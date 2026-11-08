// Mensagens da administração, modo manutenção e alertas.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3999, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpm-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste' }, stdio: ['ignore', 'ignore', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const notes = async t => (await call('GET', '/notifications', null, t)).j.notifications;

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana'), beto = await reg('Beto'), caio = await reg('Caio');
  const [ADM, A, B, C] = [adm.token, ana.token, beto.token, caio.token];
  await call('POST', `/admin/users/${beto.user.id}/role`, { role: 'mod' }, ADM);
  await call('POST', '/store/buy', { id: 'premium30' }, C);
  await call('POST', '/games', { title: 'Torre', category: 'Aventura', dim: '2D', code: '<h1>x</h1>' }, A);

  // mensagens
  ok('jogador não envia mensagens', (await call('POST', '/admin/broadcast', { audience: 'all', title: 'Oi', body: 'Teste' }, A)).s === 403);
  ok('moderador não envia para grupos', (await call('POST', '/admin/broadcast', { audience: 'all', title: 'Oi', body: 'Teste' }, B)).s === 403);
  ok('título e texto são validados', (await call('POST', '/admin/broadcast', { audience: 'all', title: 'x', body: 'Teste' }, ADM)).s === 400 && (await call('POST', '/admin/broadcast', { audience: 'all', title: 'Aviso', body: '' }, ADM)).s === 400 && (await call('POST', '/admin/broadcast', { audience: 'zzz', title: 'Aviso', body: 'Teste' }, ADM)).s === 400);
  ok('contagem prévia do público', (await call('GET', '/admin/broadcast/count?audience=all', null, ADM)).j.count === 4 && (await call('GET', '/admin/broadcast/count?audience=premium', null, ADM)).j.count === 1 && (await call('GET', '/admin/broadcast/count?audience=creators', null, ADM)).j.count === 1 && (await call('GET', '/admin/broadcast/count?audience=staff', null, ADM)).j.count === 2);
  const g = await call('POST', '/admin/broadcast', { audience: 'all', title: 'Novidade', body: 'Chegou o torneio de sábado!' }, ADM);
  ok('mensagem global chega para todos', g.j.count === 4 && (await notes(A)).some(n => n.title === 'Novidade') && (await notes(C)).some(n => n.title === 'Novidade'));
  ok('mensagem comum não é importante, a marcada é', (await notes(A)).find(n => n.title === 'Novidade').important === false);
  await call('POST', '/admin/broadcast', { audience: 'premium', title: 'Só VIP', body: 'Skin nova liberada', important: true }, ADM);
  ok('grupo recebe só quem é do grupo', (await notes(C)).some(n => n.title === 'Só VIP' && n.important === true) && !(await notes(A)).some(n => n.title === 'Só VIP'));
  ok('moderador manda mensagem para um usuário', (await call('POST', '/admin/broadcast', { audience: 'user', userId: ana.user.id, title: 'Aviso pessoal', body: 'Cuidado com o chat' }, B)).s === 200 && (await notes(A)).some(n => n.title === 'Aviso pessoal') && !(await notes(C)).some(n => n.title === 'Aviso pessoal'));
  ok('histórico de envios só para o admin', (await call('GET', '/admin/broadcasts', null, ADM)).j.broadcasts.length === 3 && (await call('GET', '/admin/broadcasts', null, B)).s === 403);
  ok('envio fica na auditoria', (await call('GET', '/admin/audit', null, ADM)).j.logs.some(l => l.action === 'Mensagem enviada' && /Novidade/.test(l.detail)));

  // manutenção
  ok('só admin liga a manutenção, com aviso', (await call('POST', '/admin/maintenance', { on: true, msg: 'Voltamos às 10h' }, B)).s === 403 && (await call('POST', '/admin/maintenance', { on: true }, ADM)).s === 400);
  ok('liga a manutenção', (await call('POST', '/admin/maintenance', { on: true, msg: 'Voltamos às 10h' }, ADM)).j.on === true);
  const pub = (await call('GET', '/maintenance')).j, h = (await call('GET', '/health')).j;
  ok('aviso público e saúde mostram a manutenção', pub.on === true && /10h/.test(pub.msg) && h.maintenance && h.maintenance.on === true);
  const blocked = await call('GET', '/games', null, A);
  ok('jogador comum recebe 503 com o aviso', blocked.s === 503 && /Em manutenção/.test(blocked.j.error) && /10h/.test(blocked.j.error), JSON.stringify(blocked));
  ok('visitante sem login também', (await call('GET', '/games')).s === 503);
  ok('administrador e moderador continuam usando', (await call('GET', '/games', null, ADM)).s === 200 && (await call('GET', '/admin/users', null, B)).s === 200);
  ok('login continua aberto', (await call('POST', '/auth/login', { email: 'ana@teste.com', password: 'senha12345' })).s === 200);
  ok('alerta de manutenção ligada', (await call('GET', '/admin/alerts', null, ADM)).j.alerts.some(a => /manutenção/.test(a.text)));
  await call('POST', '/admin/maintenance', { on: false }, ADM);
  ok('desligar libera de novo', (await call('GET', '/games', null, A)).s === 200 && (await call('GET', '/health')).j.maintenance === undefined);

  // alertas
  ok('sem denúncias não há alerta de fila', !(await call('GET', '/admin/alerts', null, B)).j.alerts.some(a => a.go === 'rep'));
  for (const t of [A, B, C]) await call('POST', '/reports', { targetType: 'user', targetId: beto.user.id === 0 ? 1 : caio.user.id, reason: 'Spam repetido' }, t);
  const al = (await call('GET', '/admin/alerts', null, B)).j.alerts;
  ok('denúncias aparecem como alerta', al.some(a => /3 denúncia/.test(a.text) && a.go === 'rep'), JSON.stringify(al));
  ok('3 denúncias no mesmo jogador viram alerta forte', al.some(a => a.level === 'bad' && /Caio/.test(a.text)));
  ok('jogador comum não vê alertas', (await call('GET', '/admin/alerts', null, A)).s === 403);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
