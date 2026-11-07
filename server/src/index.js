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
import { mountSocial } from './social.js';
import { mountAccounts } from './accounts.js';
import { mountStore, hasStudio, hasPremium, fmtUid, itemName } from './store.js';

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.JWT_SECRET || (PROD ? '' : 'dev-secret-change-me');
if (!SECRET) { console.error('Defina JWT_SECRET em produção.'); process.exit(1); }
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const CATEGORIES = ['Aventura', 'RPG', 'Corrida', 'Ação', 'Estratégia', 'Terror', 'Plataforma', 'Quebra-cabeça'];
const DEFAULT_CATEGORIES = CATEGORIES.slice();
const AGES = ['Livre', '10+', '12+', '14+', '16+', '18+'];
const LIBS = ['three', 'phaser', 'p5', 'pixi'];
const MAX_CODE = 20_000_000;

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ORIGINS.length ? ORIGINS : true }));
app.use(express.json({ limit: '30mb' }));

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
const publicUser = u => ({ id: u.id, uid: fmtUid(u), name: u.name, role: u.role, xp: u.xp, level: Math.floor(u.xp / 500) + 1, avatar: u.avatar || null, bio: u.bio || '', studio: hasStudio(u), premium: hasPremium(u), coins: u.coins || 0, frame: u.frame || null, banner: u.banner || null, title: u.title || null, titleName: itemName(u.title), ncolor: u.ncolor || null, theme: u.theme || null, bubble: u.bubble || null });
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
function softAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  req.user = h.startsWith('Bearer ') ? userFromToken(h.slice(7)) || undefined : undefined; next();
}
const adminOnly = (req, _res, next) => req.user.role === 'admin' ? next() : next(new HttpError(403, 'Acesso restrito a administradores'));
const notify = (userId, title, body = '', ref = '') => run('INSERT INTO notifications (user_id, title, body, kind, ref) VALUES (?,?,?,?,?)', userId, title, body, ref ? 'game' : 'sys', ref);

const GAME_COLS = `g.id, g.cover, g.featured, g.orientation, g.title, g.description, g.category, g.age, g.dim, g.libs, g.plays, g.created_at, g.updated_at, g.owner_id, g.status, g.ai, g.tags, g.version, g.visibility, g.settings,
  u.name AS developer,
  (SELECT ROUND(AVG(stars),1) FROM reviews r WHERE r.game_id = g.id) AS rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.game_id = g.id) AS review_count`;
