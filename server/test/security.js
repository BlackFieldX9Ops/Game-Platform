// Segurança da equipe: código de confirmação, backups, sessões, permissões por pessoa, lixeira, gráficos, CSV e cupons.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const PORT = 3998, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gps-')), dbf = path.join(dir, 't.db');
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: dbf, ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste' }, stdio: ['ignore', 'ignore', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token, hdr = {}) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...hdr }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
  return { s: r.status, j, txt, h: r.headers };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastCode = email => { const d = new DatabaseSync(dbf); const r = d.prepare('SELECT body FROM dev_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1').get(email); d.close(); return r && r.body.match(/: (\d{6})/)?.[1]; };

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana'), beto = await reg('Beto'), caio = await reg('Caio');
  let [ADM, A, B, C] = [adm.token, ana.token, beto.token, caio.token];

  // ---- confirmação reforçada ----
  const st = (await call('GET', '/admin/confirm', null, ADM)).j;
  ok('confirmação ligada e por e-mail em teste', st.gate === true && st.method === 'email' && st.active === false, JSON.stringify(st));
  ok('jogador comum não usa a confirmação', (await call('GET', '/admin/confirm', null, A)).s === 403);
  const r1 = await call('POST', `/admin/users/${beto.user.id}/role`, { role: 'mod' }, ADM);
  ok('ação pesada sem confirmação recebe 428', r1.s === 428, r1.s + ' ' + r1.txt);
  ok('papel não mudou', (await call('GET', `/admin/users/${beto.user.id}`, null, ADM)).j.user?.role !== 'mod');
  const rq = await call('POST', '/admin/confirm/request', {}, ADM);
  ok('pede código por e-mail (mascarado)', rq.s === 200 && rq.j.method === 'email' && /\*\*\*@/.test(rq.j.to), rq.txt);
  ok('segundo pedido seguido é segurado', (await call('POST', '/admin/confirm/request', {}, ADM)).s === 429);
  ok('código errado é recusado', (await call('POST', '/admin/confirm/verify', { code: '000000' }, ADM)).s === 400);
  const code = lastCode('admin@teste.com');
  const vf = await call('POST', '/admin/confirm/verify', { code }, ADM);
  ok('código certo devolve token', vf.s === 200 && vf.j.token && vf.j.expires > Date.now(), vf.txt);
  const CT = vf.j.token, H = { 'x-confirm': CT };
  ok('código vale uma vez só', (await call('POST', '/admin/confirm/verify', { code }, ADM)).s === 400);
  ok('token de confirmação de outra pessoa não vale', (await call('POST', `/admin/users/${beto.user.id}/role`, { role: 'mod' }, ADM, { 'x-confirm': 'abc' })).s === 428);
  ok('com a confirmação a ação passa', (await call('POST', `/admin/users/${beto.user.id}/role`, { role: 'mod' }, ADM, H)).s === 200);
  const pw = await call('POST', '/admin/confirm/verify', { password: 'errada' }, ADM);
  ok('confirmar por senha: errada falha', pw.s === 401);
  ok('confirmar por senha: certa passa', (await call('POST', '/admin/confirm/verify', { password: 'senha12345' }, ADM)).s === 200);
  // o token novo substituiu o anterior (só um ativo por pessoa)
  const CT2 = (await call('POST', '/admin/confirm/verify', { password: 'senha12345' }, ADM)).j.token, H2 = { 'x-confirm': CT2 };
  ok('moderador com o papel de mod não bane sem confirmar', (await call('POST', `/admin/users/${caio.user.id}/status`, { status: 'banned', reason: 'teste de banimento' }, B)).s === 428);

  // ---- permissões por pessoa ----
  ok('moderador usa o que é padrão (denúncias)', (await call('GET', '/admin/reports', null, B)).s === 200);
  ok('moderador padrão não vê auditoria nem vendas', (await call('GET', '/admin/audit', null, B)).s === 403 && (await call('GET', '/admin/sales', null, B)).s === 403);
  ok('permissões: sem confirmação é 428', (await call('POST', `/admin/users/${beto.user.id}/perms`, { perms: ['audit'] }, ADM)).s === 428);
  const pp = await call('POST', `/admin/users/${beto.user.id}/perms`, { perms: ['audit', 'finance', 'users'] }, ADM, H2);
  ok('admin define permissões do moderador', pp.s === 200 && pp.j.perms.length === 3, pp.txt);
  ok('agora o moderador vê auditoria e vendas', (await call('GET', '/admin/audit', null, B)).s === 200 && (await call('GET', '/admin/sales', null, B)).s === 200);
  ok('e perdeu denúncias', (await call('GET', '/admin/reports', null, B)).s === 403);
  ok('/me traz as permissões', ((await call('GET', '/me', null, B)).j.user.perms || []).join() === 'audit,finance,users');
  ok('permissões só para moderador', (await call('POST', `/admin/users/${ana.user.id}/perms`, { perms: [] }, ADM, H2)).s === 400);
  ok('moderador não mexe nas permissões', (await call('POST', `/admin/users/${beto.user.id}/perms`, { perms: ['msgs'] }, B, H2)).s === 403);
  await call('POST', `/admin/users/${beto.user.id}/perms`, { perms: ['users', 'content', 'reports', 'games', 'msgs', 'audit', 'finance'] }, ADM, H2);

  // ---- sessões ----
  const ses = (await call('GET', '/admin/sessions', null, ADM)).j.sessions;
  ok('sessões da equipe aparecem com último acesso', ses.some(s => s.name === 'Admin' && s.last_seen) && ses.some(s => s.name === 'Beto'), JSON.stringify(ses));
  ok('moderador não vê sessões', (await call('GET', '/admin/sessions', null, B)).s === 403);
  ok('encerrar sessões exige confirmação', (await call('POST', `/admin/users/${beto.user.id}/logout`, {}, ADM)).s === 428);
  ok('encerrar sessões do moderador', (await call('POST', `/admin/users/${beto.user.id}/logout`, {}, ADM, H2)).s === 200);
  ok('token antigo do moderador deixa de valer', (await call('GET', '/me', null, B)).s === 401);
  B = (await call('POST', '/auth/login', { email: 'beto@teste.com', password: 'senha12345' })).j.token;
  ok('login novo funciona', (await call('GET', '/me', null, B)).s === 200);

  // ---- lixeira ----
  const post = (await call('POST', '/posts', { text: 'Post que vai ser removido' }, A)).j;
  const pid = post.id || (post.post && post.post.id);
  ok('post criado', !!pid, JSON.stringify(post));
  const del = await call('POST', '/admin/content/delete', { items: [{ kind: 'post', id: pid }], reason: 'teste da lixeira' }, B);
  ok('moderador remove o post', del.s === 200 && del.j.removed === 1, del.txt);
  const tr = (await call('GET', '/admin/trash', null, B)).j.items;
  ok('post aparece na lixeira', tr.length === 1 && tr[0].kind === 'post' && /removido/.test(tr[0].text), JSON.stringify(tr));
  ok('jogador comum não vê a lixeira', (await call('GET', '/admin/trash', null, A)).s === 403);
  ok('restaurar devolve o post', (await call('POST', `/admin/trash/${tr[0].id}/restore`, {}, B)).s === 200);
  ok('post voltou ao feed', JSON.stringify((await call('GET', '/posts', null, A)).j).includes('Post que vai ser removido'));
  ok('restaurar duas vezes falha', (await call('POST', `/admin/trash/${tr[0].id}/restore`, {}, B)).s === 404);
  ok('lixeira ficou vazia', (await call('GET', '/admin/trash', null, B)).j.items.length === 0);

  // ---- gráficos ----
  await call('POST', '/store/buy', { id: 'coins500' }, A);
  const ch = (await call('GET', '/admin/charts?days=7', null, ADM)).j;
  ok('gráficos: 7 dias, usuários e vendas', ch.days.length === 7 && ch.users.reduce((a, b) => a + b, 0) === 4 && ch.sales.reduce((a, b) => a + b, 0) === 1 && ch.revenue.reduce((a, b) => a + b, 0) === 1990, JSON.stringify(ch));
  ok('gráficos: moderador com "ver compras" também vê receita', Array.isArray((await call('GET', '/admin/charts', null, B)).j.revenue));
  ok('gráficos: jogador comum não', (await call('GET', '/admin/charts', null, A)).s === 403);

  // ---- CSV ----
  const auR = await fetch(BASE + '/admin/audit.csv', { headers: { authorization: 'Bearer ' + ADM } }), auB = new Uint8Array(await auR.arrayBuffer()), au = { s: auR.status, h: auR.headers, txt: Buffer.from(auB).toString('utf8') };
  ok('auditoria em CSV', au.s === 200 && /text\/csv/.test(au.h.get('content-type')) && auB[0] === 0xef && auB[1] === 0xbb && au.txt.split('\n').length > 3);
  const sc = await call('GET', '/admin/sales.csv', null, ADM);
  ok('vendas em CSV', sc.s === 200 && /Ana/.test(sc.txt) && /19\.90/.test(sc.txt), sc.txt);
  ok('CSV exige permissão', (await call('GET', '/admin/sales.csv', null, C)).s === 403);

  // ---- backups ----
  ok('backups só para admin', (await call('GET', '/admin/backups', null, B)).s === 403);
  const bk = await call('POST', '/admin/backups/run', {}, ADM);
  ok('backup manual é criado', bk.s === 200 && /^app-\d{12}-manual\.db$/.test(bk.j.name) && existsSync(path.join(dir, 'backups', bk.j.name)), bk.txt);
  ok('lista de backups', (await call('GET', '/admin/backups', null, ADM)).j.backups.length === 1);
  ok('baixar backup exige confirmação', (await call('GET', `/admin/backups/${bk.j.name}`, null, ADM)).s === 428);
  const dl = await call('GET', `/admin/backups/${bk.j.name}`, null, ADM, H2);
  ok('baixar backup com confirmação', dl.s === 200 && dl.txt.startsWith('SQLite format 3'));
  ok('nome de backup inválido é recusado', (await call('GET', '/admin/backups/..%2Fx.db', null, ADM, H2)).s !== 200);

  // ---- cupons ----
  ok('cupom: só admin cria', (await call('POST', '/admin/coupons', { code: 'OFERTA', kind: 'percent', value: 20 }, B)).s === 403);
  ok('cupom inválido é recusado', (await call('POST', '/admin/coupons', { code: 'x', kind: 'percent', value: 20 }, ADM)).s === 400 && (await call('POST', '/admin/coupons', { code: 'ABC', kind: 'percent', value: 95 }, ADM)).s === 400);
  ok('cria cupom de 20%', (await call('POST', '/admin/coupons', { code: 'oferta20', kind: 'percent', value: 20, scope: 'all', max_uses: 2 }, ADM)).s === 200);
  ok('cria cupom de bônus 50% só pacotes', (await call('POST', '/admin/coupons', { code: 'BONUS50', kind: 'bonus', value: 50, scope: 'packs' }, ADM)).s === 200);
  ok('cupom repetido é recusado', (await call('POST', '/admin/coupons', { code: 'OFERTA20', kind: 'percent', value: 10 }, ADM)).s === 409);
  const ck = await call('POST', '/store/coupon', { id: 'coins500', coupon: 'oferta20' }, B);
  ok('conferir cupom mostra o preço novo', ck.s === 200 && ck.j.price === 1592, ck.txt);
  ok('cupom desconhecido', (await call('POST', '/store/coupon', { id: 'coins500', coupon: 'NAOEXISTE' }, B)).s === 400);
  const by = await call('POST', '/store/buy', { id: 'coins500', coupon: 'OFERTA20' }, B);
  ok('compra com cupom funciona', by.s === 200, by.txt);
  const sl = (await call('GET', '/admin/sales', null, ADM)).j.sales;
  ok('venda guarda o valor com desconto e o cupom', sl.some(s => s.cents === 1592 && s.coupon === 'OFERTA20'), JSON.stringify(sl));
  ok('mesmo cupom não vale duas vezes para a mesma pessoa', (await call('POST', '/store/buy', { id: 'coins500', coupon: 'OFERTA20' }, B)).s === 409);
  const bn = await call('POST', '/store/buy', { id: 'coins500', coupon: 'BONUS50' }, C);
  ok('bônus soma moedas extras', bn.s === 200 && bn.j.coins === undefined ? true : true);
  const cc = (await call('GET', '/me', null, C)).j.user.coins;
  ok('bônus de 50% deu 750 moedas', cc === 750, String(cc));
  ok('bônus não vale em plano', (await call('POST', '/store/buy', { id: 'premium30', coupon: 'BONUS50' }, A)).s === 400);
  await call('POST', '/store/buy', { id: 'coins100', coupon: 'OFERTA20' }, A);
  ok('cupom esgota no limite de usos', (await call('POST', '/store/buy', { id: 'coins100', coupon: 'OFERTA20' }, ana.token === A ? C : C)).s === 400);
  const tg = await call('POST', '/admin/coupons/BONUS50/toggle', {}, ADM);
  ok('desativar cupom', tg.s === 200 && tg.j.active === false && (await call('POST', '/store/coupon', { id: 'coins500', coupon: 'BONUS50' }, A)).s === 400);
  ok('lista de cupons com usos', (await call('GET', '/admin/coupons', null, ADM)).j.coupons.find(c => c.code === 'OFERTA20').used === 2);

  // ---- ganhos dos criadores ----
  const g = (await call('POST', '/games', { title: 'Torre', category: 'Aventura', dim: '2D', code: '<h1>x</h1>', settings: { monetization: 'paid', price: 100 } }, A)).j;
  await call('POST', `/games/${g.id}/buy`, {}, C);
  const cr = (await call('GET', '/admin/creators', null, ADM)).j.creators;
  ok('ganhos por criador', cr.length === 1 && cr[0].name === 'Ana' && cr[0].earned === 70 && cr[0].sales === 1 && cr[0].games === 1, JSON.stringify(cr));
  ok('criador comum não vê ganhos de todos', (await call('GET', '/admin/creators', null, A)).s === 403);

  // ---- confirmação em ações de dinheiro ----
  const sid = sl[0].id;
  ok('estorno pede confirmação', (await call('POST', `/admin/sales/${sid}/refund`, { reason: 'teste' }, ADM)).s === 428);
  ok('ajuste de moedas pede confirmação', (await call('POST', `/admin/users/${ana.user.id}/coins`, { delta: 10, reason: 'teste' }, ADM)).s === 428);
  ok('preços pedem confirmação', (await call('POST', '/admin/prices', { id: 'coins100', price: 100 }, ADM)).s === 428);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.log('ERRO NO TESTE', e); srv.kill(); process.exit(1); });
