// Teste ponta a ponta: sobe o servidor com um banco temporário e percorre os fluxos principais.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = 3999;
const BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gp-'));
const srv = spawn('node', ['src/index.js'], {
  env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', JWT_SECRET: 'teste' },
  stdio: ['ignore', 'pipe', 'inherit']
});

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'OK   ' : 'FALHA'} ${name}${cond ? '' : ' ' + extra}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await wait(150); }

  const adm = await call('POST', '/auth/register', { name: 'Admin', email: 'admin@teste.com', password: 'senha12345' });
  const ana = await call('POST', '/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senha12345' });
  const beto = await call('POST', '/auth/register', { name: 'Beto', email: 'beto@teste.com', password: 'senha12345' });
  ok('cadastro cria 3 usuários', adm.s === 201 && ana.s === 201 && beto.s === 201);
  ok('primeiro e-mail de admin recebe o papel admin', adm.j.user.role === 'admin' && ana.j.user.role === 'user');
  ok('e-mail repetido é recusado', (await call('POST', '/auth/register', { name: 'Outra', email: 'ana@teste.com', password: 'senha12345' })).s === 409);
  ok('senha curta é recusada', (await call('POST', '/auth/register', { name: 'Curta', email: 'c@teste.com', password: '123' })).s === 400);
  ok('login com senha errada falha', (await call('POST', '/auth/login', { email: 'ana@teste.com', password: 'errada123' })).s === 401);
  const login = await call('POST', '/auth/login', { email: 'ana@teste.com', password: 'senha12345' });
  ok('login correto devolve token', login.s === 200 && !!login.j.token);
  const [A, B, ADM] = [login.j.token, beto.j.token, adm.j.token];
  ok('rota protegida exige login', (await call('GET', '/me')).s === 401);

  const game = { title: 'Chuva de Blocos', description: 'Desvie dos blocos', category: 'Ação', age: 'Livre', dim: '2D', libs: ['p5'], code: '<canvas></canvas><script>1</script>' };
  ok('publicar sem código falha', (await call('POST', '/games', { ...game, code: '' }, A)).s === 400);
  ok('categoria inválida falha', (await call('POST', '/games', { ...game, category: 'X' }, A)).s === 400);
  const pub = await call('POST', '/games', game, A);
  ok('publicar jogo', pub.s === 201);
  const gid = pub.j.id;
  const list = await call('GET', '/games?dim=2D&q=Chuva');
  ok('lista e filtra jogos sem expor o código', list.j.games.length === 1 && list.j.games[0].code === undefined && list.j.games[0].developer === 'Ana');
  ok('só o dono edita', (await call('PUT', `/games/${gid}`, { ...game, title: 'Hack' }, B)).s === 403);
  ok('dono edita', (await call('PUT', `/games/${gid}`, { ...game, title: 'Chuva de Blocos 2' }, A)).s === 200);

  ok('dono lê o código-fonte', (await call('GET', `/games/${gid}/source`, null, A)).j.code.includes('canvas'));
  ok('outro jogador não lê o código-fonte', (await call('GET', `/games/${gid}/source`, null, B)).s === 403);
  const play = await call('POST', `/games/${gid}/play`, null, B);
  ok('jogar entrega o código e dá XP', play.s === 200 && play.j.code.includes('canvas') && play.j.xp === 25);
  ok('jogar exige login', (await call('POST', `/games/${gid}/play`)).s === 401);

  ok('avaliar', (await call('POST', `/games/${gid}/reviews`, { stars: 5, text: 'Muito bom' }, B)).s === 201);
  ok('nota fora de 1 a 5 falha', (await call('POST', `/games/${gid}/reviews`, { stars: 9 }, B)).s === 400);
  await call('POST', `/games/${gid}/reviews`, { stars: 3, text: 'Mudei de ideia' }, B);
  const rv = await call('GET', `/games/${gid}/reviews`);
  ok('reavaliar atualiza em vez de duplicar', rv.j.reviews.length === 1 && rv.j.reviews[0].stars === 3);
  ok('média aparece no jogo', (await call('GET', `/games/${gid}`)).j.game.rating === 3);

  await call('PUT', `/library/${gid}`, null, B); await call('PUT', `/wishlist/${gid}`, null, B);
  ok('biblioteca e desejos', (await call('GET', '/library', null, B)).j.games.length === 1 && (await call('GET', '/wishlist', null, B)).j.games.length === 1);
  await call('DELETE', `/wishlist/${gid}`, null, B);
  ok('remover dos desejos', (await call('GET', '/wishlist', null, B)).j.games.length === 0);

  const post = await call('POST', '/posts', { text: 'Recorde batido!', gameId: gid }, B);
  ok('criar post', post.s === 201);
  ok('curtir e descurtir', (await call('POST', `/posts/${post.j.id}/like`, null, A)).j.liked === true && (await call('POST', `/posts/${post.j.id}/like`, null, A)).j.liked === false);
  await call('POST', `/posts/${post.j.id}/like`, null, A);
  const posts = await call('GET', '/posts', null, A);
  ok('feed mostra curtidas e jogo', posts.j.posts[0].likes === 1 && posts.j.posts[0].liked === true && posts.j.posts[0].game_title === 'Chuva de Blocos 2');
  ok('só o autor apaga o post', (await call('DELETE', `/posts/${post.j.id}`, null, A)).s === 403);

  ok('amizade: pedido', (await call('POST', '/friends/request', { name: 'Beto' }, A)).s === 201);
  ok('amizade: pedido repetido', (await call('POST', '/friends/request', { name: 'Beto' }, A)).s === 409);
  ok('amizade: não pode se adicionar', (await call('POST', '/friends/request', { name: 'Ana' }, A)).s === 400);
  ok('mensagem exige amizade aceita', (await call('POST', '/messages', { to: beto.j.user.id, text: 'oi' }, A)).s === 403);
  const fr = await call('GET', '/friends', null, B);
  ok('Beto vê o pedido recebido', fr.j.friends[0].incoming === true);
  ok('amizade: aceitar', (await call('POST', `/friends/${ana.j.user.id}/accept`, null, B)).s === 200);

  const got = new Promise(res => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${B}`);
    ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'ready') call('POST', '/messages', { to: beto.j.user.id, text: 'Oi, Beto!' }, A); if (m.type === 'message') { ws.close(); res(m.message); } });
    setTimeout(() => res(null), 4000);
  });
  const m = await got;
  ok('chat em tempo real entrega a mensagem por WebSocket', m && m.text === 'Oi, Beto!' && m.from_name === 'Ana');
  ok('histórico de mensagens', (await call('GET', `/messages/${ana.j.user.id}`, null, B)).j.messages.length === 1);
  const bad = new WebSocket(`ws://localhost:${PORT}/ws?token=invalido`);
  const code = await new Promise(r => { bad.on('close', c => r(c)); bad.on('error', () => {}); });
  ok('WebSocket sem token válido é fechado', code === 4401);
  ok('Beto aparece offline após desconectar', (await call('GET', '/friends', null, A)).j.friends[0].online === false);

  ok('notificações do dono do jogo', (await call('GET', '/notifications', null, A)).j.notifications.some(n => n.title === 'Nova avaliação'));
  const cs = await call('GET', '/creator/stats', null, A);
  ok('painel do criador', cs.j.totals.games === 1 && cs.j.totals.plays === 1 && cs.j.games[0].in_libraries === 2);

  ok('admin: rotas bloqueadas para usuário comum', (await call('GET', '/admin/overview', null, A)).s === 403);
  const rep = await call('POST', '/reports', { targetType: 'game', targetId: gid, reason: 'Conteúdo impróprio' }, B);
  ok('denunciar jogo', rep.s === 201);
  const ov = await call('GET', '/admin/overview', null, ADM);
  ok('admin: visão geral', ov.j.users === 3 && ov.j.openReports === 1);
  const reps = await call('GET', '/admin/reports', null, ADM);
  ok('admin: lista denúncias', reps.j.reports.length === 1);
  ok('admin: remove o conteúdo denunciado', (await call('POST', `/admin/reports/${reps.j.reports[0].id}/resolve`, { action: 'remove' }, ADM)).s === 200);
  ok('jogo removido some da Loja', (await call('GET', '/games')).j.games.length === 0 && (await call('GET', `/games/${gid}`)).s === 404);

  ok('admin: suspende usuário', (await call('POST', `/admin/users/${beto.j.user.id}/status`, { status: 'suspended' }, ADM)).s === 200);
  ok('usuário suspenso perde o acesso', (await call('GET', '/me', null, B)).s === 401 && (await call('POST', '/auth/login', { email: 'beto@teste.com', password: 'senha12345' })).s === 403);
  await call('POST', '/admin/notify', { title: 'Manutenção', body: 'Hoje às 3h' }, ADM);
  ok('notificação global chega a todos', (await call('GET', '/notifications', null, A)).j.notifications.some(n => n.title === 'Manutenção'));
  ok('JSON inválido devolve 400', (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{x' })).status === 400);
}

try { await main(); } catch (e) { fail++; console.error('ERRO NO TESTE', e); }
srv.kill();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
