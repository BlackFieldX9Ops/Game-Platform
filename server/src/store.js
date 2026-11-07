// Loja: plano Studio, moedas e skins. Compras são de TESTE: ativam na hora, sem cobrança, até existir um meio de pagamento.
export const FOREVER = '9999-12-31T00:00:00.000Z';
export const hasStudio = u => !!u && (u.role === 'admin' || (!!u.studio_until && u.studio_until > new Date().toISOString()));
export const fmtUid = u => String(u.uid ?? 0).padStart(3, '0');

const PLANS = [
  { id: 'studio30', name: 'Studio 30 dias', days: 30, price: 1990, perks: ['Publicar jogos na Loja', 'Missões próprias por jogo', 'Painel de estatísticas', 'Modo avançado do Studio'] },
  { id: 'studio365', name: 'Studio 1 ano', days: 365, price: 17990, perks: ['Tudo do plano de 30 dias', 'Economia de cerca de 25%'] },
];
const PACKS = [
  { id: 'coins100', name: '100 moedas', coins: 100, price: 490 },
  { id: 'coins500', name: '500 moedas', coins: 500, price: 1990 },
  { id: 'coins1200', name: '1.200 moedas', coins: 1200, price: 3990 },
];
const ITEMS = [
  { id: 'fr_gold', slot: 'frame', name: 'Moldura dourada', coins: 150 },
  { id: 'fr_neon', slot: 'frame', name: 'Moldura neon', coins: 150 },
  { id: 'fr_fire', slot: 'frame', name: 'Moldura de fogo', coins: 250 },
  { id: 'bn_aurora', slot: 'banner', name: 'Fundo aurora', coins: 200 },
  { id: 'bn_sunset', slot: 'banner', name: 'Fundo pôr do sol', coins: 200 },
  { id: 'bn_space', slot: 'banner', name: 'Fundo espaço', coins: 300 },
];

export function mountStore(c) {
  const { app, auth, wrap, bad, get, all, run, notify, logAct, adminOnly, int } = c;
  const owned = id => all('SELECT item_id FROM user_items WHERE user_id = ?', id).map(r => r.item_id);
  const state = u => {
    const f = get('SELECT * FROM users WHERE id = ?', u.id);
    return { coins: f.coins, owned: owned(u.id), equipped: { frame: f.frame, banner: f.banner }, studio: { active: hasStudio(f), until: f.role === 'admin' ? null : (f.studio_until === FOREVER ? 'sempre' : f.studio_until) } };
  };

  app.get('/api/store', auth, (req, res) => res.json({ plans: PLANS, packs: PACKS, items: ITEMS, test: true, ...state(req.user) }));

  app.post('/api/store/buy', auth, wrap((req, res) => {
    const id = String(req.body.id || '');
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    const plan = PLANS.find(p => p.id === id), pack = PACKS.find(p => p.id === id), item = ITEMS.find(p => p.id === id);
    if (plan) {
      if (u.studio_until === FOREVER) bad('Você já tem o Studio liberado sem prazo.', 409);
      const base = u.studio_until && u.studio_until > new Date().toISOString() ? new Date(u.studio_until).getTime() : Date.now();
      run('UPDATE users SET studio_until = ? WHERE id = ?', new Date(base + plan.days * 86_400_000).toISOString(), u.id);
      notify(u.id, 'Studio liberado', `${plan.name} ativo. Você já pode publicar jogos.`);
      run("UPDATE notifications SET kind = 'premium' WHERE id = (SELECT MAX(id) FROM notifications WHERE user_id = ?)", u.id);
    } else if (pack) {
      run('UPDATE users SET coins = coins + ? WHERE id = ?', pack.coins, u.id);
    } else if (item) {
      if (owned(u.id).includes(item.id)) bad('Você já tem este item', 409);
      if (u.coins < item.coins) bad('Moedas insuficientes', 402);
      run('UPDATE users SET coins = coins - ? WHERE id = ?', item.coins, u.id);
      run('INSERT INTO user_items (user_id, item_id) VALUES (?,?)', u.id, item.id);
      run(`UPDATE users SET ${item.slot} = ? WHERE id = ?`, item.id, u.id);
    } else bad('Item não encontrado', 404);
    res.json(state(u));
  }));

  app.post('/api/store/equip', auth, wrap((req, res) => {
    const slot = req.body.slot;
    if (!['frame', 'banner'].includes(slot)) bad('Item inválido');
    const id = req.body.id ? String(req.body.id) : null;
    if (id) {
      const it = ITEMS.find(p => p.id === id);
      if (!it || it.slot !== slot || !owned(req.user.id).includes(id)) bad('Você não tem este item', 403);
    }
    run(`UPDATE users SET ${slot} = ? WHERE id = ?`, id, req.user.id);
    res.json(state(req.user));
  }));

  app.post('/api/admin/users/:id/studio', auth, adminOnly, wrap((req, res) => {
    const id = int(req.params.id, 'id');
    const t = get('SELECT * FROM users WHERE id = ?', id);
    if (!t) bad('Usuário não encontrado', 404);
    const on = !!req.body.on;
    run('UPDATE users SET studio_until = ? WHERE id = ?', on ? FOREVER : null, id);
    if (on) { notify(id, 'Studio liberado', 'A administração liberou o Studio para você. Já pode publicar jogos.'); run("UPDATE notifications SET kind = 'premium' WHERE id = (SELECT MAX(id) FROM notifications WHERE user_id = ?)", id); }
    logAct(req, on ? 'Studio liberado' : 'Studio removido', t.name);
    res.json({ ok: true });
  }));
}
