// Loja: planos (Studio e Premium), moedas, skins, bônus diário e compra de jogos pagos.
// Compras com dinheiro são de TESTE: ativam na hora, sem cobrança, até existir um meio de pagamento.
export const FOREVER = '9999-12-31T00:00:00.000Z';
const now = () => new Date().toISOString();
export const hasStudio = u => !!u && (u.role === 'admin' || (!!u.studio_until && u.studio_until > now()));
export const hasPremium = u => !!u && (!!u.premium_until && u.premium_until > now());
export const fmtUid = u => String(u.uid ?? 0).padStart(3, '0');

const PLANS = [
  { id: 'studio30', kind: 'studio', name: 'Studio 30 dias', days: 30, price: 1990, perks: ['Publicar jogos na Loja', 'Vender jogos por moedas e lançar em acesso antecipado', 'Missões próprias por jogo', 'Painel de estatísticas e modo avançado'] },
  { id: 'studio365', kind: 'studio', name: 'Studio 1 ano', days: 365, price: 17990, perks: ['Tudo do plano de 30 dias', 'Economia de cerca de 25%'] },
  { id: 'premium30', kind: 'premium', name: 'Premium 30 dias', days: 30, price: 990, perks: ['Selo Premium no perfil', 'Bônus diário de 30 moedas (em vez de 10)', '+10% de moedas em todos os pacotes', 'Itens exclusivos: moldura gema, fundo ouro, tema ouro, balão ouro, título Premium'] },
];
const PACKS = [
  { id: 'coins100', name: '100 moedas', coins: 100, price: 490 },
  { id: 'coins500', name: '500 moedas', coins: 500, price: 1990 },
  { id: 'coins1200', name: '1.200 moedas', coins: 1200, price: 3990 },
  { id: 'coins3000', name: '3.000 moedas', coins: 3000, price: 8990 },
];
const I = (id, slot, name, coins, premium = false) => ({ id, slot, name, coins, premium });
const ITEMS = [
  I('fr_gold', 'frame', 'Moldura dourada', 150), I('fr_neon', 'frame', 'Moldura neon', 150), I('fr_fire', 'frame', 'Moldura de fogo', 250),
  I('fr_ice', 'frame', 'Moldura de gelo', 200), I('fr_royal', 'frame', 'Moldura real', 300), I('fr_gem', 'frame', 'Moldura gema', 400, true),
  I('bn_aurora', 'banner', 'Fundo aurora', 200), I('bn_sunset', 'banner', 'Fundo pôr do sol', 200), I('bn_space', 'banner', 'Fundo espaço', 300),
  I('bn_forest', 'banner', 'Fundo floresta', 200), I('bn_candy', 'banner', 'Fundo doce', 250), I('bn_gold', 'banner', 'Fundo ouro', 400, true),
  I('ti_pioneer', 'title', 'Pioneiro', 100), I('ti_builder', 'title', 'Construtor', 150), I('ti_speed', 'title', 'Velocista', 150), I('ti_legend', 'title', 'Lenda', 300), I('ti_premium', 'title', 'Premium', 0, true),
  I('nc_gold', 'ncolor', 'Nome dourado', 120), I('nc_cyan', 'ncolor', 'Nome ciano', 120), I('nc_pink', 'ncolor', 'Nome rosa', 120), I('nc_green', 'ncolor', 'Nome verde', 120), I('nc_rainbow', 'ncolor', 'Nome arco-íris', 300),
  I('th_ocean', 'theme', 'Tema oceano', 250), I('th_forest', 'theme', 'Tema floresta', 250), I('th_rose', 'theme', 'Tema rosa', 250), I('th_sun', 'theme', 'Tema sol', 250), I('th_gold', 'theme', 'Tema ouro', 300, true),
  I('bb_cyan', 'bubble', 'Balão ciano', 100), I('bb_pink', 'bubble', 'Balão rosa', 100), I('bb_green', 'bubble', 'Balão verde', 100), I('bb_orange', 'bubble', 'Balão laranja', 100), I('bb_aurora', 'bubble', 'Balão aurora', 200), I('bb_gold', 'bubble', 'Balão ouro', 300, true),
];
export const SLOTS = ['frame', 'banner', 'title', 'ncolor', 'theme', 'bubble'];
export const itemName = id => (ITEMS.find(i => i.id === id) || {}).name || null;
export const GAME_SHARE = 0.7; // parte do preço que fica com o criador

