// Notificações: categorias, preferências, dispositivos (Web Push e FCM), fila com reenvio, campanhas agendadas,
// central do app (lida/não lida) e métricas. Um só lugar para o Android, o navegador e o painel.
import crypto from 'node:crypto';
import webpush from 'web-push';

export const CATS = {
  update: { name: 'Atualizações da Game Platform', kind: 'update', def: true },
  newgame: { name: 'Novos jogos na biblioteca', kind: 'game', def: true },
  gameupd: { name: 'Atualizações de jogos instalados ou favoritos', kind: 'game', def: true },
  message: { name: 'Mensagens recebidas', kind: 'message', def: true },
  friend: { name: 'Solicitações de amizade', kind: 'friend', def: true },
  invite: { name: 'Convites para partidas', kind: 'gameinvite', def: true },
  event: { name: 'Eventos e competições', kind: 'event', def: true },
  achievement: { name: 'Conquistas desbloqueadas', kind: 'achievement', def: true },
  admin: { name: 'Avisos administrativos', kind: 'admin', def: true },
  maintenance: { name: 'Manutenção do servidor', kind: 'maint', def: true },
  security: { name: 'Segurança e acesso à conta', kind: 'security', def: true, locked: true },
  studio: { name: 'Novidades do Game Studio', kind: 'studio', def: true },
  pro: { name: 'Atividades de criadores PRO', kind: 'pro', def: true }
};
export const KIND_CAT = { friend: 'friend', joinreq: 'friend', follow: 'friend', gameinvite: 'invite', invite: 'invite', mention: 'message', reply: 'message', message: 'message', event: 'event', admin: 'admin', notice: 'admin', update: 'update', studio: 'studio', pro: 'pro', security: 'security', maint: 'maintenance', achievement: 'achievement', perm: 'security', code: 'security', newgame: 'newgame' };
export const catOfKind = k => KIND_CAT[k] || '';
const AUD = {
  all: { name: 'Todos os jogadores', sql: "status = 'active'" },
  premium: { name: 'Premium ativos', sql: "status = 'active' AND premium_until > ?", p: () => [new Date().toISOString()] },
  studio: { name: 'Quem tem Studio', sql: "status = 'active' AND role <> 'admin' AND studio_until > ?", p: () => [new Date().toISOString()] },
  creators: { name: 'Criadores com jogo publicado', sql: "status = 'active' AND id IN (SELECT owner_id FROM games WHERE status = 'published')" },
  staff: { name: 'Equipe (admin e moderadores)', sql: "status = 'active' AND role IN ('admin','mod')" }
};
const RETRY = [30_000, 120_000, 600_000, 3_600_000];
const nowSql = (ms = Date.now()) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const hhmm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };

