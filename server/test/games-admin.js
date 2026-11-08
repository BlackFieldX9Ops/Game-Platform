// Jogos e jogadores no painel: estatísticas por jogo, quem jogou, online agora, despublicar com motivo.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = 3997, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpg-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', JWT_SECRET: 'teste' }, stdio: ['ignore', 'ignore', 'inherit'] });
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
  const G = { category: 'Aventura', dim: '2D', code: '<h1>x</h1>' };
  const g1 = (await call('POST', '/games', { ...G, title: 'Corrida Neon' }, A)).j.id;
  const g2 = (await call('POST', '/games', { ...G, title: 'Torre Sombria', settings: { monetization: 'paid', price: 100 } }, A)).j.id;
  await call('POST', '/store/buy', { id: 'coins500' }, C); await call('POST', `/games/${g2}/buy`, {}, C);
  await call('PUT', `/library/${g1}`, {}, C); await call('POST', `/games/${g1}/reviews`, { stars: 4, text: 'Divertido' }, C);
  await call('POST', `/games/${g1}/play`, {}, C); await call('POST', `/games/${g1}/play`, {}, C); await call('POST', `/games/${g2}/play`, {}, C);
  await call('POST', `/games/${g1}/play`, {}, B);

  ok('jogador comum não vê estatísticas', (await call('GET', '/admin/games/stats', null, A)).s === 403);
  let st = (await call('GET', '/admin/games/stats', null, B)).j;
  ok('moderador vê as estatísticas por jogo', st.games.length === 2 && st.totals.games === 2 && st.totals.plays === 4);
  const n1 = st.games.find(g => g.id === g1), n2 = st.games.find(g => g.id === g2);
  ok('contagens de partidas, jogadores, avaliações e nota', n1.plays === 3 && n1.players === 2 && n1.reviews === 1 && n1.rating === 4, JSON.stringify(n1));
  ok('jogo pago mostra preço e compradores', n2.price === 100 && n2.buyers === 1 && n2.library === 1, JSON.stringify(n2));
  ok('ordena por mais jogado e busca por nome', st.games[0].id === g1 && (await call('GET', '/admin/games/stats?q=torre', null, ADM)).j.games.length === 1 && (await call('GET', '/admin/games/stats?q=ana', null, ADM)).j.games.length === 2);

  // online agora: precisa estar conectado
  ok('sem conexão ninguém está "jogando agora"', st.totals.playingNow === 0);
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${C}`);
  await new Promise(r => ws.on('open', r)); await wait(200);
  await call('POST', `/games/${g1}/play`, {}, C); await wait(100);
  st = (await call('GET', '/admin/games/stats', null, ADM)).j;
  ok('conectado e jogando aparece online no jogo', st.games.find(g => g.id === g1).online === 1 && st.totals.playingNow === 1, JSON.stringify(st.totals));
  const dt = (await call('GET', `/admin/games/${g1}/players`, null, ADM)).j;
  ok('detalhe mostra quem está jogando e quem já jogou', dt.playingNow.length === 1 && dt.playingNow[0].name === 'Caio' && dt.players.length === 2 && dt.players.find(p => p.name === 'Caio').plays === 3 && dt.counts.library === 1);
  ok('detalhe do admin traz ganhos, o do moderador não', (await call('GET', `/admin/games/${g2}/players`, null, ADM)).j.earned === 70 && (await call('GET', `/admin/games/${g2}/players`, null, B)).j.earned === undefined);
  await call('POST', `/games/${g1}/leave`, {}, C); await wait(50);
  ok('sair do jogo tira do "jogando agora"', (await call('GET', '/admin/games/stats', null, ADM)).j.totals.playingNow === 0);
  await call('POST', `/games/${g1}/play`, {}, C); ws.close(); await wait(250);
  ok('cair a conexão também tira', (await call('GET', '/admin/games/stats', null, ADM)).j.totals.playingNow === 0);

  // despublicar
  ok('despublicar exige motivo', (await call('POST', `/admin/games/${g1}/status`, { status: 'unpublished' }, B)).s === 400);
  ok('moderador despublica com motivo e o dono é avisado', (await call('POST', `/admin/games/${g1}/status`, { status: 'unpublished', reason: 'Conteúdo impróprio' }, B)).s === 200 && (await call('GET', '/notifications', null, A)).j.notifications.some(n => /despublicado/i.test(n.title) && /impróprio/.test(n.body)));
  ok('jogador comum não despublica por aqui', (await call('POST', `/admin/games/${g1}/status`, { status: 'published' }, A)).s === 403);
  ok('estatística mostra despublicado e filtra', (await call('GET', '/admin/games/stats?status=unpublished', null, ADM)).j.games.length === 1);
  ok('republicar não precisa de motivo', (await call('POST', `/admin/games/${g1}/status`, { status: 'published' }, ADM)).s === 200);
  ok('auditoria registra com o dono como alvo', (await call('GET', `/admin/audit?target=${ana.user.id}`, null, ADM)).j.logs.some(l => l.action === 'Jogo despublicado' && /impróprio/.test(l.detail)));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
