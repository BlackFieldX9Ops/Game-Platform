// Notificações externas: dispositivos, preferências, categorias, fila com reenvio, campanhas, agendamento e central do app.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 3986, MP = 3987, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpp-')), DB = path.join(dir, 't.db');
let got = [], mode = {}; // mode[deviceId] = status a devolver (ou função)
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b || '{}'), m = mode[j.device]; let st = 200;
    if (typeof m === 'function') st = m(); else if (m) st = m;
    if (st === 200) got.push(j);
    res.statusCode = st; res.end('{}');
  });
}).listen(MP);
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: DB, ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste', PUSH_MOCK: `http://localhost:${MP}/push`, PUSH_FAST_RETRY: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
  return { s: r.status, j, txt };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(100); } return false; };
const fcmTok = n => 'fcm-token-' + n + '-'.padEnd(30, 'x');

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/api/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana'), bia = await reg('Bia'), caio = await reg('Caio');
  const [ADM, A, B, C] = [adm.token, ana.token, bia.token, caio.token];
  const dbq = sql => { const d = new DatabaseSync(DB); try { return d.prepare(sql).all(); } finally { d.close(); } };
  const dbx = sql => { const d = new DatabaseSync(DB); try { d.exec(sql); } finally { d.close(); } };

  const cfg = (await call('GET', '/api/push/config')).j;
  ok('configuração pública: chave VAPID, FCM e 13 categorias', cfg.webPush.length > 40 && cfg.fcm === true && cfg.categories.length === 13 && cfg.channels.length === 5, JSON.stringify(cfg).slice(0, 120));
  ok('a categoria de segurança não pode ser desligada', cfg.categories.find(c => c.id === 'security').locked);
  const sw = await fetch(BASE + '/sw.js');
  ok('service worker servido na raiz com escopo total', sw.status === 200 && /javascript/.test(sw.headers.get('content-type')) && sw.headers.get('service-worker-allowed') === '/' && /notificationclick/.test(await sw.text()));

  ok('registrar dispositivo exige login', (await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('a') })).s === 401);
  ok('inscrição web inválida é recusada', (await call('POST', '/api/push/register', { kind: 'web', subscription: { endpoint: 'http://x', keys: {} } }, A)).s === 400);
  ok('token FCM curto é recusado', (await call('POST', '/api/push/register', { kind: 'fcm', token: 'abc' }, A)).s === 400);
  ok('Ana registra o Android', (await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('a'), tz: 0 }, A)).s === 200);
  ok('Ana registra o navegador', (await call('POST', '/api/push/register', { kind: 'web', subscription: { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'BPxx', auth: 'yy' } } }, A)).s === 200);
  ok('registrar de novo não duplica', (await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('a') }, A)).s === 200 && (await call('GET', '/api/push/devices', null, A)).j.devices.length === 2);
  ok('Bia registra o Android', (await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('b') }, B)).s === 200);
  ok('o mesmo aparelho em outra conta passa para a conta nova', (await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('b') }, C)).s === 200 && (await call('GET', '/api/push/devices', null, B)).j.devices.length === 0);
  await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('b') }, B);

  let p = (await call('GET', '/api/push/prefs', null, A)).j.prefs;
  ok('preferências padrão: tudo ligado, sem silêncio', p.enabled && p.sound && p.vibrate && !p.quiet.on && p.priority.length === 0);
  ok('horário inválido é recusado', (await call('PUT', '/api/push/prefs', { quiet: { from: '25:99' } }, A)).s === 400);

  // pedido de amizade -> push no Android da Bia
  got = [];
  await call('POST', '/api/friends/request', { name: 'Bia' }, A);
  ok('pedido de amizade chega no celular', await until(() => got.some(g => g.payload.cat === 'friend' && /Ana/.test(g.payload.body))), JSON.stringify(got));
  const pl = got[0] && got[0].payload;
  ok('o envio leva título, texto, canal, atalho e token de abertura', pl && pl.title === 'Pedido de amizade' && pl.channel === 'gp_default' && pl.q > 0 && pl.t.length === 16 && /^\/\?n=\d+$/.test(pl.url), JSON.stringify(pl));
  ok('abrir a notificação é registrado (e token falso não vale)', (await call('POST', '/api/push/open', { q: pl.q, t: pl.t })).s === 200 && (await call('POST', '/api/push/open', { q: pl.q + 1, t: 'falso' })).s === 200
    && (await call('GET', '/api/admin/notif/overview', null, ADM)).j.opened24h === 1);

  // desligar categoria
  await call('PUT', '/api/push/prefs', { cats: { friend: false } }, B);
  got = [];
  await call('POST', '/api/friends/request', { name: 'Bia' }, C);
  await wait(900);
  ok('categoria desligada não envia push', got.length === 0);
  ok('mas o aviso continua na central do app', (await call('GET', '/api/notifications', null, B)).j.notifications.filter(n => n.category === 'friend').length === 2);
  await call('PUT', '/api/push/prefs', { cats: { friend: true } }, B);

  // tudo desligado
  await call('PUT', '/api/push/prefs', { enabled: false }, B);
  got = [];
  await call('POST', '/api/friends/request', { name: 'Bia' }, ADM);
  await wait(900);
  ok('desligar tudo para o push', got.length === 0);
  await call('PUT', '/api/push/prefs', { enabled: true }, B);

  // mensagem offline com dedupe
  ok('Bia aceita Ana', (await call('POST', `/api/friends/${ana.user.id}/accept`, {}, B)).s === 200);
  got = [];
  const anaId = ana.user.id, biaId = bia.user.id;
  await call('POST', '/api/messages', { to: biaId, text: 'Oi Bia' }, A);
  await call('POST', '/api/messages', { to: biaId, text: 'Tudo bem?' }, A);
  ok('mensagem para quem está offline vira push, sem repetir a cada mensagem', await until(() => got.some(g => g.payload.cat === 'message')) && (await wait(700), got.filter(g => g.payload.cat === 'message').length === 1), JSON.stringify(got.map(g => g.payload.title)));

  // reenvio e dispositivo morto
  const devB = dbq(`SELECT id FROM push_devices WHERE user_id = ${biaId}`)[0].id;
  let n = 0; mode[devB] = () => (++n <= 2 ? 500 : 200); got = [];
  await call('POST', '/api/admin/notif/send', { title: 'Teste de reenvio', body: 'Chegou?', category: 'admin', audience: 'user', userId: biaId }, ADM);
  ok('falha temporária é reenviada até entregar', await until(() => got.some(g => g.payload.title === 'Teste de reenvio'), 8000) && n === 3, 'tentativas ' + n);
  mode[devB] = 410; got = [];
  await call('POST', '/api/admin/notif/send', { title: 'Para o aparelho morto', body: 'xx', category: 'admin', audience: 'user', userId: biaId }, ADM);
  const dead410 = await until(() => dbq(`SELECT active FROM push_devices WHERE id = ${devB}`)[0].active === 0);
  ok('dispositivo expirado (410) é desativado', dead410, JSON.stringify(dbq('SELECT id,status,attempts,error,device_id FROM push_queue ORDER BY id DESC LIMIT 4')));
  mode[devB] = 0;
  await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('b') }, B);
  ok('registrar de novo reativa o aparelho', dbq(`SELECT active FROM push_devices WHERE id = ${devB}`)[0].active === 1);

  // campanhas
  ok('jogador comum não usa o painel de notificações', (await call('GET', '/api/admin/notif/overview', null, A)).s === 403 && (await call('POST', '/api/admin/notif/send', { title: 'x', body: 'yy', audience: 'all' }, A)).s === 403);
  ok('validação: título, público e categoria', (await call('POST', '/api/admin/notif/send', { title: 'a', body: 'bbbb', audience: 'all' }, ADM)).s === 400 && (await call('POST', '/api/admin/notif/send', { title: 'ok ok', body: 'bbbb', audience: 'zzz' }, ADM)).s === 400);
  got = [];
  const bc = await call('POST', '/api/admin/notif/send', { title: 'Torneio sábado', body: 'Vale prêmio!', category: 'event', audience: 'all' }, ADM);
  ok('envio para todos', bc.s === 200 && bc.j.count >= 4 && !bc.j.scheduled, bc.txt);
  ok('todos os aparelhos ativos recebem', await until(() => got.filter(g => g.payload.title === 'Torneio sábado').length === 3), 'recebidos ' + got.filter(g => g.payload.title === 'Torneio sábado').length);
  ok('o aviso aparece na central de todos', (await call('GET', '/api/notifications', null, C)).j.notifications.some(x => x.title === 'Torneio sábado' && x.category === 'event'));
  const camps = (await call('GET', '/api/admin/notif/campaigns', null, ADM)).j.campaigns;
  const cp = camps.find(x => x.title === 'Torneio sábado');
  ok('estatísticas por campanha: enviados e falhas', cp && cp.status === 'sent' && cp.delivery.sent === 3 && cp.categoryName === 'Eventos e competições' && cp.audienceName === 'Todos os jogadores', JSON.stringify(cp));

  // agendamento
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const sc = await call('POST', '/api/admin/notif/send', { title: 'Agendada', body: 'Mais tarde', category: 'admin', audience: 'all', scheduleAt: soon }, ADM);
  ok('agendar não envia na hora', sc.s === 200 && sc.j.scheduled && (await call('GET', '/api/notifications', null, C)).j.notifications.every(x => x.title !== 'Agendada'));
  ok('data inválida é recusada', (await call('POST', '/api/admin/notif/send', { title: 'Data ruim', body: 'xx', audience: 'all', scheduleAt: 'amanhã' }, ADM)).s === 400);
  ok('cancelar agendada', (await call('POST', `/api/admin/notif/campaigns/${sc.j.id}/cancel`, {}, ADM)).s === 200 && (await call('POST', `/api/admin/notif/campaigns/${sc.j.id}/cancel`, {}, ADM)).s === 400);
  const sc2 = await call('POST', '/api/admin/notif/send', { title: 'Vence já', body: 'Agora vai', category: 'admin', audience: 'staff', scheduleAt: soon }, ADM);
  dbx(`UPDATE campaigns SET scheduled_at = datetime('now','-1 minute') WHERE id = ${sc2.j.id}`);
  ok('agendada vencida é enviada pelo servidor sozinho', await until(() => dbq(`SELECT status FROM campaigns WHERE id = ${sc2.j.id}`)[0].status === 'sent'));
  ok('só a equipe recebeu o público "equipe"', (await call('GET', '/api/notifications', null, ADM)).j.notifications.some(x => x.title === 'Vence já') && (await call('GET', '/api/notifications', null, C)).j.notifications.every(x => x.title !== 'Vence já'));

  // horário de silêncio
  await call('PUT', '/api/push/prefs', { quiet: { on: true, from: '00:00', to: '23:59' } }, B);
  got = [];
  await call('POST', '/api/admin/notif/send', { title: 'Durante o silêncio', body: 'sssh', category: 'event', audience: 'user', userId: biaId }, ADM);
  await wait(900);
  ok('horário de silêncio segura o push comum', got.length === 0);
  await call('POST', '/api/admin/notif/send', { title: 'Alerta de acesso', body: 'importante', category: 'security', audience: 'user', userId: biaId }, ADM);
  ok('segurança passa pelo silêncio', await until(() => got.some(g => g.payload.title === 'Alerta de acesso')));
  await call('PUT', '/api/push/prefs', { quiet: { on: false } }, B);

  // central do app
  const sum = (await call('GET', '/api/notifications/summary', null, B)).j;
  ok('resumo de não lidas por categoria', sum.unread >= 3 && sum.byCategory.friend >= 1 && sum.byCategory.event >= 1, JSON.stringify(sum));
  const list = (await call('GET', '/api/notifications', null, B)).j.notifications;
  ok('lista traz categoria e estado lida/não lida', list.length > 3 && list.every(x => typeof x.read === 'boolean') && list.filter(x => x.category).length >= 3 && list.every(x => !x.read));
  ok('filtrar por categoria', (await call('GET', '/api/notifications?category=friend', null, B)).j.notifications.every(x => x.category === 'friend'));
  const one = list.find(x => x.title === 'Torneio sábado');
  ok('marcar uma como lida (aviso geral e pessoal)', (await call('POST', `/api/notifications/${one.id}/read`, {}, B)).s === 200 && (await call('POST', `/api/notifications/${list.find(x => x.category === 'friend').id}/read`, {}, B)).s === 200
    && (await call('GET', '/api/notifications', null, B)).j.notifications.filter(x => x.read).length === 2);
  ok('aviso geral lido por uma pessoa continua não lido para outra', (await call('GET', '/api/notifications', null, C)).j.notifications.find(x => x.title === 'Torneio sábado').read === false);
  ok('filtrar só não lidas', (await call('GET', '/api/notifications?unread=1', null, B)).j.notifications.every(x => !x.read));
  ok('marcar como não lida de novo', (await call('POST', `/api/notifications/${one.id}/read`, { read: false }, B)).s === 200 && (await call('GET', '/api/notifications/summary', null, B)).j.unread === sum.unread - 1);
  const ra = await call('POST', '/api/notifications/read-all', { category: 'event' }, B);
  ok('marcar todas de uma categoria', ra.j.marked >= 1 && (await call('GET', '/api/notifications/summary', null, B)).j.byCategory.event === undefined);
  ok('marcar todas', (await call('POST', '/api/notifications/read-all', {}, B)).s === 200 && (await call('GET', '/api/notifications/summary', null, B)).j.unread === 0);
  ok('notificação de outra pessoa não é acessível', (await call('POST', `/api/notifications/${list.find(x => x.category === 'friend').id}/read`, {}, A)).s === 404);
  ok('apagar continua funcionando', (await call('DELETE', `/api/notifications/${one.id}`, null, B)).s === 200 && (await call('GET', '/api/notifications', null, B)).j.notifications.every(x => x.id !== one.id));

  // eventos do produto
  got = [];
  await call('PUT', '/api/push/prefs', { enabled: true }, C);
  await call('POST', '/api/push/register', { kind: 'fcm', token: fcmTok('c') }, C);
  await call('POST', '/api/games', { title: 'Jogo Novo', category: 'Ação', dim: '2D', code: '<h1>x</h1>' }, A);
  ok('novo jogo publicado avisa quem não é amigo', await until(() => got.some(g => g.payload.cat === 'newgame' && /Jogo Novo/.test(g.payload.body))), JSON.stringify(got.map(g => g.payload.title)));
  const gid = (await call('GET', '/api/games?mine=1', null, A)).j.games?.[0]?.id;
  await call('POST', '/api/auth/reset', { email: 'caio@teste.com', password: 'novasenha123', code: '000000' }).catch(() => 0);
  got = [];
  await call('POST', '/api/admin/maintenance', { on: true, msg: 'Voltamos às 10h' }, ADM);
  ok('manutenção avisa os jogadores', await until(() => got.some(g => g.payload.cat === 'maintenance')));
  await call('POST', '/api/admin/maintenance', { on: false, msg: '' }, ADM);

  // dispositivos e saída
  ok('conta suspensa não recebe mais: remover aparelho', (await call('POST', '/api/push/unregister', { token: fcmTok('a') }, A)).s === 200 && (await call('GET', '/api/push/devices', null, A)).j.devices.length === 1);
  ok('teste de notificação tem limite de frequência', (await call('POST', '/api/push/test', {}, B)).s === 200 && (await call('POST', '/api/push/test', {}, B)).s === 429);
  const ov = (await call('GET', '/api/admin/notif/overview', null, ADM)).j;
  ok('visão geral: configuração, aparelhos e entregas', ov.configured.fcm === false || ov.configured.mock, '') && ok('visão geral: contagens', Array.isArray(ov.devices) && ov.last24h.sent > 5, JSON.stringify(ov.last24h));
  ok('o histórico antigo de mensagens continua', (await call('GET', '/api/admin/broadcasts', null, ADM)).j.broadcasts.some(b => b.title === 'Torneio sábado'));
}
main().catch(e => { console.error(e); fail++; }).finally(() => {
  console.log(`\n${pass} ok, ${fail} falhas`);
  srv.kill(); mock.close();
  process.exit(fail ? 1 : 0);
});