const parseJ = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const shapeGame = g => ({ ...g, featured: !!g.featured, ai: !!g.ai, libs: parseJ(g.libs, []), tags: parseJ(g.tags, []), settings: parseJ(g.settings, {}) });
const categories = () => { const r = get("SELECT value FROM settings WHERE key = 'categories'"); try { return r ? JSON.parse(r.value) : DEFAULT_CATEGORIES; } catch { return DEFAULT_CATEGORIES; } };
const logAct = (req, action, detail = '') => run('INSERT INTO logs (actor_id, actor, action, detail) VALUES (?,?,?,?)', req.user.id, req.user.name, action, String(detail).slice(0, 160));
const COVER_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
// Quem pode ver o jogo: todos (publicado e não privado), ou o dono e os administradores em qualquer estado.
function loadGame(id, user) {
  const g = get('SELECT * FROM games WHERE id = ?', id);
  // Jogo removido pela administração: só quem comprou (e a própria administração) ainda o enxerga.
  if (g && g.status === 'removed') {
    if (user && (user.role === 'admin' || get('SELECT 1 FROM purchases WHERE user_id = ? AND game_id = ?', user.id, g.id))) return g;
    bad('Jogo não encontrado', 404);
  }
  const staff = user && (user.id === g?.owner_id || user.role === 'admin');
  if (!g || !(staff || (g.status === 'published' && g.visibility !== 'private'))) bad('Jogo não encontrado', 404);
  return g;
}
// Jogo com preço: só dono, administração e quem comprou.
const priceOf = g => Math.round(Number(parseJ(g.settings, {}).price)) || 0;
const needsBuy = (g, user) => priceOf(g) > 0 && g.owner_id !== user.id && user.role !== 'admin' && !get('SELECT 1 FROM purchases WHERE user_id = ? AND game_id = ?', user.id, g.id);
const canEdit = (g, user) => g.owner_id === user.id || user.role === 'admin';
function gameInput(b) {
  const title = str(b.title, 'Nome', 2, 40);
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 200) : '';
  if (!categories().includes(b.category)) bad('Categoria inválida');
  const age = b.age ?? 'Livre'; if (!AGES.includes(age)) bad('Classificação inválida');
  if (!['2D', '3D'].includes(b.dim)) bad('Tipo deve ser 2D ou 3D');
  const libs = Array.isArray(b.libs) ? b.libs : [];
  if (libs.some(l => !LIBS.includes(l))) bad('Biblioteca não suportada');
  if (typeof b.code !== 'string' || !b.code.trim()) bad('O código do jogo é obrigatório');
  if (b.code.length > MAX_CODE) bad('Código maior que 20 MB');
  const orientation = b.orientation === undefined ? 'auto' : b.orientation;
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) bad('Orientação inválida');
  let cover; // undefined = não mexer; null = remover
  if ('cover' in b) {
    if (b.cover === null || b.cover === '') cover = null;
    else if (typeof b.cover === 'string' && b.cover.length <= 200_000 && COVER_RE.test(b.cover)) cover = b.cover;
    else bad('Capa inválida (use JPG, PNG ou WebP de até 150 KB)');
  }
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map(t => String(t).trim().toLowerCase().slice(0, 20)).filter(Boolean))].slice(0, 8);
  const version = b.version === undefined ? '1.0.0' : String(b.version).trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,11}$/.test(version)) bad('Versão inválida (ex.: 1.0.0)');
  const visibility = b.visibility === undefined ? 'public' : b.visibility;
  if (!['public', 'private', 'unlisted'].includes(visibility)) bad('Visibilidade inválida');
  const st = b.settings && typeof b.settings === 'object' ? b.settings : {};
  const settings = { fullscreen: st.fullscreen === 0 || st.fullscreen === false ? 0 : 1, saveProgress: st.saveProgress ? 1 : 0, monetization: ['free', 'ads', 'paid'].includes(st.monetization) ? st.monetization : 'free',
    controls: (Array.isArray(st.controls) ? st.controls : ['touch', 'keyboard']).filter(c => ['touch', 'keyboard', 'gamepad'].includes(c)), ext: [] };
  if (settings.monetization === 'paid') {
    const price = Math.round(Number(st.price));
    if (!(price >= 1 && price <= 9999)) bad('Jogo pago: informe o preço em moedas (1 a 9999)');
    settings.price = price;
  } else settings.price = 0;
  settings.early = st.early ? 1 : 0;
  let extBytes = 0;
  for (const x of (Array.isArray(st.ext) ? st.ext : []).slice(0, 6)) {
    const n = typeof x?.n === 'string' ? x.n.trim().slice(0, 40) : ''; if (!n) bad('Biblioteca externa sem nome');
    if (typeof x.u === 'string' && x.u) { if (!/^https:\/\/[^\s"'<>]{4,300}$/.test(x.u)) bad('Biblioteca externa: use um endereço https'); settings.ext.push({ n, u: x.u }); }
    else if (typeof x.c === 'string' && x.c) { extBytes += x.c.length; if (extBytes > 300_000) bad('Bibliotecas externas passam de 300 KB'); settings.ext.push({ n, c: x.c }); }
  }
  // Missões do criador: exclusivas deste jogo (o app só gera as padrão quando não há nenhuma).
  settings.missions = [];
  for (const [i, x] of (Array.isArray(st.missions) ? st.missions : []).slice(0, 8).entries()) {
    const t = typeof x?.t === 'string' ? x.t.trim().slice(0, 40) : ''; if (t.length < 3) bad('Missão ' + (i + 1) + ': dê um nome com pelo menos 3 letras');
    const k = ['plays', 'minutes'].includes(x.k) ? x.k : 'plays';
    const goal = Math.round(Number(x.goal)); if (!(goal >= 1 && goal <= (k === 'plays' ? 9999 : 6000))) bad('Missão ' + (i + 1) + ': meta inválida');
    const xp = Math.round(Number(x.xp)); if (!(xp >= 5 && xp <= 500)) bad('Missão ' + (i + 1) + ': o XP vai de 5 a 500');
    const m = { id: /^[a-z0-9]{1,8}$/.test(x.id) ? x.id : 'm' + (i + 1), t, d: typeof x.d === 'string' ? x.d.trim().slice(0, 120) : '', k, goal, xp };
    if (x.secret) { m.secret = 1; m.req = Math.min(999, Math.max(1, Math.round(Number(x.req)) || 5)); }
    if (settings.missions.some(o => o.id === m.id)) m.id = 'm' + (i + 1) + 'x';
    settings.missions.push(m);
  }
  return { title, description, category: b.category, age, dim: b.dim, libs: JSON.stringify([...new Set(libs)]), code: b.code, cover, orientation, tags: JSON.stringify(tags), version, visibility, settings: JSON.stringify(settings), ai: b.ai ? 1 : 0 };
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
app.get('/api/me', auth, (req, res) => res.json({ user: { ...publicUser(req.user), email: req.user.email, emailVerified: !!req.user.email_verified, google: !!req.user.google_id } }));
app.patch('/api/me', auth, wrap((req, res) => {
  const b = req.body || {}, cur = req.user;
  let name = cur.name, bio = cur.bio || '', avatar = cur.avatar || null;
  if (b.name !== undefined) {
    name = str(b.name, 'Nome', 3, 20);
    if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) bad('O nome só pode ter letras, números, _ . e -');
    const taken = get('SELECT id FROM users WHERE name = ?', name);
    if (taken && taken.id !== cur.id) bad('Esse nome já está em uso', 409);
  }
  if (b.bio !== undefined) {
    if (typeof b.bio !== 'string') bad('Texto inválido');
    bio = b.bio.trim().slice(0, 120);
  }
  if ('avatar' in b) {
    if (b.avatar === null || b.avatar === '') avatar = null;
    else if (typeof b.avatar === 'string' && b.avatar.length <= 80_000 && COVER_RE.test(b.avatar)) avatar = b.avatar;
    else bad('Foto inválida (use JPG, PNG ou WebP pequenos)');
  }
  run('UPDATE users SET name = ?, bio = ?, avatar = ? WHERE id = ?', name, bio, avatar, cur.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', cur.id)) });
}));

/* ---------- jogos ---------- */
app.get('/api/games', wrap((req, res) => {
  const where = ["g.status = 'published'", "g.visibility = 'public'"], p = [];
  if (req.query.category) { where.push('g.category = ?'); p.push(String(req.query.category)); }
  if (req.query.dim) { where.push('g.dim = ?'); p.push(String(req.query.dim)); }
  if (req.query.q) { where.push('(g.title LIKE ? OR g.description LIKE ?)'); const l = `%${String(req.query.q).slice(0, 40)}%`; p.push(l, l); }
  if (req.query.owner) { where.push('g.owner_id = ?'); p.push(int(req.query.owner, 'owner')); }
  const limit = Math.min(Number(req.query.limit) || 24, 60), offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = all(`SELECT ${GAME_COLS} FROM games g JOIN users u ON u.id = g.owner_id WHERE ${where.join(' AND ')} ORDER BY g.featured DESC, g.plays DESC, g.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  res.json({ games: rows.map(shapeGame) });
}));
app.get('/api/games/:id', softAuth, wrap((req, res) => {
  const id = int(req.params.id, 'id'); loadGame(id, req.user);
  res.json({ game: shapeGame(get(`SELECT ${GAME_COLS} FROM games g JOIN users u ON u.id = g.owner_id WHERE g.id = ?`, id)) });
}));
// Código-fonte para o dono editar (não conta partida nem XP).
app.get('/api/games/:id/source', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'), req.user);
  if (!canEdit(g, req.user)) bad('Só o dono ou um administrador vê o código-fonte', 403);
  res.json({ code: g.code, libs: JSON.parse(g.libs), game: shapeGame(get(`SELECT ${GAME_COLS} FROM games g JOIN users u ON u.id = g.owner_id WHERE g.id = ?`, g.id)) });
}));
// Entrega o código para jogar, conta a partida e dá XP.
app.post('/api/games/:id/play', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'), req.user);
  if (g.status === 'unpublished') bad('Jogo despublicado', 404);
  if (needsBuy(g, req.user)) bad('Compre o jogo para jogar', 402);
  run('UPDATE games SET plays = plays + 1 WHERE id = ?', g.id);
  run('UPDATE users SET xp = xp + 25 WHERE id = ?', req.user.id);
  res.json({ title: g.title, code: g.code, libs: JSON.parse(g.libs), ext: parseJ(g.settings, {}).ext || [], settings: parseJ(g.settings, {}), xp: req.user.xp + 25 });
}));
app.post('/api/games', auth, wrap((req, res) => {
  if (process.env.STUDIO_GATE !== 'off' && !hasStudio(req.user)) bad('O Studio é exclusivo de quem tem o plano. Veja os planos na Loja.', 403);
  const d = gameInput(req.body);
  if (get("SELECT COUNT(*) AS n FROM games WHERE owner_id = ? AND status = 'published'", req.user.id).n >= 50) bad('Limite de 50 jogos publicados');
  const r = run('INSERT INTO games (owner_id, title, description, category, age, dim, libs, code, cover, orientation, tags, version, visibility, settings, ai) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', req.user.id, d.title, d.description, d.category, d.age, d.dim, d.libs, d.code, d.cover ?? null, d.orientation, d.tags, d.version, d.visibility, d.settings, d.ai);
  logAct(req, 'Jogo publicado', d.title);
  run('INSERT OR IGNORE INTO library (user_id, game_id) VALUES (?,?)', req.user.id, r.lastInsertRowid);
  notify(req.user.id, 'Jogo publicado', `${d.title} já está na Loja.`, 'game:' + r.lastInsertRowid);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));
app.put('/api/games/:id', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'), req.user);
  if (!canEdit(g, req.user)) bad('Você só pode editar seus jogos', 403);
  const d = gameInput(req.body);
  run("UPDATE games SET title=?, description=?, category=?, age=?, dim=?, libs=?, code=?, orientation=?, tags=?, version=?, visibility=?, settings=?, ai=?, cover=CASE WHEN ? THEN ? ELSE cover END, updated_at=datetime('now') WHERE id=?", d.title, d.description, d.category, d.age, d.dim, d.libs, d.code, d.orientation, d.tags, d.version, d.visibility, d.settings, d.ai, d.cover === undefined ? 0 : 1, d.cover ?? null, g.id);
  if (g.owner_id !== req.user.id) { logAct(req, 'Jogo editado pelo admin', g.title); notify(g.owner_id, 'Seu jogo foi atualizado', `${d.title} foi editado pela administração.`, 'game:' + g.id); }
  res.json({ ok: true });
}));
app.post('/api/games/:id/status', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'), req.user);
  if (!canEdit(g, req.user)) bad('Sem permissão', 403);
  const status = req.body.status;
  if (!['published', 'unpublished'].includes(status)) bad('Estado inválido');
  run("UPDATE games SET status = ?, updated_at = datetime('now') WHERE id = ?", status, g.id);
  if (status === 'unpublished') run('UPDATE games SET featured = 0 WHERE id = ?', g.id);
  if (g.owner_id !== req.user.id) { logAct(req, status === 'published' ? 'Jogo republicado pelo admin' : 'Jogo despublicado pelo admin', g.title); notify(g.owner_id, status === 'published' ? 'Jogo republicado' : 'Jogo despublicado', g.title, 'game:' + g.id); }
  res.json({ ok: true });
}));
// Todos os jogos do próprio usuário, em qualquer estado.
app.get('/api/my/games', auth, (req, res) => {
  res.json({ games: all(`SELECT ${GAME_COLS} FROM games g JOIN users u ON u.id = g.owner_id WHERE g.owner_id = ? AND g.status != 'removed' ORDER BY g.id DESC LIMIT 100`, req.user.id).map(shapeGame) });
});
// Capa como imagem (usada nas listas pesadas do painel).
app.get('/api/games/:id/cover', wrap((req, res) => {
  const g = get('SELECT cover FROM games WHERE id = ?', int(req.params.id, 'id'));
  const m = g?.cover && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(g.cover);
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]).set('Cache-Control', 'public, max-age=3600').send(Buffer.from(m[2], 'base64'));
}));
app.delete('/api/games/:id', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'), req.user);
  if (g.owner_id !== req.user.id && req.user.role !== 'admin') bad('Sem permissão', 403);
  // Apagar tira o jogo da plataforma inteira (Loja, biblioteca, favoritos e histórico de todos).
  // Quem comprou continua com ele: nesse caso o jogo fica guardado como "removido", só para os compradores.
  if (get('SELECT 1 FROM purchases WHERE game_id = ?', g.id)) {
    run("UPDATE games SET status = 'removed', featured = 0 WHERE id = ?", g.id);
    run('DELETE FROM library WHERE game_id = ? AND user_id NOT IN (SELECT user_id FROM purchases WHERE game_id = ?)', g.id, g.id);
    run('DELETE FROM wishlist WHERE game_id = ?', g.id);
  } else run('DELETE FROM games WHERE id = ?', g.id);
  for (const uid of online.keys()) pushTo(uid, { type: 'games' });
  if (req.user.role === 'admin') logAct(req, g.owner_id === req.user.id ? 'Jogo próprio excluído' : 'Jogo removido', g.title);
  res.json({ ok: true });
}));

/* ---------- avaliações ---------- */
app.get('/api/games/:id/reviews', softAuth, wrap((req, res) => {
  const id = int(req.params.id, 'id'); loadGame(id, req.user);
  res.json({ reviews: all('SELECT r.id, r.stars, r.text, r.created_at, u.name AS author FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.game_id = ? ORDER BY r.id DESC LIMIT 100', id) });
}));
app.post('/api/games/:id/reviews', auth, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'), req.user);
  const stars = Number(req.body.stars); if (!Number.isInteger(stars) || stars < 1 || stars > 5) bad('A nota deve ir de 1 a 5');
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
  run('INSERT INTO reviews (game_id, user_id, stars, text) VALUES (?,?,?,?) ON CONFLICT(game_id, user_id) DO UPDATE SET stars=excluded.stars, text=excluded.text', g.id, req.user.id, stars, text);
  if (g.owner_id !== req.user.id) notify(g.owner_id, 'Nova avaliação', `${req.user.name} avaliou ${g.title} com ${stars} estrelas.`, 'game:' + g.id);
  res.status(201).json({ ok: true });
}));

/* ---------- biblioteca e desejos ---------- */
for (const [route, table] of [['library', 'library'], ['wishlist', 'wishlist']]) {
  app.get(`/api/${route}`, auth, (req, res) => {
    const rows = all(`SELECT ${GAME_COLS} FROM ${table} t JOIN games g ON g.id = t.game_id JOIN users u ON u.id = g.owner_id WHERE t.user_id = ? AND (g.status = 'published'${table === 'library' ? " OR (g.status = 'removed' AND EXISTS (SELECT 1 FROM purchases pu WHERE pu.user_id = t.user_id AND pu.game_id = g.id))" : ''})`, req.user.id);
    res.json({ games: rows.map(shapeGame) });
  });
  app.put(`/api/${route}/:gameId`, auth, wrap((req, res) => {
    const g = loadGame(int(req.params.gameId, 'id'), req.user);
    if (table === 'library' && needsBuy(g, req.user)) bad('Compre o jogo para colocar na biblioteca', 402);
    run(`INSERT OR IGNORE INTO ${table} (user_id, game_id) VALUES (?,?)`, req.user.id, g.id);
    res.json({ ok: true });
  }));
  app.delete(`/api/${route}/:gameId`, auth, wrap((req, res) => {
    run(`DELETE FROM ${table} WHERE user_id = ? AND game_id = ?`, req.user.id, int(req.params.gameId, 'id'));
    res.json({ ok: true });
  }));
}

/* ---------- comunidade ---------- */
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
    u.id AS id, u.name AS name, u.avatar AS avatar FROM friends f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id = ? OR f.addressee_id = ?`, req.user.id, req.user.id, req.user.id);
  res.json({ friends: rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar, status: r.status, incoming: r.status === 'pending' && r.addressee_id === req.user.id, online: r.status === 'accepted' && isOnline(r.id) })) });
});
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
function pushTo(userId, payload) {
  for (const ws of online.get(userId) || []) if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}
/* ---------- notificações e denúncias ---------- */
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
  res.json({ reports: all(`SELECT r.id, r.target_type, r.target_id, r.reason, r.created_at, u.name AS reporter,
    CASE r.target_type WHEN 'game' THEN (SELECT title FROM games WHERE id = r.target_id)
      WHEN 'user' THEN (SELECT name FROM users WHERE id = r.target_id)
      WHEN 'post' THEN (SELECT substr(text, 1, 60) FROM posts WHERE id = r.target_id) END AS target_title FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.status = 'open' ORDER BY r.id`) });
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
  logAct(req, action === 'remove' ? 'Conteúdo removido' : 'Denúncia mantida', `${r.target_type} #${r.target_id} · ${r.reason}`);
  res.json({ ok: true });
}));
app.get('/api/admin/users', auth, adminOnly, (_req, res) => {
  res.json({ users: all('SELECT id, uid, name, email, role, status, xp, created_at, studio_until, (SELECT COUNT(*) FROM games WHERE owner_id = users.id) AS games FROM users ORDER BY id DESC LIMIT 200') });
});
app.post('/api/admin/users/:id/status', auth, adminOnly, wrap((req, res) => {
  const id = int(req.params.id, 'id'), status = req.body.status;
  if (!['active', 'suspended'].includes(status)) bad('Status inválido');
  if (id === req.user.id) bad('Você não pode alterar a própria conta');
  run('UPDATE users SET status = ? WHERE id = ?', status, id);
  logAct(req, status === 'suspended' ? 'Usuário suspenso' : 'Usuário reativado', (get('SELECT name FROM users WHERE id = ?', id) || {}).name || '#' + id);
  res.json({ ok: true });
}));
app.post('/api/admin/notify', auth, adminOnly, wrap((req, res) => {
  run('INSERT INTO notifications (user_id, title, body) VALUES (NULL,?,?)', str(req.body.title, 'Título', 2, 80), typeof req.body.body === 'string' ? req.body.body.slice(0, 200) : '');
  logAct(req, 'Notificação global', req.body.title);
  res.status(201).json({ ok: true });
}));
app.get('/api/categories', (_req, res) => res.json({ categories: categories() }));
app.put('/api/admin/categories', auth, adminOnly, wrap((req, res) => {
  const list = Array.isArray(req.body.categories) ? req.body.categories.map(c => typeof c === 'string' ? c.trim() : '') : [];
  if (list.length < 2 || list.length > 14) bad('Mantenha entre 2 e 14 categorias');
  if (list.some(c => c.length < 2 || c.length > 16)) bad('Cada categoria deve ter de 2 a 16 letras');
  if (new Set(list.map(c => c.toLowerCase())).size !== list.length) bad('Há categorias repetidas');
  run("INSERT INTO settings (key, value) VALUES ('categories', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(list));
  logAct(req, 'Categorias alteradas', list.join(', '));
  res.json({ categories: list });
}));
app.get('/api/admin/games', auth, adminOnly, (req, res) => {
  const w = ["g.status != 'removed'"], p = [], q = req.query;
  if (q.creator === 'me') { w.push('g.owner_id = ?'); p.push(req.user.id); }
  if (q.creator === 'others') { w.push('g.owner_id != ? AND g.ai = 0'); p.push(req.user.id); }
  if (q.creator === 'ai') w.push('g.ai = 1');
  if (['published', 'unpublished'].includes(q.status)) { w.push('g.status = ?'); p.push(q.status); }
  if (q.owner) { w.push('g.owner_id = ?'); p.push(int(q.owner, 'owner')); }
  if (q.q) { w.push('g.title LIKE ?'); p.push(`%${String(q.q).slice(0, 40)}%`); }
  const rows = all(`SELECT g.id, g.title, g.category, g.dim, g.status, g.visibility, g.featured, g.plays, g.ai, g.version, g.created_at, g.owner_id, u.name AS developer,
    (g.cover IS NOT NULL) AS has_cover, (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'game' AND r.target_id = g.id AND r.status = 'open') AS reports
    FROM games g JOIN users u ON u.id = g.owner_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY g.id DESC LIMIT 200`, ...p);
  res.json({ games: rows.map(g => ({ ...g, featured: !!g.featured, ai: !!g.ai, has_cover: !!g.has_cover, mine: g.owner_id === req.user.id })) });
});
app.post('/api/admin/games/:id/feature', auth, adminOnly, wrap((req, res) => {
  const g = loadGame(int(req.params.id, 'id'), req.user), on = req.body.featured ? 1 : 0;
  if (on && get('SELECT COUNT(*) AS n FROM games WHERE featured = 1').n >= 8 && !g.featured) bad('No máximo 8 jogos em destaque');
  run('UPDATE games SET featured = ? WHERE id = ?', on, g.id);
  logAct(req, on ? 'Jogo destacado' : 'Destaque removido', g.title);
  res.json({ ok: true });
}));
app.get('/api/admin/logs', auth, adminOnly, (_req, res) => {
  res.json({ logs: all('SELECT id, actor, action, detail, created_at FROM logs ORDER BY id DESC LIMIT 60') });
});

/* ---------- contas: Google, recuperar senha, verificar e-mail, progresso ---------- */
mountStore({ app, auth, wrap, bad, get, all, run, logAct, adminOnly, int, loadGame, parseJ });
mountAccounts({ app, auth, wrap, bad, str, get, all, run, sign, publicUser, authLimiter, PROD, SECRET });

/* ---------- chat e comunidade ---------- */
mountSocial({ app, auth, softAuth, wrap, bad, str, int, get, all, run, areFriends, pushTo, isOnline, publicUser, loadGame, COVER_RE, userFromToken, categories });

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
