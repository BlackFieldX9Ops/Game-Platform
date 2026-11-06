import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { all, get, run } from './db.js';

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.JWT_SECRET || (PROD ? '' : 'dev-secret-change-me');
if (!SECRET) { console.error('Defina JWT_SECRET em produção.'); process.exit(1); }
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const CATEGORIES = ['Aventura', 'RPG', 'Corrida', 'Ação', 'Estratégia', 'Terror', 'Plataforma', 'Quebra-cabeça'];
const AGES = ['Livre', '10+', '12+', '14+', '16+', '18+'];
const LIBS = ['three', 'phaser', 'p5', 'pixi'];
const MAX_CODE = 2_000_000;

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ORIGINS.length ? ORIGINS : true }));
app.use(express.json({ limit: '3mb' }));

/* ---------- utilidades ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (m, s = 400) => { throw new HttpError(s, m); };
function str(v, name, min, max) {
  if (typeof v !== 'string') bad(`${name} é obrigatório`);
  const t = v.trim();
  if (t.length < min || t.length > max) bad(`${name} deve ter entre ${min} e ${max} caracteres`);
  return t;
}
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) bad(`${name} inválido`); return n; };
const publicUser = u => ({ id: u.id, name: u.name, role: u.role, xp: u.xp, level: Math.floor(u.xp / 500) + 1 });
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });

function userFromToken(token) {
  try {
    const { id } = jwt.verify(token, SECRET);
    const u = get('SELECT * FROM users WHERE id = ?', id);
    return u && u.status === 'active' ? u : null;
  } catch { return null; }
}
function auth(req, _res, next) {
  const h = req.headers.authorization || '';
  const u = h.startsWith('Bearer ') ? userFromToken(h.slice(7)) : null;
  if (!u) return next(new HttpError(401, 'Faça login para continuar'));
  req.user = u; next();
}
const adminOnly = (req, _res, next) => req.user.role === 'admin' ? next() : next(new HttpError(403, 'Acesso restrito a administradores'));
const notify = (userId, title, body = '') => run('INSERT INTO notifications (user_id, title, body) VALUES (?,?,?)', userId, title, body);

const GAME_COLS = `g.id, g.title, g.description, g.category, g.age, g.dim, g.libs, g.plays, g.created_at, g.owner_id,
  u.name AS developer,
  (SELECT ROUND(AVG(stars),1) FROM reviews r WHERE r.game_id = g.id) AS rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.game_id = g.id) AS review_count`;
const shapeGame = g => ({ ...g, libs: JSON.parse(g.libs) });
function loadGame(id, { owned } = {}) {
  const g = get('SELECT * FROM games WHERE id = ?', id);
  if (!g || g.status !== 'published') bad('Jogo não encontrado', 404);
  return g;
}
function gameInput(b) {
  const title = str(b.title, 'Nome', 2, 40);
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 200) : '';
  if (!CATEGORIES.includes(b.category)) bad('Categoria inválida');
  const age = b.age ?? 'Livre'; if (!AGES.includes(age)) bad('Classificação inválida');
  if (!['2D', '3D'].includes(b.dim)) bad('Tipo deve ser 2D ou 3D');
  const libs = Array.isArray(b.libs) ? b.libs : [];
  if (libs.some(l => !LIBS.includes(l))) bad('Biblioteca não suportada');
  if (typeof b.code !== 'string' || !b.code.trim()) bad('O código do jogo é obrigatório');
  if (b.code.length > MAX_CODE) bad('Código maior que 2 MB');
  return { title, description, category: b.category, age, dim: b.dim, libs: JSON.stringify([...new Set(libs)]), code: b.code };
}

/* ---------- saúde ---------- */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

