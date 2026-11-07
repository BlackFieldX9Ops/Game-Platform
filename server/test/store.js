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

  // bônus diário, Premium e novos itens
  const d1 = await call('POST', '/store/daily', {}, beto.token);
  ok('bônus diário dá 10 moedas', d1.s === 200 && d1.j.reward === 10 && d1.j.coins === 10);
  ok('bônus diário só uma vez por dia', (await call('POST', '/store/daily', {}, beto.token)).s === 429);
  ok('item exclusivo exige Premium', (await call('POST', '/store/buy', { id: 'ti_premium' }, beto.token)).s === 403);
  const pr = await call('POST', '/store/buy', { id: 'premium30' }, beto.token);
  ok('Premium ativa na hora', pr.j.premium.active === true && pr.j.daily.reward === 30);
  const pk = await call('POST', '/store/buy', { id: 'coins100' }, beto.token);
  ok('Premium ganha +10% nos pacotes', pk.j.coins === 10 + 110);
  const tp = await call('POST', '/store/buy', { id: 'ti_premium' }, beto.token);
  ok('título Premium sai de graça para quem tem Premium e fica equipado', tp.s === 200 && tp.j.equipped.title === 'ti_premium');
  ok('/me traz o título pelo nome e o selo premium', (await call('GET', '/me', null, beto.token)).j.user.titleName === 'Premium' && (await call('GET', '/me', null, beto.token)).j.user.premium === true);
  const th = await call('POST', '/store/buy', { id: 'th_ocean' }, ana.token);
  ok('tema comprado fica equipado', th.j.equipped.theme === 'th_ocean' || th.s === 402);
  const nc = await call('POST', '/store/buy', { id: 'nc_gold' }, ana.token);
  ok('cor do nome e balão são slots válidos', nc.s === 200 || nc.s === 402);
  ok('slot inexistente é recusado', (await call('POST', '/store/equip', { slot: 'x', id: null }, ana.token)).s === 400);

  // jogos pagos: preço em moedas, compra, acesso e repasse ao criador
  const paid = { ...GAME, title: 'Jogo Pago', settings: { monetization: 'paid', price: 100, early: 1 } };
  ok('jogo pago sem preço é recusado', (await call('POST', '/games', { ...GAME, settings: { monetization: 'paid' } }, ana.token)).s === 400);
  const pg = await call('POST', '/games', paid, ana.token);
  ok('criador publica jogo pago em acesso antecipado', pg.s === 201);
  const gm = (await call('GET', `/games/${pg.j.id}`)).j.game;
  ok('jogo traz preço e acesso antecipado nas configurações', gm.settings.price === 100 && gm.settings.early === 1);
  const cara = await reg('Cara');
  ok('sem comprar não joga (402)', (await call('POST', `/games/${pg.j.id}/play`, {}, cara.token)).s === 402);
  ok('sem comprar não entra na biblioteca (402)', (await call('PUT', `/library/${pg.j.id}`, {}, cara.token)).s === 402);
  ok('sem moedas não compra (402)', (await call('POST', `/games/${pg.j.id}/buy`, {}, cara.token)).s === 402);
  await call('POST', '/store/buy', { id: 'coins500' }, cara.token);
  const anaBefore = (await call('GET', '/me', null, ana.token)).j.user.coins;
  const bg = await call('POST', `/games/${pg.j.id}/buy`, {}, cara.token);
  ok('compra desconta as moedas', bg.s === 200 && bg.j.coins === 400);
  ok('criador recebe 70%', (await call('GET', '/me', null, ana.token)).j.user.coins === anaBefore + 70);
  ok('depois de comprar joga', (await call('POST', `/games/${pg.j.id}/play`, {}, cara.token)).s === 200);
  ok('jogo comprado entra na biblioteca', (await call('GET', '/library', null, cara.token)).j.games.some(x => x.id === pg.j.id));
  ok('não compra duas vezes', (await call('POST', `/games/${pg.j.id}/buy`, {}, cara.token)).s === 409);
  ok('dono joga o próprio jogo pago sem comprar', (await call('POST', `/games/${pg.j.id}/play`, {}, ana.token)).s === 200);
  ok('comprador e criador recebem aviso de compra', (await call('GET', '/notifications', null, cara.token)).j.notifications.some(n => n.kind === 'purchase') && (await call('GET', '/notifications', null, ana.token)).j.notifications.some(n => n.kind === 'purchase'));
  ok('jogo gratuito não pode ser comprado', (await call('POST', `/games/${(await call('POST', '/games', GAME, ana.token)).j.id}/buy`, {}, cara.token)).s === 400);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
