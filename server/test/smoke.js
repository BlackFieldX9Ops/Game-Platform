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
  env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', JWT_SECRET: 'teste' },
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
  ok('admin: denúncia traz o nome do conteúdo', typeof reps.j.reports[0].target_title === 'string' && reps.j.reports[0].target_title.length > 0);
  ok('admin: remove o conteúdo denunciado', (await call('POST', `/admin/reports/${reps.j.reports[0].id}/resolve`, { action: 'remove' }, ADM)).s === 200);
  ok('jogo removido some da Loja', (await call('GET', '/games')).j.games.length === 0 && (await call('GET', `/games/${gid}`)).s === 404);

  ok('admin: suspende usuário', (await call('POST', `/admin/users/${beto.j.user.id}/status`, { status: 'suspended' }, ADM)).s === 200);
  ok('usuário suspenso perde o acesso', (await call('GET', '/me', null, B)).s === 401 && (await call('POST', '/auth/login', { email: 'beto@teste.com', password: 'senha12345' })).s === 403);
  await call('POST', '/admin/notify', { title: 'Manutenção', body: 'Hoje às 3h' }, ADM);
  ok('notificação global chega a todos', (await call('GET', '/notifications', null, A)).j.notifications.some(n => n.title === 'Manutenção'));
  // --- capa, destaques, categorias e logs
  const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const base = { title: 'Com Capa', description: 'x', category: 'Ação', age: 'Livre', dim: '2D', libs: [], code: '<canvas></canvas>' };
  ok('orientação inválida é recusada', (await call('POST', '/games', { ...base, orientation: 'diagonal' }, A)).s === 400);
  const gl = await call('POST', '/games', { ...base, title: 'Deitado', orientation: 'landscape' }, A);
  ok('jogo guarda a orientação pedida', gl.s === 201 && (await call('GET', '/games/' + gl.j.id)).j.game.orientation === 'landscape');
  ok('orientação padrão é automática', (await call('GET', '/games/' + (await call('POST', '/games', { ...base, title: 'Livre' }, A)).j.id)).j.game.orientation === 'auto');
  const bad1 = await call('POST', '/games', { ...base, cover: 'http://x/y.png' }, A);
  ok('capa inválida é recusada', bad1.s === 400);
  const g1 = await call('POST', '/games', { ...base, cover: PIX }, A);
  ok('jogo com capa é publicado', g1.s === 201);
  const lst = await call('GET', '/games?q=Com%20Capa');
  ok('lista devolve a capa', lst.j.games[0] && lst.j.games[0].cover === PIX && lst.j.games[0].featured === false);
  await call('PUT', '/games/' + g1.j.id, { ...base, title: 'Com Capa 2' }, A);
  ok('editar sem enviar capa mantém a capa', (await call('GET', '/games/' + g1.j.id)).j.game.cover === PIX);
  await call('PUT', '/games/' + g1.j.id, { ...base, title: 'Com Capa 2', cover: null }, A);
  ok('enviar capa nula remove a capa', (await call('GET', '/games/' + g1.j.id)).j.game.cover === null);
  ok('destaque: usuário comum é bloqueado', (await call('POST', `/admin/games/${g1.j.id}/feature`, { featured: true }, A)).s === 403);
  ok('destaque: admin destaca', (await call('POST', `/admin/games/${g1.j.id}/feature`, { featured: true }, ADM)).s === 200);
  const top = await call('GET', '/games');
  ok('destacado vem primeiro na Loja', top.j.games[0].id === g1.j.id && top.j.games[0].featured === true);
  ok('admin lista jogos com o destaque', (await call('GET', '/admin/games', null, ADM)).j.games.some(g => g.id === g1.j.id && g.featured));
  ok('categorias públicas têm o padrão', (await call('GET', '/categories')).j.categories.includes('Terror'));
  ok('categorias: usuário comum é bloqueado', (await call('PUT', '/admin/categories', { categories: ['A1', 'B2'] }, A)).s === 403);
  ok('categorias: repetidas recusadas', (await call('PUT', '/admin/categories', { categories: ['Ação', 'ação'] }, ADM)).s === 400);
  ok('categorias: admin altera a lista', (await call('PUT', '/admin/categories', { categories: ['Ação', 'Corrida', 'Esportes'] }, ADM)).s === 200);
  ok('categoria nova vale na publicação', (await call('POST', '/games', { ...base, title: 'Futebol', category: 'Esportes' }, A)).s === 201);
  ok('dimensão Misto é aceita', (await call('POST', '/games', { ...base, title: 'Misto Um', category: 'Esportes', dim: 'Misto' }, A)).s === 201);
  ok('dimensão inventada é recusada', (await call('POST', '/games', { ...base, title: 'Dim X', category: 'Esportes', dim: '4D' }, A)).s === 400);
  ok('tipos de projeto são públicos', (await call('GET', '/kinds')).j.kinds.includes('Aplicativo') && (await call('GET', '/kinds')).j.dims.includes('Misto'));
  ok('jogador não altera os tipos', (await call('PUT', '/admin/kinds', { kinds: ['Jogo'] }, A)).s === 403);
  ok('admin altera os tipos', (await call('PUT', '/admin/kinds', { kinds: ['Jogo', 'Aplicativo', 'Plugin'] }, ADM)).s === 200);
  ok('tipo de projeto vai junto com o jogo', (await call('POST', '/games', { ...base, title: 'Plug', category: 'Esportes', settings: { kind: 'Plugin' } }, A)).s === 201);
  ok('tipo que não existe é recusado', (await call('POST', '/games', { ...base, title: 'Plug2', category: 'Esportes', settings: { kind: 'Nave' } }, A)).s === 400);
  ok('lista de tipos vazia é recusada', (await call('PUT', '/admin/kinds', { kinds: [] }, ADM)).s === 400);
  ok('categoria removida não vale mais', (await call('POST', '/games', { ...base, title: 'Susto', category: 'Terror' }, A)).s === 400);
  ok('restaurar padrões devolve categorias e tipos', (await call('POST', '/admin/studio-defaults', {}, ADM)).j.kinds.length === 4);
  const logs = await call('GET', '/admin/logs', null, ADM);
  ok('logs registram as ações do admin', logs.s === 200 && ['Jogo destacado', 'Categorias alteradas', 'Usuário suspenso', 'Notificação global'].every(a => logs.j.logs.some(l => l.action === a)));
  ok('logs: usuário comum é bloqueado', (await call('GET', '/admin/logs', null, A)).s === 403);
  // --- perfil: foto, bio e exclusão de jogos pelo admin
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const pf = await call('PATCH', '/me', { bio: '  Criador de jogos  ', avatar: px }, A);
  ok('perfil: salva foto e bio sem mudar o nome', pf.s === 200 && pf.j.user.avatar === px && pf.j.user.bio === 'Criador de jogos' && pf.j.user.name === 'Ana');
  ok('perfil: foto aparece em /me', (await call('GET', '/me', null, A)).j.user.avatar === px);
  ok('perfil: foto inválida é recusada', (await call('PATCH', '/me', { avatar: 'http://x/y.png' }, A)).s === 400);
  ok('perfil: foto grande demais é recusada', (await call('PATCH', '/me', { avatar: 'data:image/png;base64,' + 'A'.repeat(90000) }, A)).s === 400);
  ok('perfil: remove a foto', (await call('PATCH', '/me', { avatar: null }, A)).j.user.avatar === null);
  const mg = await call('POST', '/games', game, ADM);
  ok('admin publica um jogo próprio', mg.s === 201);
  ok('admin exclui o próprio jogo', (await call('DELETE', `/games/${mg.j.id}`, null, ADM)).s === 200 && (await call('GET', `/games/${mg.j.id}`)).s === 404);
  ok('log registra a exclusão do jogo próprio', (await call('GET', '/admin/logs', null, ADM)).j.logs.some(l => l.action === 'Jogo próprio excluído'));
  // --- gerenciamento avançado de jogos
  const caio = await call('POST', '/auth/register', { name: 'Caio', email: 'caio@teste.com', password: 'senha12345' });
  const C = caio.j.token;
  const rich = { ...game, title: 'Rico', tags: ['Ação ', 'ação', 'Rápido'], version: '2.1.0', visibility: 'public', ai: true, cover: px,
    settings: { fullscreen: 0, controls: ['touch', 'gamepad', 'volante'], saveProgress: true, monetization: 'ads', ext: [{ n: 'Lib A', u: 'https://cdn.exemplo.com/a.js' }, { n: 'Lib B', c: 'window.B=1' }] } };
  const rc = await call('POST', '/games', rich, A);
  ok('jogo com tags, versão, IA e configurações é criado', rc.s === 201);
  const rg = (await call('GET', `/games/${rc.j.id}`)).j.game;
  ok('tags são normalizadas e sem repetição', JSON.stringify(rg.tags) === JSON.stringify(['ação', 'rápido']));
  ok('versão, IA e configurações voltam certinhas', rg.version === '2.1.0' && rg.ai === true && rg.settings.fullscreen === 0 && rg.settings.saveProgress === 1 && rg.settings.monetization === 'ads' && JSON.stringify(rg.settings.controls) === '["touch","gamepad"]' && rg.settings.ext.length === 2);
  ok('play entrega as bibliotecas externas e as configurações', (await call('POST', `/games/${rc.j.id}/play`, null, C)).j.ext.length === 2);
  ok('versão inválida é recusada', (await call('POST', '/games', { ...game, version: 'x y' }, A)).s === 400);
  ok('visibilidade inválida é recusada', (await call('POST', '/games', { ...game, visibility: 'secreto' }, A)).s === 400);
  ok('biblioteca externa só aceita https', (await call('POST', '/games', { ...game, settings: { ext: [{ n: 'x', u: 'http://a.com/x.js' }] } }, A)).s === 400);
  ok('capa é servida como imagem', (await fetch(`${BASE}/games/${rc.j.id}/cover`)).headers.get('content-type') === 'image/png');
  const priv = (await call('POST', '/games', { ...game, title: 'Secreto', visibility: 'private' }, A)).j.id;
  const unl = (await call('POST', '/games', { ...game, title: 'Escondido', visibility: 'unlisted' }, A)).j.id;
  const pubList = (await call('GET', '/games?limit=60')).j.games.map(g => g.title);
  ok('privado e não listado não aparecem na Loja', !pubList.includes('Secreto') && !pubList.includes('Escondido') && pubList.includes('Rico'));
  ok('privado não abre para estranhos, mas o não listado abre pelo endereço', (await call('GET', `/games/${priv}`)).s === 404 && (await call('GET', `/games/${priv}`, null, C)).s === 404 && (await call('GET', `/games/${unl}`)).s === 200);
  ok('o dono e o admin enxergam o privado', (await call('GET', `/games/${priv}`, null, A)).s === 200 && (await call('GET', `/games/${priv}/source`, null, ADM)).s === 200);
  ok('outro usuário não vê o código-fonte', (await call('GET', `/games/${rc.j.id}/source`, null, C)).s === 403);
  const mine = (await call('GET', '/my/games', null, A)).j.games;
  ok('"meus jogos" traz todos os do dono, inclusive privados', mine.some(g => g.title === 'Secreto') && mine.some(g => g.title === 'Rico'));
  ok('dono despublica o próprio jogo', (await call('POST', `/games/${rc.j.id}/status`, { status: 'unpublished' }, A)).s === 200);
  ok('despublicado some da Loja e não pode ser jogado', !(await call('GET', '/games?limit=60')).j.games.some(g => g.title === 'Rico') && (await call('POST', `/games/${rc.j.id}/play`, null, C)).s === 404);
  ok('despublicado continua em "meus jogos" com o estado certo', (await call('GET', '/my/games', null, A)).j.games.find(g => g.title === 'Rico').status === 'unpublished');
  ok('outro usuário não despublica jogo alheio', (await call('POST', `/games/${rc.j.id}/status`, { status: 'published' }, C)).s === 404);
  ok('dono republica', (await call('POST', `/games/${rc.j.id}/status`, { status: 'published' }, A)).s === 200 && (await call('GET', '/games?limit=60')).j.games.some(g => g.title === 'Rico'));
  ok('usuário comum não edita jogo alheio', (await call('PUT', `/games/${rc.j.id}`, { ...rich, title: 'Hack' }, C)).s === 403);
  const ed = await call('PUT', `/games/${rc.j.id}`, { ...rich, title: 'Rico Editado', version: '2.2.0' }, ADM);
  ok('admin edita jogo de outro usuário', ed.s === 200 && (await call('GET', `/games/${rc.j.id}`)).j.game.title === 'Rico Editado');
  ok('o dono é avisado da edição do admin', (await call('GET', '/notifications', null, A)).j.notifications.some(n => /editado pela administração/.test(n.body)));
  ok('admin despublica jogo de outro usuário', (await call('POST', `/games/${rc.j.id}/status`, { status: 'unpublished' }, ADM)).s === 200);
  const mg2 = (await call('POST', '/games', { ...game, title: 'Do Admin' }, ADM)).j.id;
  const ag = async q => (await call('GET', '/admin/games' + q, null, ADM)).j.games.map(g => g.title).sort().join('|');
  ok('admin lista jogos de todos, em qualquer estado, com criador e capa', (await call('GET', '/admin/games', null, ADM)).j.games.some(g => g.title === 'Rico Editado' && g.status === 'unpublished' && g.developer === 'Ana' && g.has_cover && g.ai));
  ok('filtro "Eu" mostra só os do admin', await ag('?creator=me') === 'Do Admin');
  ok('filtro "IA" mostra só os gerados por IA', await ag('?creator=ai') === 'Rico Editado');
  ok('filtro "Outros usuários" não traz os do admin nem os de IA', !(await ag('?creator=others')).includes('Do Admin') && !(await ag('?creator=others')).includes('Rico Editado'));
  ok('filtro por estado', (await ag('?status=unpublished')).includes('Rico Editado') && !(await ag('?status=unpublished')).includes('Do Admin'));
  ok('filtro por dono e busca por nome', (await ag(`?owner=${ana.j.user.id}&q=Rico`)) === 'Rico Editado');
  ok('usuário comum não usa a lista do admin', (await call('GET', '/admin/games', null, A)).s === 403);
  ok('lista de usuários do admin traz a contagem de jogos', (await call('GET', '/admin/users', null, ADM)).j.users.find(u => u.name === 'Ana').games >= 3);
  ok('admin exclui jogo de outro usuário', (await call('DELETE', `/games/${priv}`, null, ADM)).s === 200 && (await call('GET', `/games/${priv}`, null, A)).s === 404);
  ok('admin exclui jogo próprio e de IA', (await call('DELETE', `/games/${mg2}`, null, ADM)).s === 200 && (await call('DELETE', `/games/${rc.j.id}`, null, ADM)).s === 200);
  ok('JSON inválido devolve 400', (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{x' })).status === 400);
}

try { await main(); } catch (e) { fail++; console.error('ERRO NO TESTE', e); }
srv.kill();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
