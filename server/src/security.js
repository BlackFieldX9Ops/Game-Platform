// Segurança da equipe: confirmação reforçada (código por e-mail ou senha), backups do banco e sessões.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const CONFIRM_TTL = 10 * 60_000, CODE_TTL = 10 * 60_000;

export function mountSecurity(c) {
  const { app, auth, adminOnly, wrap, bad, get, all, run, db, logAct, notify, HttpError, dbFile, PROD } = c;
  const env = process.env, mailOn = () => !!env.RESEND_API_KEY, gate = () => env.CONFIRM_GATE !== 'off';
  const FROM = env.MAIL_FROM || 'Game Platform <onboarding@resend.dev>';
  const codes = new Map(), tokens = new Map(); // userId -> { hash, exp, tries } | { tok, exp }

  async function sendMail(to, subject, body) {
    if (mailOn()) {
      try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [to], subject, text: body }) }); return r.ok; } catch { return false; }
    }
    if (!PROD) { run('INSERT INTO dev_outbox (to_email, subject, body) VALUES (?,?,?)', to, subject, body); return true; }
    return false;
  }
  const mask = e => { const [a, b] = String(e).split('@'); return a.slice(0, 2) + '***@' + b; };

  // Ações pesadas pedem uma confirmação válida por 10 minutos (cabeçalho x-confirm).
  const confirmed = req => {
    if (!gate()) return true;
    const t = tokens.get(req.user.id), h = String(req.headers['x-confirm'] || '');
    return !!(t && t.exp > Date.now() && h && crypto.timingSafeEqual(Buffer.from(sha(h)), Buffer.from(sha(t.tok))));
  };
  const need = req => { if (!confirmed(req)) throw new HttpError(428, 'Confirme sua identidade para continuar'); };
  const needMw = (req, _res, next) => { try { need(req); next(); } catch (e) { next(e); } };

  app.get('/api/admin/confirm', auth, (req, res) => {
    if (!['admin', 'mod'].includes(req.user.role)) bad('Acesso restrito à equipe', 403);
    res.json({ gate: gate(), method: mailOn() || !PROD ? 'email' : 'password', active: confirmed(req) });
  });
  app.post('/api/admin/confirm/request', auth, wrap(async (req, res) => {
    if (!['admin', 'mod'].includes(req.user.role)) bad('Acesso restrito à equipe', 403);
    if (!(mailOn() || !PROD)) return res.json({ method: 'password' });
    const prev = codes.get(req.user.id);
    if (prev && prev.sentAt && Date.now() - prev.sentAt < 30_000) bad('Espere alguns segundos para pedir outro código', 429);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    codes.set(req.user.id, { hash: sha(req.user.id + ':' + code), exp: Date.now() + CODE_TTL, tries: 0, sentAt: Date.now() });
    const ok = await sendMail(req.user.email, `Código de confirmação: ${code}`, `Seu código para confirmar uma ação no painel do Game Platform: ${code}\n\nVale por 10 minutos. Se não foi você, troque a sua senha agora.`);
    if (!ok) bad('Não foi possível enviar o e-mail agora', 502);
    res.json({ method: 'email', to: mask(req.user.email) });
  }));
  app.post('/api/admin/confirm/verify', auth, wrap((req, res) => {
    if (!['admin', 'mod'].includes(req.user.role)) bad('Acesso restrito à equipe', 403);
    const b = req.body || {};
    if (b.password !== undefined) {
      if (!bcrypt.compareSync(String(b.password), req.user.pass_hash)) { logAct(req, 'Confirmação falhou', 'senha incorreta'); bad('Senha incorreta', 401); }
    } else {
      const k = codes.get(req.user.id);
      if (!k || k.exp < Date.now()) bad('Código inválido ou vencido', 400);
      if (k.tries >= 5) bad('Muitas tentativas. Peça um código novo.', 429);
      if (k.hash !== sha(req.user.id + ':' + String(b.code || '').trim())) { k.tries++; bad('Código inválido ou vencido', 400); }
      codes.delete(req.user.id);
    }
    const tok = crypto.randomBytes(24).toString('hex');
    tokens.set(req.user.id, { tok, exp: Date.now() + CONFIRM_TTL });
    res.json({ token: tok, expires: Date.now() + CONFIRM_TTL });
  }));

  // ---------- backups do banco ----------
  const dir = path.join(path.dirname(path.resolve(dbFile)), 'backups');
  const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const listBackups = () => { try { return fs.readdirSync(dir).filter(f => /^app-\d{12}(-manual)?\.db$/.test(f)).map(f => { const s = fs.statSync(path.join(dir, f)); return { name: f, size: s.size, at: s.mtime.toISOString() }; }).sort((a, b) => b.at.localeCompare(a.at)); } catch { return []; } };
  function runBackup(manual = false) {
    fs.mkdirSync(dir, { recursive: true });
    const name = `app-${stamp()}${manual ? '-manual' : ''}.db`, file = path.join(dir, name);
    if (fs.existsSync(file)) return name;
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const auto = listBackups().filter(b => !b.name.includes('manual'));
    for (const b of auto.slice(14)) { try { fs.unlinkSync(path.join(dir, b.name)); } catch {} }
    const man = listBackups().filter(b => b.name.includes('manual'));
    for (const b of man.slice(10)) { try { fs.unlinkSync(path.join(dir, b.name)); } catch {} }
    return name;
  }
  const tick = () => { try { const last = listBackups()[0]; if (!last || Date.now() - Date.parse(last.at) > 20 * 3600e3) runBackup(); } catch (e) { console.error('backup falhou:', e.message); } };
  if (env.BACKUP_AUTO !== 'off') { setTimeout(tick, 20_000).unref(); setInterval(tick, 3600e3).unref(); }

  app.get('/api/admin/backups', auth, adminOnly, (_req, res) => res.json({ backups: listBackups(), persistent: /[\\/]data([\\/]|$)/.test(path.resolve(dbFile)) || !!env.BACKUP_PERSISTENT, dir: path.basename(dir) }));
  app.post('/api/admin/backups/run', auth, adminOnly, wrap((req, res) => { const name = runBackup(true); logAct(req, 'Backup criado', name); res.json({ ok: true, name, backups: listBackups() }); }));
  app.get('/api/admin/backups/:name', auth, adminOnly, needMw, wrap((req, res) => {
    const name = String(req.params.name);
    if (!/^app-\d{12}(-manual)?\.db$/.test(name)) bad('Backup inválido', 400);
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) bad('Backup não encontrado', 404);
    logAct(req, 'Backup baixado', name);
    res.download(file, name);
  }));

  // ---------- sessões ----------
  app.get('/api/admin/sessions', auth, adminOnly, (_req, res) => {
    res.json({ sessions: all("SELECT id, name, role, last_seen, last_ip, last_ua FROM users WHERE role IN ('admin','mod') ORDER BY (last_seen IS NULL), last_seen DESC").map(u => ({ ...u, ua: String(u.last_ua || '').slice(0, 90) })) });
  });
  app.post('/api/admin/users/:id/logout', auth, adminOnly, needMw, wrap((req, res) => {
    const id = Number(req.params.id), t = get('SELECT id, name FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    run('UPDATE users SET token_ver = token_ver + 1 WHERE id = ?', id);
    logAct(req, 'Sessões encerradas', t.name, id);
    res.json({ ok: true, self: id === req.user.id });
  }));

  return { confirmed, need, needMw, runBackup };
}
