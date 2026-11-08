// Conta de verdade: Google, recuperar senha e verificar e-mail por código, e progresso entre aparelhos.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export function mountAccounts(c) {
  const { app, auth, wrap, bad, str, get, all, run, sign, publicUser, authLimiter, PROD, SECRET } = c;
  const env = process.env;
  const G = {
    id: env.GOOGLE_CLIENT_ID || '', secret: env.GOOGLE_CLIENT_SECRET || '', pub: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  };
  const googleOn = () => !!(G.id && G.secret && G.pub);
  const mailOn = () => !!env.RESEND_API_KEY;
  const FROM = env.MAIL_FROM || 'Game Platform <onboarding@resend.dev>';
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const userOut = u => ({ ...publicUser(u), email: u.email, emailVerified: !!u.email_verified, google: !!u.google_id });

  /* ---------- e-mail (Resend); sem chave, em desenvolvimento, fica na tabela dev_outbox ---------- */
  async function sendMail(to, subject, body) {
    if (mailOn()) {
      try {
        const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [to], subject, text: body }) });
        return r.ok;
      } catch { return false; }
    }
    if (!PROD) { run('INSERT INTO dev_outbox (to_email, subject, body) VALUES (?,?,?)', to, subject, body); return true; }
    return false;
  }
  async function issueCode(email, kind) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    run('INSERT INTO auth_codes (email, kind, code_hash, expires_at, attempts) VALUES (?,?,?,?,0) ON CONFLICT(email, kind) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0',
      email, kind, sha(email + ':' + kind + ':' + code), Date.now() + 15 * 60_000);
    const what = kind === 'reset' ? 'recuperar a sua senha' : 'confirmar o seu e-mail';
    return sendMail(email, `Seu código do Game Platform: ${code}`, `Use este código para ${what}: ${code}\n\nEle vale por 15 minutos. Se não foi você, ignore esta mensagem.`);
  }
  function checkCode(email, kind, code) {
    const row = get('SELECT * FROM auth_codes WHERE email = ? AND kind = ?', email, kind);
    if (!row || row.expires_at < Date.now()) bad('Código inválido ou vencido', 400);
    if (row.attempts >= 5) bad('Muitas tentativas. Peça um código novo.', 429);
    if (row.code_hash !== sha(email + ':' + kind + ':' + String(code || '').trim())) {
      run('UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ? AND kind = ?', email, kind);
      bad('Código inválido ou vencido', 400);
    }
    run('DELETE FROM auth_codes WHERE email = ? AND kind = ?', email, kind);
  }

  app.get('/api/auth/config', (_req, res) => res.json({ google: googleOn(), mail: mailOn() || !PROD }));

  /* ---------- recuperar senha ---------- */
  app.post('/api/auth/forgot', authLimiter, wrap(async (req, res) => {
    const email = str(req.body.email, 'E-mail', 5, 120).toLowerCase();
    const u = get('SELECT * FROM users WHERE email = ? AND status = ?', email, 'active');
    if (u) await issueCode(email, 'reset'); // resposta igual exista a conta ou não
    res.json({ ok: true });
  }));
  app.post('/api/auth/reset', authLimiter, wrap((req, res) => {
    const email = str(req.body.email, 'E-mail', 5, 120).toLowerCase();
    const password = str(req.body.password, 'Senha', c.cfg ? c.cfg.val('minPassword') : 8, 100);
    const u = get('SELECT * FROM users WHERE email = ? AND status = ?', email, 'active');
    if (!u) bad('Código inválido ou vencido', 400);
    checkCode(email, 'reset', req.body.code);
    run('UPDATE users SET pass_hash = ?, email_verified = 1 WHERE id = ?', bcrypt.hashSync(password, 10), u.id);
    if (c.hub && c.hub.emit) c.hub.emit(u.id, 'Senha alterada', 'A senha da sua conta foi redefinida. Se não foi você, fale com a administração.', { cat: 'security', important: true, kind: 'security' });
    res.json({ token: sign(u), user: userOut(get('SELECT * FROM users WHERE id = ?', u.id)) });
  }));

  /* ---------- verificar e-mail ---------- */
  app.post('/api/auth/verify/send', auth, authLimiter, wrap(async (req, res) => {
    if (req.user.email_verified) return res.json({ ok: true, already: true });
    const sent = await issueCode(req.user.email, 'verify');
    if (!sent) bad('Não foi possível enviar o e-mail agora', 503);
    res.json({ ok: true });
  }));
  app.post('/api/auth/verify', auth, authLimiter, wrap((req, res) => {
    checkCode(req.user.email, 'verify', req.body.code);
    run('UPDATE users SET email_verified = 1 WHERE id = ?', req.user.id);
    res.json({ ok: true });
  }));

  /* ---------- Google (fluxo web; no app, volta por gameplatform://auth) ---------- */
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signState = o => { const p = b64(o); return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
  function readState(s) {
    const [p, sig] = String(s || '').split('.');
    if (!p || !sig) return null;
    const want = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
  }
  const page = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#0a0d1c;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div style="padding:24px"><h2>${title}</h2><p style="color:#a8b0d0">${msg}</p></div>`;
  app.get('/api/auth/google/start', (req, res) => {
    if (!googleOn()) return res.status(501).json({ error: 'Entrar com Google ainda não foi configurado neste servidor' });
    const state = signState({ app: req.query.app === '1' ? 1 : 0, n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60_000 });
    const q = new URLSearchParams({ client_id: G.id, redirect_uri: G.pub + '/api/auth/google/callback', response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    res.redirect(G.authUrl + '?' + q);
  });
  function uniqueName(base) {
    let n = String(base || 'Jogador').normalize('NFKD').replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 16) || 'Jogador';
    if (n.length < 3) n = 'Jogador';
    let cand = n, i = 1;
    while (get('SELECT 1 FROM users WHERE name = ?', cand)) cand = n.slice(0, 20 - String(++i).length) + i;
    return cand;
  }
  app.get('/api/auth/google/callback', wrap(async (req, res) => {
    const st = readState(req.query.state);
    if (!st) return res.status(400).type('html').send(page('Link inválido', 'Volte ao app e tente entrar com o Google de novo.'));
    if (req.query.error || !req.query.code || !googleOn()) return res.status(400).type('html').send(page('Não foi possível entrar', 'O Google não confirmou o login. Volte ao app e tente de novo.'));
    let prof;
    try {
      const r = await fetch(G.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(req.query.code), client_id: G.id, client_secret: G.secret, redirect_uri: G.pub + '/api/auth/google/callback', grant_type: 'authorization_code' }) });
      const j = await r.json();
      prof = JSON.parse(Buffer.from(String(j.id_token).split('.')[1], 'base64url').toString());
    } catch { return res.status(502).type('html').send(page('Google indisponível', 'Tente de novo em instantes.')); }
    if (!prof || prof.aud !== G.id || !prof.email || prof.email_verified === false) return res.status(400).type('html').send(page('E-mail não verificado', 'Use uma conta Google com e-mail verificado.'));
    const email = String(prof.email).toLowerCase();
    let u = get('SELECT * FROM users WHERE google_id = ?', String(prof.sub)) || get('SELECT * FROM users WHERE email = ?', email);
    if (u && u.status !== 'active') return res.status(403).type('html').send(page('Conta suspensa', 'Fale com a administração.'));
    if (!u) {
      const role = process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user';
      const r = run('INSERT INTO users (name, email, pass_hash, role, email_verified, google_id) VALUES (?,?,?,?,1,?)', uniqueName(prof.given_name || prof.name || email.split('@')[0]), email, bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10), role, String(prof.sub));
      u = get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
    } else if (!u.google_id || !u.email_verified) run('UPDATE users SET google_id = COALESCE(google_id, ?), email_verified = 1 WHERE id = ?', String(prof.sub), u.id);
    const code = crypto.randomBytes(24).toString('hex');
    run('DELETE FROM auth_exchange WHERE expires_at < ?', Date.now());
    run('INSERT INTO auth_exchange (code, user_id, expires_at) VALUES (?,?,?)', code, u.id, Date.now() + 2 * 60_000);
    if (st.app) {
      const link = 'gameplatform://auth?code=' + code;
      return res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${link}"><body style="font-family:system-ui;background:#0a0d1c;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div style="padding:24px"><h2>Login feito</h2><p style="color:#a8b0d0">Voltando para o Game Platform…</p><p><a style="color:#a78bfa" href="${link}">Toque aqui se o app não abrir</a></p></div>`);
    }
    res.redirect(G.pub + '/#gpcode=' + code);
  }));
  app.post('/api/auth/exchange', authLimiter, wrap((req, res) => {
    const code = typeof req.body.code === 'string' ? req.body.code : '';
    const row = get('SELECT * FROM auth_exchange WHERE code = ?', code);
    run('DELETE FROM auth_exchange WHERE code = ?', code); // uso único
    if (!row || row.expires_at < Date.now()) bad('Código de login vencido. Tente de novo.', 400);
    const u = get("SELECT * FROM users WHERE id = ? AND status = 'active'", row.user_id);
    if (!u) bad('Conta indisponível', 403);
    res.json({ token: sign(u), user: userOut(u) });
  }));

  /* ---------- progresso entre aparelhos ---------- */
  app.get('/api/me/progress', auth, (req, res) => {
    const r = get('SELECT data, updated_at FROM progress WHERE user_id = ?', req.user.id);
    let data = null; try { data = r ? JSON.parse(r.data) : null; } catch {}
    res.json({ data, updated_at: r ? r.updated_at : null });
  });
  app.put('/api/me/progress', auth, wrap((req, res) => {
    const d = req.body && req.body.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) bad('Dados inválidos');
    const json = JSON.stringify(d);
    if (json.length > 400_000) bad('Progresso grande demais', 413);
    run("INSERT INTO progress (user_id, data, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", req.user.id, json);
    res.json({ ok: true, updated_at: get('SELECT updated_at FROM progress WHERE user_id = ?', req.user.id).updated_at });
  }));
}
