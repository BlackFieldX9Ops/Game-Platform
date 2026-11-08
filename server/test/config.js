// Configurações do administrador: validação, auditoria e se o servidor realmente respeita cada uma.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3995, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpc-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste', PUSH_WORKER: 'off' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
  return { s: r.status, j, txt };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const IMG = 'data:image/png;base64,iVBORw0KGgo=';

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  const reg = async (n, pw = 'senha12345') => (await call('POST', '/api/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: pw }));
  const adm = (await reg('Admin')).j, ana = (await reg('Ana')).j, bia = (await reg('Bia')).j;
  const [ADM, A, B] = [adm.token, ana.token, bia.token];
  const cfg = (patch, t = ADM) => call('POST', '/api/admin/config', patch, t);

  // leitura e permissão
  let r = await call('GET', '/api/admin/config', null, ADM);
  ok('o painel recebe grupos, campos e valores atuais', r.s === 200 && r.j.groups.length >= 5 && r.j.fields.length >= 20 && r.j.values.maxMsgLen === 300 && r.j.values.signupOpen === true, r.txt.slice(0, 120));
  ok('as categorias de notificação vêm marcadas (segurança travada)', r.j.cats.security && r.j.cats.security.locked === true);
  ok('jogador não vê as configurações', (await call('GET', '/api/admin/config', null, A)).s === 403);
  ok('jogador não altera as configurações', (await cfg({ maxMsgLen: 100 }, A)).s === 403);

  // validação
  ok('número fora do limite é recusado', (await cfg({ maxMsgLen: 5 })).s === 400);
  ok('texto no lugar de número é recusado', (await cfg({ welcomeCoins: 'muitas' })).s === 400);
  ok('horário inválido é recusado', (await cfg({ quietFrom: '25:99' })).s === 400);
  ok('senha mínima abaixo de 8 é recusada', (await cfg({ minPassword: 4 })).s === 400);
  ok('nada mudou depois dos erros', (await call('GET', '/api/admin/config', null, ADM)).j.values.maxMsgLen === 300);
  r = await cfg({ maxMsgLen: 300 });
  ok('salvar o mesmo valor não muda nada', r.s === 200 && r.j.unchanged === true);

  // cadastro
  r = await cfg({ minPassword: 12, blockedDomains: 'Lixo.com\nspam.net, lixo.com' });
  ok('admin salva senha mínima e domínios (sem repetidos)', r.s === 200 && r.j.values.minPassword === 12 && r.j.values.blockedDomains.length === 2, r.txt);
  ok('senha curta não cadastra', (await reg('Curta', 'senha12345')).s === 400);
  ok('domínio bloqueado não cadastra', (await call('POST', '/api/auth/register', { name: 'Zeca', email: 'zeca@lixo.com', password: 'senha-bem-longa-1' })).s === 403);
  ok('senha longa e e-mail normal cadastram', (await call('POST', '/api/auth/register', { name: 'Caio', email: 'caio@teste.com', password: 'senha-bem-longa-1' })).s === 201);
  await cfg({ minPassword: 8, blockedDomains: [], signupOpen: false });
  r = await reg('Dani');
  ok('cadastros fechados recusam gente nova', r.s === 403 && /fechados/.test(r.txt), r.txt);
  ok('quem já tem conta continua entrando', (await call('POST', '/api/auth/login', { email: 'ana@teste.com', password: 'senha12345' })).s === 200);
  await cfg({ signupOpen: true, welcomeCoins: 25 });
  r = await reg('Edu');
  ok('moedas de boas-vindas entram na conta nova', r.s === 201 && (r.j.user.coins || 0) === 25, r.txt.slice(0, 160));

  // economia
  r = await call('POST', '/api/store/daily', null, A);
  ok('bônus diário padrão (10)', r.s === 200 && (r.j.reward === 10 || r.j.got === 10 || r.j.coins >= 10), r.txt);
  await cfg({ dailyCoins: 40 });
  const st = (await call('GET', '/api/store', null, B)).j;
  ok('o bônus diário mostra o valor novo', st.daily && st.daily.reward === 40, JSON.stringify(st.daily));
  const c0 = (await call('GET', '/api/store', null, B)).j.coins;
  await call('POST', '/api/store/daily', null, B);
  ok('e entrega o valor novo', (await call('GET', '/api/store', null, B)).j.coins === c0 + 40);
  await call('POST', '/api/store/checkout', { id: 'premium30' }, B);
  await cfg({ premiumBonusPct: 50 });
  const c1 = (await call('GET', '/api/store', null, B)).j.coins;
  await call('POST', '/api/store/checkout', { id: 'coins500' }, B);
  const c2 = (await call('GET', '/api/store', null, B)).j.coins;
  ok('bônus do Premium nos pacotes segue a configuração (+50%)', c2 - c1 === 750, `ganhou ${c2 - c1}`);

  // moderação e chat
  await cfg({ bannedWords: 'Palavrão\ncoisa feia' });
  r = await call('POST', '/api/posts', { text: 'que PALAVRÃO horrível' }, A);
  ok('publicação com palavra proibida é recusada (sem acento/maiúscula)', r.s === 400, r.txt);
  ok('palavra dentro de outra não conta', (await call('POST', '/api/posts', { text: 'palavrões não é a mesma palavra? sim é outra' }, A)).s === 201);
  ok('frase proibida também vale', (await call('POST', '/api/posts', { text: 'isso é uma coisa  feia mesmo' }, A)).s === 400);
  r = await call('POST', '/api/spaces', { kind: 'group', name: 'Turma', access: 'public' }, A);
  const sid = r.j.id || (r.j.space && r.j.space.id);
  ok('grupo criado', r.s === 201 && sid, r.txt);
  await call('POST', `/api/spaces/${sid}/join`, null, B);
  ok('mensagem com palavra proibida é recusada no grupo', (await call('POST', `/api/spaces/${sid}/messages`, { text: 'olha o palavrão' }, A)).s === 400);
  await cfg({ bannedWords: [], maxMsgLen: 50 });
  r = await call('POST', `/api/spaces/${sid}/messages`, { text: 'x'.repeat(120) }, A);
  ok('mensagem é cortada no tamanho máximo', r.s === 201 && r.j.message.text.length === 50, r.txt.slice(0, 160));
  await cfg({ allowImages: false });
  ok('imagem recusada quando desligada', (await call('POST', `/api/spaces/${sid}/messages`, { text: 'foto', image: IMG }, A)).s === 403);
  ok('texto continua passando', (await call('POST', `/api/spaces/${sid}/messages`, { text: 'só texto' }, A)).s === 201);
  await cfg({ allowImages: true, slowModeSec: 30 });
  ok('1ª mensagem passa no modo lento', (await call('POST', `/api/spaces/${sid}/messages`, { text: 'oi' }, B)).s === 201);
  r = await call('POST', `/api/spaces/${sid}/messages`, { text: 'oi de novo' }, B);
  ok('2ª mensagem seguida espera', r.s === 429 && /Espere/.test(r.txt), r.txt);
  await cfg({ slowModeSec: 0, allowSpaceCreate: false });
  ok('jogador não cria grupo quando desligado', (await call('POST', '/api/spaces', { kind: 'group', name: 'Outra', access: 'public' }, A)).s === 403);
  ok('administrador ainda cria', (await call('POST', '/api/spaces', { kind: 'group', name: 'Equipe', access: 'public' }, ADM)).s === 201);
  await cfg({ allowSpaceCreate: true });

  // denúncias
  await cfg({ reportsPerHour: 1 });
  const p = await call('POST', '/api/posts', { text: 'post para denunciar' }, B);
  ok('1ª denúncia passa', (await call('POST', '/api/reports', { targetType: 'post', targetId: p.j.id, reason: 'spam aqui' }, A)).s === 201);
  ok('2ª denúncia na mesma hora é recusada', (await call('POST', '/api/reports', { targetType: 'post', targetId: p.j.id, reason: 'spam de novo' }, A)).s === 429);

  // notificações e aviso no app
  r = await cfg({ pushOffCats: ['security', 'event'], pushDailyLimit: 5, quietDefault: true, quietFrom: '23:00', quietTo: '06:30' });
  ok('categorias travadas (segurança) não podem ser desligadas', r.s === 200 && !r.j.values.pushOffCats.includes('security') && r.j.values.pushOffCats.includes('event'), r.txt);
  const pf = (await call('GET', '/api/push/prefs', null, A)).j.prefs;
  ok('o horário silencioso padrão chega às preferências de quem não mexeu', pf.quiet.on === true && pf.quiet.from === '23:00' && pf.quiet.to === '06:30', JSON.stringify(pf.quiet));
  await cfg({ homeNotice: '  Manutenção no sábado  ' });
  r = await call('GET', '/api/platform');
  ok('o aviso do app é público e aparado', r.j.notice === 'Manutenção no sábado', r.txt);

  // auditoria
  r = await call('GET', '/api/admin/audit', null, ADM);
  const txt = JSON.stringify(r.j);
  ok('as mudanças ficam na auditoria com antes → depois', r.s === 200 && /Configurações alteradas/.test(txt) && /→/.test(txt), txt.slice(0, 200));

  console.log(`\n${pass} ok, ${fail} falhas`);
  srv.kill(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
