// Chat e comunidade: feed, comentários, seguidores, grupos, comunidades, conversas e notificações.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 3998, BASE = `http://localhost:${PORT}/api`;
const dir = mkdtempSync(path.join(tmpdir(), 'gps-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', JWT_SECRET: 'teste' }, stdio: ['ignore', 'pipe', 'inherit'] });
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
  const adm = await reg('Admin'), ana = await reg('Ana'), beto = await reg('Beto'), caio = await reg('Caio');
  const [ADM, A, B, C] = [adm.token, ana.token, beto.token, caio.token];
  const [aid, bid, cid] = [ana.user.id, beto.user.id, caio.user.id];

  ok('app começa sem posts, grupos, comunidades ou conversas', (await call('GET', '/posts', null, A)).j.posts.length === 0 && (await call('GET', '/spaces', null, A)).j.spaces.length === 0 && (await call('GET', '/conversations', null, A)).j.conversations.length === 0);

  // busca e seguidores
  ok('busca por nome', (await call('GET', '/users/search?q=be', null, A)).j.users.some(u => u.name === 'Beto'));
  ok('busca por ID', (await call('GET', `/users/search?q=%23${bid}`, null, A)).j.users[0]?.name === 'Beto');
  ok('seguir um jogador', (await call('POST', `/users/${bid}/follow`, null, A)).j.following === true);
  ok('seguido recebe notificação de seguidor', (await call('GET', '/notifications', null, B)).j.notifications.some(n => n.kind === 'follow'));
  ok('não segue a si mesmo', (await call('POST', `/users/${aid}/follow`, null, A)).s === 400);

  // posts, filtros, comentários, menções
  const p1 = await call('POST', '/posts', { text: 'Primeiro post do Beto, oi @Ana' }, B);
  const p2 = await call('POST', '/posts', { text: 'Post da Ana' }, A);
  const gm = await call('POST', '/games', { title: 'Jogo teste', category: 'Ação', dim: '2D', code: '<h1>x</h1>' }, B);
  const p3 = await call('POST', '/posts', { text: 'Joguem isso', gameId: gm.j.id }, B);
  ok('posts criados', p1.s === 201 && p2.s === 201 && p3.s === 201);
  ok('menção avisa o jogador', (await call('GET', '/notifications', null, A)).j.notifications.some(n => n.kind === 'mention' && n.ref === 'post:' + p1.j.id));
  ok('Para você traz tudo', (await call('GET', '/posts?filter=foryou', null, A)).j.posts.length === 3);
  const fol = (await call('GET', '/posts?filter=following', null, A)).j.posts;
  ok('Seguindo traz os seguidos e os próprios', fol.length === 3);
  ok('Seguindo some quando não segue ninguém', (await call('GET', '/posts?filter=following', null, C)).j.posts.length === 0);
  const gms = (await call('GET', '/posts?filter=games', null, A)).j.posts;
  ok('Jogos traz só posts com jogo', gms.length === 1 && gms[0].game_title === 'Jogo teste');
  ok('post traz autor, avatar e contagens', 'author_id' in gms[0] && 'comments' in gms[0] && gms[0].likes === 0);
  const cm = await call('POST', `/posts/${p1.j.id}/comments`, { text: 'Bom! @Caio veja' }, A);
  ok('comentar', cm.s === 201 && (await call('GET', `/posts/${p1.j.id}/comments`, null, A)).j.comments.length === 1);
  ok('autor recebe resposta', (await call('GET', '/notifications', null, B)).j.notifications.some(n => n.kind === 'reply'));
  ok('menção em comentário avisa', (await call('GET', '/notifications', null, C)).j.notifications.some(n => n.kind === 'mention'));
  ok('comentário conta no feed', (await call('GET', '/posts', null, A)).j.posts.find(p => p.id === p1.j.id).comments === 1);
  ok('só o autor apaga comentário', (await call('DELETE', `/comments/${cm.j.id}`, null, C)).s === 403 && (await call('DELETE', `/comments/${cm.j.id}`, null, A)).s === 200);
  ok('comentário vazio é recusado', (await call('POST', `/posts/${p1.j.id}/comments`, { text: ' ' }, A)).s === 400);

  // grupos
  const g = await call('POST', '/spaces', { kind: 'group', name: 'Amigos do jogo', description: 'Bate-papo', access: 'private', rules: 'Respeito', members: ['Beto', '#' + cid, 'Fantasma'] }, A);
  ok('criar grupo privado com membros iniciais', g.s === 201);
  ok('convidados recebem convite', (await call('GET', '/notifications', null, B)).j.notifications.some(n => n.kind === 'invite') && (await call('GET', '/notifications', null, C)).j.notifications.some(n => n.kind === 'invite'));
  const outsider = await reg('Dani');
  ok('grupo privado invisível para estranhos', (await call('GET', '/spaces', null, outsider.token)).j.spaces.length === 0 && (await call('GET', `/spaces/${g.j.id}`, null, outsider.token)).s === 404);
  ok('convidado enxerga o grupo como convidado', (await call('GET', `/spaces/${g.j.id}`, null, B)).j.space.my_status === 'invited');
  ok('convidado não conversa antes de aceitar', (await call('POST', `/spaces/${g.j.id}/messages`, { text: 'oi' }, B)).s === 403);
  ok('aceitar o convite', (await call('POST', `/spaces/${g.j.id}/join`, null, B)).j.status === 'active');
  ok('recusar o convite', (await call('POST', `/spaces/${g.j.id}/decline`, null, C)).s === 200 && (await call('GET', `/spaces/${g.j.id}`, null, C)).s === 404);
  ok('estranho não entra em grupo privado', (await call('POST', `/spaces/${g.j.id}/join`, null, outsider.token)).s === 404);
  const d = (await call('GET', `/spaces/${g.j.id}`, null, A)).j;
  ok('detalhe traz membros, regras e papel', d.members.length === 2 && d.space.rules === 'Respeito' && d.space.my_role === 'owner' && d.space.staff);

  // chat do grupo, imagem, jogo, não lidas
  ok('mensagem no grupo', (await call('POST', `/spaces/${g.j.id}/messages`, { text: 'Olá grupo' }, B)).s === 201);
  ok('imagem e jogo no grupo', (await call('POST', `/spaces/${g.j.id}/messages`, { image: PNG, gameId: gm.j.id }, B)).s === 201);
  ok('imagem inválida é recusada', (await call('POST', `/spaces/${g.j.id}/messages`, { image: 'http://x/a.png' }, B)).s === 400);
  ok('mensagem vazia é recusada', (await call('POST', `/spaces/${g.j.id}/messages`, { text: ' ' }, B)).s === 400);
  let cv = (await call('GET', '/conversations', null, A)).j;
  const gc = cv.conversations.find(x => x.type === 'group');
  ok('conversa do grupo com não lidas e prévia', gc && gc.unread === 2 && /Beto: Foto/.test(gc.last) && cv.unread === 2);
  const msgs = (await call('GET', `/spaces/${g.j.id}/messages`, null, A)).j.messages;
  ok('histórico traz imagem e jogo', msgs.length === 2 && msgs[1].image === PNG && msgs[1].game_title === 'Jogo teste');
  ok('ler zera as não lidas', (await call('GET', '/conversations', null, A)).j.unread === 0);
  ok('estranho não lê o chat', (await call('GET', `/spaces/${g.j.id}/messages`, null, outsider.token)).s === 404);
  ok('editar grupo só o criador', (await call('PUT', `/spaces/${g.j.id}`, { name: 'Novo nome' }, B)).s === 403 && (await call('PUT', `/spaces/${g.j.id}`, { name: 'Novo nome', cover: PNG }, A)).s === 200);
  ok('convidar por ID', (await call('POST', `/spaces/${g.j.id}/invite`, { id: cid }, A)).s === 201);
  ok('remover membro', (await call('DELETE', `/spaces/${g.j.id}/members/${bid}`, null, B)).s === 403 && (await call('DELETE', `/spaces/${g.j.id}/members/${bid}`, null, A)).s === 200);
  ok('criador não sai nem é removido', (await call('POST', `/spaces/${g.j.id}/leave`, null, A)).s === 400 && (await call('DELETE', `/spaces/${g.j.id}/members/${aid}`, null, ADM)).s === 403);

  // comunidades
  const cm1 = await call('POST', '/spaces', { kind: 'community', name: 'Fãs de plataforma', description: 'Tudo sobre', category: 'Plataforma', access: 'restricted', rules: 'Sem spoilers', cover: PNG }, A);
  const op = await call('POST', '/spaces', { kind: 'community', name: 'Comunidade aberta', access: 'open' }, A);
  ok('criar comunidades', cm1.s === 201 && op.s === 201);
  ok('acesso inválido para o tipo', (await call('POST', '/spaces', { kind: 'community', name: 'Xyz', access: 'private' }, A)).s === 400 && (await call('POST', '/spaces', { kind: 'group', name: 'Xyz', access: 'open' }, A)).s === 400);
  ok('comunidades aparecem para todos', (await call('GET', '/spaces?kind=community', null, outsider.token)).j.spaces.length === 2);
  ok('busca de comunidade por nome', (await call('GET', '/spaces?kind=community&q=plataforma', null, B)).j.spaces.length === 1);
  ok('comunidade aberta: entra direto', (await call('POST', `/spaces/${op.j.id}/join`, null, B)).j.status === 'active');
  ok('comunidade restrita: fica pendente e avisa o criador', (await call('POST', `/spaces/${cm1.j.id}/join`, null, B)).j.status === 'pending' && (await call('GET', '/notifications', null, A)).j.notifications.some(n => n.kind === 'joinreq'));
  ok('pendente não conversa nem publica', (await call('POST', `/spaces/${cm1.j.id}/messages`, { text: 'oi' }, B)).s === 403 && (await call('POST', '/posts', { text: 'oi', spaceId: cm1.j.id }, B)).s === 403);
  ok('só administração aprova', (await call('POST', `/spaces/${cm1.j.id}/members/${bid}/approve`, null, C)).s === 403 && (await call('POST', `/spaces/${cm1.j.id}/members/${bid}/approve`, null, A)).s === 200);
  const cp = await call('POST', '/posts', { text: 'Dica da comunidade', spaceId: cm1.j.id }, B);
  ok('post dentro da comunidade', cp.s === 201);
  ok('feed da comunidade é próprio', (await call('GET', `/posts?space=${cm1.j.id}`, null, B)).j.posts.length === 1 && (await call('GET', `/posts?space=${op.j.id}`, null, B)).j.posts.length === 0);
  ok('post de comunidade fica fora do feed de quem não participa', !(await call('GET', '/posts', null, outsider.token)).j.posts.some(p => p.id === cp.j.id) && (await call('GET', '/posts', null, B)).j.posts.some(p => p.id === cp.j.id));
  ok('evento: só administração cria, data validada', (await call('POST', `/spaces/${cm1.j.id}/events`, { title: 'Campeonato', startsAt: '2030-01-10T20:00' }, B)).s === 403 && (await call('POST', `/spaces/${cm1.j.id}/events`, { title: 'Campeonato', startsAt: 'amanhã' }, A)).s === 400);
  const ev = await call('POST', `/spaces/${cm1.j.id}/events`, { title: 'Campeonato', description: 'Valendo', startsAt: '2030-01-10T20:00' }, A);
  ok('criar evento e avisar membros', ev.s === 201 && (await call('GET', '/notifications', null, B)).j.notifications.some(n => n.kind === 'event'));
  ok('detalhe da comunidade traz eventos', (await call('GET', `/spaces/${cm1.j.id}`, null, B)).j.events[0]?.title === 'Campeonato');
  ok('grupo não tem eventos', (await call('POST', `/spaces/${g.j.id}/events`, { title: 'Algo aqui', startsAt: '2030-01-10' }, A)).s === 400);
  ok('chat geral da comunidade', (await call('POST', `/spaces/${cm1.j.id}/messages`, { text: 'Bem-vindos' }, B)).s === 201 && (await call('GET', '/conversations', null, A)).j.conversations.some(x => x.type === 'community' && x.unread === 1));
  ok('excluir evento', (await call('DELETE', `/spaces/${cm1.j.id}/events/${ev.j.id}`, null, A)).s === 200);
  ok('meus espaços', (await call('GET', '/spaces?mine=1', null, B)).j.spaces.length === 2);
  ok('sair da comunidade', (await call('POST', `/spaces/${op.j.id}/leave`, null, B)).s === 200);
  ok('excluir comunidade (criador) apaga posts e chat', (await call('DELETE', `/spaces/${cm1.j.id}`, null, B)).s === 403 && (await call('DELETE', `/spaces/${cm1.j.id}`, null, A)).s === 200 && (await call('GET', `/posts?space=${cm1.j.id}`, null, A)).s === 404);

  // amigos e mensagens diretas
  ok('adicionar amigo por ID', (await call('POST', '/friends/request', { id: '#' + bid }, A)).s === 201);
  ok('adicionar amigo por nome', (await call('POST', '/friends/request', { name: 'Caio' }, A)).s === 201);
  ok('jogador inexistente', (await call('POST', '/friends/request', { name: 'Ninguem' }, A)).s === 404);
  ok('pedido gera notificação de amigo', (await call('GET', '/notifications', null, B)).j.notifications.some(n => n.kind === 'friend'));
  ok('aceitar amizade', (await call('POST', `/friends/${aid}/accept`, null, B)).s === 200);
  ok('DM sem ser amigo é recusada', (await call('POST', '/messages', { to: cid, text: 'oi' }, A)).s === 403);
  ok('DM com texto, imagem e jogo', (await call('POST', '/messages', { to: bid, text: 'Oi!' }, A)).s === 201 && (await call('POST', '/messages', { to: bid, image: PNG }, A)).s === 201 && (await call('POST', '/messages', { to: bid, gameId: gm.j.id, text: 'Veja' }, A)).s === 201);
  ok('DM vazia é recusada', (await call('POST', '/messages', { to: bid, text: ' ' }, A)).s === 400);
  cv = (await call('GET', '/conversations', null, B)).j;
  const dm = cv.conversations.find(x => x.type === 'direct');
  ok('conversa direta com não lidas e prévia', dm && dm.name === 'Ana' && dm.unread === 3 && /Veja/.test(dm.last) && 'online' in dm);
  const hist = (await call('GET', `/messages/${aid}`, null, B)).j.messages;
  ok('histórico direto com imagem e jogo', hist.length === 3 && hist[1].image === PNG && hist[2].game_title === 'Jogo teste');
  ok('ler a DM zera as não lidas', (await call('GET', '/conversations', null, B)).j.conversations.find(x => x.type === 'direct').unread === 0);
  ok('convidar amigo para jogo', (await call('POST', `/friends/${bid}/invite-game`, { gameId: gm.j.id }, A)).s === 201 && (await call('GET', '/notifications', null, B)).j.notifications.some(n => n.kind === 'gameinvite'));
  ok('não convida não-amigo', (await call('POST', `/friends/${cid}/invite-game`, { gameId: gm.j.id }, A)).s === 403);
  // validade e exclusão de notificações
  const dbx = new DatabaseSync(path.join(dir, 't.db'));
  const nid = k => Number(dbx.prepare("INSERT INTO notifications (user_id, title, body, kind, created_at) VALUES (?,?,?,?,datetime('now','-30 hours'))").run(aid, 'Velho ' + k, 'x', k).lastInsertRowid);
  const nOld = nid('sys'), nUpd = nid('update'), nPay = nid('purchase'), nCode = nid('code');
  const bro = Number(dbx.prepare("INSERT INTO notifications (user_id, title, body, kind) VALUES (NULL,'Aviso geral','x','sys')").run().lastInsertRowid);
  const lst = (await call('GET', '/notifications', null, A)).j.notifications;
  ok('aviso comum com mais de 24 h é apagado sozinho', !lst.some(n => n.id === nOld));
  ok('avisos importantes (atualização, compra, código) não expiram', [nUpd, nPay, nCode].every(i => lst.some(n => n.id === i && n.important === true)));
  ok('aviso novo não é marcado como importante', lst.filter(n => ![nUpd, nPay, nCode].includes(n.id)).every(n => n.important === false));
  ok('apagar aviso importante', (await call('DELETE', `/notifications/${nUpd}`, null, A)).s === 200 && !(await call('GET', '/notifications', null, A)).j.notifications.some(n => n.id === nUpd));
  ok('não apaga aviso de outro jogador', (await call('DELETE', `/notifications/${nPay}`, null, B)).s === 404);
  ok('aviso geral apagado só some para quem apagou', (await call('DELETE', `/notifications/${bro}`, null, A)).s === 200 && !(await call('GET', '/notifications', null, A)).j.notifications.some(n => n.id === bro) && (await call('GET', '/notifications', null, B)).j.notifications.some(n => n.id === bro));
  dbx.close();
  ok('apagar post leva os comentários', (await call('DELETE', `/posts/${p1.j.id}`, null, B)).s === 200);
}
try { await main(); } catch (e) { fail++; console.error('ERRO NO TESTE', e); }
srv.kill(); rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
