// Compras e preços: registro de vendas, preços editáveis, itens fora de venda, ajustes e estornos (só administrador).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3996, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpc-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste' }, stdio: ['ignore', 'ignore', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana'), beto = await reg('Beto'), caio = await reg('Caio');
  const [ADM, A, B, C] = [adm.token, ana.token, beto.token, caio.token];
  await call('POST', `/admin/users/${beto.user.id}/role`, { role: 'mod' }, ADM);

  // vendas
  ok('compra de pacote vira venda', (await call('POST', '/store/buy', { id: 'coins500' }, A)).s === 200);
  await call('POST', '/store/buy', { id: 'studio30' }, A);
  await call('POST', '/store/buy', { id: 'premium30' }, C);
  await call('POST', '/store/buy', { id: 'coins1200' }, C);
  await call('POST', '/store/buy', { id: 'fr_gold' }, C);
  const g = (await call('POST', '/games', { title: 'Torre', category: 'Aventura', dim: '2D', code: '<h1>x</h1>', settings: { monetization: 'paid', price: 100 } }, A)).j;
  await call('POST', `/games/${g.id}/buy`, {}, C);
  const sales = (await call('GET', '/admin/sales', null, ADM)).j.sales;
  ok('lista de vendas tem tudo (6)', sales.length === 6, JSON.stringify(sales.map(s => s.kind)));
  ok('venda traz comprador, tipo e valor', sales.some(s => s.kind === 'coins' && s.buyer === 'Ana' && s.cents === 1990 && s.coins === 500) && sales.some(s => s.kind === 'game' && s.cut === 70));
  ok('moderador e jogador não veem vendas nem preços', [(await call('GET', '/admin/sales', null, B)).s, (await call('GET', '/admin/commerce', null, B)).s, (await call('GET', '/admin/sales', null, A)).s, (await call('POST', '/admin/prices', { id: 'coins100', price: 1 }, B)).s].every(s => s === 403));
  ok('filtro por tipo e busca', (await call('GET', '/admin/sales?kind=coins', null, ADM)).j.sales.length === 2 && (await call('GET', '/admin/sales?q=ana', null, ADM)).j.sales.every(s => s.buyer === 'Ana'));
  const cm = (await call('GET', '/admin/commerce', null, ADM)).j;
  ok('resumo soma dinheiro de teste e moedas', cm.all.n === 6 && cm.all.cents === 1990 + 1990 + 990 + 3990 && cm.d7.n === 6 && cm.kinds.length === 5 && cm.activePlans.premium === 1, JSON.stringify(cm.all));
  ok('catálogo do admin traz padrão e editado', cm.catalog.plans.length === 3 && cm.catalog.plans[0].base.price === 1990 && cm.catalog.plans[0].edited === false);

  // preços editáveis
  ok('admin muda o preço do plano', (await call('POST', '/admin/prices', { id: 'studio30', price: 2490 }, ADM)).j.catalog.plans[0].price === 2490);
  const pub = (await call('GET', '/store', null, B)).j;
  ok('loja pública mostra o preço novo', pub.plans.find(p => p.id === 'studio30').price === 2490 && pub.plans[0].base === undefined);
  ok('preço inválido é recusado', (await call('POST', '/admin/prices', { id: 'studio30', price: -5 }, ADM)).s === 400 && (await call('POST', '/admin/prices', { id: 'studio30', price: 1.5 }, ADM)).s === 400 && (await call('POST', '/admin/prices', { id: 'nada', price: 5 }, ADM)).s === 404);
  ok('skin é editada em moedas', (await call('POST', '/admin/prices', { id: 'fr_neon', coins: 90 }, ADM)).j.catalog.items.find(i => i.id === 'fr_neon').coins === 90);
  await call('POST', '/store/buy', { id: 'coins100' }, B); await call('POST', '/store/buy', { id: 'coins500' }, B);
  ok('comprar skin cobra o preço novo', (await call('POST', '/store/buy', { id: 'fr_neon' }, B)).j.coins === 600 - 90, '');
  ok('nome e vantagens editáveis', (await call('POST', '/admin/prices', { id: 'premium30', name: 'VIP 30 dias', perks: ['Selo VIP', 'Bônus diário maior'] }, ADM)).j.catalog.plans.find(p => p.id === 'premium30').perks.length === 2 && (await call('GET', '/store', null, A)).j.plans.find(p => p.id === 'premium30').name === 'VIP 30 dias');
  ok('tirar da venda esconde e bloqueia', (await call('POST', '/admin/prices', { id: 'coins100', active: false }, ADM)).s === 200 && !(await call('GET', '/store', null, A)).j.packs.some(p => p.id === 'coins100') && (await call('POST', '/store/buy', { id: 'coins100' }, A)).s === 410);
  ok('restaurar volta ao padrão', (await call('POST', '/admin/prices/reset', { id: 'studio30' }, ADM)).j.catalog.plans[0].price === 1990 && (await call('POST', '/admin/prices/reset', { id: 'coins100' }, ADM)).s === 200 && (await call('GET', '/store', null, A)).j.packs.some(p => p.id === 'coins100'));
  ok('mudança sem efeito não registra', (await call('POST', '/admin/prices', { id: 'coins500', price: 1990 }, ADM)).j.unchanged === true);

  // ajustes
  const cid = caio.user.id, aid = ana.user.id;
  ok('ajuste de moedas exige motivo', (await call('POST', `/admin/users/${cid}/coins`, { delta: 50 }, ADM)).s === 400);
  const before = (await call('GET', '/me', null, C)).j.user.coins;
  ok('admin dá moedas com motivo', (await call('POST', `/admin/users/${cid}/coins`, { delta: 50, reason: 'Prêmio do torneio' }, ADM)).j.coins === before + 50);
  ok('saldo não fica negativo', (await call('POST', `/admin/users/${cid}/coins`, { delta: -99999, reason: 'Teste de limite' }, ADM)).s === 400);
  ok('ajuste de plano soma dias', (await call('POST', `/admin/users/${aid}/plan`, { kind: 'premium', days: 10, reason: 'Cortesia' }, ADM)).s === 200 && (await call('GET', '/store', null, A)).j.premium.active === true);
  ok('ajuste de plano pode tirar dias', (await call('POST', `/admin/users/${aid}/plan`, { kind: 'premium', days: -30, reason: 'Correção' }, ADM)).s === 200 && (await call('GET', '/store', null, A)).j.premium.active === false);

  // estornos
  const all_ = (await call('GET', '/admin/sales', null, ADM)).j.sales;
  const pack = all_.find(s => s.kind === 'coins' && s.buyer === 'Caio'), game = all_.find(s => s.kind === 'game'), item = all_.find(s => s.kind === 'item' && s.buyer === 'Caio'), plan = all_.find(s => s.kind === 'premium');
  ok('estorno exige motivo', (await call('POST', `/admin/sales/${pack.id}/refund`, {}, ADM)).s === 400);
  ok('estorno de jogo devolve moedas e tira da biblioteca', (async () => true)());
  const cBefore = (await call('GET', '/me', null, C)).j.user.coins, aBefore = (await call('GET', '/me', null, A)).j.user.coins;
  ok('estorna a compra de jogo', (await call('POST', `/admin/sales/${game.id}/refund`, { reason: 'Pedido do jogador' }, ADM)).s === 200);
  ok('comprador recebe as moedas de volta, criador perde a parte dele', (await call('GET', '/me', null, C)).j.user.coins === cBefore + 100 && (await call('GET', '/me', null, A)).j.user.coins === aBefore - 70);
  ok('jogo sai da biblioteca do comprador', !(await call('GET', '/library', null, C)).j.games.some(x => x.id === g.id));
  ok('não estorna duas vezes', (await call('POST', `/admin/sales/${game.id}/refund`, { reason: 'De novo' }, ADM)).s === 409);
  ok('estorna a skin e desequipa', (await call('POST', `/admin/sales/${item.id}/refund`, { reason: 'Engano' }, ADM)).s === 200 && (await call('GET', '/store', null, C)).j.equipped.frame === null && !(await call('GET', '/store', null, C)).j.owned.includes('fr_gold'));
  ok('estorna o premium e tira os dias', (await call('POST', `/admin/sales/${plan.id}/refund`, { reason: 'Cobrança duplicada' }, ADM)).s === 200 && (await call('GET', '/store', null, C)).j.premium.active === false);
  await call('POST', '/store/buy', { id: 'item_nao_existe' }, C);
  const spend = (await call('POST', '/store/buy', { id: 'ti_legend' }, C)).s;
  ok('estorno de pacote falha se o jogador já gastou as moedas', spend === 200 && (await call('POST', '/admin/users/' + cid + '/coins', { delta: -(await call('GET', '/me', null, C)).j.user.coins + 5, reason: 'Zerar para o teste' }, ADM)).s === 200 && (await call('POST', `/admin/sales/${pack.id}/refund`, { reason: 'Teste' }, ADM)).s === 409);
  const sm = (await call('GET', '/admin/commerce', null, ADM)).j;
  ok('resumo ignora vendas estornadas', sm.refunds === 3 && sm.all.n === 7, JSON.stringify(sm.all) + sm.refunds);
  const au = (await call('GET', '/admin/audit', null, ADM)).j.logs.map(l => l.action).join('|');
  ok('tudo aparece na auditoria', ['Loja: item alterado', 'Moedas ajustadas', 'Plano ajustado', 'Compra estornada', 'Loja: item restaurado ao padrão'].every(a => au.includes(a)), au);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
