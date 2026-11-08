// Área de gestão: usuários, suspensão e banimento, perfis de acesso e moderação de conteúdo.
// Perfis: admin (tudo), mod (usuários, denúncias e conteúdo, sem dinheiro e sem banir) e user.
export function mountAdmin(c) {
  const { app, auth, staffOnly, adminOnly, wrap, bad, int, get, all, run, logAct, notify, fmtUid, parseJ, playing, PLAY_TTL, isOnline } = c;
  const isAdmin = u => u.role === 'admin';
  const dateBR = s => String(s || '').slice(0, 10).split('-').reverse().join('/');
  const esc = s => String(s).replace(/[%_\\]/g, m => '\\' + m);

  // ---------- usuários ----------
  app.get('/api/admin/users', auth, staffOnly, (req, res) => {
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

  app.get('/api/admin/users/:id', auth, staffOnly, wrap((req, res) => {
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
      history: all('SELECT id, actor, role, action, detail, created_at FROM logs WHERE target_id = ? ORDER BY id DESC LIMIT 30', id)
    };
    if (adm) {
      out.email = u.email; out.emailVerified = !!u.email_verified; out.google = !!u.google_id;
      out.coins = u.coins || 0; out.studio_until = u.studio_until; out.premium_until = u.premium_until;
      out.purchases = all('SELECT p.game_id, g.title, p.created_at FROM purchases p JOIN games g ON g.id = p.game_id WHERE p.user_id = ? ORDER BY p.rowid DESC LIMIT 8', id);
    }
    res.json({ user: out });
  }));

  app.post('/api/admin/users/:id/status', auth, staffOnly, wrap((req, res) => {
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
    const id = int(req.params.id, 'id'), role = req.body.role;
    if (!['user', 'mod'].includes(role)) bad('Perfil inválido');
    const t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    if (id === req.user.id || t.role === 'admin') bad('Não é possível alterar o perfil de um administrador', 403);
    if (t.status !== 'active') bad('Reative a conta antes de mudar o perfil');
    run('UPDATE users SET role = ? WHERE id = ?', role, id);
    logAct(req, role === 'mod' ? 'Moderador nomeado' : 'Moderador removido', t.name, id);
    notify(id, role === 'mod' ? 'Você agora é moderador' : 'Seu perfil de moderador foi removido', role === 'mod' ? 'Você pode moderar comentários e denúncias pelo painel no computador.' : '');
    res.json({ ok: true, role });
  }));

  // ---------- moderação de conteúdo ----------
  const KINDS = {
    review: { table: 'reviews', label: 'avaliação' },
    comment: { table: 'comments', label: 'comentário' },
    post: { table: 'posts', label: 'publicação' }
  };
  app.get('/api/admin/content', auth, staffOnly, wrap((req, res) => {
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

  app.post('/api/admin/content/delete', auth, staffOnly, wrap((req, res) => {
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
      run(`DELETE FROM ${k.table} WHERE id = ?`, id);
      logAct(req, `Removido: ${k.label}`, `${row.name} · "${String(row.text || '').replace(/\s+/g, ' ').slice(0, 80)}" · ${reason}`, row.user_id);
      notify(row.user_id, `Sua ${k.label} foi removida`, reason);
      removed++;
    }
    res.json({ ok: true, removed });
  }));

  // ---------- jogos e jogadores ----------
  const playersNow = () => { const out = {}; for (const [uid, p] of playing) { if (Date.now() - p.at > PLAY_TTL || !isOnline(uid)) { playing.delete(uid); continue; } (out[p.gid] = out[p.gid] || []).push(uid); } return out; };

  app.get('/api/admin/games/stats', auth, staffOnly, (req, res) => {
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

  app.get('/api/admin/games/:id/players', auth, staffOnly, wrap((req, res) => {
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
  app.post('/api/admin/games/:id/status', auth, staffOnly, wrap((req, res) => {
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


  // ---------- auditoria ----------
  app.get('/api/admin/audit', auth, adminOnly, (req, res) => {
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
