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
let skinFn = () => [];
export const itemName = id => (ITEMS.find(i => i.id === id) || skinFn().find(i => i.id === id) || {}).name || null;
// Itens criados pelo administrador (tabela store_items): ids "c" + número.
export const SKIN_SLOTS = ['frame', 'banner', 'title', 'ncolor', 'theme', 'bubble'];
export const SKIN_FONTS = { padrao: '', gotica: "'Palatino Linotype','Book Antiqua',Georgia,serif", fantasia: "fantasy,Impact,'Arial Black',sans-serif", cursiva: "'Segoe Script','Brush Script MT','Comic Sans MS',cursive", maquina: "ui-monospace,'Courier New',monospace", redonda: "'Trebuchet MS','Arial Rounded MT Bold',system-ui,sans-serif", grossa: "Impact,'Arial Black',sans-serif" };
const HEX = /^#[0-9a-fA-F]{6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dataOk = (d, max) => typeof d === 'string' && d.length <= max;
const IMG_RE = /^data:(image\/(?:png|webp|gif|jpeg));base64,([A-Za-z0-9+/=]+)$/;
const FONT_RE = /^data:(font\/(?:woff2|woff|ttf|otf));base64,([A-Za-z0-9+/=]+)$/;
const fontMagic = b => { const m = b.subarray(0, 4).toString('latin1'); return m === 'wOF2' ? 'font/woff2' : m === 'wOFF' ? 'font/woff' : m === 'OTTO' ? 'font/otf' : (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || m === 'true' ? 'font/ttf' : null; };
const imgMagic = b => { const h = b.subarray(0, 12); const s4 = h.toString('latin1', 0, 4); if (h[0] === 0x89 && s4.slice(1) === 'PNG') return 'image/png'; if (s4 === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'; if (s4 === 'GIF8') return 'image/gif'; if (h[0] === 0xff && h[1] === 0xd8) return 'image/jpeg'; return null; };
// texturas do tema do app: cada uma é uma imagem (pode ser animada) em um lugar do app
export const TEX_KEYS = ['splash', 'hero', 'tile1', 'tile2', 'tile3', 'tile4', 'card', 'icon', 'corner_l', 'corner_r', 'nav'];
export { IMG_RE, FONT_RE, HEX, DAY, dataOk, fontMagic, imgMagic };
export const GAME_SHARE = 0.7; // parte do preço que fica com o criador

export function mountStore(c) {
  const { app, auth, wrap, bad, get, all, run, logAct, adminOnly, int, loadGame, parseJ, confirmCheck, alertAdmins, staffCan } = c;
  const notifyK = (userId, title, body, kind, ref = '') => run('INSERT INTO notifications (user_id, title, body, kind, ref) VALUES (?,?,?,?,?)', userId, title, body, kind, ref);
  const clog = (userId, delta, note, ref = null) => run('INSERT INTO coin_log (user_id, delta, note, ref) VALUES (?,?,?,?)', userId, delta, note, ref);
  // Preços e textos editáveis pelo administrador ficam em settings('price_ov'); o resto vem dos padrões acima.
  const overrides = () => { const r = get("SELECT value FROM settings WHERE key = 'price_ov'"); return r ? parseJ(r.value, {}) : {}; };
  const saveOv = o => run("INSERT INTO settings (key, value) VALUES ('price_ov', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(o));
  const customPacks = () => { const r = get("SELECT value FROM settings WHERE key = 'custom_packs'"); const l = r ? parseJ(r.value, []) : []; return Array.isArray(l) ? l : []; };
  const saveCustomPacks = l => run("INSERT INTO settings (key, value) VALUES ('custom_packs', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(l));
  const allPacks = () => [...PACKS, ...customPacks()];
  const merged = (list, ov) => list.map(p => ({ ...p, ...(ov[p.id] || {}), base: p, edited: !!ov[p.id] }));
  // ---- itens criados pelo administrador ----
  const today = () => new Date().toISOString().slice(0, 10);
  const inWindow = i => (!i.starts_at || i.starts_at <= today()) && (!i.ends_at || i.ends_at >= today());
  const texMap = () => { const m = {}; for (const t of all('SELECT item_id, key FROM store_item_tex')) (m[t.item_id] ||= []).push(t.key); return m; };
  const rowToSkin = r => ({ id: 'c' + r.id, n: r.id, slot: r.slot, name: r.name, coins: r.coins, premium: !!r.premium, active: !!r.active, tag: r.tag || '', starts_at: r.starts_at || null, ends_at: r.ends_at || null, data: parseJ(r.data, {}), ver: r.ver, hasImg: !!r.hasImg, hasFont: !!r.hasFont, tex: r.tex || all('SELECT key FROM store_item_tex WHERE item_id = ?', r.id).map(t => t.key), custom: true });
  let skinCache = null;
  const skinItems = () => skinCache || (skinCache = (() => { const tm = texMap(); return all('SELECT id, slot, name, coins, premium, active, tag, starts_at, ends_at, data, ver, (img IS NOT NULL) AS hasImg, (font IS NOT NULL) AS hasFont FROM store_items ORDER BY id').map(r => rowToSkin({ ...r, tex: tm[r.id] })); })());
  const skinDirty = () => { skinCache = null; };
  skinFn = () => skinItems();
  const pubSkin = i => { const { n, active, ...r } = i; return r; };
  const allItems = () => [...ITEMS, ...skinItems()];
  const skinDefs = () => skinItems().map(pubSkin);
  const catalog = (all_ = false) => {
    const ov = overrides(), keep = x => all_ || x.active !== false;
    const strip = x => { if (all_) return x; const { base, edited, active, ...r } = x; return r; };
    return { plans: merged(PLANS, ov).filter(keep).map(strip), packs: merged(allPacks(), ov).filter(keep).map(strip), items: [...merged(ITEMS, ov).filter(keep).map(strip), ...skinItems().filter(i => all_ || (i.active && inWindow(i))).map(i => all_ ? i : pubSkin(i))] };
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
  const dailyReward = u => hasPremium(u) ? c.cfg.val('dailyCoinsPremium') : c.cfg.val('dailyCoins');
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


  /* ---------- pagamentos: InfinitePay (link de pagamento), Pix manual ou teste ---------- */
  const PAY_DEF = { mode: 'test', handle: '', apiKey: '', pixKey: '', pixName: '', pixCity: '', note: '', minCents: 100 };
  const payCfg = () => { const r = get("SELECT value FROM settings WHERE key = 'pay_cfg'"); return { ...PAY_DEF, ...(r ? parseJ(r.value, {}) : {}) }; };
  const savePay = o => run("INSERT INTO settings (key, value) VALUES ('pay_cfg', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(o));
  const API = () => (process.env.INFINITEPAY_API || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '');
  const PUB = () => (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const payPublic = cfg => ({ mode: cfg.mode, handle: cfg.handle, hasKey: !!cfg.apiKey, pixKey: cfg.pixKey, pixName: cfg.pixName, pixCity: cfg.pixCity, note: cfg.note, minCents: cfg.minCents, webhook: PUB() ? PUB() + '/api/pay/webhook' : '', publicUrl: PUB() });
  const ipFetch = async (path, body, cfg) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(API() + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) }, body: JSON.stringify(body), signal: ctl.signal });
      const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { }
      return { status: r.status, json: j, text: txt.slice(0, 300) };
    } finally { clearTimeout(t); }
  };
  const findUrl = j => {
    if (!j || typeof j !== 'object') return '';
    for (const k of ['url', 'link', 'checkout_url', 'payment_url', 'invoice_url', 'checkoutUrl', 'paymentUrl']) if (typeof j[k] === 'string' && /^https:\/\//.test(j[k])) return j[k];
    for (const v of Object.values(j)) { if (typeof v === 'string' && /^https:\/\//.test(v)) return v; if (v && typeof v === 'object') { const x = findUrl(v); if (x) return x; } }
    return '';
  };
  const createLink = async (cfg, o) => {
    if (!cfg.handle) bad('Falta o InfiniteTag nas configurações de pagamento', 409);
    const body = { handle: cfg.handle, items: [{ quantity: 1, price: o.cents, description: o.name }], order_nsu: o.nsu };
    if (PUB()) { body.redirect_url = PUB() + '/?paid=' + o.nsu; body.webhook_url = PUB() + '/api/pay/webhook'; body.webhook = { url: PUB() + '/api/pay/webhook', events: ['paid'] }; }
    const r = await ipFetch('/links', body, cfg);
    const url = findUrl(r.json);
    if (r.status >= 300 || !url) { console.error('InfinitePay /links', r.status, r.text); bad('A InfinitePay não devolveu o link de pagamento (' + r.status + '). Confira o InfiniteTag.', 502); }
    return url;
  };
  const orderOut = o => ({ nsu: o.nsu, name: o.name, cents: o.cents, coins: o.coins, status: o.status, method: o.method, link: o.link || '', created_at: o.created_at, paid_at: o.paid_at || null });
  // Entrega o pedido uma única vez (a troca de status é o que impede entrega dupla).
  const fulfill = (nsu, via, extra = {}) => {
    const o = get('SELECT * FROM orders WHERE nsu = ?', nsu);
    if (!o) return { ok: false, code: 404 };
    if (o.status === 'paid') return { ok: true, already: true, order: o };
    if (o.status !== 'pending') return { ok: false, code: 409, order: o };
    const r = run("UPDATE orders SET status = 'paid', paid_at = ?, tx_nsu = COALESCE(?, tx_nsu), slug = COALESCE(?, slug), receipt = COALESCE(?, receipt), paid_cents = COALESCE(?, paid_cents), note = ? WHERE nsu = ? AND status = 'pending'", now(), extra.tx || null, extra.slug || null, extra.receipt || null, extra.paid || null, via, nsu);
    if (!r.changes) return { ok: true, already: true, order: get('SELECT * FROM orders WHERE nsu = ?', nsu) };
    const u = get('SELECT * FROM users WHERE id = ?', o.user_id);
    const cat = catalog(true), plan = cat.plans.find(p => p.id === o.item_id), pack = cat.packs.find(p => p.id === o.item_id);
    const cp = o.coupon ? get('SELECT * FROM coupons WHERE code = ?', o.coupon) : null;
    const item = plan || pack;
    if (!u || !item) return { ok: false, code: 410, order: o };
    grant(u, plan, pack, cp && cp.active ? cp : null, o.cents, true);
    return { ok: true, order: get('SELECT * FROM orders WHERE nsu = ?', nsu) };
  };
  const checkPaid = async (o, tx, slug) => {
    const cfg = payCfg();
    const r = await ipFetch('/payment_check', { handle: cfg.handle, order_nsu: o.nsu, transaction_nsu: tx, slug }, cfg);
    const j = r.json || {};
    return j.success === true && j.paid === true && Number(j.amount) === o.cents ? { ok: true, paid: Number(j.paid_amount) || o.cents, method: j.capture_method || '' } : { ok: false };
  };

  app.get('/api/admin/pay', auth, adminOnly, (_req, res) => res.json({ cfg: payPublic(payCfg()) }));
  app.post('/api/admin/pay', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const b = req.body || {}, cur = payCfg(), next = { ...cur }, notes = [];
    if (b.mode !== undefined) { if (!['test', 'infinitepay', 'pix'].includes(b.mode)) bad('Modo inválido'); if (b.mode !== cur.mode) { notes.push(`modo ${cur.mode} → ${b.mode}`); next.mode = b.mode; } }
    if (b.handle !== undefined) { const h = String(b.handle).trim().replace(/^\$/, '').slice(0, 40); if (h && !/^[A-Za-z0-9._-]{2,40}$/.test(h)) bad('InfiniteTag inválido (letras, números, ponto, - ou _; sem o $)'); if (h !== cur.handle) { notes.push('InfiniteTag alterado'); next.handle = h; } }
    if (b.apiKey !== undefined && String(b.apiKey).trim() !== '') { const k = String(b.apiKey).trim(); if (!/^inchk_[A-Za-z0-9_-]{8,200}$/.test(k)) bad('A chave de API da InfinitePay começa com inchk_'); next.apiKey = k; notes.push('chave de API alterada'); }
    if (b.clearKey) { next.apiKey = ''; notes.push('chave de API removida'); }
    for (const [f, max, nm] of [['pixKey', 80, 'chave Pix'], ['pixName', 40, 'nome do recebedor'], ['pixCity', 30, 'cidade'], ['note', 200, 'aviso de pagamento']]) {
      if (b[f] !== undefined) { const v = String(b[f]).trim().slice(0, max); if (v !== cur[f]) { notes.push(nm + ' alterado(a)'); next[f] = v; } }
    }
    if (b.minCents !== undefined) { const v = Math.round(Number(b.minCents)); if (!Number.isInteger(v) || v < 100 || v > 100000) bad('Valor mínimo de R$ 1,00 a R$ 1.000,00'); if (v !== cur.minCents) { notes.push('valor mínimo alterado'); next.minCents = v; } }
    if (next.mode === 'infinitepay' && !next.handle) bad('Para usar a InfinitePay, informe o InfiniteTag', 409);
    if (next.mode === 'pix' && !next.pixKey) bad('Para o Pix manual, informe a chave Pix', 409);
    if (!notes.length) return res.json({ ok: true, unchanged: true, cfg: payPublic(cur) });
    savePay(next);
    logAct(req, 'Pagamentos: configuração alterada', notes.join(' · '));
    res.json({ ok: true, cfg: payPublic(next) });
  }));
  // Cria um link de R$ 1,00 só para ver se a conta responde (nada é cobrado se ninguém pagar).
  app.post('/api/admin/pay/test', auth, adminOnly, wrap(async (req, res) => {
    const cfg = payCfg();
    if (!cfg.handle) bad('Informe e salve o InfiniteTag antes de testar', 409);
    const nsu = 'teste-' + globalThis.crypto.randomUUID();
    const body = { handle: cfg.handle, items: [{ quantity: 1, price: 100, description: 'Teste de conexão Game Platform' }], order_nsu: nsu };
    const r = await ipFetch('/links', body, cfg);
    const url = findUrl(r.json);
    logAct(req, 'Pagamentos: teste de conexão', r.status < 300 && url ? 'ok' : 'falhou (' + r.status + ')');
    res.json({ ok: r.status < 300 && !!url, status: r.status, url, detail: url ? '' : r.text });
  }));

  app.post('/api/store/checkout', auth, wrap(async (req, res) => {
    const id = String(req.body.id || ''), u = get('SELECT * FROM users WHERE id = ?', req.user.id), cfg = payCfg();
    const cat = catalog(), plan = cat.plans.find(p => p.id === id), pack = cat.packs.find(p => p.id === id), item = plan || pack;
    if (!item) bad('Item não encontrado ou fora de venda', 404);
    const cp = couponFor(u.id, req.body.coupon, item, plan ? 'plan' : 'pack');
    if (plan) { const col = plan.kind === 'premium' ? 'premium_until' : 'studio_until'; if (u[col] === FOREVER) bad('Você já tem este plano liberado sem prazo.', 409); }
    const cents = priceWith(item, cp);
    if (cfg.mode === 'test') {
      const g = grant(u, plan, pack, cp, cents, false);
      return res.json({ mode: 'test', ok: true, got: g.got, ...state(get('SELECT * FROM users WHERE id = ?', u.id)) });
    }
    if (cents < cfg.minCents) bad('Valor abaixo do mínimo para pagamento (R$ ' + (cfg.minCents / 100).toFixed(2).replace('.', ',') + ')', 400);
    const open = get("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'pending' AND created_at > datetime('now','-1 hour')", u.id).n;
    if (open >= 5) bad('Você tem pedidos em aberto demais. Conclua ou aguarde.', 429);
    const nsu = globalThis.crypto.randomUUID(), o = { nsu, cents, name: item.name };
    run('INSERT INTO orders (nsu, user_id, kind, item_id, name, cents, coins, days, coupon, method) VALUES (?,?,?,?,?,?,?,?,?,?)', nsu, u.id, plan ? plan.kind : 'coins', item.id, item.name, cents, pack ? pack.coins : 0, plan ? plan.days : 0, cp ? cp.code : null, cfg.mode);
    if (cfg.mode === 'infinitepay') {
      let link;
      try { link = await createLink(cfg, o); } catch (e) { run("UPDATE orders SET status = 'canceled', note = ? WHERE nsu = ?", 'falha ao criar link', nsu); throw e; }
      run('UPDATE orders SET link = ? WHERE nsu = ?', link, nsu);
      return res.json({ mode: 'infinitepay', order: orderOut(get('SELECT * FROM orders WHERE nsu = ?', nsu)), url: link });
    }
    res.json({ mode: 'pix', order: orderOut(get('SELECT * FROM orders WHERE nsu = ?', nsu)), pix: { key: cfg.pixKey, name: cfg.pixName, city: cfg.pixCity, note: cfg.note, cents, code: nsu.slice(0, 8).toUpperCase() } });
  }));
  app.get('/api/store/orders', auth, (req, res) => {
    const cfg = payCfg();
    res.json({ orders: all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', req.user.id).map(o => ({ ...orderOut(o), ...(o.method === 'pix' ? { pix: { key: cfg.pixKey, name: cfg.pixName, city: cfg.pixCity, note: cfg.note, cents: o.cents, code: o.nsu.slice(0, 8).toUpperCase() } } : {}) })) });
  });
  // O app volta do pagamento e pergunta se já caiu; se tiver os dados do retorno, confirma direto com a InfinitePay.
  app.post('/api/store/orders/:nsu/verify', auth, wrap(async (req, res) => {
    const o = get('SELECT * FROM orders WHERE nsu = ? AND user_id = ?', String(req.params.nsu), req.user.id);
    if (!o) bad('Pedido não encontrado', 404);
    if (o.status === 'pending' && o.method === 'infinitepay') {
      const tx = String(req.body.transaction_nsu || o.tx_nsu || ''), slug = String(req.body.slug || o.slug || '');
      if (tx && slug) {
        const c = await checkPaid(o, tx, slug);
        if (c.ok) fulfill(o.nsu, 'verificado pelo retorno', { tx, slug, receipt: String(req.body.receipt_url || '').slice(0, 300), paid: c.paid });
      }
    }
    const f = get('SELECT * FROM orders WHERE nsu = ?', o.nsu);
    res.json({ order: orderOut(f), ...(f.status === 'paid' ? state(get('SELECT * FROM users WHERE id = ?', req.user.id)) : {}) });
  }));
  // Aviso automático da InfinitePay. Não há assinatura, então sempre confirmamos com payment_check antes de entregar.
  app.post('/api/pay/webhook', wrap(async (req, res) => {
    const b = req.body || {}, nsu = String(b.order_nsu || '');
    const o = nsu ? get('SELECT * FROM orders WHERE nsu = ?', nsu) : null;
    if (!o) return res.status(200).json({ ok: true, ignored: true });
    if (o.status === 'paid') return res.json({ ok: true, already: true });
    if (o.method !== 'infinitepay') return res.json({ ok: true, ignored: true });
    const tx = String(b.transaction_nsu || ''), slug = String(b.invoice_slug || b.slug || '');
    let c = { ok: false };
    try { c = await checkPaid(o, tx, slug); } catch (e) { console.error('payment_check', e.message); return res.status(400).json({ ok: false }); }
    if (!c.ok) return res.status(400).json({ ok: false });
    fulfill(o.nsu, 'confirmado pelo aviso automático', { tx, slug, receipt: String(b.receipt_url || '').slice(0, 300), paid: c.paid });
    res.json({ ok: true });
  }));

  // Admin: pedidos e confirmação manual (Pix)
  app.get('/api/admin/orders', auth, staffCan('finance'), wrap((req, res) => {
    const st = ['pending', 'paid', 'canceled'].includes(req.query.status) ? req.query.status : '';
    const rows = all(`SELECT o.*, u.name AS buyer FROM orders o JOIN users u ON u.id = o.user_id ${st ? 'WHERE o.status = ?' : ''} ORDER BY o.created_at DESC LIMIT 100`, ...(st ? [st] : []));
    res.json({ orders: rows.map(o => ({ ...orderOut(o), buyer: o.buyer, user_id: o.user_id, note: o.note, receipt: o.receipt || '', code: o.nsu.slice(0, 8).toUpperCase() })), pending: get("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").n });
  }));
  app.post('/api/admin/orders/:nsu/confirm', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const o = get('SELECT * FROM orders WHERE nsu = ?', String(req.params.nsu));
    if (!o) bad('Pedido não encontrado', 404);
    if (o.status === 'paid') bad('Este pedido já foi pago', 409);
    if (o.status !== 'pending') bad('Este pedido foi cancelado', 409);
    const r = fulfill(o.nsu, 'confirmado pelo administrador ' + req.user.name);
    if (!r.ok) bad('Não foi possível entregar este pedido', r.code || 409);
    logAct(req, 'Pedido confirmado manualmente', `${o.name} · ${o.cents / 100} · pedido ${o.nsu.slice(0, 8).toUpperCase()}`);
    res.json({ ok: true });
  }));
  app.post('/api/admin/orders/:nsu/cancel', auth, adminOnly, wrap((req, res) => {
    const o = get('SELECT * FROM orders WHERE nsu = ?', String(req.params.nsu));
    if (!o) bad('Pedido não encontrado', 404);
    if (o.status !== 'pending') bad('Só pedidos em aberto podem ser cancelados', 409);
    run("UPDATE orders SET status = 'canceled', note = ? WHERE nsu = ? AND status = 'pending'", 'cancelado por ' + req.user.name, o.nsu);
    logAct(req, 'Pedido cancelado', `${o.name} · pedido ${o.nsu.slice(0, 8).toUpperCase()}`);
    res.json({ ok: true });
  }));

  // Pacotes de moedas: criar e remover (os padrões só podem sair de venda)
  app.post('/api/admin/packs', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 40), coins = Number(b.coins), price = Number(b.price);
    if (name.length < 2) bad('Dê um nome ao pacote');
    if (!Number.isInteger(coins) || coins < 1 || coins > 1_000_000) bad('Moedas de 1 a 1.000.000');
    if (!Number.isInteger(price) || price < 0 || price > 10_000_000) bad('Preço inválido (centavos)');
    const l = customPacks();
    if (l.length >= 30) bad('Limite de 30 pacotes extras');
    const id = 'cp' + Date.now().toString(36);
    l.push({ id, name, coins, price }); saveCustomPacks(l);
    logAct(req, 'Loja: pacote criado', `${name} · ${coins} moedas · ${brl(price)}`);
    res.json({ ok: true, catalog: catalog(true) });
  }));
  app.delete('/api/admin/packs/:id', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const id = String(req.params.id), l = customPacks(), p = l.find(x => x.id === id);
    if (!p) bad('Só pacotes criados por você podem ser apagados. Os padrões podem ser tirados de venda.', 404);
    saveCustomPacks(l.filter(x => x.id !== id));
    const ov = overrides(); delete ov[id]; saveOv(ov);
    logAct(req, 'Loja: pacote apagado', p.name);
    res.json({ ok: true, catalog: catalog(true) });
  }));

  app.get('/api/store/log', auth, (req, res) => res.json({ log: all('SELECT id, delta, note, created_at FROM coin_log WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id) }));
  app.get('/api/store', auth, (req, res) => {
    const cat = catalog(), st = state(req.user);
    // itens que o jogador já tem continuam aparecendo, mesmo fora da venda (temporada acabou)
    for (const i of skinItems()) if (st.owned.includes(i.id) && !cat.items.some(x => x.id === i.id)) cat.items.push({ ...pubSkin(i), offsale: true });
    res.json({ ...cat, skins: skinDefs(), test: payCfg().mode === 'test', payMode: payCfg().mode, ...st });
  });
  // definições de aparência (cores, imagens) de todos os itens criados: o app usa para desenhar os perfis dos outros jogadores
  app.get('/api/skins', (_req, res) => res.set('Cache-Control', 'no-cache').json({ skins: skinDefs() }));
  const blob = (col, re) => (req, res) => {
    const id = Number(String(req.params.id).replace(/^c/, ''));
    const r = Number.isInteger(id) ? get(`SELECT ${col} AS b FROM store_items WHERE id = ?`, id) : null;
    const m = r && r.b && re.exec(r.b);
    if (!m) return res.status(404).end();
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(Buffer.from(m[2], 'base64'));
  };
  app.get('/api/store/img/:id', blob('img', IMG_RE));
  app.get('/api/store/font/:id', blob('font', FONT_RE));
  app.get('/api/store/tex/:id/:key', (req, res) => {
    const id = Number(String(req.params.id).replace(/^c/, ''));
    const r = Number.isInteger(id) && TEX_KEYS.includes(req.params.key) ? get('SELECT img FROM store_item_tex WHERE item_id = ? AND key = ?', id, req.params.key) : null;
    const m = r && IMG_RE.exec(r.img);
    if (!m) return res.status(404).end();
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(Buffer.from(m[2], 'base64'));
  });

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

  // Entrega o plano ou o pacote (usado na compra de teste, na confirmação do pagamento e na confirmação manual do Pix).
  const grant = (u, plan, pack, cp, cents, live) => {
    if (plan) {
      const col = plan.kind === 'premium' ? 'premium_until' : 'studio_until';
      const base = u[col] && u[col] > now() ? new Date(u[col]).getTime() : Date.now();
      run(`UPDATE users SET ${col} = ? WHERE id = ?`, new Date(base + plan.days * 86_400_000).toISOString(), u.id);
      sale(u.id, plan.kind, plan.id, plan.name, { cents, days: plan.days, coupon: cp ? cp.code : null }); if (cp) useCoupon(u.id, cp);
      notifyK(u.id, plan.kind === 'premium' ? 'Premium ativo' : 'Studio liberado', plan.kind === 'premium' ? `${plan.name} ativo. Aproveite o bônus diário e os itens exclusivos.` : `${plan.name} ativo. Você já pode publicar jogos.`, 'premium');
      return { got: 0 };
    }
    const got = Math.floor((hasPremium(u) ? Math.floor(pack.coins * (1 + c.cfg.val('premiumBonusPct') / 100)) : pack.coins) * (cp && cp.kind === 'bonus' ? 1 + cp.value / 100 : 1));
    run('UPDATE users SET coins = coins + ? WHERE id = ?', got, u.id);
    clog(u.id, got, 'Pacote ' + pack.name + (live ? '' : ' (teste)'));
    sale(u.id, 'coins', pack.id, pack.name, { cents, coins: got, coupon: cp ? cp.code : null }); if (cp) useCoupon(u.id, cp);
    notifyK(u.id, 'Moedas recebidas', `${got} moedas foram adicionadas à sua conta.`, 'premium');
    return { got };
  };

  app.post('/api/store/buy', auth, wrap((req, res) => {
    const id = String(req.body.id || '');
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    const cat = catalog(), plan = cat.plans.find(p => p.id === id), pack = cat.packs.find(p => p.id === id), item = cat.items.find(p => p.id === id);
    if (!plan && !pack && !item && [...PLANS, ...allPacks(), ...allItems()].some(p => p.id === id)) bad('Este item não está à venda agora', 410);
    const cp = plan ? couponFor(u.id, req.body.coupon, plan, 'plan') : pack ? couponFor(u.id, req.body.coupon, pack, 'pack') : null;
    if (plan || pack) {
      if (payCfg().mode !== 'test') bad('O pagamento real está ligado. Use o botão de comprar para abrir o pagamento.', 409);
      if (plan) { const col = plan.kind === 'premium' ? 'premium_until' : 'studio_until'; if (u[col] === FOREVER) bad('Você já tem este plano liberado sem prazo.', 409); }
      grant(u, plan, pack, cp, priceWith(plan || pack, cp), false);
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
      const it = allItems().find(p => p.id === id);
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
    const cut = Math.floor(price * c.cfg.val('creatorSharePct') / 100);
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
    const b = req.body, id = String(b.id || ''), base = [...PLANS, ...allPacks(), ...ITEMS].find(p => p.id === id);
    if (!base) bad('Item não encontrado', 404);
    const isItem = ITEMS.includes(base), field = isItem ? 'coins' : 'price';
    const ov = overrides(), cur = { ...base, ...(ov[id] || {}) }, next = { ...(ov[id] || {}) }, notes = [];
    if (b[field] !== undefined) {
      const v = Number(b[field]);
      if (!Number.isInteger(v) || v < 0 || v > (isItem ? 100000 : 10_000_000)) bad(isItem ? 'Preço em moedas inválido (0 a 100000)' : 'Preço inválido (centavos, até 100000,00)');
      if (v !== cur[field]) { notes.push(isItem ? `${cur.coins} → ${v} moedas` : `${brl(cur.price)} → ${brl(v)}`); next[field] = v; }
    }
    if (b.coins !== undefined && !isItem && base.coins !== undefined) {
      const v = Number(b.coins);
      if (!Number.isInteger(v) || v < 1 || v > 1_000_000) bad('Moedas do pacote inválidas (1 a 1.000.000)');
      if (v !== cur.coins) { notes.push(`${cur.coins} → ${v} moedas no pacote`); next.coins = v; }
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
    const id = String(req.body.id || ''), base = [...PLANS, ...allPacks(), ...ITEMS].find(p => p.id === id);
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
      const it = allItems().find(i => i.id === s.ref); if (it) run(`UPDATE users SET ${it.slot} = NULL WHERE id = ? AND ${it.slot} = ?`, u.id, it.id);
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
    const scope = String(b.scope || 'all'), valid = ['all', 'plans', 'packs', ...PLANS.map(p => p.id), ...allPacks().map(p => p.id)];
    if (!valid.includes(scope)) bad('Alcance inválido');
    if (kind === 'bonus' && !(scope === 'all' || scope === 'packs' || allPacks().some(p => p.id === scope))) bad('Bônus só vale para pacotes de moedas');
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

  // ---- criador de itens (administrador) ----
  const SK_MAX_IMG = 4_200_000, SK_MAX_FONT = 560_000, SK_MAX_TEX_TOTAL = 12_000_000;
  const colorOf = (v, nm, req_ = false) => { if (v === undefined || v === null || v === '') { if (req_) bad(nm + ': escolha uma cor'); return ''; } if (!HEX.test(String(v))) bad(nm + ': cor inválida'); return String(v).toLowerCase(); };
  const cleanData = (slot, d) => {
    d = d && typeof d === 'object' ? d : {}; const o = {};
    if (slot === 'frame') { o.glow = colorOf(d.glow, 'Brilho'); o.anim = ['none', 'spin', 'pulse'].includes(d.anim) ? d.anim : 'none'; }
    else if (slot === 'banner') { o.c1 = colorOf(d.c1, 'Cor 1'); o.c2 = colorOf(d.c2, 'Cor 2'); o.c3 = colorOf(d.c3, 'Cor 3'); o.fx = ['none', 'move'].includes(d.fx) ? d.fx : 'none'; }
    else if (slot === 'title') { o.color = colorOf(d.color, 'Cor do título'); o.bg = colorOf(d.bg, 'Fundo do título'); }
    else if (slot === 'ncolor') { o.c1 = colorOf(d.c1, 'Cor 1', true); o.c2 = colorOf(d.c2, 'Cor 2'); }
    else if (slot === 'bubble') { o.bg = colorOf(d.bg, 'Cor do balão', true); o.bg2 = colorOf(d.bg2, 'Cor 2 do balão'); o.fg = colorOf(d.fg, 'Cor do texto'); }
    else if (slot === 'theme') {
      for (const [k, n] of [['accent', 'Cor principal'], ['accent2', 'Cor secundária'], ['bg', 'Fundo'], ['surface', 'Cartões'], ['fg', 'Texto'], ['muted', 'Texto fraco'], ['line', 'Linhas']]) o[k] = colorOf(d[k], n, k === 'accent');
      o.font = Object.hasOwn(SKIN_FONTS, d.font) ? d.font : 'padrao';
      o.shade = Math.max(0, Math.min(90, parseInt(d.shade, 10) || 0));
      o.fit = ['cover', 'tile'].includes(d.fit) ? d.fit : 'cover';
      o.light = !!d.light;
    }
    return o;
  };
  const imgIn = (v, cur) => {
    if (v === undefined || v === 'keep') return cur;
    if (v === null || v === '') return null;
    if (!dataOk(v, SK_MAX_IMG)) bad('Imagem muito grande (máximo 3 MB)');
    const m = IMG_RE.exec(v); if (!m) bad('Use imagem PNG, APNG, WebP, GIF ou JPG');
    const real = imgMagic(Buffer.from(m[2], 'base64')); if (!real) bad('O arquivo não parece uma imagem válida');
    return `data:${real};base64,${m[2]}`;
  };
  const fontIn = (v, cur) => {
    if (v === undefined || v === 'keep') return cur;
    if (v === null || v === '') return null;
    if (!dataOk(v, SK_MAX_FONT)) bad('Fonte muito grande (máximo cerca de 400 KB)');
    const m = /^data:[a-z0-9\/\-+.]*;base64,([A-Za-z0-9+/=]+)$/.exec(v); if (!m) bad('Arquivo de fonte inválido');
    const real = fontMagic(Buffer.from(m[1], 'base64')); if (!real) bad('Use fonte .woff2, .woff, .ttf ou .otf');
    return `data:${real};base64,${m[1]}`;
  };
  const dateIn = (v, nm) => { if (v === undefined || v === null || v === '') return null; if (!DAY.test(String(v))) bad(nm + ': use a data no formato AAAA-MM-DD'); return String(v); };
  const adminSkin = r => { const s = rowToSkin(r); return { ...pubSkin(s), id: s.id, active: s.active, owners: get('SELECT COUNT(*) AS n FROM user_items WHERE item_id = ?', s.id).n, onSale: s.active && inWindow(s) }; };
  const skinRows = () => all('SELECT id, slot, name, coins, premium, active, tag, starts_at, ends_at, data, ver, (img IS NOT NULL) AS hasImg, (font IS NOT NULL) AS hasFont FROM store_items ORDER BY id DESC');
  app.get('/api/admin/store-items', auth, adminOnly, (_req, res) => res.json({ items: skinRows().map(adminSkin), fonts: Object.keys(SKIN_FONTS), slots: SKIN_SLOTS }));
  const applyTex = (id, texIn) => {
    let changed = false;
    for (const [k, v] of Object.entries(texIn)) {
      if (v === null) { if (run('DELETE FROM store_item_tex WHERE item_id = ? AND key = ?', id, k).changes) changed = true; }
      else { run('INSERT INTO store_item_tex (item_id, key, img) VALUES (?,?,?) ON CONFLICT(item_id, key) DO UPDATE SET img = excluded.img', id, k, v); changed = true; }
    }
    const tot = get('SELECT COALESCE(SUM(LENGTH(img)), 0) AS n FROM store_item_tex WHERE item_id = ?', id).n;
    if (tot > SK_MAX_TEX_TOTAL) { run('DELETE FROM store_item_tex WHERE item_id = ?', id); bad('As texturas deste tema passam de 9 MB juntas. Use imagens menores.'); }
    return changed;
  };
  const saveSkin = (req, id) => {
    const b = req.body || {}, cur = id ? get('SELECT * FROM store_items WHERE id = ?', id) : null;
    if (id && !cur) bad('Item não encontrado', 404);
    const slot = cur ? cur.slot : String(b.slot || ''); if (!SKIN_SLOTS.includes(slot)) bad('Tipo de item inválido');
    const name = String(b.name !== undefined ? b.name : (cur ? cur.name : '')).trim().slice(0, 40); if (name.length < 2) bad('Dê um nome ao item (mínimo 2 letras)');
    const coins = b.coins !== undefined ? Number(b.coins) : (cur ? cur.coins : 0); if (!Number.isInteger(coins) || coins < 0 || coins > 100000) bad('Preço em moedas inválido (0 a 100000)');
    const data = b.data !== undefined ? cleanData(slot, b.data) : parseJ(cur && cur.data, {});
    const img = imgIn(b.img, cur ? cur.img : null), font = slot === 'theme' ? fontIn(b.font, cur ? cur.font : null) : null;
    const starts = b.starts_at !== undefined ? dateIn(b.starts_at, 'Início') : (cur ? cur.starts_at : null), ends = b.ends_at !== undefined ? dateIn(b.ends_at, 'Fim') : (cur ? cur.ends_at : null);
    if (starts && ends && ends < starts) bad('A data final não pode ser antes da inicial');
    if (slot === 'frame' && !img && !data.glow) bad('Moldura: coloque uma imagem ou escolha a cor do brilho');
    if (slot === 'banner' && !img && !data.c1) bad('Fundo: coloque uma imagem ou escolha ao menos a cor 1');
    if (slot === 'theme' && !data.accent) bad('Tema: escolha a cor principal');
    // texturas (só tema): { chave: 'keep' | dataURL | null }
    const texIn = {};
    if (slot === 'theme' && b.tex && typeof b.tex === 'object') {
      for (const [k, v] of Object.entries(b.tex)) {
        if (!TEX_KEYS.includes(k)) bad('Textura desconhecida: ' + k);
        if (v === 'keep' || v === undefined) continue;
        texIn[k] = v === null || v === '' ? null : imgIn(v, null);
      }
    }
    const premium = b.premium !== undefined ? (b.premium ? 1 : 0) : (cur ? cur.premium : 0), active = b.active !== undefined ? (b.active ? 1 : 0) : (cur ? cur.active : 1);
    const tag = String(b.tag !== undefined ? b.tag : (cur ? cur.tag : '')).trim().slice(0, 24);
    if (cur) {
      const visual = img !== cur.img || font !== cur.font || JSON.stringify(data) !== cur.data;
      run("UPDATE store_items SET name = ?, coins = ?, premium = ?, active = ?, tag = ?, starts_at = ?, ends_at = ?, data = ?, img = ?, font = ?, ver = ver + ?, updated_at = datetime('now') WHERE id = ?", name, coins, premium, active, tag, starts, ends, JSON.stringify(data), img, font, visual ? 1 : 0, cur.id);
      const texChanged = applyTex(cur.id, texIn);
      if (texChanged && !visual) run('UPDATE store_items SET ver = ver + 1 WHERE id = ?', cur.id);
      return cur.id;
    }
    if (get('SELECT COUNT(*) AS n FROM store_items').n >= 300) bad('Limite de 300 itens criados');
    const nid = run('INSERT INTO store_items (slot, name, coins, premium, active, tag, starts_at, ends_at, data, img, font) VALUES (?,?,?,?,?,?,?,?,?,?,?)', slot, name, coins, premium, active, tag, starts, ends, JSON.stringify(data), img, font).lastInsertRowid;
    applyTex(Number(nid), texIn);
    return nid;
  };
  const lastSkin = id => adminSkin(get('SELECT id, slot, name, coins, premium, active, tag, starts_at, ends_at, data, ver, (img IS NOT NULL) AS hasImg, (font IS NOT NULL) AS hasFont FROM store_items WHERE id = ?', id));
  app.post('/api/admin/store-items', auth, adminOnly, wrap((req, res) => {
    const id = Number(saveSkin(req, 0)); skinDirty();
    const it = lastSkin(id); logAct(req, 'Loja: item criado', `${it.name} (${it.slot})`);
    res.json({ ok: true, item: it });
  }));
  app.put('/api/admin/store-items/:id', auth, adminOnly, wrap((req, res) => {
    const id = int(req.params.id, 'id'); saveSkin(req, id); skinDirty();
    const it = lastSkin(id); logAct(req, 'Loja: item editado', `${it.name} (${it.slot})`);
    res.json({ ok: true, item: it });
  }));
  app.delete('/api/admin/store-items/:id', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const id = int(req.params.id, 'id'), r = get('SELECT * FROM store_items WHERE id = ?', id);
    if (!r) bad('Item não encontrado', 404);
    const key = 'c' + id;
    for (const sl of SKIN_SLOTS) run(`UPDATE users SET ${sl} = NULL WHERE ${sl} = ?`, key);
    const owners = get('SELECT COUNT(*) AS n FROM user_items WHERE item_id = ?', key).n;
    run('DELETE FROM user_items WHERE item_id = ?', key); run('DELETE FROM store_item_tex WHERE item_id = ?', id); run('DELETE FROM store_items WHERE id = ?', id); skinDirty();
    logAct(req, 'Loja: item apagado', `${r.name} (${r.slot}) · ${owners} jogador(es) tinham`);
    res.json({ ok: true, owners });
  }));
}
