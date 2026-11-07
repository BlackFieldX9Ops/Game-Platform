// ID de jogador (000 = admin), plano Studio, loja (planos, moedas, skins) e liberação pelo administrador.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3994, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpst-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', JWT_SECRET: 'teste' }, stdio: ['ignore', 'pipe', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const GAME = { title: 'Jogo', category: 'Ação', dim: '2D', code: '<h1>x</h1>' };

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const ana = await reg('Ana'), adm = await reg('Admin'), beto = await reg('Beto');
  ok('o administrador recebe o ID 000 mesmo cadastrando depois', adm.user.uid === '000');
  ok('os outros recebem 001, 002 em ordem', ana.user.uid === '001' && beto.user.uid === '002');
  ok('busca por #ID usa o ID de jogador', (await call('GET', '/users/search?q=%232', null, ana.token)).j.users[0]?.name === 'Beto');
  ok('busca por #0 acha o administrador', (await call('GET', '/users/search?q=%230', null, ana.token)).j.users[0]?.name === 'Admin');

  ok('sem plano não publica jogo', (await call('POST', '/games', GAME, ana.token)).s === 403);
  ok('/me mostra que não tem o Studio', (await call('GET', '/me', null, ana.token)).j.user.studio === false);
  ok('administrador publica sem plano', (await call('POST', '/games', GAME, adm.token)).s === 201);

  // administração libera
  ok('usuário comum não libera Studio', (await call('POST', `/admin/users/${beto.user.id}/studio`, { on: true }, ana.token)).s === 403);
  ok('admin libera o Studio', (await call('POST', `/admin/users/${beto.user.id}/studio`, { on: true }, adm.token)).j.ok === true);
  ok('quem foi liberado publica', (await call('POST', '/games', GAME, beto.token)).s === 201);
  ok('liberado recebe aviso importante', (await call('GET', '/notifications', null, beto.token)).j.notifications.some(n => n.kind === 'premium'));
  ok('lista de usuários do admin traz ID e plano', (await call('GET', '/admin/users', null, adm.token)).j.users.some(u => u.uid === 2 && u.studio_until));
  await call('POST', `/admin/users/${beto.user.id}/studio`, { on: false }, adm.token);
  ok('admin tira o Studio e volta a bloquear', (await call('POST', '/games', GAME, beto.token)).s === 403);

  // loja
  const st = (await call('GET', '/store', null, ana.token)).j;
  ok('loja lista planos, moedas e skins', st.plans.length >= 2 && st.packs.length >= 3 && st.items.length >= 6 && st.coins === 0);
  const b1 = (await call('POST', '/store/buy', { id: 'studio30' }, ana.token)).j;
  ok('comprar o plano libera na hora', b1.studio.active === true);
  ok('depois da compra publica jogo', (await call('POST', '/games', GAME, ana.token)).s === 201);
  ok('comprar de novo acumula o prazo', (await call('POST', '/store/buy', { id: 'studio30' }, ana.token)).j.studio.until > b1.studio.until);
  ok('skin sem moedas é recusada', (await call('POST', '/store/buy', { id: 'fr_gold' }, ana.token)).s === 402);
  ok('pacote de moedas soma', (await call('POST', '/store/buy', { id: 'coins500' }, ana.token)).j.coins === 500);
  const sk = (await call('POST', '/store/buy', { id: 'fr_gold' }, ana.token)).j;
  ok('skin comprada gasta moedas, entra nos itens e já fica equipada', sk.coins === 350 && sk.owned.includes('fr_gold') && sk.equipped.frame === 'fr_gold');
  ok('não compra a mesma skin duas vezes', (await call('POST', '/store/buy', { id: 'fr_gold' }, ana.token)).s === 409);
  ok('não equipa item que não tem', (await call('POST', '/store/equip', { slot: 'banner', id: 'bn_space' }, ana.token)).s === 403);
  ok('tira a moldura', (await call('POST', '/store/equip', { slot: 'frame', id: null }, ana.token)).j.equipped.frame === null);
  ok('item inexistente dá 404', (await call('POST', '/store/buy', { id: 'nada' }, ana.token)).s === 404);
  ok('/me traz moedas e moldura', (await call('GET', '/me', null, ana.token)).j.user.coins === 350);
  ok('loja exige login', (await call('GET', '/store')).s === 401);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