export function mountStore(c) {
  const { app, auth, wrap, bad, get, all, run, logAct, adminOnly, int, loadGame, parseJ, confirmCheck, alertAdmins, staffCan } = c;
  const notifyK = (userId, title, body, kind, ref = '') => run('INSERT INTO notifications (user_id, title, body, kind, ref) VALUES (?,?,?,?,?)', userId, title, body, kind, ref);
  const clog = (userId, delta, note, ref = null) => run('INSERT INTO coin_log (user_id, delta, note, ref) VALUES (?,?,?,?)', userId, delta, note, ref);
  // Preços e textos editáveis pelo administrador ficam em settings('price_ov'); o resto vem dos padrões acima.
  const overrides = () => { const r = get("SELECT value FROM settings WHERE key = 'price_ov'"); return r ? parseJ(r.value, {}) : {}; };
  const saveOv = o => run("INSERT INTO settings (key, value) VALUES ('price_ov', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(o));
  const merged = (list, ov) => list.map(p => ({ ...p, ...(ov[p.id] || {}), base: p, edited: !!ov[p.id] }));
  const catalog = (all_ = false) => {
    const ov = overrides(), keep = x => all_ || x.active !== false;
    const strip = x => { if (all_) return x; const { base, edited, active, ...r } = x; return r; };
    return { plans: merged(PLANS, ov).filter(keep).map(strip), packs: merged(PACKS, ov).filter(keep).map(strip), items: merged(ITEMS, ov).filter(keep).map(strip) };
  };
  const sale = (userId, kind, ref, name, o = {}) => run('INSERT INTO sales (user_id, kind, ref, name, cents, coins, cut, owner_id, days, coupon) VALUES (?,?,?,?,?,?,?,?,?,?)', userId, kind, ref, name, o.cents || 0, o.coins || 0, o.cut || 0, o.owner || null, o.days || 0, o.coupon || null);
  const brl = c => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
  // Cupons: desconto em % no preço (planos e pacotes) ou bônus em % de moedas (pacotes). Um uso por jogador.
  const couponFor = (userId, codeIn, item, kind) => {
    const code = String(codeIn || '').trim(); if (!code) return null;
    const cp = get('SELECT * FROM coupons WHERE code = ?', code);
    if (!cp || !cp.active) bad('Cupom inválido', 400);
    if (cp.ends_at && cp.ends_at < new Date().toISOString().slice(0, 10)) bad('Este cupom venceu', 400);
    if (cp.max_uses && cp.used >= cp.max_uses) bad('Este cupom esgotou', 400);
    if (get('SELECT 1 FROM coupon_uses WHERE code = ? AND user_id = ?', cp.code, userId)) bad('Você já usou este cupom', 409);
    const okScope = cp.scope === 'all' || cp.scope === item.id || (cp.scope === 'plans' && kind === 'plan') || (cp.scope === 'packs' && kind === 'pack');
    if (!okScope) bad('Este cupom não vale para este item', 400);
    if (cp.kind === 'bonus' && kind !== 'pack') bad('Este cupom só vale para pacotes de moedas', 400);
    return cp;
  };
  const useCoupon = (userId, cp) => { run('INSERT INTO coupon_uses (code, user_id) VALUES (?,?)', cp.code, userId); run('UPDATE coupons SET used = used + 1 WHERE code = ?', cp.code); };
  const priceWith = (item, cp) => cp && cp.kind === 'percent' ? Math.max(0, Math.round(item.price * (100 - cp.value) / 100)) : item.price;
  const owned = id => all('SELECT item_id FROM user_items WHERE user_id = ?', id).map(r => r.item_id);
  const dailyReward = u => hasPremium(u) ? 30 : 10;
  const dailyWait = u => u.daily_at ? Math.max(0, new Date(u.daily_at).getTime() + 20 * 3600_000 - Date.now()) : 0;
  const state = u => {
    const f = get('SELECT * FROM users WHERE id = ?', u.id);
    const eq = {}; for (const s of SLOTS) eq[s] = f[s] || null;
    return {
      coins: f.coins, owned: owned(u.id), equipped: eq,
      studio: { active: hasStudio(f), until: f.role === 'admin' ? null : (f.studio_until === FOREVER ? 'sempre' : f.studio_until) },
      premium: { active: hasPremium(f), until: f.premium_until },
      daily: { reward: dailyReward(f), waitMs: dailyWait(f) },
    };
  };

  app.get('/api/store/log', auth, (req, res) => res.json({ log: all('SELECT id, delta, note, created_at FROM coin_log WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id) }));
  app.get('/api/store', auth, (req, res) => res.json({ ...catalog(), test: true, ...state(req.user) }));

  app.post('/api/store/coupon', auth, wrap((req, res) => {
    const cat = catalog(), id = String(req.body.id || ''), plan = cat.plans.find(p => p.id === id), pack = cat.packs.find(p => p.id === id), item = plan || pack;
    if (!item) bad('Item não encontrado', 404);
    const cp = couponFor(req.user.id, req.body.coupon, item, plan ? 'plan' : 'pack');
    if (!cp) bad('Digite o cupom', 400);
    res.json({ ok: true, code: cp.code, kind: cp.kind, value: cp.value, price: priceWith(item, cp), bonusCoins: cp.kind === 'bonus' ? Math.floor(item.coins * cp.value / 100) : 0 });
  }));
  app.post('/api/store/daily', auth, wrap((req, res) => {
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (dailyWait(u) > 0) bad('O bônus de hoje já foi coletado. Volte mais tarde.', 429);
    const r = dailyReward(u);
    run('UPDATE users SET coins = coins + ?, daily_at = ? WHERE id = ?', r, now(), u.id);
    clog(u.id, r, 'Bônus diário');
    res.json({ reward: r, ...state(u) });
  }));

  app.post('/api/store/buy', auth, wrap((req, res) => {
    const id = String(req.body.id || '');
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    const cat = catalog(), plan = cat.plans.find(p => p.id === id), pack = cat.packs.find(p => p.id === id), item = cat.items.find(p => p.id === id);
    if (!plan && !pack && !item && [...PLANS, ...PACKS, ...ITEMS].some(p => p.id === id)) bad('Este item não está à venda agora', 410);
    const cp = plan ? couponFor(u.id, req.body.coupon, plan, 'plan') : pack ? couponFor(u.id, req.body.coupon, pack, 'pack') : null;
    if (plan) {
      const col = plan.kind === 'premium' ? 'premium_until' : 'studio_until';
      if (u[col] === FOREVER) bad('Você já tem este plano liberado sem prazo.', 409);
      const base = u[col] && u[col] > now() ? new Date(u[col]).getTime() : Date.now();
      run(`UPDATE users SET ${col} = ? WHERE id = ?`, new Date(base + plan.days * 86_400_000).toISOString(), u.id);
      sale(u.id, plan.kind, plan.id, plan.name, { cents: priceWith(plan, cp), days: plan.days, coupon: cp ? cp.code : null }); if (cp) useCoupon(u.id, cp);
      notifyK(u.id, plan.kind === 'premium' ? 'Premium ativo' : 'Studio liberado', plan.kind === 'premium' ? `${plan.name} ativo. Aproveite o bônus diário e os itens exclusivos.` : `${plan.name} ativo. Você já pode publicar jogos.`, 'premium');
    } else if (pack) {
      const got = Math.floor((hasPremium(u) ? Math.floor(pack.coins * 1.1) : pack.coins) * (cp && cp.kind === 'bonus' ? 1 + cp.value / 100 : 1));
      run('UPDATE users SET coins = coins + ? WHERE id = ?', got, u.id);
      clog(u.id, got, 'Pacote ' + pack.name + ' (teste)');
      sale(u.id, 'coins', pack.id, pack.name, { cents: priceWith(pack, cp), coins: got, coupon: cp ? cp.code : null }); if (cp) useCoupon(u.id, cp);
    } else if (item) {
      if (owned(u.id).includes(item.id)) bad('Você já tem este item', 409);
      if (item.premium && !hasPremium(u)) bad('Item exclusivo de quem tem o Premium', 403);
      if (u.coins < item.coins) bad('Moedas insuficientes', 402);
      run('UPDATE users SET coins = coins - ? WHERE id = ?', item.coins, u.id);
      clog(u.id, -item.coins, item.name);
      run('INSERT INTO user_items (user_id, item_id) VALUES (?,?)', u.id, item.id);
      sale(u.id, 'item', item.id, item.name, { coins: item.coins });
      run(`UPDATE users SET ${item.slot} = ? WHERE id = ?`, item.id, u.id);
    } else bad('Item não encontrado', 404);
    res.json(state(u));
  }));

  app.post('/api/store/equip', auth, wrap((req, res) => {
    const slot = req.body.slot;
    if (!SLOTS.includes(slot)) bad('Item inválido');
    const id = req.body.id ? String(req.body.id) : null;
    if (id) {
      const it = ITEMS.find(p => p.id === id);
      if (!it || it.slot !== slot || !owned(req.user.id).includes(id)) bad('Você não tem este item', 403);
    }
    run(`UPDATE users SET ${slot} = ? WHERE id = ?`, id, req.user.id);
    res.json(state(req.user));
  }));

  // Compra de jogo pago (preço em moedas). O criador recebe 70%.
  app.post('/api/games/:id/buy', auth, wrap((req, res) => {
    const g = loadGame(int(req.params.id, 'id'), req.user);
    if (g.status !== 'published') bad('Jogo indisponível', 404);
    const price = Math.round(Number(parseJ(g.settings, {}).price)) || 0;
    if (price <= 0) bad('Este jogo é gratuito', 400);
    if (g.owner_id === req.user.id || req.user.role === 'admin') bad('Você já tem acesso a este jogo', 409);
    if (get('SELECT 1 FROM purchases WHERE user_id = ? AND game_id = ?', req.user.id, g.id)) bad('Você já comprou este jogo', 409);
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (u.coins < price) bad('Moedas insuficientes', 402);
    const cut = Math.floor(price * GAME_SHARE);
    run('UPDATE users SET coins = coins - ? WHERE id = ?', price, u.id);
    run('UPDATE users SET coins = coins + ? WHERE id = ?', cut, g.owner_id);
    clog(u.id, -price, 'Jogo: ' + g.title, 'buy:' + g.id);
    clog(g.owner_id, cut, 'Venda: ' + g.title, 'sale:' + g.id);
    run('INSERT INTO purchases (user_id, game_id) VALUES (?,?)', u.id, g.id);
    sale(u.id, 'game', String(g.id), g.title, { coins: price, cut, owner: g.owner_id });
    run('INSERT OR IGNORE INTO library (user_id, game_id) VALUES (?,?)', u.id, g.id);
    notifyK(u.id, 'Compra confirmada', `${g.title} é seu para sempre.`, 'purchase', 'game:' + g.id);
    notifyK(g.owner_id, 'Você vendeu um jogo', `${u.name} comprou ${g.title}. Você recebeu ${cut} moedas.`, 'purchase', 'game:' + g.id);
    res.json(state(u));
  }));

  // ---------- gestão de compras (só administrador: moderador não vê dinheiro) ----------
  const KIND = { studio: 'Plano Studio', premium: 'Premium', coins: 'Moedas', item: 'Skin', game: 'Jogo' };
  const sumOf = (where, ...p) => get(`SELECT COUNT(*) AS n, COALESCE(SUM(cents),0) AS cents, COALESCE(SUM(coins),0) AS coins FROM sales WHERE refunded_at IS NULL ${where}`, ...p);

  app.get('/api/admin/commerce', auth, staffCan('finance'), (req, res) => {
    const kinds = all("SELECT kind, COUNT(*) AS n, COALESCE(SUM(cents),0) AS cents, COALESCE(SUM(coins),0) AS coins FROM sales WHERE refunded_at IS NULL GROUP BY kind");
    const top = all("SELECT name, kind, COUNT(*) AS n, COALESCE(SUM(cents),0) AS cents, COALESCE(SUM(coins),0) AS coins FROM sales WHERE refunded_at IS NULL GROUP BY kind, ref ORDER BY n DESC LIMIT 6");
    res.json({
      test: true, today: sumOf("AND created_at >= datetime('now','start of day')"), d7: sumOf("AND created_at >= datetime('now','-7 days')"), d30: sumOf("AND created_at >= datetime('now','-30 days')"), all: sumOf(''),
      refunds: get('SELECT COUNT(*) AS n FROM sales WHERE refunded_at IS NOT NULL').n, kinds, top,
      catalog: catalog(true),
      coinsInCirculation: get('SELECT COALESCE(SUM(coins),0) AS n FROM users').n,
      activePlans: { studio: get("SELECT COUNT(*) AS n FROM users WHERE studio_until > ? AND role <> 'admin'", now()).n, premium: get("SELECT COUNT(*) AS n FROM users WHERE premium_until > ?", now()).n },
    });
  });

  app.get('/api/admin/sales', auth, staffCan('finance'), wrap((req, res) => {
    const w = [], p = [], q = req.query;
    if (KIND[q.kind]) { w.push('s.kind = ?'); p.push(q.kind); }
    if (q.user) { w.push('s.user_id = ?'); p.push(int(q.user, 'user')); }
    if (q.q) { const like = '%' + String(q.q).trim().slice(0, 60).toLowerCase().replace(/[%_\\]/g, m => '\\' + m) + '%'; w.push("(LOWER(s.name) LIKE ? ESCAPE '\\' OR LOWER(u.name) LIKE ? ESCAPE '\\')"); p.push(like, like); }
    if (Number(q.before)) { w.push('s.id < ?'); p.push(Number(q.before)); }
    const rows = all(`SELECT s.id, s.user_id, u.name AS buyer, s.kind, s.ref, s.name, s.cents, s.coins, s.cut, s.days, s.coupon, s.refunded_at, s.created_at FROM sales s JOIN users u ON u.id = s.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY s.id DESC LIMIT 81`, ...p);
    res.json({ sales: rows.slice(0, 80).map(r => ({ ...r, kindName: KIND[r.kind] || r.kind })), more: rows.length > 80 });
  }));

  const reasonOf = (b, min = 5) => { const r = typeof b.reason === 'string' ? b.reason.trim().slice(0, 140) : ''; if (r.length < min) bad(`Escreva o motivo (mínimo ${min} letras)`); return r; };

  app.post('/api/admin/prices', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const b = req.body, id = String(b.id || ''), base = [...PLANS, ...PACKS, ...ITEMS].find(p => p.id === id);
    if (!base) bad('Item não encontrado', 404);
    const isItem = ITEMS.includes(base), field = isItem ? 'coins' : 'price';
    const ov = overrides(), cur = { ...base, ...(ov[id] || {}) }, next = { ...(ov[id] || {}) }, notes = [];
    if (b[field] !== undefined) {
      const v = Number(b[field]);
      if (!Number.isInteger(v) || v < 0 || v > (isItem ? 100000 : 10_000_000)) bad(isItem ? 'Preço em moedas inválido (0 a 100000)' : 'Preço inválido (centavos, até 100000,00)');
      if (v !== cur[field]) { notes.push(isItem ? `${cur.coins} → ${v} moedas` : `${brl(cur.price)} → ${brl(v)}`); next[field] = v; }
    }
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 40); if (n.length < 2) bad('Nome muito curto'); if (n !== cur.name) { notes.push(`nome "${cur.name}" → "${n}"`); next.name = n; } }
    if (b.perks !== undefined) {
      if (!Array.isArray(b.perks) || b.perks.length > 8) bad('Vantagens inválidas (até 8)');
      const pk = b.perks.map(x => String(x).trim().slice(0, 110)).filter(Boolean);
      if (!base.perks) bad('Este item não tem lista de vantagens');
      if (JSON.stringify(pk) !== JSON.stringify(cur.perks)) { notes.push('vantagens editadas'); next.perks = pk; }
    }
    if (b.active !== undefined) { const a = !!b.active; if (a !== (cur.active !== false)) { notes.push(a ? 'voltou a ser vendido' : 'tirado da venda'); next.active = a; } }
    if (!notes.length) return res.json({ ok: true, unchanged: true, catalog: catalog(true) });
    ov[id] = next; saveOv(ov);
    logAct(req, 'Loja: item alterado', `${base.name} · ${notes.join(' · ')}`);
    res.json({ ok: true, catalog: catalog(true) });
  }));

  app.post('/api/admin/prices/reset', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const id = String(req.body.id || ''), base = [...PLANS, ...PACKS, ...ITEMS].find(p => p.id === id);
    if (!base) bad('Item não encontrado', 404);
    const ov = overrides(); delete ov[id]; saveOv(ov);
    logAct(req, 'Loja: item restaurado ao padrão', base.name);
    res.json({ ok: true, catalog: catalog(true) });
  }));

  app.post('/api/admin/users/:id/coins', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const id = int(req.params.id, 'id'), t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    const delta = Number(req.body.delta), reason = reasonOf(req.body);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) bad('Valor inválido (1 a 100000, positivo ou negativo)');
    if (t.coins + delta < 0) bad('O saldo não pode ficar negativo (saldo atual: ' + t.coins + ')');
    run('UPDATE users SET coins = coins + ? WHERE id = ?', delta, id);
    clog(id, delta, 'Ajuste da administração: ' + reason, 'adj');
    notifyK(id, delta > 0 ? 'Moedas recebidas' : 'Ajuste de moedas', `${delta > 0 ? '+' : ''}${delta} moedas. ${reason}`, 'purchase');
    logAct(req, 'Moedas ajustadas', `${t.name} · ${delta > 0 ? '+' : ''}${delta} · ${reason}`, id);
    res.json({ ok: true, coins: t.coins + delta });
  }));

  app.post('/api/admin/users/:id/plan', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const id = int(req.params.id, 'id'), t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    const kind = req.body.kind, days = Number(req.body.days), reason = reasonOf(req.body);
    if (!['studio', 'premium'].includes(kind)) bad('Plano inválido');
    if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 3650) bad('Dias inválidos (1 a 3650, positivo ou negativo)');
    const col = kind === 'studio' ? 'studio_until' : 'premium_until';
    if (t[col] === FOREVER) bad('Este plano está liberado sem prazo. Use "Remover Studio" para tirar.', 409);
    const base = t[col] && t[col] > now() ? new Date(t[col]).getTime() : Date.now(), end = base + days * 86_400_000;
    run(`UPDATE users SET ${col} = ? WHERE id = ?`, end > Date.now() ? new Date(end).toISOString() : null, id);
    notifyK(id, days > 0 ? (kind === 'studio' ? 'Studio liberado' : 'Premium ativo') : 'Plano ajustado', `${days > 0 ? '+' : ''}${days} dias de ${kind === 'studio' ? 'Studio' : 'Premium'}. ${reason}`, 'premium');
    logAct(req, 'Plano ajustado', `${t.name} · ${kind} ${days > 0 ? '+' : ''}${days} dias · ${reason}`, id);
    res.json({ ok: true });
  }));

  app.post('/api/admin/sales/:id/refund', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const s = get('SELECT * FROM sales WHERE id = ?', int(req.params.id, 'id'));
    if (!s) bad('Compra não encontrada', 404);
    if (s.refunded_at) bad('Esta compra já foi estornada', 409);
    const reason = reasonOf(req.body), u = get('SELECT * FROM users WHERE id = ?', s.user_id);
    if (!u) bad('Usuário não encontrado', 404);
    if (s.kind === 'coins') {
      if (u.coins < s.coins) bad(`O jogador já gastou parte destas moedas (saldo ${u.coins}, pacote ${s.coins}). Ajuste as moedas manualmente.`, 409);
      run('UPDATE users SET coins = coins - ? WHERE id = ?', s.coins, u.id); clog(u.id, -s.coins, 'Estorno: ' + s.name, 'refund:' + s.id);
    } else if (s.kind === 'studio' || s.kind === 'premium') {
      const col = s.kind === 'studio' ? 'studio_until' : 'premium_until';
      if (u[col] && u[col] !== FOREVER) { const end = new Date(u[col]).getTime() - s.days * 86_400_000; run(`UPDATE users SET ${col} = ? WHERE id = ?`, end > Date.now() ? new Date(end).toISOString() : null, u.id); }
    } else if (s.kind === 'item') {
      run('UPDATE users SET coins = coins + ? WHERE id = ?', s.coins, u.id); clog(u.id, s.coins, 'Estorno: ' + s.name, 'refund:' + s.id);
      run('DELETE FROM user_items WHERE user_id = ? AND item_id = ?', u.id, s.ref);
      const it = ITEMS.find(i => i.id === s.ref); if (it) run(`UPDATE users SET ${it.slot} = NULL WHERE id = ? AND ${it.slot} = ?`, u.id, it.id);
    } else if (s.kind === 'game') {
      run('UPDATE users SET coins = coins + ? WHERE id = ?', s.coins, u.id); clog(u.id, s.coins, 'Estorno: ' + s.name, 'refund:' + s.id);
      if (s.owner_id && s.cut) { const o = get('SELECT coins FROM users WHERE id = ?', s.owner_id); if (o) { const take = Math.min(o.coins, s.cut); run('UPDATE users SET coins = coins - ? WHERE id = ?', take, s.owner_id); clog(s.owner_id, -take, 'Estorno de venda: ' + s.name, 'refund:' + s.id); } }
      run('DELETE FROM purchases WHERE user_id = ? AND game_id = ?', u.id, Number(s.ref));
      run('DELETE FROM library WHERE user_id = ? AND game_id = ?', u.id, Number(s.ref));
    }
    run("UPDATE sales SET refunded_at = datetime('now') WHERE id = ?", s.id);
    notifyK(u.id, 'Compra estornada', `${s.name}: ${reason}`, 'purchase');
    logAct(req, 'Compra estornada', `${u.name} · ${s.name}${s.cents ? ' · ' + brl(s.cents) : s.coins ? ' · ' + s.coins + ' moedas' : ''} · ${reason}`, u.id);
    res.json({ ok: true });
  }));

  // ---------- cupons, ganhos dos criadores e exportação ----------
  app.get('/api/admin/coupons', auth, adminOnly, (_req, res) => res.json({ coupons: all('SELECT code, kind, value, scope, max_uses, used, ends_at, active, created_at FROM coupons ORDER BY created_at DESC').map(c => ({ ...c, active: !!c.active })) }));
  app.post('/api/admin/coupons', auth, adminOnly, wrap((req, res) => {
    const b = req.body, code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) bad('Código de 3 a 20 letras, números, - ou _');
    const kind = b.kind === 'bonus' ? 'bonus' : 'percent', value = Number(b.value);
    if (!Number.isInteger(value) || value < 1 || value > (kind === 'percent' ? 90 : 100)) bad(kind === 'percent' ? 'Desconto de 1 a 90%' : 'Bônus de 1 a 100%');
    const scope = String(b.scope || 'all'), valid = ['all', 'plans', 'packs', ...PLANS.map(p => p.id), ...PACKS.map(p => p.id)];
    if (!valid.includes(scope)) bad('Alcance inválido');
    if (kind === 'bonus' && !(scope === 'all' || scope === 'packs' || PACKS.some(p => p.id === scope))) bad('Bônus só vale para pacotes de moedas');
    const max = Math.max(0, Math.min(100000, Number(b.max_uses) || 0)), ends = /^\d{4}-\d{2}-\d{2}$/.test(String(b.ends_at || '')) ? b.ends_at : null;
    if (get('SELECT 1 FROM coupons WHERE code = ?', code)) bad('Já existe um cupom com este código', 409);
    run('INSERT INTO coupons (code, kind, value, scope, max_uses, ends_at) VALUES (?,?,?,?,?,?)', code, kind, value, scope, max, ends);
    logAct(req, 'Cupom criado', `${code} · ${kind === 'percent' ? value + '% de desconto' : '+' + value + '% de moedas'} · ${scope}${max ? ' · ' + max + ' usos' : ''}${ends ? ' · até ' + ends : ''}`);
    res.json({ ok: true });
  }));
  app.post('/api/admin/coupons/:code/toggle', auth, adminOnly, wrap((req, res) => {
    const cp = get('SELECT * FROM coupons WHERE code = ?', String(req.params.code));
    if (!cp) bad('Cupom não encontrado', 404);
    run('UPDATE coupons SET active = ? WHERE code = ?', cp.active ? 0 : 1, cp.code);
    logAct(req, cp.active ? 'Cupom desativado' : 'Cupom reativado', cp.code);
    res.json({ ok: true, active: !cp.active });
  }));
  app.get('/api/admin/creators', auth, staffCan('finance'), (_req, res) => {
    res.json({ creators: all(`SELECT u.id, u.name, COUNT(*) AS sales, COUNT(DISTINCT s.user_id) AS buyers, COALESCE(SUM(s.cut),0) AS earned, MAX(s.created_at) AS last_at,
      (SELECT COUNT(*) FROM games g WHERE g.owner_id = u.id AND g.status = 'published') AS games
      FROM sales s JOIN users u ON u.id = s.owner_id WHERE s.kind = 'game' AND s.refunded_at IS NULL GROUP BY u.id ORDER BY earned DESC LIMIT 100`) });
  });
  const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  app.get('/api/admin/sales.csv', auth, staffCan('finance'), (_req, res) => {
    const rows = all('SELECT s.id, s.created_at, u.name AS buyer, s.kind, s.name, s.cents, s.coins, s.coupon, s.refunded_at FROM sales s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 5000');
    const body = ['id,quando,comprador,tipo,item,valor_reais,moedas,cupom,estornada_em', ...rows.map(r => [r.id, r.created_at, r.buyer, r.kind, r.name, (r.cents / 100).toFixed(2), r.coins, r.coupon || '', r.refunded_at || ''].map(csvCell).join(','))].join('\r\n');
    res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="vendas.csv"' }).send('﻿' + body);
  });

  app.post('/api/admin/users/:id/studio', auth, adminOnly, wrap((req, res) => {
    const id = int(req.params.id, 'id');
    const t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    const on = !!req.body.on;
    run('UPDATE users SET studio_until = ? WHERE id = ?', on ? FOREVER : null, id);
    if (on) notifyK(id, 'Studio liberado', 'A administração liberou o Studio para você. Já pode publicar jogos.', 'premium');
    logAct(req, on ? 'Studio liberado' : 'Studio removido', t.name);
    res.json({ ok: true });
  }));
}
