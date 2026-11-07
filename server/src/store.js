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
  const { app, auth, wrap, bad, get, all, run, logAct, adminOnly, int, loadGame, parseJ } = c;
  const notifyK = (userId, title, body, kind, ref = '') => run('INSERT INTO notifications (user_id, title, body, kind, ref) VALUES (?,?,?,?,?)', userId, title, body, kind, ref);
  const clog = (userId, delta, note, ref = null) => run('INSERT INTO coin_log (user_id, delta, note, ref) VALUES (?,?,?,?)', userId, delta, note, ref);
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
  app.get('/api/store', auth, (req, res) => res.json({ plans: PLANS, packs: PACKS, items: ITEMS, test: true, ...state(req.user) }));

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
    const plan = PLANS.find(p => p.id === id), pack = PACKS.find(p => p.id === id), item = ITEMS.find(p => p.id === id);
    if (plan) {
      const col = plan.kind === 'premium' ? 'premium_until' : 'studio_until';
      if (u[col] === FOREVER) bad('Você já tem este plano liberado sem prazo.', 409);
      const base = u[col] && u[col] > now() ? new Date(u[col]).getTime() : Date.now();
      run(`UPDATE users SET ${col} = ? WHERE id = ?`, new Date(base + plan.days * 86_400_000).toISOString(), u.id);
      notifyK(u.id, plan.kind === 'premium' ? 'Premium ativo' : 'Studio liberado', plan.kind === 'premium' ? `${plan.name} ativo. Aproveite o bônus diário e os itens exclusivos.` : `${plan.name} ativo. Você já pode publicar jogos.`, 'premium');
    } else if (pack) {
      const got = hasPremium(u) ? Math.floor(pack.coins * 1.1) : pack.coins;
      run('UPDATE users SET coins = coins + ? WHERE id = ?', got, u.id);
      clog(u.id, got, 'Pacote ' + pack.name + ' (teste)');
    } else if (item) {
      if (owned(u.id).includes(item.id)) bad('Você já tem este item', 409);
      if (item.premium && !hasPremium(u)) bad('Item exclusivo de quem tem o Premium', 403);
      if (u.coins < item.coins) bad('Moedas insuficientes', 402);
      run('UPDATE users SET coins = coins - ? WHERE id = ?', item.coins, u.id);
      clog(u.id, -item.coins, item.name);
      run('INSERT INTO user_items (user_id, item_id) VALUES (?,?)', u.id, item.id);
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
    run('INSERT OR IGNORE INTO library (user_id, game_id) VALUES (?,?)', u.id, g.id);
    notifyK(u.id, 'Compra confirmada', `${g.title} é seu para sempre.`, 'purchase', 'game:' + g.id);
    notifyK(g.owner_id, 'Você vendeu um jogo', `${u.name} comprou ${g.title}. Você recebeu ${cut} moedas.`, 'purchase', 'game:' + g.id);
    res.json(state(u));
  }));

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
