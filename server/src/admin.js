// Área de gestão: usuários, suspensão e banimento, perfis de acesso e moderação de conteúdo.
// Perfis: admin (tudo), mod (usuários, denúncias e conteúdo, sem dinheiro e sem banir) e user.
export function mountAdmin(c) {
  const { app, auth, staffOnly, adminOnly, wrap, bad, int, get, all, run, logAct, notify, fmtUid, parseJ, playing, PLAY_TTL, isOnline, pushTo, online, maintenance, setMaintenance, confirmCheck, alertAdmins, staffCan, permsOf, PERMS } = c;
  const isAdmin = u => u.role === 'admin';
  const dateBR = s => String(s || '').slice(0, 10).split('-').reverse().join('/');
  const esc = s => String(s).replace(/[%_\\]/g, m => '\\' + m);

  // ---------- usuários ----------
  app.get('/api/admin/users', auth, staffCan('users'), (req, res) => {
    const q = req.query, w = [], p = [];
    if (q.q) {
      const t = String(q.q).trim().slice(0, 60), asId = /^#?\d{1,6}$/.test(t) ? Number(t.replace('#', '')) : null;
      const like = `%${esc(t.toLowerCase())}%`;
      w.push(`(LOWER(name) LIKE ? ESCAPE '\\'${isAdmin(req.user) ? " OR LOWER(email) LIKE ? ESCAPE '\\'" : ''}${asId !== null ? ' OR uid = ?' : ''})`);
      p.push(like); if (isAdmin(req.user)) p.push(like);
      if (asId !== null) p.push(asId);
    }
    if (['active', 'suspended', 'banned'].includes(q.status)) { w.push('status = ?'); p.push(q.status); }
    if (['user', 'mod', 'admin'].includes(q.role)) { w.push('role = ?'); p.push(q.role); }
    if (q.plan === 'studio') w.push("(role = 'admin' OR (studio_until IS NOT NULL AND studio_until > datetime('now')))");
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 200)), offset = Math.max(0, Number(q.offset) || 0);
    const total = get(`SELECT COUNT(*) AS n FROM users ${where}`, ...p).n;
    const email = isAdmin(req.user) ? 'email, ' : '';
    const users = all(`SELECT id, uid, name, ${email}role, status, status_until, status_reason, xp, avatar, created_at, studio_until, (SELECT COUNT(*) FROM games WHERE owner_id = users.id AND status != 'removed') AS games FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
    res.json({ users: users.map(u => ({ ...u, uidFmt: fmtUid(u) })), total });
  });

  app.get('/api/admin/users/:id', auth, staffCan('users'), wrap((req, res) => {
    const id = int(req.params.id, 'id'), adm = isAdmin(req.user);
    const u = get('SELECT * FROM users WHERE id = ?', id);
    if (!u) bad('Usuário não encontrado', 404);
    const n = (sql) => get(sql, id).n;
    const out = {
      id: u.id, uid: u.uid, uidFmt: fmtUid(u), name: u.name, role: u.role, status: u.status, status_until: u.status_until, status_reason: u.status_reason,
      xp: u.xp, avatar: u.avatar || null, bio: u.bio || '', created_at: u.created_at,
      counts: {
        games: n("SELECT COUNT(*) AS n FROM games WHERE owner_id = ? AND status != 'removed'"),
        reviews: n('SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?'),
        posts: n('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?'),
        comments: n('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?'),
        library: n('SELECT COUNT(*) AS n FROM library WHERE user_id = ?'),
        reportsAgainst: n("SELECT COUNT(*) AS n FROM reports WHERE target_type = 'user' AND target_id = ?"),
        reportsMade: n('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?')
      },
      games: all("SELECT id, title, status, plays, created_at FROM games WHERE owner_id = ? AND status != 'removed' ORDER BY id DESC LIMIT 8", id),
      recent: {
        posts: all('SELECT id, substr(text,1,140) AS text, created_at FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 5', id),
        comments: all('SELECT id, substr(text,1,140) AS text, created_at FROM comments WHERE user_id = ? ORDER BY id DESC LIMIT 5', id),
        reviews: all('SELECT r.id, r.stars, substr(r.text,1,140) AS text, r.created_at, g.title AS game FROM reviews r JOIN games g ON g.id = r.game_id WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 5', id)
      },
      history: all('SELECT id, actor, role, action, detail, created_at FROM logs WHERE target_id = ? ORDER BY id DESC LIMIT 30', id),
      perms: permsOf(u), lastSeen: u.last_seen || null
    };
    if (adm) {
      out.email = u.email; out.emailVerified = !!u.email_verified; out.google = !!u.google_id;
      out.coins = u.coins || 0; out.studio_until = u.studio_until; out.premium_until = u.premium_until;
      out.purchases = all('SELECT p.game_id, g.title, p.created_at FROM purchases p JOIN games g ON g.id = p.game_id WHERE p.user_id = ? ORDER BY p.rowid DESC LIMIT 8', id);
    }
    res.json({ user: out });
  }));

  app.post('/api/admin/users/:id/status', auth, staffCan('users'), wrap((req, res) => {
    const id = int(req.params.id, 'id'), status = req.body.status, adm = isAdmin(req.user);
    if (!['active', 'suspended', 'banned'].includes(status)) bad('Status inválido');
    const t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    if (id === req.user.id) bad('Você não pode alterar a própria conta');
    if (t.role === 'admin') bad('Contas de administrador não podem ser suspensas aqui', 403);
    if (t.role === 'mod' && !adm) bad('Só o administrador altera moderadores', 403);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 140) : '';
    const days = req.body.days === undefined || req.body.days === null || req.body.days === '' ? null : Number(req.body.days);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) bad('Prazo inválido (1 a 365 dias)');
    if (status === 'banned' || t.status === 'banned') confirmCheck(req);
    if (status === 'banned') {
      if (!adm) bad('Só o administrador pode banir', 403);
      if (reason.length < 5) bad('Escreva o motivo do banimento (mínimo 5 letras)');
    }
    if (status === 'suspended' && !adm) {
      if (days === null || days > 30) bad('Moderadores suspendem de 1 a 30 dias');
      if (reason.length < 5) bad('Escreva o motivo da suspensão (mínimo 5 letras)');
    }
    if (status === 'active' && t.status === 'banned' && !adm) bad('Só o administrador desbane', 403);
    if (status === 'active') run("UPDATE users SET status = 'active', status_until = NULL, status_reason = '' WHERE id = ?", id);
    else if (status === 'banned') run("UPDATE users SET status = 'banned', status_until = NULL, status_reason = ? WHERE id = ?", reason, id);
    else if (days) run("UPDATE users SET status = 'suspended', status_until = datetime('now', ?), status_reason = ? WHERE id = ?", `+${days} days`, reason, id);
    else run("UPDATE users SET status = 'suspended', status_until = NULL, status_reason = ? WHERE id = ?", reason, id);
    const label = { active: 'Usuário reativado', suspended: 'Usuário suspenso', banned: 'Usuário banido' }[status];
    logAct(req, label, `${t.name}${days ? ` · ${days} dia(s)` : ''}${reason ? ` · ${reason}` : ''}`, id);
    const u2 = get('SELECT status, status_until, status_reason FROM users WHERE id = ?', id);
    res.json({ ok: true, ...u2 });
  }));

  // Perfil de acesso: só o administrador promove ou rebaixa moderadores.
  app.post('/api/admin/users/:id/role', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const id = int(req.params.id, 'id'), role = req.body.role;
    if (!['user', 'mod'].includes(role)) bad('Perfil inválido');
    const t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    if (id === req.user.id || t.role === 'admin') bad('Não é possível alterar o perfil de um administrador', 403);
    if (t.status !== 'active') bad('Reative a conta antes de mudar o perfil');
    run('UPDATE users SET role = ? WHERE id = ?', role, id);
    logAct(req, role === 'mod' ? 'Moderador nomeado' : 'Moderador removido', t.name, id);
    notify(id, role === 'mod' ? 'Você agora é moderador' : 'Seu perfil de moderador foi removido', role === 'mod' ? 'Você pode moderar comentários e denúncias pelo painel no computador.' : '', '', 'security');
    res.json({ ok: true, role });
  }));

  // ---------- moderação de conteúdo ----------
  const KINDS = {
    review: { table: 'reviews', label: 'avaliação' },
    comment: { table: 'comments', label: 'comentário' },
    post: { table: 'posts', label: 'publicação' }
  };
  app.get('/api/admin/content', auth, staffCan('content'), wrap((req, res) => {
    const kind = req.query.kind;
    if (!KINDS[kind]) bad('Tipo inválido');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50)), before = Number(req.query.before) || 0;
    const w = [], p = [];
    if (before) { w.push('t.id < ?'); p.push(before); }
    if (req.query.q) { const like = `%${esc(String(req.query.q).trim().slice(0, 60).toLowerCase())}%`; w.push("(LOWER(t.text) LIKE ? ESCAPE '\\' OR LOWER(u.name) LIKE ? ESCAPE '\\')"); p.push(like, like); }
    if (req.query.user) { w.push('t.user_id = ?'); p.push(int(req.query.user, 'user')); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const sel = {
      review: `SELECT t.id, t.text, t.stars, t.created_at, u.id AS author_id, u.name AS author, g.title AS target, NULL AS reports FROM reviews t JOIN users u ON u.id = t.user_id JOIN games g ON g.id = t.game_id`,
      comment: `SELECT t.id, t.text, NULL AS stars, t.created_at, u.id AS author_id, u.name AS author, substr(po.text,1,50) AS target, NULL AS reports FROM comments t JOIN users u ON u.id = t.user_id JOIN posts po ON po.id = t.post_id`,
      post: `SELECT t.id, t.text, NULL AS stars, t.created_at, u.id AS author_id, u.name AS author, g.title AS target, (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = t.id AND r.status = 'open') AS reports FROM posts t JOIN users u ON u.id = t.user_id LEFT JOIN games g ON g.id = t.game_id`
    }[kind];
    const items = all(`${sel} ${where} ORDER BY t.id DESC LIMIT ?`, ...p, limit + 1);
    const more = items.length > limit;
    res.json({ items: items.slice(0, limit).map(i => ({ ...i, kind })), more });
  }));

  app.post('/api/admin/content/delete', auth, staffCan('content'), wrap((req, res) => {
    const list = Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : [];
    if (!list.length) bad('Nada selecionado');
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 100) : '';
    if (reason.length < 3) bad('Escreva o motivo da remoção');
    let removed = 0;
    for (const it of list) {
      const k = KINDS[it && it.kind], id = Number(it && it.id);
      if (!k || !Number.isInteger(id)) continue;
      const row = get(`SELECT t.id, t.text, t.user_id, u.name, u.role FROM ${k.table} t JOIN users u ON u.id = t.user_id WHERE t.id = ?`, id);
      if (!row) continue;
      if (row.role === 'admin' && !isAdmin(req.user)) continue;
      const full = get(`SELECT * FROM ${k.table} WHERE id = ?`, id);
      run('INSERT INTO trash (kind, ref_id, user_id, author, data, reason, actor) VALUES (?,?,?,?,?,?,?)', it.kind, id, row.user_id, row.name, JSON.stringify(full), reason, req.user.name);
      run(`DELETE FROM ${k.table} WHERE id = ?`, id);
      logAct(req, `Removido: ${k.label}`, `${row.name} · "${String(row.text || '').replace(/\s+/g, ' ').slice(0, 80)}" · ${reason}`, row.user_id);
      notify(row.user_id, `Sua ${k.label} foi removida`, reason);
      removed++;
    }
    res.json({ ok: true, removed });
  }));

  // ---------- jogos e jogadores ----------
  const playersNow = () => { const out = {}; for (const [uid, p] of playing) { if (Date.now() - p.at > PLAY_TTL || !isOnline(uid)) { playing.delete(uid); continue; } (out[p.gid] = out[p.gid] || []).push(uid); } return out; };

  app.get('/api/admin/games/stats', auth, staffCan('games'), (req, res) => {
    const q = req.query, w = ["g.status != 'removed'"], p = [];
    if (['published', 'unpublished'].includes(q.status)) { w.push('g.status = ?'); p.push(q.status); }
    if (q.q) { w.push("(LOWER(g.title) LIKE ? ESCAPE '\\' OR LOWER(u.name) LIKE ? ESCAPE '\\')"); const l = `%${esc(String(q.q).trim().slice(0, 40).toLowerCase())}%`; p.push(l, l); }
    const now = playersNow();
    const rows = all(`SELECT g.id, g.title, g.category, g.dim, g.status, g.visibility, g.featured, g.plays, g.settings, g.created_at, u.id AS owner_id, u.name AS developer,
      (SELECT COUNT(*) FROM library l WHERE l.game_id = g.id AND l.user_id != g.owner_id) AS library, (SELECT COUNT(*) FROM purchases pu WHERE pu.game_id = g.id) AS buyers,
      (SELECT COUNT(*) FROM game_plays gp WHERE gp.game_id = g.id) AS players, (SELECT COUNT(*) FROM reviews r WHERE r.game_id = g.id) AS reviews,
      (SELECT ROUND(AVG(r.stars), 1) FROM reviews r WHERE r.game_id = g.id) AS rating,
      (SELECT COUNT(*) FROM reports rp WHERE rp.target_type = 'game' AND rp.target_id = g.id AND rp.status = 'open') AS reports
      FROM games g JOIN users u ON u.id = g.owner_id WHERE ${w.join(' AND ')} LIMIT 500`, ...p)
      .map(g => ({ ...g, featured: !!g.featured, price: Math.round(Number(parseJ(g.settings, {}).price)) || 0, settings: undefined, online: (now[g.id] || []).length }));
    const key = { plays: 'plays', library: 'library', players: 'players', online: 'online', rating: 'rating', reports: 'reports', new: 'id' }[q.sort] || 'plays';
    rows.sort((a, b) => ((b[key] || 0) - (a[key] || 0)) || (b.id - a.id));
    res.json({ games: rows.slice(0, 200), total: rows.length, totals: {
      games: rows.length, published: rows.filter(g => g.status === 'published').length, plays: rows.reduce((s, g) => s + g.plays, 0),
      library: rows.reduce((s, g) => s + g.library, 0), playingNow: Object.values(now).reduce((s, l) => s + l.length, 0) } });
  });

  app.get('/api/admin/games/:id/players', auth, staffCan('games'), wrap((req, res) => {
    const id = int(req.params.id, 'id'), adm = isAdmin(req.user);
    const g = get('SELECT g.id, g.title, g.category, g.dim, g.status, g.visibility, g.featured, g.plays, g.version, g.created_at, g.updated_at, g.settings, u.id AS owner_id, u.name AS developer FROM games g JOIN users u ON u.id = g.owner_id WHERE g.id = ?', id);
    if (!g) bad('Jogo não encontrado', 404);
    const names = ids => ids.length ? all(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
    const out = {
      game: { id: g.id, title: g.title, category: g.category, dim: g.dim, status: g.status, visibility: g.visibility, featured: !!g.featured, plays: g.plays, version: g.version, created_at: g.created_at, updated_at: g.updated_at, owner_id: g.owner_id, developer: g.developer, price: Math.round(Number(parseJ(g.settings, {}).price)) || 0 },
      playingNow: names(playersNow()[id] || []),
      counts: { library: get('SELECT COUNT(*) AS n FROM library WHERE game_id = ? AND user_id != ?', id, g.owner_id).n, players: get('SELECT COUNT(*) AS n FROM game_plays WHERE game_id = ?', id).n, wishlist: get('SELECT COUNT(*) AS n FROM wishlist WHERE game_id = ?', id).n, reviews: get('SELECT COUNT(*) AS n FROM reviews WHERE game_id = ?', id).n, reports: get("SELECT COUNT(*) AS n FROM reports WHERE target_type = 'game' AND target_id = ? AND status = 'open'", id).n },
      rating: get('SELECT ROUND(AVG(stars), 1) AS r FROM reviews WHERE game_id = ?', id).r,
      players: all('SELECT u.id, u.name, gp.plays, gp.last_at FROM game_plays gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.last_at DESC LIMIT 40', id),
      reviews: all('SELECT r.id, r.stars, substr(r.text,1,140) AS text, r.created_at, u.name AS author FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.game_id = ? ORDER BY r.id DESC LIMIT 6', id)
    };
    if (adm) { out.counts.buyers = get('SELECT COUNT(*) AS n FROM purchases WHERE game_id = ?', id).n; out.earned = get("SELECT COALESCE(SUM(cut),0) AS n FROM sales WHERE kind = 'game' AND ref = ? AND refunded_at IS NULL", String(id)).n; }
    res.json(out);
  }));

  // Despublicar / republicar: moderador e administrador, sempre com motivo ao despublicar.
  app.post('/api/admin/games/:id/status', auth, staffCan('games'), wrap((req, res) => {
    const id = int(req.params.id, 'id'), status = req.body.status;
    if (!['published', 'unpublished'].includes(status)) bad('Estado inválido');
    const g = get("SELECT * FROM games WHERE id = ? AND status != 'removed'", id);
    if (!g) bad('Jogo não encontrado', 404);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 140) : '';
    if (status === 'unpublished' && reason.length < 5) bad('Escreva o motivo (mínimo 5 letras)');
    run("UPDATE games SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
    if (status === 'unpublished') run('UPDATE games SET featured = 0 WHERE id = ?', id);
    logAct(req, status === 'published' ? 'Jogo republicado' : 'Jogo despublicado', `${g.title}${reason ? ' · ' + reason : ''}`, g.owner_id);
    if (g.owner_id !== req.user.id) notify(g.owner_id, status === 'published' ? 'Jogo republicado' : 'Jogo despublicado pela administração', status === 'published' ? `${g.title} voltou para a Loja.` : `${g.title}: ${reason}`);
    res.json({ ok: true });
  }));


  // ---------- mensagens da administração ----------
  const AUD = {
    all: { name: 'Todos os jogadores', sql: "status = 'active'" },
    premium: { name: 'Premium ativos', sql: "status = 'active' AND premium_until > ?", p: () => [new Date().toISOString()] },
    studio: { name: 'Quem tem Studio', sql: "status = 'active' AND role <> 'admin' AND studio_until > ?", p: () => [new Date().toISOString()] },
    creators: { name: 'Criadores com jogo publicado', sql: "status = 'active' AND id IN (SELECT owner_id FROM games WHERE status = 'published')" },
    staff: { name: 'Equipe (admin e moderadores)', sql: "status = 'active' AND role IN ('admin','mod')" }
  };
  const audIds = k => all(`SELECT id FROM users WHERE ${AUD[k].sql}`, ...(AUD[k].p ? AUD[k].p() : [])).map(r => r.id);

  app.get('/api/admin/broadcast/count', auth, adminOnly, (req, res) => {
    const k = req.query.audience; if (!AUD[k]) bad('Público inválido');
    res.json({ count: audIds(k).length, name: AUD[k].name });
  });
  app.get('/api/admin/broadcasts', auth, adminOnly, (_req, res) => {
    res.json({ broadcasts: all('SELECT b.id, b.actor, b.audience, b.user_id, u.name AS to_name, b.title, b.body, b.important, b.count, b.created_at FROM broadcasts b LEFT JOIN users u ON u.id = b.user_id ORDER BY b.id DESC LIMIT 40').map(b => ({ ...b, important: !!b.important, audienceName: b.audience === 'user' ? (b.to_name || 'Usuário') : (AUD[b.audience] || {}).name || b.audience })) });
  });
  app.post('/api/admin/broadcast', auth, staffCan('msgs'), wrap((req, res) => {
    const b = req.body, aud = String(b.audience || '');
    const title = typeof b.title === 'string' ? b.title.trim() : '', body = typeof b.body === 'string' ? b.body.trim() : '';
    if (title.length < 2 || title.length > 60) bad('Título de 2 a 60 letras');
    if (body.length < 2 || body.length > 300) bad('Mensagem de 2 a 300 letras');
    const kind = b.important ? 'notice' : 'admin';
    let ids = [], target = null;
    if (aud === 'user') {
      target = get('SELECT id, name, status FROM users WHERE id = ?', int(b.userId, 'userId'));
      if (!target) bad('Usuário não encontrado', 404);
      const nid = run("INSERT INTO notifications (user_id, title, body, kind, category) VALUES (?,?,?,?, 'admin')", target.id, title, body, kind).lastInsertRowid; ids = [target.id];
      if (c.hub && c.hub.enqueue) c.hub.enqueue(Number(nid), ids, 'admin', { title, body, important: !!b.important });
    } else {
      if (!isAdmin(req.user)) bad('Só o administrador envia para grupos', 403);
      confirmCheck(req);
      if (!AUD[aud]) bad('Público inválido');
      ids = audIds(aud);
      if (aud === 'all') { const nid = run("INSERT INTO notifications (user_id, title, body, kind, category) VALUES (NULL,?,?,?, 'admin')", title, body, kind).lastInsertRowid; if (c.hub && c.hub.enqueue) c.hub.enqueue(Number(nid), ids, 'admin', { title, body, important: !!b.important }); }
      else for (const id of ids) { const nid = run("INSERT INTO notifications (user_id, title, body, kind, category) VALUES (?,?,?,?, 'admin')", id, title, body, kind).lastInsertRowid; if (c.hub && c.hub.enqueue) c.hub.enqueue(Number(nid), [id], 'admin', { title, body, important: !!b.important }); }
    }
    run('INSERT INTO broadcasts (actor_id, actor, audience, user_id, title, body, important, count) VALUES (?,?,?,?,?,?,?,?)', req.user.id, req.user.name, aud, target ? target.id : null, title, body, b.important ? 1 : 0, ids.length);
    logAct(req, 'Mensagem enviada', `${target ? target.name : AUD[aud].name} (${ids.length}) · ${title}`, target ? target.id : null);
    for (const id of aud === 'all' ? [...online.keys()] : ids) pushTo(id, { type: 'games' });
    res.json({ ok: true, count: ids.length });
  }));

  // ---------- modo manutenção ----------
  app.get('/api/admin/maintenance', auth, adminOnly, (_req, res) => { const m = maintenance(); res.json({ on: !!m, msg: m ? m.msg || '' : '' }); });
  app.post('/api/admin/maintenance', auth, adminOnly, wrap((req, res) => {
    const on = !!req.body.on, msg = typeof req.body.msg === 'string' ? req.body.msg.trim().slice(0, 140) : '';
    if (on && msg.length < 3) bad('Escreva o aviso que os jogadores vão ver');
    confirmCheck(req);
    setMaintenance({ on, msg });
    if (c.hub && c.hub.system) c.hub.system(on ? 'Manutenção programada' : 'Servidor de volta', on ? msg : 'A manutenção terminou. Pode voltar a jogar.', 'maintenance', { important: on });
    alertAdmins(on ? 'Manutenção ligada' : 'Manutenção desligada', `${req.user.name}${msg ? ': ' + msg : ''}`);
    logAct(req, on ? 'Manutenção ligada' : 'Manutenção desligada', msg);
    res.json({ ok: true, on, msg });
  }));

  // ---------- alertas ----------
  app.get('/api/admin/alerts', auth, staffOnly, (req, res) => {
    const out = [], n = (sql, ...p) => get(sql, ...p).n, adm = isAdmin(req.user);
    const open = n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'");
    const old = get("SELECT MIN(created_at) AS t FROM reports WHERE status = 'open'").t;
    if (open) out.push({ level: 'warn', text: `${open} denúncia(s) aguardando análise`, go: 'rep' });
    if (old && Date.parse(old.replace(' ', 'T') + 'Z') < Date.now() - 24 * 3600e3) out.push({ level: 'bad', text: 'Há denúncia parada há mais de 24 horas', go: 'rep' });
    for (const g of all("SELECT g.id, g.title, COUNT(*) AS c FROM reports r JOIN games g ON g.id = r.target_id WHERE r.target_type = 'game' AND r.status = 'open' GROUP BY g.id HAVING c >= 3")) out.push({ level: 'bad', text: `O jogo "${g.title}" tem ${g.c} denúncias abertas`, go: 'games' });
    for (const u of all("SELECT u.id, u.name, COUNT(*) AS c FROM reports r JOIN users u ON u.id = r.target_id WHERE r.target_type = 'user' AND r.status = 'open' GROUP BY u.id HAVING c >= 3")) out.push({ level: 'bad', text: `${u.name} recebeu ${u.c} denúncias abertas`, go: 'users' });
    const exp = n("SELECT COUNT(*) AS n FROM users WHERE status = 'suspended' AND status_until IS NOT NULL AND status_until <= datetime('now','+1 day')");
    if (exp) out.push({ level: 'info', text: `${exp} suspensão(ões) terminam nas próximas 24 horas`, go: 'users' });
    const burst = n("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now','-1 hour')");
    if (burst >= 20) out.push({ level: 'warn', text: `${burst} contas novas na última hora`, go: 'users' });
    if (adm) {
      const rf = n("SELECT COUNT(*) AS n FROM sales WHERE refunded_at >= datetime('now','-1 day')");
      if (rf >= 3) out.push({ level: 'warn', text: `${rf} estornos nas últimas 24 horas`, go: 'buy' });
    }
    if (maintenance()) out.push({ level: 'warn', text: 'O modo manutenção está LIGADO: jogadores não conseguem usar o app', go: 'over' });
    res.json({ alerts: out });
  });


  // ---------- permissões por pessoa ----------
  app.post('/api/admin/users/:id/perms', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const id = int(req.params.id, 'id'), t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    if (t.role !== 'mod') bad('Só moderadores têm permissões ajustáveis', 400);
    const list = Array.isArray(req.body.perms) ? [...new Set(req.body.perms.map(String))].filter(k => PERMS[k]) : null;
    if (!list) bad('Lista de permissões inválida');
    run('UPDATE users SET perms = ? WHERE id = ?', JSON.stringify(list), id);
    logAct(req, 'Permissões alteradas', `${t.name} · ${list.map(k => PERMS[k]).join(', ') || 'nenhuma'}`, id);
    notify(id, 'Suas permissões mudaram', list.length ? 'Você pode: ' + list.map(k => PERMS[k]).join(', ') : 'Você ficou sem permissões no painel.', '', 'security');
    res.json({ ok: true, perms: list });
  }));
  app.get('/api/admin/perms', auth, adminOnly, (_req, res) => res.json({ perms: PERMS }));

  // ---------- lixeira (desfazer remoções de conteúdo) ----------
  app.get('/api/admin/trash', auth, staffCan('content'), (req, res) => {
    const rows = all("SELECT id, kind, ref_id, user_id, author, data, reason, actor, created_at FROM trash WHERE restored_at IS NULL AND created_at >= datetime('now','-30 days') ORDER BY id DESC LIMIT 100");
    res.json({ items: rows.map(r => { const d = parseJ(r.data, {}); return { id: r.id, kind: r.kind, label: (KINDS[r.kind] || {}).label || r.kind, author: r.author, user_id: r.user_id, text: String(d.text || '').slice(0, 160), stars: d.stars || null, reason: r.reason, actor: r.actor, created_at: r.created_at }; }) });
  });
  app.post('/api/admin/trash/:id/restore', auth, staffCan('content'), wrap((req, res) => {
    const r = get('SELECT * FROM trash WHERE id = ? AND restored_at IS NULL', int(req.params.id, 'id'));
    if (!r) bad('Item não encontrado na lixeira', 404);
    const k = KINDS[r.kind], d = parseJ(r.data, null);
    if (!k || !d) bad('Item inválido', 400);
    const cols = Object.keys(d);
    try { run(`INSERT INTO ${k.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => d[c])); }
    catch (e) { bad(/UNIQUE/i.test(e.message) ? 'Este item já existe de novo' : 'Não dá para restaurar: o conteúdo de origem não existe mais', 409); }
    run("UPDATE trash SET restored_at = datetime('now') WHERE id = ?", r.id);
    logAct(req, `Restaurado: ${k.label}`, `${r.author} · "${String(d.text || '').replace(/\s+/g, ' ').slice(0, 80)}"`, r.user_id);
    if (r.user_id) notify(r.user_id, `Sua ${k.label} foi restaurada`, 'A moderação reviu a remoção.');
    res.json({ ok: true });
  }));
  setInterval(() => { try { run("DELETE FROM trash WHERE created_at < datetime('now','-30 days')"); } catch {} }, 6 * 3600e3).unref();

  // ---------- gráficos ----------
  app.get('/api/admin/charts', auth, staffOnly, (req, res) => {
    const days = Math.min(60, Math.max(7, Number(req.query.days) || 14)), adm = req.user.role === 'admin';
    const list = []; for (let i = days - 1; i >= 0; i--) list.push(new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10));
    const series = (sql, ...p) => { const m = {}; for (const r of all(sql, ...p)) m[r.d] = r.n; return list.map(d => m[d] || 0); };
    const from = list[0];
    const out = { days: list,
      users: series("SELECT date(created_at) AS d, COUNT(*) AS n FROM users WHERE date(created_at) >= ? GROUP BY d", from),
      plays: series('SELECT day AS d, plays AS n FROM plays_daily WHERE day >= ?', from),
      games: series("SELECT date(created_at) AS d, COUNT(*) AS n FROM games WHERE status != 'removed' AND date(created_at) >= ? GROUP BY d", from),
      reports: series('SELECT date(created_at) AS d, COUNT(*) AS n FROM reports WHERE date(created_at) >= ? GROUP BY d', from) };
    if (adm || permsOf(req.user).includes('finance')) out.sales = series('SELECT date(created_at) AS d, COUNT(*) AS n FROM sales WHERE refunded_at IS NULL AND date(created_at) >= ? GROUP BY d', from);
    if (adm || permsOf(req.user).includes('finance')) out.revenue = series('SELECT date(created_at) AS d, COALESCE(SUM(cents),0) AS n FROM sales WHERE refunded_at IS NULL AND date(created_at) >= ? GROUP BY d', from);
    res.json(out);
  });

  // ---------- exportar auditoria (CSV) ----------
  const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  app.get('/api/admin/audit.csv', auth, staffCan('audit'), (req, res) => {
    const rows = all('SELECT id, created_at, actor, role, action, detail, target_id FROM logs ORDER BY id DESC LIMIT 5000');
    const body = ['id,quando,quem,perfil,acao,detalhe,alvo', ...rows.map(r => [r.id, r.created_at, r.actor, r.role || '', r.action, r.detail, r.target_id || ''].map(csvCell).join(','))].join('\r\n');
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="auditoria.csv"' }).send('﻿' + body);
  });


  // ---------- auditoria ----------
  app.get('/api/admin/audit', auth, staffCan('audit'), (req, res) => {
    const q = req.query, w = [], p = [];
    if (q.target) { w.push('target_id = ?'); p.push(int(q.target, 'target')); }
    if (q.actor) { w.push('actor_id = ?'); p.push(int(q.actor, 'actor')); }
    if (q.q) { const like = `%${esc(String(q.q).slice(0, 60).toLowerCase())}%`; w.push("(LOWER(action) LIKE ? ESCAPE '\\' OR LOWER(detail) LIKE ? ESCAPE '\\' OR LOWER(actor) LIKE ? ESCAPE '\\')"); p.push(like, like, like); }
    if (q.before) { w.push('id < ?'); p.push(Number(q.before) || 0); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const rows = all(`SELECT id, actor_id, actor, role, action, detail, target_id, created_at FROM logs ${where} ORDER BY id DESC LIMIT 101`, ...p);
    res.json({ logs: rows.slice(0, 100), more: rows.length > 100 });
  });
}
