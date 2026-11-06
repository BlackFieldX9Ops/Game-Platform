// Chat e comunidade: feed, comentários, seguidores, grupos, comunidades, conversas e notificações sociais.
export function mountSocial(c) {
  const { app, auth, softAuth, wrap, bad, str, int, get, all, run, areFriends, pushTo, isOnline, publicUser, loadGame, COVER_RE } = c;

  const notifyK = (userId, title, body, kind, ref = '') =>
    run('INSERT INTO notifications (user_id, title, body, kind, ref) VALUES (?,?,?,?,?)', userId, title, body, kind, ref);
  const IMG_MAX = 400_000;
  function image(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || v.length > IMG_MAX || !COVER_RE.test(v)) bad('Imagem inválida (JPG, PNG ou WebP de até 250 KB)');
    return v;
  }
  function mentions(text, by, ref, where) {
    const seen = new Set();
    for (const m of text.matchAll(/@([A-Za-z0-9_.-]{3,20})/g)) {
      if (seen.has(m[1].toLowerCase())) continue; seen.add(m[1].toLowerCase());
      const u = get("SELECT id FROM users WHERE name = ? AND status = 'active'", m[1]);
      if (u && u.id !== by.id) notifyK(u.id, 'Você foi mencionado', `${by.name} mencionou você ${where}.`, 'mention', ref);
    }
  }
  const findUser = b => {
    if (b.id !== undefined && b.id !== null && b.id !== '') {
      const id = Number(String(b.id).replace(/^#/, ''));
      if (Number.isInteger(id) && id > 0) return get("SELECT * FROM users WHERE id = ? AND status = 'active'", id);
    }
    if (typeof b.name === 'string' && b.name.trim()) {
      const n = b.name.trim().replace(/^@/, '');
      if (/^#\d+$/.test(n)) return get("SELECT * FROM users WHERE id = ? AND status = 'active'", Number(n.slice(1)));
      return get("SELECT * FROM users WHERE name = ? AND status = 'active'", n);
    }
    return null;
  };

  /* ---------- usuários e seguidores ---------- */
  app.get('/api/users/search', auth, wrap((req, res) => {
    const q = String(req.query.q || '').trim().replace(/^@/, '');
    if (q.length < 1) return res.json({ users: [] });
    const rows = /^#\d+$/.test(q)
      ? all("SELECT id, name, avatar FROM users WHERE id = ? AND status='active'", Number(q.slice(1)))
      : all("SELECT id, name, avatar FROM users WHERE name LIKE ? ESCAPE '\\' AND status='active' AND id != ? ORDER BY name LIMIT 20", q.replace(/[\\%_]/g, '\\$&') + '%', req.user.id);
    res.json({ users: rows.map(u => ({ ...u, following: !!get('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?', req.user.id, u.id) })) });
  }));
  app.post('/api/users/:id/follow', auth, wrap((req, res) => {
    const id = int(req.params.id, 'id');
    if (id === req.user.id) bad('Você não pode seguir a si mesmo');
    if (!get("SELECT 1 FROM users WHERE id = ? AND status='active'", id)) bad('Jogador não encontrado', 404);
    const had = get('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?', req.user.id, id);
    if (had) run('DELETE FROM follows WHERE follower_id=? AND followed_id=?', req.user.id, id);
    else { run('INSERT INTO follows (follower_id, followed_id) VALUES (?,?)', req.user.id, id); notifyK(id, 'Novo seguidor', `${req.user.name} começou a seguir você.`, 'follow', 'user:' + req.user.id); }
    res.json({ following: !had });
  }));
  app.get('/api/following', auth, (req, res) => {
    res.json({ following: all('SELECT u.id, u.name, u.avatar FROM follows f JOIN users u ON u.id = f.followed_id WHERE f.follower_id = ? ORDER BY u.name', req.user.id) });
  });

  /* ---------- feed, curtidas e comentários ---------- */
  const member = (spaceId, userId) => get("SELECT * FROM space_members WHERE space_id=? AND user_id=? AND status='active'", spaceId, userId);
  const spaceRow = id => get('SELECT * FROM spaces WHERE id = ?', id);
  // Espaço privado só aparece para quem participa (ou convidado/pendente) e para a administração.
  function seeSpace(s, user) {
    if (!s) return false;
    if (s.access !== 'private') return true;
    return !!user && (user.role === 'admin' || !!get('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?', s.id, user.id));
  }
  function loadSpace(id, user) { const s = spaceRow(id); if (!seeSpace(s, user)) bad('Não encontrado', 404); return s; }
  const isStaff = (s, user) => user.role === 'admin' || !!get("SELECT 1 FROM space_members WHERE space_id=? AND user_id=? AND status='active' AND role IN ('owner','admin')", s.id, user.id);

  app.get('/api/posts', softAuth, wrap((req, res) => {
    const me = req.user ? req.user.id : 0;
    const filter = ['foryou', 'following', 'games'].includes(req.query.filter) ? req.query.filter : 'foryou';
    const where = [], args = [];
    if (req.query.space) {
      const s = loadSpace(int(req.query.space, 'space'), req.user);
      where.push('p.space_id = ?'); args.push(s.id);
    } else {
      where.push('(p.space_id IS NULL OR p.space_id IN (SELECT space_id FROM space_members WHERE user_id = ? AND status = \'active\'))'); args.push(me);
    }
    if (filter === 'following') { where.push('(p.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?) OR p.user_id = ?)'); args.push(me, me); }
    if (filter === 'games') where.push('p.game_id IS NOT NULL');
    const rows = all(`SELECT p.id, p.text, p.created_at, p.game_id, p.space_id, p.user_id AS author_id, u.name AS author, u.avatar AS author_avatar,
      g.title AS game_title, sp.name AS space_name,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id = ${me}) AS liked,
      (SELECT COUNT(*) FROM comments k WHERE k.post_id = p.id) AS comments,
      (SELECT COUNT(*) FROM follows f WHERE f.follower_id = ${me} AND f.followed_id = p.user_id) AS following
      FROM posts p JOIN users u ON u.id = p.user_id
      LEFT JOIN games g ON g.id = p.game_id AND g.status = 'published' AND g.visibility != 'private'
      LEFT JOIN spaces sp ON sp.id = p.space_id
      WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 50`, ...args);
    res.json({ posts: rows.map(r => ({ ...r, liked: !!r.liked, following: !!r.following })) });
  }));
  app.post('/api/posts', auth, wrap((req, res) => {
    const text = str(req.body.text, 'Texto', 1, 500);
    let gameId = null;
    if (req.body.gameId) gameId = loadGame(int(req.body.gameId, 'gameId'), req.user).id;
    let spaceId = null;
    if (req.body.spaceId) {
      const s = loadSpace(int(req.body.spaceId, 'spaceId'), req.user);
      if (!member(s.id, req.user.id)) bad('Entre para publicar aqui', 403);
      spaceId = s.id;
    }
    const r = run('INSERT INTO posts (user_id, game_id, space_id, text) VALUES (?,?,?,?)', req.user.id, gameId, spaceId, text);
    mentions(text, req.user, 'post:' + r.lastInsertRowid, 'em uma publicação');
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  }));
  app.get('/api/posts/:id/comments', softAuth, wrap((req, res) => {
    const p = get('SELECT * FROM posts WHERE id = ?', int(req.params.id, 'id'));
    if (!p) bad('Post não encontrado', 404);
    if (p.space_id) loadSpace(p.space_id, req.user);
    res.json({ comments: all('SELECT k.id, k.text, k.created_at, k.user_id, u.name AS author, u.avatar AS author_avatar FROM comments k JOIN users u ON u.id = k.user_id WHERE k.post_id = ? ORDER BY k.id LIMIT 200', p.id) });
  }));
  app.post('/api/posts/:id/comments', auth, wrap((req, res) => {
    const p = get('SELECT * FROM posts WHERE id = ?', int(req.params.id, 'id'));
    if (!p) bad('Post não encontrado', 404);
    if (p.space_id) { loadSpace(p.space_id, req.user); if (!member(p.space_id, req.user.id)) bad('Entre para comentar', 403); }
    const text = str(req.body.text, 'Comentário', 1, 300);
    const r = run('INSERT INTO comments (post_id, user_id, text) VALUES (?,?,?)', p.id, req.user.id, text);
    if (p.user_id !== req.user.id) notifyK(p.user_id, 'Nova resposta', `${req.user.name} respondeu sua publicação.`, 'reply', 'post:' + p.id);
    mentions(text, req.user, 'post:' + p.id, 'em um comentário');
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  }));
  app.delete('/api/comments/:id', auth, wrap((req, res) => {
    const k = get('SELECT * FROM comments WHERE id = ?', int(req.params.id, 'id'));
    if (!k) bad('Comentário não encontrado', 404);
    if (k.user_id !== req.user.id && req.user.role !== 'admin') bad('Sem permissão', 403);
    run('DELETE FROM comments WHERE id = ?', k.id);
    res.json({ ok: true });
  }));

  /* ---------- amigos por nome ou ID, convite para jogo ---------- */
  app.post('/api/friends/request', auth, wrap((req, res) => {
    const t = findUser(req.body);
    if (!t) bad('Jogador não encontrado', 404);
    if (t.id === req.user.id) bad('Você não pode adicionar a si mesmo');
    const ex = get('SELECT * FROM friends WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)', req.user.id, t.id, t.id, req.user.id);
    if (ex) bad(ex.status === 'accepted' ? 'Vocês já são amigos' : 'Já existe um pedido pendente', 409);
    run('INSERT INTO friends (requester_id, addressee_id) VALUES (?,?)', req.user.id, t.id);
    notifyK(t.id, 'Pedido de amizade', `${req.user.name} quer ser seu amigo.`, 'friend', 'user:' + req.user.id);
    res.status(201).json({ ok: true });
  }));
  app.post('/api/friends/:id/invite-game', auth, wrap((req, res) => {
    const to = int(req.params.id, 'id');
    if (!areFriends(req.user.id, to)) bad('Só é possível convidar amigos', 403);
    const g = loadGame(int(req.body.gameId, 'gameId'), req.user);
    const r = run('INSERT INTO messages (from_id, to_id, text, game_id) VALUES (?,?,?,?)', req.user.id, to, 'Vamos jogar?', g.id);
    notifyK(to, 'Convite para jogar', `${req.user.name} convidou você para jogar ${g.title}.`, 'gameinvite', 'game:' + g.id);
    pushTo(to, { type: 'message', message: { ...dmRow(r.lastInsertRowid), from_name: req.user.name } });
    res.status(201).json({ ok: true });
  }));

  /* ---------- mensagens diretas ---------- */
  const dmRow = id => get('SELECT m.id, m.from_id, m.to_id, m.text, m.image, m.game_id, m.created_at, g.title AS game_title FROM messages m LEFT JOIN games g ON g.id = m.game_id WHERE m.id = ?', id);
  app.get('/api/messages/:userId', auth, wrap((req, res) => {
    const o = int(req.params.userId, 'userId');
    if (!areFriends(req.user.id, o)) bad('Só é possível conversar com amigos', 403);
    const rows = all(`SELECT m.id, m.from_id, m.to_id, m.text, m.image, m.game_id, m.created_at, g.title AS game_title FROM messages m LEFT JOIN games g ON g.id = m.game_id
      WHERE (m.from_id=? AND m.to_id=?) OR (m.from_id=? AND m.to_id=?) ORDER BY m.id DESC LIMIT 100`, req.user.id, o, o, req.user.id);
    run("UPDATE messages SET read_at = datetime('now') WHERE to_id = ? AND from_id = ? AND read_at IS NULL", req.user.id, o);
    res.json({ messages: rows.reverse() });
  }));
  app.post('/api/messages', auth, wrap((req, res) => {
    const to = int(req.body.to, 'to');
    if (!areFriends(req.user.id, to)) bad('Só é possível conversar com amigos', 403);
    const img = image(req.body.image);
    const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
    let gid = null;
    if (req.body.gameId) gid = loadGame(int(req.body.gameId, 'gameId'), req.user).id;
    if (!text && !img && !gid) bad('Escreva uma mensagem');
    const r = run('INSERT INTO messages (from_id, to_id, text, image, game_id) VALUES (?,?,?,?,?)', req.user.id, to, text, img, gid);
    const msg = dmRow(r.lastInsertRowid);
    pushTo(to, { type: 'message', message: { ...msg, from_name: req.user.name } });
    mentions(text, req.user, 'user:' + req.user.id, 'em uma conversa');
    res.status(201).json({ message: msg });
  }));

  /* ---------- lista de conversas (diretas + grupos + comunidades) ---------- */
  app.get('/api/conversations', auth, (req, res) => {
    const me = req.user.id, out = [];
    const friends = all(`SELECT u.id, u.name, u.avatar FROM friends f JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)`, me, me, me);
    for (const f of friends) {
      const last = get('SELECT id, from_id, text, image, game_id, created_at FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id DESC LIMIT 1', me, f.id, f.id, me);
      const unread = get('SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND from_id = ? AND read_at IS NULL', me, f.id).n;
      out.push({ type: 'direct', id: f.id, name: f.name, avatar: f.avatar, online: isOnline(f.id), unread, last: last ? preview(last) : '', at: last ? last.created_at : '', lastId: last ? last.id : 0 });
    }
    const spaces = all("SELECT s.id, s.kind, s.name, s.cover FROM spaces s JOIN space_members m ON m.space_id = s.id WHERE m.user_id = ? AND m.status = 'active'", me);
    for (const s of spaces) {
      const last = get('SELECT m.id, m.user_id, m.text, m.image, m.game_id, m.created_at, u.name AS author FROM room_msgs m JOIN users u ON u.id = m.user_id WHERE m.space_id = ? ORDER BY m.id DESC LIMIT 1', s.id);
      const rd = get('SELECT last_id FROM room_reads WHERE user_id = ? AND space_id = ?', me, s.id);
      const unread = get('SELECT COUNT(*) AS n FROM room_msgs WHERE space_id = ? AND id > ? AND user_id != ?', s.id, rd ? rd.last_id : 0, me).n;
      out.push({ type: s.kind, id: s.id, name: s.name, avatar: s.cover, unread, last: last ? (last.user_id === me ? 'Você: ' : last.author + ': ') + preview(last) : '', at: last ? last.created_at : '', lastId: last ? last.id : 0 });
    }
    out.sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.lastId - a.lastId);
    res.json({ conversations: out, unread: out.reduce((n, x) => n + x.unread, 0) });
  });
  function preview(m) { return m.text || (m.image ? 'Foto' : m.game_id ? 'Jogo compartilhado' : ''); }

  /* ---------- grupos e comunidades ---------- */
  const ACCESS = { group: ['public', 'private'], community: ['open', 'restricted'] };
  const spaceCols = `s.id, s.kind, s.name, s.description, s.cover, s.category, s.rules, s.access, s.owner_id, s.created_at,
    (SELECT COUNT(*) FROM space_members m WHERE m.space_id = s.id AND m.status = 'active') AS members`;
  const shapeSpace = (s, user) => {
    const m = user ? get('SELECT role, status FROM space_members WHERE space_id=? AND user_id=?', s.id, user.id) : null;
    return { ...s, my_status: m ? m.status : null, my_role: m ? m.role : null };
  };
  app.get('/api/spaces', softAuth, wrap((req, res) => {
    const kind = ['group', 'community'].includes(req.query.kind) ? req.query.kind : null;
    const me = req.user ? req.user.id : 0, q = String(req.query.q || '').trim();
    const where = ['(s.access != \'private\' OR EXISTS (SELECT 1 FROM space_members x WHERE x.space_id = s.id AND x.user_id = ?)' + (req.user && req.user.role === 'admin' ? ' OR 1' : '') + ')'], args = [me];
    if (kind) { where.push('s.kind = ?'); args.push(kind); }
    if (req.query.mine) where.push("EXISTS (SELECT 1 FROM space_members y WHERE y.space_id = s.id AND y.user_id = ? AND y.status = 'active')"), args.push(me);
    if (q) { where.push("s.name LIKE ? ESCAPE '\\'"); args.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%'); }
    const rows = all(`SELECT ${spaceCols} FROM spaces s WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 100`, ...args);
    res.json({ spaces: rows.map(s => shapeSpace(s, req.user)) });
  }));
  app.post('/api/spaces', auth, wrap((req, res) => {
    const b = req.body, kind = b.kind;
    if (!ACCESS[kind]) bad('Tipo inválido');
    const name = str(b.name, 'Nome', 3, 40);
    const description = typeof b.description === 'string' ? b.description.trim().slice(0, 300) : '';
    const rules = typeof b.rules === 'string' ? b.rules.trim().slice(0, 600) : '';
    const access = b.access === undefined ? ACCESS[kind][0] : b.access;
    if (!ACCESS[kind].includes(access)) bad('Acesso inválido');
    const category = kind === 'community' ? (typeof b.category === 'string' ? b.category.trim().slice(0, 30) : '') : '';
    const cover = image(b.cover);
    const r = run('INSERT INTO spaces (kind, name, description, cover, category, rules, access, owner_id) VALUES (?,?,?,?,?,?,?,?)', kind, name, description, cover, category, rules, access, req.user.id);
    const id = Number(r.lastInsertRowid);
    run("INSERT INTO space_members (space_id, user_id, role, status) VALUES (?,?,'owner','active')", id, req.user.id);
    const label = kind === 'group' ? 'grupo' : 'comunidade';
    for (const who of (Array.isArray(b.members) ? b.members : []).slice(0, 30)) {
      const u = findUser(typeof who === 'object' ? who : { name: String(who) });
      if (!u || u.id === req.user.id || get('SELECT 1 FROM space_members WHERE space_id=? AND user_id=?', id, u.id)) continue;
      run("INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,'invited')", id, u.id);
      notifyK(u.id, 'Convite', `${req.user.name} convidou você para o ${label} ${name}.`, 'invite', 'space:' + id);
    }
    res.status(201).json({ id });
  }));
  app.get('/api/spaces/:id', softAuth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    const full = get(`SELECT ${spaceCols} FROM spaces s WHERE s.id = ?`, s.id);
    const members = all(`SELECT u.id, u.name, u.avatar, m.role, m.status FROM space_members m JOIN users u ON u.id = m.user_id
      WHERE m.space_id = ? AND m.status IN ('active','pending') ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name LIMIT 200`, s.id)
      .map(m => ({ ...m, online: m.status === 'active' && isOnline(m.id) }));
    const mine = shapeSpace(full, req.user);
    const staff = !!req.user && isStaff(s, req.user);
    const events = all('SELECT e.id, e.title, e.description, e.starts_at, e.user_id, u.name AS author FROM space_events e JOIN users u ON u.id = e.user_id WHERE e.space_id = ? ORDER BY e.starts_at LIMIT 50', s.id);
    res.json({ space: { ...mine, staff }, members: members.filter(m => staff || m.status === 'active'), events });
  }));
  app.put('/api/spaces/:id', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (s.owner_id !== req.user.id && req.user.role !== 'admin') bad('Só o criador pode editar', 403);
    const b = req.body;
    const name = b.name === undefined ? s.name : str(b.name, 'Nome', 3, 40);
    const description = b.description === undefined ? s.description : String(b.description).trim().slice(0, 300);
    const rules = b.rules === undefined ? s.rules : String(b.rules).trim().slice(0, 600);
    const access = b.access === undefined ? s.access : b.access;
    if (!ACCESS[s.kind].includes(access)) bad('Acesso inválido');
    const category = b.category === undefined ? s.category : String(b.category).trim().slice(0, 30);
    const cover = 'cover' in b ? image(b.cover) : s.cover;
    run('UPDATE spaces SET name=?, description=?, rules=?, access=?, category=?, cover=? WHERE id=?', name, description, rules, access, category, cover, s.id);
    res.json({ ok: true });
  }));
  app.delete('/api/spaces/:id', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (s.owner_id !== req.user.id && req.user.role !== 'admin') bad('Só o criador pode excluir', 403);
    run('DELETE FROM spaces WHERE id = ?', s.id);
    res.json({ ok: true });
  }));
  app.post('/api/spaces/:id/join', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    const m = get('SELECT * FROM space_members WHERE space_id=? AND user_id=?', s.id, req.user.id);
    if (m && m.status === 'active') return res.json({ status: 'active' });
    if (m && m.status === 'invited') { run("UPDATE space_members SET status='active' WHERE space_id=? AND user_id=?", s.id, req.user.id); return res.json({ status: 'active' }); }
    if (m) return res.json({ status: 'pending' });
    const open = s.access === 'public' || s.access === 'open';
    if (!open) {
      run("INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,'pending')", s.id, req.user.id);
      notifyK(s.owner_id, 'Pedido para entrar', `${req.user.name} quer entrar em ${s.name}.`, 'joinreq', 'space:' + s.id);
      return res.status(202).json({ status: 'pending' });
    }
    run("INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,'active')", s.id, req.user.id);
    res.status(201).json({ status: 'active' });
  }));
  app.post('/api/spaces/:id/decline', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    run("DELETE FROM space_members WHERE space_id=? AND user_id=? AND status IN ('invited','pending')", s.id, req.user.id);
    res.json({ ok: true });
  }));
  app.post('/api/spaces/:id/leave', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (s.owner_id === req.user.id) bad('O criador não pode sair; exclua o espaço se quiser encerrá-lo');
    run('DELETE FROM space_members WHERE space_id=? AND user_id=?', s.id, req.user.id);
    res.json({ ok: true });
  }));
  app.post('/api/spaces/:id/invite', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (!member(s.id, req.user.id)) bad('Só participantes convidam', 403);
    if (s.access !== 'public' && s.access !== 'open' && !isStaff(s, req.user)) bad('Só os administradores convidam aqui', 403);
    const u = findUser(req.body);
    if (!u) bad('Jogador não encontrado', 404);
    const m = get('SELECT * FROM space_members WHERE space_id=? AND user_id=?', s.id, u.id);
    if (m && m.status === 'active') bad('Já participa', 409);
    if (m && m.status === 'pending') run("UPDATE space_members SET status='active' WHERE space_id=? AND user_id=?", s.id, u.id);
    else if (!m) run("INSERT INTO space_members (space_id, user_id, status) VALUES (?,?,'invited')", s.id, u.id);
    notifyK(u.id, 'Convite', `${req.user.name} convidou você para ${s.name}.`, 'invite', 'space:' + s.id);
    res.status(201).json({ ok: true });
  }));
  app.post('/api/spaces/:id/members/:uid/approve', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (!isStaff(s, req.user)) bad('Sem permissão', 403);
    const uid = int(req.params.uid, 'uid');
    const r = run("UPDATE space_members SET status='active' WHERE space_id=? AND user_id=? AND status='pending'", s.id, uid);
    if (!r.changes) bad('Pedido não encontrado', 404);
    notifyK(uid, 'Pedido aceito', `Você entrou em ${s.name}.`, 'invite', 'space:' + s.id);
    res.json({ ok: true });
  }));
  app.delete('/api/spaces/:id/members/:uid', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    const uid = int(req.params.uid, 'uid');
    if (uid === s.owner_id) bad('O criador não pode ser removido', 403);
    if (!isStaff(s, req.user)) bad('Sem permissão', 403);
    run('DELETE FROM space_members WHERE space_id=? AND user_id=?', s.id, uid);
    res.json({ ok: true });
  }));
  app.post('/api/spaces/:id/events', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (s.kind !== 'community') bad('Só comunidades têm eventos');
    if (!isStaff(s, req.user)) bad('Só administradores criam eventos', 403);
    const title = str(req.body.title, 'Título', 3, 60);
    const description = typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 200) : '';
    const at = String(req.body.startsAt || '');
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(at) || Number.isNaN(Date.parse(at))) bad('Data inválida');
    const r = run('INSERT INTO space_events (space_id, user_id, title, description, starts_at) VALUES (?,?,?,?,?)', s.id, req.user.id, title, description, at);
    for (const m of all("SELECT user_id FROM space_members WHERE space_id=? AND status='active' AND user_id != ?", s.id, req.user.id)) notifyK(m.user_id, 'Novo evento', `${title} em ${s.name}.`, 'event', 'space:' + s.id);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  }));
  app.delete('/api/spaces/:id/events/:eid', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (!isStaff(s, req.user)) bad('Sem permissão', 403);
    run('DELETE FROM space_events WHERE id=? AND space_id=?', int(req.params.eid, 'eid'), s.id);
    res.json({ ok: true });
  }));

  /* ---------- chat de grupo e de comunidade ---------- */
  const roomRow = id => get('SELECT m.id, m.space_id, m.user_id, m.text, m.image, m.game_id, m.created_at, u.name AS author, u.avatar AS author_avatar, g.title AS game_title FROM room_msgs m JOIN users u ON u.id = m.user_id LEFT JOIN games g ON g.id = m.game_id WHERE m.id = ?', id);
  app.get('/api/spaces/:id/messages', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (!member(s.id, req.user.id)) bad('Entre para ver o chat', 403);
    const rows = all(`SELECT m.id, m.space_id, m.user_id, m.text, m.image, m.game_id, m.created_at, u.name AS author, u.avatar AS author_avatar, g.title AS game_title
      FROM room_msgs m JOIN users u ON u.id = m.user_id LEFT JOIN games g ON g.id = m.game_id WHERE m.space_id = ? ORDER BY m.id DESC LIMIT 100`, s.id).reverse();
    const lastId = rows.length ? rows[rows.length - 1].id : 0;
    run('INSERT INTO room_reads (user_id, space_id, last_id) VALUES (?,?,?) ON CONFLICT(user_id, space_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)', req.user.id, s.id, lastId);
    res.json({ messages: rows });
  }));
  app.post('/api/spaces/:id/messages', auth, wrap((req, res) => {
    const s = loadSpace(int(req.params.id, 'id'), req.user);
    if (!member(s.id, req.user.id)) bad('Entre para conversar', 403);
    const img = image(req.body.image);
    const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
    let gid = null;
    if (req.body.gameId) gid = loadGame(int(req.body.gameId, 'gameId'), req.user).id;
    if (!text && !img && !gid) bad('Escreva uma mensagem');
    const r = run('INSERT INTO room_msgs (space_id, user_id, text, image, game_id) VALUES (?,?,?,?,?)', s.id, req.user.id, text, img, gid);
    const msg = roomRow(r.lastInsertRowid);
    run('INSERT INTO room_reads (user_id, space_id, last_id) VALUES (?,?,?) ON CONFLICT(user_id, space_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)', req.user.id, s.id, msg.id);
    for (const m of all("SELECT user_id FROM space_members WHERE space_id=? AND status='active' AND user_id != ?", s.id, req.user.id)) pushTo(m.user_id, { type: 'room', message: msg, space: { id: s.id, name: s.name, kind: s.kind } });
    mentions(text, req.user, 'space:' + s.id, 'em ' + s.name);
    res.status(201).json({ message: msg });
  }));

  /* ---------- notificações: validade de 24 h, avisos importantes e apagar ---------- */
  // Importantes (atualização, permissão, código, compra de passe/pacote/skin/premium) não expiram: só somem quando o jogador apaga.
  const IMPORTANT = ['update', 'perm', 'code', 'purchase', 'premium'];
  const impQ = IMPORTANT.map(() => '?').join(',');
  const purge = () => run(`DELETE FROM notifications WHERE kind NOT IN (${impQ}) AND created_at < datetime('now','-24 hours')`, ...IMPORTANT);
  purge(); setInterval(purge, 3600e3).unref();
  app.get('/api/notifications', auth, (req, res) => {
    purge();
    const rows = all(`SELECT id, title, body, kind, ref, created_at FROM notifications
      WHERE (user_id = ? OR user_id IS NULL) AND id NOT IN (SELECT notif_id FROM notif_dismissed WHERE user_id = ?) ORDER BY id DESC LIMIT 50`, req.user.id, req.user.id);
    res.json({ notifications: rows.map(n => ({ ...n, important: IMPORTANT.includes(n.kind) })) });
  });
  app.delete('/api/notifications/:id', auth, wrap((req, res) => {
    const n = get('SELECT id, user_id FROM notifications WHERE id = ?', int(req.params.id, 'id'));
    if (!n || (n.user_id !== null && n.user_id !== req.user.id)) bad('Notificação não encontrada', 404);
    if (n.user_id === null) run('INSERT OR IGNORE INTO notif_dismissed (user_id, notif_id) VALUES (?,?)', req.user.id, n.id);
    else run('DELETE FROM notifications WHERE id = ?', n.id);
    res.json({ ok: true });
  }));
}
