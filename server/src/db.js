import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_FILE || './data/app.db';
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  xp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  age TEXT NOT NULL DEFAULT 'Livre',
  dim TEXT NOT NULL,
  libs TEXT NOT NULL DEFAULT '[]',
  code TEXT NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status, category, dim);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game_id, user_id)
);
CREATE TABLE IF NOT EXISTS library (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS friends (
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (requester_id, addressee_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_id, to_id, id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('game','post','user')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// Migração simples para bancos criados antes de capa e destaque existirem.
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols.includes('status_until')) db.exec('ALTER TABLE users ADD COLUMN status_until TEXT');
if (!userCols.includes('status_reason')) db.exec("ALTER TABLE users ADD COLUMN status_reason TEXT NOT NULL DEFAULT ''");
const logCols = db.prepare('PRAGMA table_info(logs)').all().map(c => c.name);
if (!logCols.includes('target_id')) db.exec('ALTER TABLE logs ADD COLUMN target_id INTEGER');
if (!logCols.includes('role')) db.exec("ALTER TABLE logs ADD COLUMN role TEXT NOT NULL DEFAULT ''");
db.exec('CREATE INDEX IF NOT EXISTS logs_target ON logs(target_id, id)');
if (!userCols.includes('avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
if (!userCols.includes('bio')) db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
if (!userCols.includes('banner_img')) db.exec('ALTER TABLE users ADD COLUMN banner_img TEXT');
if (!userCols.includes('fav_games')) db.exec("ALTER TABLE users ADD COLUMN fav_games TEXT NOT NULL DEFAULT '[]'");
if (!userCols.includes('platform')) db.exec("ALTER TABLE users ADD COLUMN platform TEXT NOT NULL DEFAULT ''");
const gameCols = db.prepare('PRAGMA table_info(games)').all().map(c => c.name);
if (!gameCols.includes('cover')) db.exec('ALTER TABLE games ADD COLUMN cover TEXT');
if (!gameCols.includes('orientation')) db.exec("ALTER TABLE games ADD COLUMN orientation TEXT NOT NULL DEFAULT 'auto'");
if (!gameCols.includes('ai')) db.exec('ALTER TABLE games ADD COLUMN ai INTEGER NOT NULL DEFAULT 0');
if (!gameCols.includes('tags')) db.exec("ALTER TABLE games ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
if (!gameCols.includes('version')) db.exec("ALTER TABLE games ADD COLUMN version TEXT NOT NULL DEFAULT '1.0.0'");
if (!gameCols.includes('visibility')) db.exec("ALTER TABLE games ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
if (!gameCols.includes('settings')) db.exec("ALTER TABLE games ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
if (!gameCols.includes('featured')) db.exec('ALTER TABLE games ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');


db.exec(`
CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  user_id INTEGER,
  author TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  restored_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS trash_kind ON trash(kind, id);
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  kind TEXT NOT NULL,
  value INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  max_uses INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS coupon_uses (
  code TEXT NOT NULL COLLATE NOCASE,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS plays_daily (
  day TEXT PRIMARY KEY,
  plays INTEGER NOT NULL DEFAULT 0
);
`);
const addC = (t, c, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
addC('users', 'token_ver', 'INTEGER NOT NULL DEFAULT 0');
addC('users', 'last_seen', 'TEXT');
addC('users', 'last_ip', 'TEXT');
addC('users', 'last_ua', 'TEXT');
addC('users', 'perms', 'TEXT');


db.exec(`
CREATE TABLE IF NOT EXISTS app_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'android',
  notes TEXT NOT NULL DEFAULT '',
  fixes TEXT NOT NULL DEFAULT '[]',
  mandatory INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  actor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, build)
);
CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  from_build INTEGER NOT NULL DEFAULT 0,
  to_build INTEGER NOT NULL DEFAULT 0,
  ui TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 1,
  detail TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS app_events_k ON app_events(kind, id);
`);


db.exec(`
CREATE TABLE IF NOT EXISTS notif_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notif_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notif_id)
);
CREATE TABLE IF NOT EXISTS notif_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS push_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('web','fcm')),
  token TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  tz INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  failures INTEGER NOT NULL DEFAULT 0,
  last_ok TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS push_devices_user ON push_devices(user_id, active);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'admin',
  audience TEXT NOT NULL DEFAULT 'all',
  user_id INTEGER,
  important INTEGER NOT NULL DEFAULT 0,
  ref TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS campaigns_due ON campaigns(status, scheduled_at);
CREATE TABLE IF NOT EXISTS push_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notif_id INTEGER NOT NULL,
  campaign_id INTEGER,
  device_id INTEGER NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  sent_at TEXT,
  opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (notif_id, device_id)
);
CREATE INDEX IF NOT EXISTS push_queue_due ON push_queue(status, next_at);
CREATE INDEX IF NOT EXISTS push_queue_camp ON push_queue(campaign_id);
`);

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

/* ---------- chat e comunidade ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followed_id)
);
CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('group','community')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover TEXT,
  category TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  access TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS space_members (
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE IF NOT EXISTS space_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS room_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  image TEXT,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_room_msgs ON room_msgs(space_id, id);
CREATE TABLE IF NOT EXISTS room_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  last_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, space_id)
);
`);
const addCol = (t, c, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
addCol('posts', 'space_id', 'INTEGER REFERENCES spaces(id) ON DELETE CASCADE');
addCol('messages', 'image', 'TEXT');
addCol('messages', 'game_id', 'INTEGER REFERENCES games(id) ON DELETE SET NULL');
addCol('messages', 'read_at', 'TEXT');
addCol('notifications', 'kind', "TEXT NOT NULL DEFAULT 'sys'");
addCol('notifications', 'ref', "TEXT NOT NULL DEFAULT ''");
addCol('notifications', 'category', "TEXT NOT NULL DEFAULT ''");
addCol('notifications', 'read_at', 'TEXT');
addCol('notifications', 'dedupe', "TEXT NOT NULL DEFAULT ''");
addCol('notifications', 'campaign_id', 'INTEGER');

db.exec(`
CREATE TABLE IF NOT EXISTS notif_dismissed (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notif_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notif_id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS purchases (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, game_id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS auth_codes (
  email TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, kind)
);
CREATE TABLE IF NOT EXISTS auth_exchange (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dev_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addCol('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'google_id', 'TEXT');

/* ---------- ID de jogador (000 = administrador), plano Studio, moedas e itens ---------- */
addCol('users', 'uid', 'INTEGER');
addCol('users', 'studio_until', 'TEXT');
addCol('users', 'coins', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'frame', 'TEXT');
addCol('users', 'banner', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS user_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_uid ON users(uid);
CREATE TABLE IF NOT EXISTS coin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS coin_log_user ON coin_log(user_id, id);
`);
// quem já existe recebe ID em ordem de cadastro; o primeiro administrador é o 000
for (const u of db.prepare('SELECT id, role FROM users WHERE uid IS NULL ORDER BY id').all()) {
  const zero = db.prepare('SELECT 1 FROM users WHERE uid = 0').get();
  const next = u.role === 'admin' && !zero ? 0 : db.prepare('SELECT COALESCE(MAX(uid), 0) + 1 AS n FROM users').get().n;
  db.prepare('UPDATE users SET uid = ? WHERE id = ?').run(next, u.id);
}
db.exec(`
CREATE TRIGGER IF NOT EXISTS users_uid_ai AFTER INSERT ON users WHEN NEW.uid IS NULL BEGIN
  UPDATE users SET uid = CASE
    WHEN NEW.role = 'admin' AND NOT EXISTS (SELECT 1 FROM users WHERE uid = 0) THEN 0
    ELSE (SELECT COALESCE(MAX(uid), 0) + 1 FROM users) END
  WHERE id = NEW.id;
END;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  nsu TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  cents INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 0,
  coupon TEXT,
  method TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  link TEXT,
  tx_nsu TEXT,
  slug TEXT,
  receipt TEXT,
  paid_cents INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  cents INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  cut INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER,
  days INTEGER NOT NULL DEFAULT 0,
  refunded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sales_kind ON sales(kind, id);
CREATE INDEX IF NOT EXISTS sales_user ON sales(user_id, id);
CREATE TABLE IF NOT EXISTS game_plays (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  plays INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS game_plays_game ON game_plays(game_id, last_at);
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor TEXT NOT NULL,
  audience TEXT NOT NULL,
  user_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  important INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addCol('sales', 'coupon', 'TEXT');

addCol('users', 'title', 'TEXT');
addCol('users', 'ncolor', 'TEXT');
addCol('users', 'theme', 'TEXT');
addCol('users', 'bubble', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS store_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot TEXT NOT NULL,
  name TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  premium INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  tag TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  img TEXT,
  font TEXT,
  ver INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addCol('users', 'premium_until', 'TEXT');
addCol('users', 'daily_at', 'TEXT');
