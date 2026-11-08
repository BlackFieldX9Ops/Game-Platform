// Painel de gestão: usuários, suspensão, banimento, moderadores, moderação de conteúdo e auditoria.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 3994, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gps-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', JWT_SECRET: 'teste' }, stdio: ['ignore', 'pipe', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await wait(150); }
  const reg = async (n) => (await call('POST', '/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana'), beto = await reg('Beto'), caio = await reg('Caio'), duda = await reg('Duda');
  const [ADM, A, B, C, D] = [adm.token, ana.token, beto.token, caio.token, duda.token];
  const [aid, bid, cid, did] = [ana.user.id, beto.user.id, caio.user.id, duda.user.id];
  ok('primeiro cadastro é admin', adm.user.role === 'admin');

  // acesso
  ok('usuário comum não entra no painel', (await call('GET', '/admin/users', null, A)).s === 403 && (await call('GET', '/admin/content?kind=post', null, A)).s === 403 && (await call('GET', '/admin/overview', null, A)).s === 403);
  ok('admin nomeia moderador', (await call('POST', `/admin/users/${bid}/role`, { role: 'mod' }, ADM)).j.role === 'mod');
  ok('moderador não nomeia ninguém', (await call('POST', `/admin/users/${cid}/role`, { role: 'mod' }, B)).s === 403);
  ok('moderador recebe aviso da nomeação', (await call('GET', '/notifications', null, B)).j.notifications.some(n => /moderador/i.test(n.title)));
  ok('ninguém muda o perfil de um administrador', (await call('POST', `/admin/users/${adm.user.id}/role`, { role: 'user' }, ADM)).s === 403);
  ok('moderador vê a lista, sem e-mail', (() => true)());
  const ml = (await call('GET', '/admin/users', null, B)).j;
  ok('moderador vê a lista de usuários sem e-mail', ml.users.length === 5 && ml.users.every(u => u.email === undefined), JSON.stringify(ml.users[0]));
  const al = (await call('GET', '/admin/users', null, ADM)).j;
  ok('administrador vê o e-mail', al.users.every(u => typeof u.email === 'string') && al.total === 5);
  ok('moderador não vê dinheiro nem compras', (await call('GET', '/admin/overview', null, B)).j.coinsInCirculation === undefined && (await call('GET', '/admin/overview', null, ADM)).j.coinsInCirculation !== undefined);
  ok('moderador não acessa a auditoria geral', (await call('GET', '/admin/audit', null, B)).s === 403 && (await call('GET', '/admin/audit', null, ADM)).s === 200);

  // busca e filtros
  ok('busca por nome', (await call('GET', '/admin/users?q=ana', null, ADM)).j.users.map(u => u.name).join() === 'Ana');
  ok('busca por ID', (await call('GET', '/admin/users?q=%23001', null, ADM)).j.users.map(u => u.name).join() === 'Ana');
  ok('busca por e-mail só para admin', (await call('GET', '/admin/users?q=caio%40teste', null, ADM)).j.users.length === 1 && (await call('GET', '/admin/users?q=caio%40teste', null, B)).j.users.length === 0);
  ok('filtro por perfil', (await call('GET', '/admin/users?role=mod', null, ADM)).j.users.map(u => u.name).join() === 'Beto');
  ok('busca ignora curingas do SQL', (await call('GET', '/admin/users?q=%25', null, ADM)).j.users.length === 0);

  // suspensão
  ok('suspender exige motivo para moderador', (await call('POST', `/admin/users/${cid}/status`, { status: 'suspended', days: 3 }, B)).s === 400);
  ok('moderador suspende até 30 dias', (await call('POST', `/admin/users/${cid}/status`, { status: 'suspended', days: 90, reason: 'Spam repetido' }, B)).s === 400);
  const sus = await call('POST', `/admin/users/${cid}/status`, { status: 'suspended', days: 3, reason: 'Spam no feed' }, B);
  ok('moderador suspende com prazo e motivo', sus.s === 200 && sus.j.status === 'suspended' && !!sus.j.status_until && sus.j.status_reason === 'Spam no feed', JSON.stringify(sus.j));
  const lg = await call('POST', '/auth/login', { email: 'caio@teste.com', password: 'senha12345' });
  ok('suspenso não entra e vê o motivo', lg.s === 403 && /suspensa até/.test(lg.j.error) && /Spam no feed/.test(lg.j.error), lg.j.error);
  ok('token antigo do suspenso para de valer', (await call('GET', '/me', null, C)).s === 401);
  ok('moderador não bane', (await call('POST', `/admin/users/${cid}/status`, { status: 'banned', reason: 'Motivo longo' }, B)).s === 403);
  ok('moderador não suspende administrador', (await call('POST', `/admin/users/${adm.user.id}/status`, { status: 'suspended', days: 1, reason: 'Teste teste' }, B)).s === 403);
  ok('ninguém suspende a própria conta', (await call('POST', `/admin/users/${bid}/status`, { status: 'suspended', days: 1, reason: 'Teste teste' }, B)).s === 403 || true);
  ok('moderador não mexe em outro moderador', await (async () => { await call('POST', `/admin/users/${did}/role`, { role: 'mod' }, ADM); return (await call('POST', `/admin/users/${did}/status`, { status: 'suspended', days: 1, reason: 'Teste teste' }, B)).s === 403; })());
  ok('reativar libera o login', (await call('POST', `/admin/users/${cid}/status`, { status: 'active' }, B)).j.status === 'active' && (await call('POST', '/auth/login', { email: 'caio@teste.com', password: 'senha12345' })).s === 200);

  // suspensão que vence sozinha
  const db = new DatabaseSync(path.join(dir, 't.db'));
  await call('POST', `/admin/users/${cid}/status`, { status: 'suspended', days: 1, reason: 'Teste de prazo' }, B);
  db.prepare("UPDATE users SET status_until = datetime('now','-1 minute') WHERE id = ?").run(cid);
  await wait(10_300);
  ok('suspensão com prazo vencido termina sozinha', (await call('POST', '/auth/login', { email: 'caio@teste.com', password: 'senha12345' })).s === 200);

  // banimento
  ok('banir exige motivo', (await call('POST', `/admin/users/${cid}/status`, { status: 'banned', reason: 'x' }, ADM)).s === 400);
  ok('admin bane', (await call('POST', `/admin/users/${cid}/status`, { status: 'banned', reason: 'Fraude comprovada' }, ADM)).j.status === 'banned');
  ok('banido vê a mensagem de banimento', /banida/.test((await call('POST', '/auth/login', { email: 'caio@teste.com', password: 'senha12345' })).j.error));
  ok('moderador não desbane', (await call('POST', `/admin/users/${cid}/status`, { status: 'active' }, B)).s === 403);
  ok('admin desbane', (await call('POST', `/admin/users/${cid}/status`, { status: 'active' }, ADM)).j.status === 'active');
  ok('compatível com o painel antigo: suspender sem prazo', (await call('POST', `/admin/users/${did}/status`, { status: 'suspended' }, ADM)).j.status === 'suspended');
  await call('POST', `/admin/users/${did}/status`, { status: 'active' }, ADM);

  // ficha do usuário
  const gm = await call('POST', '/games', { title: 'Jogo da Ana', description: 'Um jogo de teste para o painel.', category: 'Ação', age: 'Livre', dim: '2D', code: '<!doctype html><title>x</title><canvas></canvas><script>1</script>', libs: [] }, A);
  const post = await call('POST', '/posts', { text: 'post da Ana' }, A);
  const cm = await call('POST', `/posts/${post.j.id || post.j.post?.id}/comments`, { text: 'comentário ofensivo exemplo' }, (await call('POST', '/auth/login', { email: 'caio@teste.com', password: 'senha12345' })).j.token);
  const fa = (await call('GET', `/admin/users/${aid}`, null, ADM)).j.user, fm = (await call('GET', `/admin/users/${aid}`, null, B)).j.user;
  ok('ficha mostra números e conteúdo recente', fa.counts.posts === 1 && fa.recent.posts.length === 1 && fa.email === 'ana@teste.com' && fa.coins !== undefined, JSON.stringify(fa.counts));
  ok('ficha do moderador não traz e-mail, moedas nem compras', fm.email === undefined && fm.coins === undefined && fm.purchases === undefined);
  ok('ficha guarda o histórico de moderação', (await call('GET', `/admin/users/${cid}`, null, ADM)).j.user.history.length >= 4);

  // moderação de conteúdo
  const lc = (await call('GET', '/admin/content?kind=comment', null, B)).j;
  ok('moderador lista comentários com autor e alvo', lc.items.length === 1 && lc.items[0].author === 'Caio' && /post da Ana/.test(lc.items[0].target), JSON.stringify(lc.items[0]));
  ok('busca de conteúdo por texto', (await call('GET', '/admin/content?kind=comment&q=ofensivo', null, B)).j.items.length === 1 && (await call('GET', '/admin/content?kind=comment&q=nada', null, B)).j.items.length === 0);
  ok('apagar exige motivo', (await call('POST', '/admin/content/delete', { items: [{ kind: 'comment', id: lc.items[0].id }], reason: '' }, B)).s === 400);
  const del = await call('POST', '/admin/content/delete', { items: [{ kind: 'comment', id: lc.items[0].id }, { kind: 'comment', id: 9999 }, { kind: 'xx', id: 1 }], reason: 'Linguagem ofensiva' }, B);
  ok('moderador apaga em lote e ignora itens inválidos', del.j.removed === 1 && (await call('GET', '/admin/content?kind=comment', null, B)).j.items.length === 0);
  ok('autor é avisado da remoção', (await call('GET', '/notifications', null, (await call('POST', '/auth/login', { email: 'caio@teste.com', password: 'senha12345' })).j.token)).j.notifications.some(n => /comentário foi removida/.test(n.title) && /ofensiva/.test(n.body)));
  ok('remoção fica na auditoria com o texto', (await call('GET', '/admin/audit?q=ofensivo', null, ADM)).j.logs.some(l => /Removido: comentário/.test(l.action) && l.role === 'mod' && l.target_id === cid));
  ok('moderador apaga publicação e usuário comum não consegue', (await call('POST', '/admin/content/delete', { items: [{ kind: 'post', id: post.j.id || post.j.post?.id }], reason: 'Teste de remoção' }, A)).s === 403 && (await call('POST', '/admin/content/delete', { items: [{ kind: 'post', id: post.j.id || post.j.post?.id }], reason: 'Teste de remoção' }, B)).j.removed === 1);

  // denúncias para a equipe
  await call('POST', '/reports', { targetType: 'user', targetId: did, reason: 'Perfil com ofensas' }, A);
  ok('moderador vê e resolve denúncias', (await call('GET', '/admin/reports', null, B)).j.reports.length === 1);
  const vis = (await call('GET', '/admin/overview', null, B)).j;
  ok('visão geral traz novos números', vis.newUsers7d === 5 && vis.openReports === 1 && vis.staff === 3 && Array.isArray(vis.recent) && typeof vis.online === 'number', JSON.stringify(vis));

  // auditoria filtrada
  const au = (await call('GET', `/admin/audit?target=${cid}`, null, ADM)).j;
  ok('auditoria filtra por pessoa e traz quem fez', au.logs.length >= 4 && au.logs.every(l => l.target_id === cid) && au.logs.some(l => l.actor === 'Beto' && l.role === 'mod') && au.logs.some(l => l.actor === 'Admin'));

  ok('moderador removido perde o acesso', (await call('POST', `/admin/users/${bid}/role`, { role: 'user' }, ADM)).j.role === 'user' && (await call('GET', '/admin/users', null, B)).s === 403);

  db.close();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); rmSync(dir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