/* ---------- autenticação ---------- */
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Tente de novo em alguns minutos.' } });
app.post('/api/auth/register', authLimiter, wrap((req, res) => {
  const name = str(req.body.name, 'Nome', 3, 20);
  if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) bad('O nome só pode ter letras, números, _ . e -');
  const email = str(req.body.email, 'E-mail', 5, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('E-mail inválido');
  const password = str(req.body.password, 'Senha', 8, 100);
  if (get('SELECT 1 FROM users WHERE email = ?', email)) bad('Esse e-mail já está cadastrado', 409);
  if (get('SELECT 1 FROM users WHERE name = ?', name)) bad('Esse nome já está em uso', 409);
  const role = ADMIN_EMAIL && email === ADMIN_EMAIL ? 'admin' : 'user';
  const r = run('INSERT INTO users (name, email, pass_hash, role) VALUES (?,?,?,?)', name, email, bcrypt.hashSync(password, 10), role);
  const u = get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
  notify(u.id, 'Bem-vindo à Game Platform', 'Jogue, crie e compartilhe seus jogos.');
  res.status(201).json({ token: sign(u), user: publicUser(u) });
}));
app.post('/api/auth/login', authLimiter, wrap((req, res) => {
  const email = str(req.body.email, 'E-mail', 5, 120).toLowerCase();
  const u = get('SELECT * FROM users WHERE email = ?', email);
  if (!u || !bcrypt.compareSync(String(req.body.password ?? ''), u.pass_hash)) bad('E-mail ou senha incorretos', 401);
  if (u.status !== 'active') bad('Conta suspensa', 403);
  res.json({ token: sign(u), user: publicUser(u) });
}));
app.get('/api/me', auth, (req, res) => res.json({ user: { ...publicUser(req.user), email: req.user.email } }));
app.patch('/api/me', auth, wrap((req, res) => {
  const name = str(req.body.name, 'Nome', 3, 20);
  if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) bad('O nome só pode ter letras, números, _ . e -');
  const taken = get('SELECT id FROM users WHERE name = ?', name);
  if (taken && taken.id !== req.user.id) bad('Esse nome já está em uso', 409);
  run('UPDATE users SET name = ? WHERE id = ?', name, req.user.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
}));