export function mountPush(c) {
  const { app, auth, adminOnly, staffCan, wrap, bad, int, get, all, run, logAct, confirmCheck, parseJ, isOnline, pushTo, PROD } = c;
  const env = process.env, SECRET = env.JWT_SECRET || 'dev';
  const setting = (k, d) => { const r = get('SELECT value FROM settings WHERE key = ?', k); return r ? parseJ(r.value, d) : d; };
  const setSetting = (k, v) => run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));

  // ---- chaves e provedores ----
  let vapid = (env.VAPID_PUBLIC && env.VAPID_PRIVATE) ? { publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE } : setting('vapid', null);
  if (!vapid) { vapid = webpush.generateVAPIDKeys(); setSetting('vapid', vapid); }
  const SUBJECT = env.VAPID_SUBJECT || env.PUBLIC_URL || 'https://game-platform-dgvz.onrender.com';
  webpush.setVapidDetails(/^(https:\/\/|mailto:)/.test(SUBJECT) ? SUBJECT : /@/.test(SUBJECT) ? 'mailto:' + SUBJECT : 'mailto:contato@game-platform.app', vapid.publicKey, vapid.privateKey);
  let sa = null;
  try { const raw = env.FCM_SERVICE_ACCOUNT; if (raw) sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); if (sa && !(sa.client_email && sa.private_key && sa.project_id)) sa = null; } catch { sa = null; }
  const MOCK = env.PUSH_MOCK || '';
  const fcmOn = () => !!sa || !!MOCK;

  let tok = { v: '', exp: 0 };
  async function fcmToken() {
    if (tok.v && tok.exp > Date.now() + 60_000) return tok.v;
    const t = Math.floor(Date.now() / 1000), b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const un = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3600 });
    const sig = crypto.createSign('RSA-SHA256').update(un).sign(sa.private_key, 'base64url');
    const r = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: un + '.' + sig }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw Object.assign(new Error('FCM auth ' + r.status), { retry: true });
    tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
    return tok.v;
  }
  // devolve { ok } | { dead, error } | { retry, error }
  async function deliver(dev, p) {
    if (MOCK) {
      try {
        const r = await fetch(MOCK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: dev.id, kind: dev.kind, payload: p }) });
        if (r.status >= 200 && r.status < 300) return { ok: true };
        if (r.status === 404 || r.status === 410) return { dead: true, error: 'expirado (' + r.status + ')' };
        return { retry: true, error: 'HTTP ' + r.status };
      } catch (e) { return { retry: true, error: e.message }; }
    }
    if (dev.kind === 'web') {
      try {
        await webpush.sendNotification({ endpoint: dev.token, keys: parseJ(dev.keys, {}) }, JSON.stringify(p), { TTL: p.important ? 86400 : 3600, urgency: p.priority ? 'high' : 'normal' });
        return { ok: true };
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) return { dead: true, error: 'expirado (' + e.statusCode + ')' };
        if (e.statusCode === 400 || e.statusCode === 401 || e.statusCode === 403) return { dead: true, error: 'recusado (' + e.statusCode + ')' };
        return { retry: true, error: String(e.statusCode || e.message).slice(0, 80) };
      }
    }
    if (!sa) return { dead: true, error: 'FCM não configurado' };
    try {
      const t = await fcmToken();
      const data = {}; for (const [k, v] of Object.entries({ id: p.id, q: p.q, t: p.t, cat: p.cat, ref: p.ref, url: p.url })) data[k] = String(v ?? '');
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ message: { token: dev.token, notification: { title: p.title, body: p.body }, data, android: { priority: p.priority ? 'HIGH' : 'NORMAL', ttl: '86400s', notification: { channel_id: p.channel, tag: 'gp-n' + p.id } } } }) });
      if (r.ok) return { ok: true };
      const j = await r.json().catch(() => ({})), code = (j.error && j.error.status) || '';
      if (r.status === 404 || code === 'NOT_FOUND' || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') return { dead: true, error: 'token inválido (' + code + ')' };
      if (r.status === 401) tok = { v: '', exp: 0 };
      return { retry: true, error: 'FCM ' + r.status + ' ' + code };
    } catch (e) { return { retry: true, error: e.message.slice(0, 80) }; }
  }

  // ---- preferências ----
  const defPrefs = () => ({ enabled: true, cats: {}, sound: true, vibrate: true, priority: [], quiet: { on: c.cfg ? c.cfg.val('quietDefault') : false, from: c.cfg ? c.cfg.val('quietFrom') : '22:00', to: c.cfg ? c.cfg.val('quietTo') : '07:00' } });
  const prefsOf = uid => { const r = get('SELECT data FROM notif_prefs WHERE user_id = ?', uid); const d = defPrefs(), s = r ? parseJ(r.data, {}) : {}; return { ...d, ...s, quiet: { ...d.quiet, ...(s.quiet || {}) }, cats: s.cats || {}, priority: Array.isArray(s.priority) ? s.priority : [] }; };
  const catOn = (pf, cat) => !CATS[cat] || CATS[cat].locked || (pf.cats[cat] === undefined ? CATS[cat].def : !!pf.cats[cat]);
  const inQuiet = (pf, tz, at = Date.now()) => {
    if (!pf.quiet.on) return false;
    const a = hhmm(pf.quiet.from), b = hhmm(pf.quiet.to); if (a === null || b === null || a === b) return false;
    const m = ((Math.floor(at / 60000) + (Number(tz) || 0)) % 1440 + 1440) % 1440;
    return a < b ? (m >= a && m < b) : (m >= a || m < b);
  };
  const channelOf = (pf, prio) => prio ? 'gp_priority' : pf.sound && pf.vibrate ? 'gp_default' : pf.sound ? 'gp_sound' : pf.vibrate ? 'gp_vibrate' : 'gp_silent';

  // ---- enfileirar envios ----
  const qtok = q => crypto.createHash('sha256').update(q + ':' + SECRET).digest('hex').slice(0, 16);
  function enqueue(notifId, userIds, cat, n, campaignId = null) {
    let queued = 0;
    for (const uid of userIds) {
      const pf = prefsOf(uid);
      if (!pf.enabled && !CATS[cat].locked) continue;
      if (!catOn(pf, cat)) continue;
      if (c.cfg && !CATS[cat].locked) {
        if (c.cfg.val('pushOffCats').includes(cat)) continue;
        const lim = c.cfg.val('pushDailyLimit');
        if (lim > 0 && cat !== 'maintenance' && get("SELECT COUNT(DISTINCT notif_id) AS n FROM push_queue WHERE user_id = ? AND created_at > datetime('now','-1 day')", uid).n >= lim) continue;
      }
      const devs = all('SELECT id, tz, kind FROM push_devices WHERE user_id = ? AND active = 1', uid);
      if (!devs.length) continue;
      const prio = pf.priority.includes(cat) || CATS[cat].locked || !!n.important;
      const online = isOnline(uid);
      for (const d of devs) {
        if (!n.force && !prio && inQuiet(pf, d.tz)) continue;
        const payload = { id: notifId, title: n.title, body: n.body, cat, ref: n.ref || '', url: '/?n=' + notifId, important: !!n.important, priority: prio, silent: !pf.sound, vibrate: pf.vibrate ? [120, 60, 120] : [], channel: channelOf(pf, prio), kind: d.kind };
        const r = run("INSERT OR IGNORE INTO push_queue (notif_id, campaign_id, device_id, user_id, status, next_at, payload) VALUES (?,?,?,?,'queued',?,?)", notifId, campaignId, d.id, uid, Date.now() + (online ? 5000 : 0), JSON.stringify(payload));
        if (r.changes) queued++;
      }
    }
    return queued;
  }
  // cria a notificação do app (e o push, se a categoria permitir)
  function emit(userId, title, body = '', o = {}) {
    const cat = o.cat || catOfKind(o.kind) || '', kind = o.kind || (CATS[cat] && CATS[cat].kind) || 'sys';
    if (userId !== null && o.dedupe) {
      const old = get(`SELECT id FROM notifications WHERE user_id = ? AND dedupe = ? AND created_at > datetime('now', ?)`, userId, o.dedupe, `-${o.window || 10} minutes`);
      if (old) return old.id;
    }
    const id = Number(run('INSERT INTO notifications (user_id, title, body, kind, ref, category, dedupe, campaign_id) VALUES (?,?,?,?,?,?,?,?)', userId, String(title).slice(0, 80), String(body).slice(0, 300), kind, o.ref || '', cat, o.dedupe || '', o.campaign || null).lastInsertRowid);
    if (userId !== null) { try { pushTo(userId, { type: 'notif', id }); } catch {} }
    if (cat && CATS[cat] && userId !== null && o.push !== false) enqueue(id, [userId], cat, { title, body, ref: o.ref, important: o.important, force: o.force });
    return id;
  }

  // ---- campanhas (admin e eventos do sistema) ----
  const audIds = k => all(`SELECT id FROM users WHERE ${AUD[k].sql}`, ...(AUD[k].p ? AUD[k].p() : [])).map(r => r.id);
  function deliverCampaign(id) {
    const cp = get('SELECT * FROM campaigns WHERE id = ?', id);
    if (!cp || !['scheduled', 'sending'].includes(cp.status)) return null;
    run("UPDATE campaigns SET status = 'sending' WHERE id = ?", id);
    const cat = CATS[cp.category] ? cp.category : 'admin', kind = cp.important ? 'notice' : CATS[cat].kind;
    let ids;
    if (cp.audience === 'user') ids = [cp.user_id];
    else { ids = audIds(cp.audience); }
    const n = { title: cp.title, body: cp.body, ref: cp.ref, important: !!cp.important };
    if (cp.audience === 'all') {
      const nid = Number(run('INSERT INTO notifications (user_id, title, body, kind, ref, category, campaign_id) VALUES (NULL,?,?,?,?,?,?)', cp.title, cp.body, kind, cp.ref, cat, id).lastInsertRowid);
      enqueue(nid, ids, cat, n, id);
      for (const uid of ids) if (isOnline(uid)) pushTo(uid, { type: 'notif', id: nid });
    } else {
      for (const uid of ids) {
        const nid = Number(run('INSERT INTO notifications (user_id, title, body, kind, ref, category, campaign_id) VALUES (?,?,?,?,?,?,?)', uid, cp.title, cp.body, kind, cp.ref, cat, id).lastInsertRowid);
        enqueue(nid, [uid], cat, n, id);
        if (isOnline(uid)) pushTo(uid, { type: 'notif', id: nid });
      }
    }
    run("UPDATE campaigns SET status = 'sent', count = ?, sent_at = datetime('now') WHERE id = ?", ids.length, id);
    return { id, count: ids.length };
  }
  function createCampaign(actor, b) {
    const cat = CATS[b.category] ? b.category : 'admin';
    const aud = String(b.audience || 'all');
    if (aud !== 'user' && !AUD[aud]) bad('Público inválido');
    const title = typeof b.title === 'string' ? b.title.trim() : '', body = typeof b.body === 'string' ? b.body.trim() : '';
    if (title.length < 2 || title.length > 60) bad('Título de 2 a 60 letras');
    if (body.length < 2 || body.length > 300) bad('Mensagem de 2 a 300 letras');
    let uid = null;
    if (aud === 'user') { const u = get('SELECT id FROM users WHERE id = ?', int(b.userId, 'userId')); if (!u) bad('Usuário não encontrado', 404); uid = u.id; }
    let at = null;
    if (b.scheduleAt) { const t = Date.parse(b.scheduleAt); if (!Number.isFinite(t)) bad('Data de agendamento inválida'); if (t > Date.now() + 30_000) { if (t > Date.now() + 365 * 86400e3) bad('Agende para no máximo 1 ano'); at = nowSql(t); } }
    const ref = typeof b.ref === 'string' && /^(game|user|space|post|settings|update|store):?[\w-]{0,30}$/.test(b.ref) ? b.ref : '';
    const id = Number(run('INSERT INTO campaigns (actor_id, actor, title, body, category, audience, user_id, important, ref, scheduled_at, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)', actor ? actor.id : null, actor ? actor.name : 'Sistema', title, body, cat, aud, uid, b.important ? 1 : 0, ref, at, 'scheduled').lastInsertRowid);
    if (at) return { id, scheduled: true, at };
    const r = deliverCampaign(id);
    try { run('INSERT INTO broadcasts (actor_id, actor, audience, user_id, title, body, important, count) VALUES (?,?,?,?,?,?,?,?)', actor ? actor.id : null, actor ? actor.name : 'Sistema', aud, uid, title, body, b.important ? 1 : 0, r.count); } catch {}
    return { id, scheduled: false, count: r.count };
  }
  const system = (title, body, category, o = {}) => { try { return createCampaign(null, { title, body, category, audience: o.audience || 'all', important: o.important, ref: o.ref }); } catch { return null; } };

  // ---- eventos do produto ----
  function newGame(g, owner) {
    try {
      if (get("SELECT id FROM notifications WHERE user_id IS NULL AND dedupe = ? AND created_at > datetime('now','-10 minutes')", 'newgame:' + owner.id)) return;
      const studio = owner.studio_until && owner.studio_until > new Date().toISOString();
      const friends = new Set(all("SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS f FROM friends WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", owner.id, owner.id, owner.id).map(r => r.f));
      const everyone = all("SELECT id FROM users WHERE status = 'active' AND id != ? LIMIT 5000", owner.id).map(r => r.id).filter(i => !friends.has(i));
      const nid = Number(run("INSERT INTO notifications (user_id, title, body, kind, ref, category, dedupe) VALUES (NULL,?,?,'game',?,'newgame',?)", 'Novo jogo na Loja', `${g.title}, de ${owner.name}.`, 'game:' + g.id, 'newgame:' + owner.id).lastInsertRowid);
      enqueue(nid, everyone, 'newgame', { title: 'Novo jogo na Loja', body: `${g.title}, de ${owner.name}.`, ref: 'game:' + g.id });
      for (const f of friends) emit(f, studio ? 'Criador PRO publicou um jogo' : 'Seu amigo publicou um jogo', `${owner.name} publicou ${g.title}.`, { cat: 'pro', ref: 'game:' + g.id, dedupe: 'pro:' + g.id });
    } catch (e) { console.error('push newGame', e.message); }
  }
  function gameUpdated(g, version) {
    try {
      const ids = all('SELECT DISTINCT user_id FROM (SELECT user_id FROM library WHERE game_id = ? UNION SELECT user_id FROM wishlist WHERE game_id = ?) WHERE user_id != ?', g.id, g.id, g.owner_id).map(r => r.user_id);
      for (const uid of ids.slice(0, 2000)) emit(uid, 'Jogo atualizado', `${g.title} chegou à versão ${version}.`, { cat: 'gameupd', ref: 'game:' + g.id, dedupe: `gameupd:${g.id}:${version}`, window: 1440 });
    } catch (e) { console.error('push gameUpdated', e.message); }
  }
  const notifyUpdate = (name, notes) => system('Nova versão da Game Platform', `${name}${notes ? ': ' + notes : ''}`.slice(0, 280), 'update', { important: true, ref: 'update' });

  // ---- worker de envio ----
  let busy = false;
  async function pump() {
    if (busy) return; busy = true;
    try {
      // agendadas
      for (const cp of all("SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now') LIMIT 5")) deliverCampaign(cp.id);
      const due = all("SELECT q.id, q.notif_id, q.attempts, q.payload, d.id AS did, d.kind, d.token, d.keys, d.failures FROM push_queue q JOIN push_devices d ON d.id = q.device_id WHERE q.status = 'queued' AND q.next_at <= ? AND d.active = 1 ORDER BY q.id LIMIT 40", Date.now());
      await Promise.all(due.map(async q => {
        const p = parseJ(q.payload, {}), n = get('SELECT id, user_id FROM notifications WHERE id = ?', q.notif_id);
        if (!n) { run("UPDATE push_queue SET status = 'skipped', error = 'removida' WHERE id = ?", q.id); return; }
        if (n.user_id !== null && get('SELECT read_at FROM notifications WHERE id = ?', n.id).read_at && p.cat !== 'security') { run("UPDATE push_queue SET status = 'skipped', error = 'já lida' WHERE id = ?", q.id); return; }
        const r = await deliver({ id: q.did, kind: q.kind, token: q.token, keys: q.keys }, { ...p, q: q.id, t: qtok(String(q.id)) });
        if (r.ok) { run("UPDATE push_queue SET status = 'sent', attempts = attempts + 1, sent_at = datetime('now'), error = '' WHERE id = ?", q.id); run("UPDATE push_devices SET failures = 0, last_ok = datetime('now') WHERE id = ?", q.did); }
        else if (r.dead) { run("UPDATE push_queue SET status = 'dead', attempts = attempts + 1, error = ? WHERE id = ?", r.error, q.id); run('UPDATE push_devices SET active = 0 WHERE id = ?', q.did); }
        else {
          const at = q.attempts + 1;
          if (at > RETRY.length) { run("UPDATE push_queue SET status = 'failed', attempts = ?, error = ? WHERE id = ?", at, r.error, q.id); }
          else run('UPDATE push_queue SET attempts = ?, next_at = ?, error = ? WHERE id = ?', at, Date.now() + (env.PUSH_FAST_RETRY ? 300 : RETRY[at - 1]), r.error, q.id);
          run('UPDATE push_devices SET failures = failures + 1 WHERE id = ?', q.did);
          if (q.failures + 1 >= 12) run('UPDATE push_devices SET active = 0 WHERE id = ?', q.did);
        }
      }));
    } catch (e) { console.error('push pump', e.message); }
    busy = false;
  }
  if (env.PUSH_WORKER !== 'off') setInterval(pump, env.PUSH_FAST_RETRY ? 400 : 3000).unref();
  setInterval(() => { try { run("DELETE FROM push_queue WHERE created_at < datetime('now','-30 days')"); run("DELETE FROM push_devices WHERE active = 0 AND created_at < datetime('now','-60 days')"); } catch {} }, 6 * 3600e3).unref();

  // ---- API do jogador ----
  app.get('/api/push/config', (_req, res) => res.json({
    webPush: vapid.publicKey, fcm: fcmOn(),
    categories: Object.entries(CATS).map(([id, v]) => ({ id, name: v.name, def: v.def, locked: !!v.locked })),
    channels: [{ id: 'gp_default', name: 'Padrão', sound: true, vibrate: true }, { id: 'gp_sound', name: 'Só som', sound: true, vibrate: false }, { id: 'gp_vibrate', name: 'Só vibração', sound: false, vibrate: true }, { id: 'gp_silent', name: 'Silencioso', sound: false, vibrate: false }, { id: 'gp_priority', name: 'Prioritárias', sound: true, vibrate: true, high: true }]
  }));
  app.get('/sw.js', (_req, res) => res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' }).send(SW));
  app.post('/api/push/register', auth, wrap((req, res) => {
    const b = req.body || {}, kind = b.kind === 'fcm' ? 'fcm' : 'web';
    let token, keys = '';
    if (kind === 'web') {
      const s = b.subscription || {};
      if (typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 600 || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') bad('Inscrição de notificação inválida');
      token = s.endpoint; keys = JSON.stringify({ p256dh: s.keys.p256dh.slice(0, 200), auth: s.keys.auth.slice(0, 100) });
    } else {
      if (!fcmOn()) bad('Notificações do Android ainda não estão ativas no servidor', 503);
      token = typeof b.token === 'string' ? b.token.trim() : ''; if (token.length < 20 || token.length > 400) bad('Token inválido');
    }
    const tz = Math.max(-840, Math.min(840, Math.round(Number(b.tz) || 0))), ua = String(req.headers['user-agent'] || '').slice(0, 120), plat = String(b.platform || (kind === 'fcm' ? 'android' : 'web')).slice(0, 16);
    const old = get('SELECT id FROM push_devices WHERE token = ?', token);
    if (old) run("UPDATE push_devices SET user_id = ?, keys = ?, platform = ?, ua = ?, tz = ?, active = 1, failures = 0 WHERE id = ?", req.user.id, keys, plat, ua, tz, old.id);
    else {
      run('INSERT INTO push_devices (user_id, kind, token, keys, platform, ua, tz) VALUES (?,?,?,?,?,?,?)', req.user.id, kind, token, keys, plat, ua, tz);
      for (const x of all('SELECT id FROM push_devices WHERE user_id = ? ORDER BY id DESC LIMIT -1 OFFSET 10', req.user.id)) run('DELETE FROM push_devices WHERE id = ?', x.id);
    }
    res.json({ ok: true });
  }));
  app.post('/api/push/unregister', auth, wrap((req, res) => {
    const t = String((req.body && (req.body.token || (req.body.subscription && req.body.subscription.endpoint))) || '');
    run('DELETE FROM push_devices WHERE token = ? AND user_id = ?', t, req.user.id);
    res.json({ ok: true });
  }));
  app.get('/api/push/devices', auth, (req, res) => res.json({ devices: all('SELECT id, kind, platform, ua, active, last_ok, created_at FROM push_devices WHERE user_id = ? ORDER BY id DESC', req.user.id).map(d => ({ ...d, active: !!d.active })) }));
  app.get('/api/push/prefs', auth, (req, res) => res.json({ prefs: prefsOf(req.user.id) }));
  app.put('/api/push/prefs', auth, wrap((req, res) => {
    const b = req.body || {}, cur = prefsOf(req.user.id), nx = { ...cur };
    if (b.enabled !== undefined) nx.enabled = !!b.enabled;
    if (b.sound !== undefined) nx.sound = !!b.sound;
    if (b.vibrate !== undefined) nx.vibrate = !!b.vibrate;
    if (b.cats && typeof b.cats === 'object') for (const [k, v] of Object.entries(b.cats)) if (CATS[k] && !CATS[k].locked) nx.cats[k] = !!v;
    if (Array.isArray(b.priority)) nx.priority = [...new Set(b.priority.map(String).filter(k => CATS[k]))];
    if (b.quiet && typeof b.quiet === 'object') {
      const q = { ...cur.quiet }; if (b.quiet.on !== undefined) q.on = !!b.quiet.on;
      for (const k of ['from', 'to']) if (b.quiet[k] !== undefined) { if (hhmm(b.quiet[k]) === null) bad('Horário inválido (use HH:MM)'); q[k] = String(b.quiet[k]).padStart(5, '0'); }
      nx.quiet = q;
    }
    if (b.tz !== undefined) run('UPDATE push_devices SET tz = ? WHERE user_id = ?', Math.max(-840, Math.min(840, Math.round(Number(b.tz) || 0))), req.user.id);
    run("INSERT INTO notif_prefs (user_id, data, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", req.user.id, JSON.stringify(nx));
    res.json({ prefs: nx });
  }));
  const lastTest = new Map();
  app.post('/api/push/test', auth, wrap((req, res) => {
    if (Date.now() - (lastTest.get(req.user.id) || 0) < 10_000) bad('Espere alguns segundos para testar de novo', 429);
    lastTest.set(req.user.id, Date.now());
    const id = emit(req.user.id, 'Teste de notificação', 'Se você viu isto fora do app, está tudo certo.', { cat: 'update', force: true });
    res.json({ ok: true, id, devices: get('SELECT COUNT(*) AS n FROM push_devices WHERE user_id = ? AND active = 1', req.user.id).n });
  }));
  app.post('/api/push/open', (req, res) => {
    const q = Number(req.body && req.body.q), t = String((req.body && req.body.t) || '');
    if (Number.isInteger(q) && q > 0 && t === qtok(String(q))) run("UPDATE push_queue SET opened_at = datetime('now') WHERE id = ? AND opened_at IS NULL", q);
    res.json({ ok: true });
  });

  // ---- central do app ----
  const unreadSql = "(n.user_id = ? OR n.user_id IS NULL) AND n.id NOT IN (SELECT notif_id FROM notif_dismissed WHERE user_id = ?) AND ((n.user_id IS NOT NULL AND n.read_at IS NULL) OR (n.user_id IS NULL AND n.id NOT IN (SELECT notif_id FROM notif_reads WHERE user_id = ?)))";
  app.get('/api/notifications/summary', auth, (req, res) => {
    const rows = all(`SELECT n.id, n.kind, n.category FROM notifications n WHERE ${unreadSql} AND n.created_at > datetime('now','-30 days') ORDER BY n.id DESC LIMIT 300`, req.user.id, req.user.id, req.user.id);
    const by = {}; for (const r of rows) { const k = r.category || catOfKind(r.kind) || 'other'; by[k] = (by[k] || 0) + 1; }
    res.json({ unread: rows.length, byCategory: by });
  });
  app.post('/api/notifications/read-all', auth, wrap((req, res) => {
    const cat = req.body && req.body.category ? String(req.body.category) : '';
    const rows = all(`SELECT n.id, n.user_id, n.kind, n.category FROM notifications n WHERE ${unreadSql} LIMIT 500`, req.user.id, req.user.id, req.user.id).filter(r => !cat || (r.category || catOfKind(r.kind)) === cat);
    for (const r of rows) { if (r.user_id === null) run('INSERT OR IGNORE INTO notif_reads (user_id, notif_id) VALUES (?,?)', req.user.id, r.id); else run("UPDATE notifications SET read_at = datetime('now') WHERE id = ?", r.id); }
    res.json({ ok: true, marked: rows.length });
  }));
  app.post('/api/notifications/:id/read', auth, wrap((req, res) => {
    const n = get('SELECT id, user_id FROM notifications WHERE id = ?', int(req.params.id, 'id'));
    if (!n || (n.user_id !== null && n.user_id !== req.user.id)) bad('Notificação não encontrada', 404);
    if (req.body && req.body.read === false) { if (n.user_id === null) run('DELETE FROM notif_reads WHERE user_id = ? AND notif_id = ?', req.user.id, n.id); else run('UPDATE notifications SET read_at = NULL WHERE id = ?', n.id); }
    else if (n.user_id === null) run('INSERT OR IGNORE INTO notif_reads (user_id, notif_id) VALUES (?,?)', req.user.id, n.id); else run("UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ?", n.id);
    res.json({ ok: true });
  }));
  app.post('/api/notifications/achievement', auth, wrap((req, res) => {
    const id = String((req.body && req.body.id) || '').replace(/[^\w-]/g, '').slice(0, 30), title = String((req.body && req.body.title) || '').slice(0, 50);
    if (!id || title.length < 2) bad('Conquista inválida');
    res.json({ ok: true, id: emit(req.user.id, 'Conquista desbloqueada', title, { cat: 'achievement', ref: 'ach:' + id, dedupe: 'ach:' + id, window: 525600 }) });
  }));

  // ---- painel administrativo ----
  const campRow = r => ({ ...r, important: !!r.important, audienceName: r.audience === 'user' ? (r.to_name || 'Usuário') : (AUD[r.audience] || {}).name || r.audience, categoryName: (CATS[r.category] || {}).name || r.category });
  app.get('/api/admin/notif/overview', auth, adminOnly, (_req, res) => {
    const st = all("SELECT status, COUNT(*) AS n FROM push_queue WHERE created_at >= datetime('now','-24 hours') GROUP BY status");
    res.json({
      configured: { web: true, fcm: !!sa, mock: !!MOCK }, publicKey: vapid.publicKey,
      devices: all('SELECT kind, active, COUNT(*) AS n FROM push_devices GROUP BY kind, active'),
      last24h: Object.fromEntries(st.map(r => [r.status, r.n])),
      opened24h: get("SELECT COUNT(*) AS n FROM push_queue WHERE opened_at IS NOT NULL AND created_at >= datetime('now','-24 hours')").n,
      failures: all("SELECT q.id, q.status, q.attempts, q.error, q.created_at, d.kind, u.name AS user FROM push_queue q JOIN push_devices d ON d.id = q.device_id JOIN users u ON u.id = q.user_id WHERE q.status IN ('failed','dead') ORDER BY q.id DESC LIMIT 15")
    });
  });
  app.get('/api/admin/notif/campaigns', auth, adminOnly, (_req, res) => {
    const rows = all('SELECT c.*, u.name AS to_name FROM campaigns c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 60');
    const stat = all('SELECT campaign_id, status, COUNT(*) AS n, SUM(opened_at IS NOT NULL) AS o FROM push_queue WHERE campaign_id IS NOT NULL GROUP BY campaign_id, status');
    const by = {}; for (const s of stat) { const x = by[s.campaign_id] = by[s.campaign_id] || { queued: 0, sent: 0, failed: 0, dead: 0, skipped: 0, opened: 0 }; x[s.status] = s.n; x.opened += s.o || 0; }
    res.json({ campaigns: rows.map(r => ({ ...campRow(r), delivery: by[r.id] || { queued: 0, sent: 0, failed: 0, dead: 0, skipped: 0, opened: 0 } })) });
  });
  app.get('/api/admin/notif/campaigns/:id', auth, adminOnly, wrap((req, res) => {
    const id = int(req.params.id, 'id'), c0 = get('SELECT c.*, u.name AS to_name FROM campaigns c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?', id);
    if (!c0) bad('Campanha não encontrada', 404);
    res.json({ campaign: campRow(c0), failures: all("SELECT q.id, q.status, q.attempts, q.error, d.kind, u.name AS user FROM push_queue q JOIN push_devices d ON d.id = q.device_id JOIN users u ON u.id = q.user_id WHERE q.campaign_id = ? AND q.status IN ('failed','dead') LIMIT 50", id) });
  }));
  app.post('/api/admin/notif/send', auth, wrap((req, res) => {
    const b = req.body || {}, aud = String(b.audience || 'all');
    if (aud === 'user') { if (!c.permsOf(req.user).includes('msgs')) bad('Sem permissão para enviar mensagens', 403); }
    else { if (req.user.role !== 'admin') bad('Só o administrador envia para grupos', 403); confirmCheck(req); }
    const r = createCampaign(req.user, b);
    logAct(req, r.scheduled ? 'Notificação agendada' : 'Notificação enviada', `${aud === 'user' ? 'um jogador' : AUD[aud].name} · ${String(b.title || '').slice(0, 50)}${r.scheduled ? ' · ' + r.at + ' UTC' : ''}`);
    res.json({ ok: true, ...r });
  }));
  app.post('/api/admin/notif/campaigns/:id/cancel', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const cp = get('SELECT * FROM campaigns WHERE id = ?', int(req.params.id, 'id'));
    if (!cp) bad('Campanha não encontrada', 404);
    if (cp.status !== 'scheduled') bad('Só dá para cancelar o que ainda não foi enviado');
    run("UPDATE campaigns SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ? AND status = 'scheduled'", cp.id);
    logAct(req, 'Notificação cancelada', cp.title);
    res.json({ ok: true });
  }));
  app.post('/api/admin/notif/retry', auth, adminOnly, wrap((req, res) => {
    const r = run("UPDATE push_queue SET status = 'queued', attempts = 0, next_at = 0, error = '' WHERE status = 'failed' AND created_at >= datetime('now','-3 days')");
    res.json({ ok: true, requeued: r.changes });
  }));
  return { emit, enqueue, createCampaign, deliverCampaign, system, newGame, gameUpdated, notifyUpdate, pump, prefsOf, CATS };
}

const SW = `/* Game Platform: notificações no navegador */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Game Platform', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Game Platform', {
    body: d.body || '', tag: 'gp-n' + (d.id || Date.now()), renotify: false, silent: !!d.silent, vibrate: d.vibrate || [],
    requireInteraction: !!d.priority, icon: '/icon-192.png', badge: '/icon-192.png', data: d
  }));
});
self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {}; e.notification.close();
  e.waitUntil((async () => {
    try { if (d.q) await fetch('/api/push/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: d.q, t: d.t }) }); } catch (x) {}
    const url = d.url || '/';
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { try { c.postMessage({ type: 'gp-notif', id: d.id, ref: d.ref, cat: d.cat }); } catch (x) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
`;