/* ---------- jogos ---------- */
app.get('/api/games', wrap((req, res) => {
  const where = ["g.status = 'published'"], p = [];
  if (req.query.category) { where.push('g.category = ?'); p.push(String(req.query.category)); }
  if (req.query.dim) { where.push('g.dim = ?'); p.push(String(req.query.dim)); }
  if (req.query.q) { where.push('(g.title LIKE ? OR g.description LIKE ?)'); const l = `%${String(req.query.q).slice(0, 40)}%`; p.push(l, l); }
  if (req.query.owner) { where.push('g.owner_id = ?'); p.push(int(req.query.owner, 'owner')); }
  const limit = Math.min(Number(req.query.limit) || 24, 60), offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = all(`SELECT ${GAME_COLS} FROM games g JOIN users u ON u.id = g.owner_id WHERE ${where.join(' AND ')} ORDER BY g.plays DESC, g.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  res.json({ games: rows.map(shapeGame) });
}));
app.get('/api/games/:id', wrap((req, res) => {
  const id = int(req.params.id, 'id'); loadGame(id);
  res.json({ game: shapeGame(get(`SELECT ${GAME_COLS} FROM games g JOIN users u ON u.id = g.owner_id WHERE g.id = ?`, id)) });
}));
// Código-fonte para o dono editar (não conta partida nem XP).
app.get('/api/games/:id/source', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'));
  if (g.owner_id !== req.user.id) bad('Só o dono vê o código-fonte', 403);
  res.json({ code: g.code, libs: JSON.parse(g.libs) });
}));
// Entrega o código para jogar, conta a partida e dá XP.
app.post('/api/games/:id/play', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'));
  run('UPDATE games SET plays = plays + 1 WHERE id = ?', g.id);
  run('UPDATE users SET xp = xp + 25 WHERE id = ?', req.user.id);
  res.json({ title: g.title, code: g.code, libs: JSON.parse(g.libs), xp: req.user.xp + 25 });
}));
app.post('/api/games', auth, wrap((req, res) => {
  const d = gameInput(req.body);
  if (get("SELECT COUNT(*) AS n FROM games WHERE owner_id = ? AND status = 'published'", req.user.id).n >= 50) bad('Limite de 50 jogos publicados');
  const r = run('INSERT INTO games (owner_id, title, description, category, age, dim, libs, code) VALUES (?,?,?,?,?,?,?,?)', req.user.id, d.title, d.description, d.category, d.age, d.dim, d.libs, d.code);
  run('INSERT OR IGNORE INTO library (user_id, game_id) VALUES (?,?)', req.user.id, r.lastInsertRowid);
  notify(req.user.id, 'Jogo publicado', `${d.title} já está na Loja.`);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
app.put('/api/games/:id', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'));
  if (g.owner_id !== req.user.id) bad('Você só pode editar seus jogos', 403);
  const d = gameInput(req.body);
  run("UPDATE games SET title=?, description=?, category=?, age=?, dim=?, libs=?, code=?, updated_at=datetime('now') WHERE id=?", d.title, d.description, d.category, d.age, d.dim, d.libs, d.code, g.id);
  res.json({ ok: true });
}));
app.delete('/api/games/:id', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'));
  if (g.owner_id !== req.user.id && req.user.role !== 'admin') bad('Sem permissão', 403);
  run('DELETE FROM games WHERE id = ?', g.id);
  res.json({ ok: true });
}));

/* ---------- avaliações ---------- */
app.get('/api/games/:id/reviews', wrap((req, res) => {
  const id = int(req.params.id, 'id'); loadGame(id);
  res.json({ reviews: all('SELECT r.id, r.stars, r.text, r.created_at, u.name AS author FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.game_id = ? ORDER BY r.id DESC LIMIT 100', id) });
}));
app.post('/api/games/:id/reviews', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'));
  const stars = Number(req.body.stars); if (!Number.isInteger(stars) || stars < 1 || stars > 5) bad('A nota deve ir de 1 a 5');
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
  run('INSERT INTO reviews (game_id, user_id, stars, text) VALUES (?,?,?,?) ON CONFLICT(game_id, user_id) DO UPDATE SET stars=excluded.stars, text=excluded.text', g.id, req.user.id, stars, text);
  if (g.owner_id !== req.user.id) notify(g.owner_id, 'Nova avaliação', `${req.user.name} avaliou ${g.title} com ${stars} estrelas.`);
  res.status(201).json({ ok: true });
}));

/* ---------- biblioteca e desejos ---------- */
for (const [route, table] of [['library', 'library'], ['wishlist', 'wishlist']]) {
  app.get(`/api/${route}`, auth, (req, res) => {
    const rows = all(`SELECT ${GAME_COLS} FROM ${table} t JOIN games g ON g.id = t.game_id JOIN users u ON u.id = g.owner_id WHERE t.user_id = ? AND g.status = 'published'`, req.user.id);
    res.json({ games: rows.map(shapeGame) });
  });
  app.put(`/api/${route}/:gameId`, auth, wrap((req, res) => {
    const g = loadGame(int(req.params.gameId, 'id'));
    run(`INSERT OR IGNORE INTO ${table} (user_id, game_id) VALUES (?,?)`, req.user.id, g.id);
    res.json({ ok: true });
  }));
  app.delete(`/api/${route}/:gameId`, auth, wrap((req, res) => {
    run(`DELETE FROM ${table} WHERE user_id = ? AND game_id = ?`, req.user.id, int(req.params.gameId, 'id'));
    res.json({ ok: true });
  }));
}

/* ---------- comunidade ---------- */
app.get('/api/posts', wrap((req, res) => {
  const me = (() => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? userFromToken(h.slice(7)) : null; })();
  const rows = all(`SELECT p.id, p.text, p.created_at, p.game_id, u.name AS author, g.title AS game_title,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
    FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN games g ON g.id = p.game_id AND g.status = 'published'
    ORDER BY p.id DESC LIMIT 50`, me ? me.id : 0);
  res.json({ posts: rows.map(r => ({ ...r, liked: !!r.liked })) });
}));
app.post('/api/posts', auth, wrap((req, res) => {
  const text = str(req.body.text, 'Texto', 1, 240);
  let gameId = null;
  if (req.body.gameId) gameId = loadGame(int(req.body.gameId, 'gameId')).id;
  const r = run('INSERT INTO posts (user_id, game_id, text) VALUES (?,?,?)', req.user.id, gameId, text);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
app.post('/api/posts/:id/like', auth, wrap((req, res) => {
  const id = int(req.params.id, 'id');
  if (!get('SELECT 1 FROM posts WHERE id = ?', id)) bad('Post não encontrado', 404);
  const had = get('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?', id, req.user.id);
  if (had) run('DELETE FROM likes WHERE post_id = ? AND user_id = ?', id, req.user.id);
  else run('INSERT INTO likes (post_id, user_id) VALUES (?,?)', id, req.user.id);
  res.json({ liked: !had });
}));
app.delete('/api/posts/:id', auth, wrap((req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', int(req.params.id, 'id'));
  if (!p) bad('Post não encontrado', 404);
  if (p.user_id !== req.user.id && req.user.role !== 'admin') bad('Sem permissão', 403);
  run('DELETE FROM posts WHERE id = ?', p.id);
  res.json({ ok: true });
}));

/* ---------- amigos ---------- */
const online = new Map(); // userId -> Set<WebSocket>
const isOnline = id => (online.get(id)?.size || 0) > 0;
app.get('/api/friends', auth, (req, res) => {
  const rows = all(`SELECT f.status, f.requester_id, f.addressee_id,
    u.id AS id, u.name AS name FROM friends f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id = ? OR f.addressee_id = ?`, req.user.id, req.user.id, req.user.id);
  res.json({ friends: rows.map(r => ({ id: r.id, name: r.name, status: r.status, incoming: r.status === 'pending' && r.addressee_id === req.user.id, online: r.status === 'accepted' && isOnline(r.id) })) });
});
app.post('/api/friends/request', auth, wrap((req, res) => {
  const name = str(req.body.name, 'Nome', 3, 20);
  const t = get('SELECT * FROM users WHERE name = ? AND status = ?', name, 'active');
  if (!t) bad('Jogador não encontrado', 404);
  if (t.id === req.user.id) bad('Você não pode adicionar a si mesmo');
  const ex = get('SELECT * FROM friends WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)', req.user.id, t.id, t.id, req.user.id);
  if (ex) bad(ex.status === 'accepted' ? 'Vocês já são amigos' : 'Já existe um pedido pendente', 409);
  run('INSERT INTO friends (requester_id, addressee_id) VALUES (?,?)', req.user.id, t.id);
  notify(t.id, 'Pedido de amizade', `${req.user.name} quer ser seu amigo.`);
  res.status(201).json({ ok: true });
}));
app.post('/api/friends/:id/accept', auth, wrap((req, res) => {
  const r = run("UPDATE friends SET status='accepted' WHERE requester_id = ? AND addressee_id = ? AND status='pending'", int(req.params.id, 'id'), req.user.id);
  if (!r.changes) bad('Pedido não encontrado', 404);
  res.json({ ok: true });
}));
app.delete('/api/friends/:id', auth, wrap((req, res) => {
  const id = int(req.params.id, 'id');
  run('DELETE FROM friends WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)', req.user.id, id, id, req.user.id);
  res.json({ ok: true });
}));

/* ---------- mensagens ---------- */
const areFriends = (a, b) => !!get("SELECT 1 FROM friends WHERE status='accepted' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))", a, b, b, a);
app.get('/api/messages/:userId', auth, wrap((req, res) => {
  const o = int(req.params.userId, 'userId');
  if (!areFriends(req.user.id, o)) bad('Só é possível conversar com amigos', 403);
  const rows = all('SELECT id, from_id, to_id, text, created_at FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id DESC LIMIT 100', req.user.id, o, o, req.user.id);
  res.json({ messages: rows.reverse() });
}));
function pushTo(userId, payload) {
  for (const ws of online.get(userId) || []) if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}
app.post('/api/messages', auth, wrap((req, res) => {
  const to = int(req.body.to, 'to'), text = str(req.body.text, 'Mensagem', 1, 300);
  if (!areFriends(req.user.id, to)) bad('Só é possível conversar com amigos', 403);
  const r = run('INSERT INTO messages (from_id, to_id, text) VALUES (?,?,?)', req.user.id, to, text);
  const msg = get('SELECT id, from_id, to_id, text, created_at FROM messages WHERE id = ?', r.lastInsertRowid);
  pushTo(to, { type: 'message', message: { ...msg, from_name: req.user.name } });
  res.status(201).json({ message: msg });
}));

/* ---------- notificações e denúncias ---------- */
app.get('/api/notifications', auth, (req, res) => {
  res.json({ notifications: all('SELECT id, title, body, created_at FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC LIMIT 50', req.user.id) });
});
app.post('/api/reports', auth, wrap((req, res) => {
  const type = req.body.targetType; if (!['game', 'post', 'user'].includes(type)) bad('Tipo de denúncia inválido');
  const id = int(req.body.targetId, 'targetId'), reason = str(req.body.reason, 'Motivo', 3, 200);
  const table = { game: 'games', post: 'posts', user: 'users' }[type];
  if (!get(`SELECT 1 FROM ${table} WHERE id = ?`, id)) bad('Conteúdo não encontrado', 404);
  run('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?,?,?,?)', req.user.id, type, id, reason);
  res.status(201).json({ ok: true });
}));

/* ---------- painel do criador ---------- */
app.get('/api/creator/stats', auth, (req, res) => {
  const games = all(`SELECT g.id, g.title, g.plays,
    (SELECT ROUND(AVG(stars),1) FROM reviews r WHERE r.game_id = g.id) AS rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.game_id = g.id) AS reviews,
    (SELECT COUNT(*) FROM library l WHERE l.game_id = g.id) AS in_libraries,
    (SELECT COUNT(*) FROM wishlist w WHERE w.game_id = g.id) AS in_wishlists
    FROM games g WHERE g.owner_id = ? AND g.status = 'published' ORDER BY g.plays DESC`, req.user.id);
  res.json({ games, totals: { games: games.length, plays: games.reduce((a, g) => a + g.plays, 0), reviews: games.reduce((a, g) => a + g.reviews, 0) } });
});

/* ---------- administração ---------- */
app.get('/api/admin/overview', auth, adminOnly, (_req, res) => {
  res.json({
    users: get('SELECT COUNT(*) AS n FROM users').n,
    games: get("SELECT COUNT(*) AS n FROM games WHERE status='published'").n,
    openReports: get("SELECT COUNT(*) AS n FROM reports WHERE status='open'").n,
    plays: get('SELECT COALESCE(SUM(plays),0) AS n FROM games').n
  });
});
app.get('/api/admin/reports', auth, adminOnly, (_req, res) => {
  res.json({ reports: all("SELECT r.id, r.target_type, r.target_id, r.reason, r.created_at, u.name AS reporter FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.status = 'open' ORDER BY r.id") });
});
app.post('/api/admin/reports/:id/resolve', auth, adminOnly, wrap((req, res) => {
  const r = get("SELECT * FROM reports WHERE id = ? AND status = 'open'", int(req.params.id, 'id'));
  if (!r) bad('Denúncia não encontrada', 404);
  const action = req.body.action;
  if (!['dismiss', 'remove'].includes(action)) bad('Ação inválida');
  if (action === 'remove') {
    if (r.target_type === 'game') run('DELETE FROM games WHERE id = ?', r.target_id);
    if (r.target_type === 'post') run('DELETE FROM posts WHERE id = ?', r.target_id);
    if (r.target_type === 'user') run("UPDATE users SET status = 'suspended' WHERE id = ? AND role <> 'admin'", r.target_id);
  }
  run("UPDATE reports SET status = ? WHERE id = ?", action === 'remove' ? 'actioned' : 'dismissed', r.id);
  res.json({ ok: true });
}));
app.get('/api/admin/users', auth, adminOnly, (_req, res) => {
  res.json({ users: all('SELECT id, name, email, role, status, xp, created_at FROM users ORDER BY id DESC LIMIT 200') });
});
app.post('/api/admin/users/:id/status', auth, adminOnly, wrap((req, res) => {
  const id = int(req.params.id, 'id'), status = req.body.status;
  if (!['active', 'suspended'].includes(status)) bad('Status inválido');
  if (id === req.user.id) bad('Você não pode alterar a própria conta');
  run('UPDATE users SET status = ? WHERE id = ?', status, id);
  res.json({ ok: true });
}));
app.post('/api/admin/notify', auth, adminOnly, wrap((req, res) => {
  run('INSERT INTO notifications (user_id, title, body) VALUES (NULL,?,?)', str(req.body.title, 'Título', 2, 80), typeof req.body.body === 'string' ? req.body.body.slice(0, 200) : '');
  res.status(201).json({ ok: true });
}));

/* ---------- app estático (opcional) e erros ---------- */
const here = path.dirname(fileURLToPath(import.meta.url));
const www = [process.env.STATIC_DIR, path.join(here, '../www'), path.join(here, '../../app/www')]
  .filter(Boolean).map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, 'index.html'))) || '';
if (www) app.use(express.static(www));
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo grande demais' });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido' });
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro interno do servidor' });
});

/* ---------- tempo real (chat) ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
  const u = userFromToken(token);
  if (!u) { ws.close(4401, 'não autorizado'); return; }
  if (!online.has(u.id)) online.set(u.id, new Set());
  online.get(u.id).add(ws);
  ws.send(JSON.stringify({ type: 'ready', user: publicUser(u) }));
  ws.on('close', () => { online.get(u.id)?.delete(ws); });
});

server.listen(PORT, () => console.log(`Game Platform API em http://localhost:${PORT}`));
