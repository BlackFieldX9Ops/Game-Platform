// Configurações gerais do administrador: identidade da plataforma, regras de uso e aparelhos compatíveis,
// lançamento global e formatação protegida (compras e atividade) com senha, frase e backup antes.
import bcrypt from 'bcryptjs';
import { CATS } from './push.js';
import { GROUPS, FIELDS } from './settings.js';

export const RULES_DEF = {
  intro: 'Estas regras valem para todo mundo que usa o Game Platform. Quem quebrar as regras pode ter jogos removidos, a conta suspensa ou banida.',
  sections: [
    { title: 'Respeito entre jogadores', body: 'Trate todos com respeito. Não é permitido assediar, ameaçar, humilhar ou discriminar ninguém no chat, no feed, nas comunidades ou nos comentários dos jogos.' },
    { title: 'Conteúdo dos jogos', body: 'Publique só jogos que você criou ou tem permissão para usar. É proibido conteúdo sexual, violência explícita gratuita, apologia ao ódio, golpes e qualquer coisa ilegal. Jogos não podem coletar dados dos jogadores nem tentar sair da área onde rodam.' },
    { title: 'Contas e segurança', body: 'Cada pessoa usa a própria conta e não compartilha a senha. Não tente invadir contas, burlar o sistema de moedas ou usar bugs para ganhar vantagem. A equipe pode pedir comprovação em caso de suspeita.' },
    { title: 'Compras e moedas', body: 'Moedas e planos são digitais e ficam ligados à sua conta. Pedidos de estorno são analisados pela equipe caso a caso. Pagamentos só são entregues depois de confirmados.' },
    { title: 'Denúncias e moderação', body: 'Use o botão de denúncia para avisar a equipe sobre abusos. Denúncias falsas repetidas também podem gerar punição. Decisões da moderação ficam registradas.' },
    { title: 'Privacidade', body: 'Guardamos apenas o necessário para o app funcionar: nome, e-mail, progresso, compras e mensagens. Você pode pedir a exclusão da sua conta à equipe.' },
  ],
  devices: [
    { name: 'Android', req: 'Android 7.0 (Nougat) ou mais novo', rec: 'Android 10 ou mais novo', note: 'Aparelhos com Android 6 ou menos não conseguem instalar o app. Use o site no navegador.' },
    { name: 'Memória (RAM)', req: '2 GB', rec: '4 GB ou mais', note: 'Jogos 3D pedem mais memória. Com pouca RAM, feche outros apps antes de jogar.' },
    { name: 'Espaço livre', req: '150 MB', rec: '500 MB ou mais', note: 'Para o app, atualizações e saves.' },
    { name: 'WebView do Android', req: 'Atualizado pela Play Store (Chrome 100 ou mais novo)', rec: 'Sempre atualizado', note: 'Os jogos rodam no WebView do sistema. Se um jogo não abre, atualize o "Android System WebView".' },
    { name: 'Internet', req: 'Necessária para entrar, Loja, Chat e salvar progresso', rec: 'Wi-Fi ou 4G estável', note: 'Sem internet o app abre com o que já foi carregado e avisa que está offline.' },
    { name: 'Computador / navegador', req: 'Chrome, Edge ou Firefox atualizados', rec: 'Chrome ou Edge', note: 'O painel de gestão é para telas largas (a partir de 1000 px).' },
  ],
};
export const PLATFORM_DEF = { name: 'Game Platform', tagline: 'Jogue. Crie. Compartilhe.', supportEmail: '', termsUrl: '', privacyUrl: '', welcome: '' };

export function mountAdminX(c) {
  const { app, auth, adminOnly, wrap, bad, get, all, run, db, logAct, confirmCheck, parseJ, runBackup, cfg } = c;
  const kv = (k, def) => { const r = get('SELECT value FROM settings WHERE key = ?', k); return r ? { ...def, ...parseJ(r.value, {}) } : { ...def }; };
  const put = (k, v) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
  const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  const url = (v, nm) => { const t = txt(v, 200); if (t && !/^https:\/\/[^\s]+$/.test(t)) bad(nm + ' deve começar com https://'); return t; };

  // ---------- identidade e regras (públicas para leitura) ----------
  app.get('/api/platform', (_req, res) => res.json({ platform: kv('platform', PLATFORM_DEF), launched: !!get("SELECT 1 FROM settings WHERE key = 'launched'"), notice: cfg.val('homeNotice'), appSig: cfg.val('appSig'), feat: { chat: !!cfg.val('featChat'), missions: !!cfg.val('featMissions'), shortcuts: !!cfg.val('featShortcuts') } }));
  app.get('/api/rules', (_req, res) => { const r = kv('rules', RULES_DEF); res.json({ rules: { intro: r.intro, sections: r.sections, devices: r.devices, updated_at: r.updated_at || null } }); });
  app.get('/api/admin/platform', auth, adminOnly, (_req, res) => res.json({ platform: kv('platform', PLATFORM_DEF), rules: kv('rules', RULES_DEF), defaults: { rules: RULES_DEF } }));
  app.post('/api/admin/platform', auth, adminOnly, wrap((req, res) => {
    const b = req.body || {}, cur = kv('platform', PLATFORM_DEF), next = { ...cur }, notes = [];
    const set = (f, v, nm) => { if (v !== cur[f]) { next[f] = v; notes.push(nm); } };
    if (b.name !== undefined) { const n = txt(b.name, 40); if (n.length < 2) bad('Nome da plataforma muito curto'); set('name', n, 'nome'); }
    if (b.tagline !== undefined) set('tagline', txt(b.tagline, 80), 'frase');
    if (b.supportEmail !== undefined) { const e = txt(b.supportEmail, 120); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) bad('E-mail de suporte inválido'); set('supportEmail', e, 'e-mail de suporte'); }
    if (b.termsUrl !== undefined) set('termsUrl', url(b.termsUrl, 'O link dos termos'), 'link dos termos');
    if (b.privacyUrl !== undefined) set('privacyUrl', url(b.privacyUrl, 'O link da privacidade'), 'link da privacidade');
    if (b.welcome !== undefined) set('welcome', txt(b.welcome, 300), 'mensagem de boas-vindas');
    if (!notes.length) return res.json({ ok: true, unchanged: true, platform: cur });
    put('platform', next);
    logAct(req, 'Configurações gerais alteradas', notes.join(' · '));
    res.json({ ok: true, platform: next });
  }));
  app.post('/api/admin/rules', auth, adminOnly, wrap((req, res) => {
    const b = req.body || {};
    if (b.reset) { run("DELETE FROM settings WHERE key = 'rules'"); logAct(req, 'Regras de uso restauradas ao padrão', ''); return res.json({ ok: true, rules: kv('rules', RULES_DEF) }); }
    if (!Array.isArray(b.sections) || b.sections.length > 20) bad('Regras inválidas (até 20 blocos)');
    if (!Array.isArray(b.devices) || b.devices.length > 20) bad('Lista de aparelhos inválida (até 20 linhas)');
    const sections = b.sections.map(s => ({ title: txt(s && s.title, 60), body: txt(s && s.body, 1200) })).filter(s => s.title && s.body);
    const devices = b.devices.map(d => ({ name: txt(d && d.name, 40), req: txt(d && d.req, 100), rec: txt(d && d.rec, 100), note: txt(d && d.note, 240) })).filter(d => d.name && d.req);
    if (!sections.length) bad('Escreva pelo menos uma regra');
    const next = { intro: txt(b.intro, 400), sections, devices, updated_at: new Date().toISOString() };
    put('rules', next);
    logAct(req, 'Regras de uso e aparelhos editados', `${sections.length} regra(s) · ${devices.length} requisito(s)`);
    res.json({ ok: true, rules: next });
  }));

  // ---------- configurações do administrador (cadastro único, desenhado pelo painel) ----------
  app.get('/api/admin/config', auth, adminOnly, (_req, res) => res.json({ groups: GROUPS, fields: FIELDS, values: cfg.values(), cats: Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, { name: v.name, locked: !!v.locked }])) }));
  app.post('/api/admin/config', auth, adminOnly, wrap((req, res) => {
    const notes = cfg.save(req.body || {}, bad, CATS);
    if (!notes.length) return res.json({ ok: true, unchanged: true, values: cfg.values() });
    logAct(req, 'Configurações alteradas', notes.join(' · ').slice(0, 480));
    res.json({ ok: true, values: cfg.values() });
  }));

  // ---------- lançamento global e formatação ----------
  const launched = () => { const r = get("SELECT value FROM settings WHERE key = 'launched'"); return r ? parseJ(r.value, {}) : null; };
  const SCOPES = {
    sales: { name: 'Compras e vendas', desc: 'Vendas, pedidos, jogos comprados e usos de cupom (o contador dos cupons volta a zero).', tables: ['sales', 'orders', 'purchases', 'coupon_uses'], extra: () => run('UPDATE coupons SET used = 0') },
    wallet: { name: 'Moedas, skins e planos dos jogadores', desc: 'Saldo de moedas, extrato, skins compradas e planos Studio e Premium dos jogadores (administradores mantêm o acesso).', tables: ['coin_log', 'user_items'], extra: () => { run("UPDATE users SET coins = 0, frame = NULL, banner = NULL, title = NULL, ncolor = NULL, theme = NULL, bubble = NULL"); run("UPDATE users SET studio_until = NULL, premium_until = NULL WHERE role <> 'admin'"); } },
    activity: { name: 'Atividade recente', desc: 'Jogadas, estatísticas diárias, avisos enviados, notificações, fila de push e mensagens globais.', tables: ['plays_daily', 'game_plays', 'notifications', 'notif_reads', 'notif_dismissed', 'push_queue', 'campaigns', 'broadcasts', 'app_events'] },
    audit: { name: 'Histórico da auditoria', desc: 'Apaga o registro de ações da equipe. Não recomendado: a própria formatação é registrada depois.', tables: ['logs'] },
  };
  const count = t => { try { return get(`SELECT COUNT(*) AS n FROM ${t}`).n; } catch { return 0; } };
  const preview = () => Object.fromEntries(Object.entries(SCOPES).map(([k, s]) => [k, { name: s.name, desc: s.desc, rows: s.tables.reduce((a, t) => a + count(t), 0) + (k === 'wallet' ? get('SELECT COALESCE(SUM(coins),0) AS n FROM users').n > 0 ? 1 : 0 : 0) }]));
  const fails = new Map(); // userId -> { n, until }
  const guard = req => { const f = fails.get(req.user.id); if (f && f.until > Date.now() && f.n >= 5) bad('Muitas tentativas erradas. Aguarde 15 minutos.', 429); };
  const wrong = (req, why) => { const f = fails.get(req.user.id); const n = f && f.until > Date.now() ? f.n + 1 : 1; fails.set(req.user.id, { n, until: Date.now() + (Number(process.env.ADMINX_LOCK_MS) || 15 * 60_000) }); logAct(req, 'Tentativa de ação protegida falhou', why); bad(why, 403); };
  const checkPass = (req, pass) => {
    const u = get('SELECT pass_hash FROM users WHERE id = ?', req.user.id);
    if (!u || !u.pass_hash) bad('Sua conta não tem senha. Defina uma senha em Recuperar senha antes de usar esta função.', 409);
    if (!bcrypt.compareSync(String(pass || ''), u.pass_hash)) wrong(req, 'Senha incorreta');
  };

  app.get('/api/admin/reset', auth, adminOnly, (_req, res) => res.json({ launched: launched(), scopes: preview(), phrase: 'FORMATAR TUDO' }));
  app.post('/api/admin/reset', auth, adminOnly, wrap((req, res) => {
    guard(req);
    const b = req.body || {};
    const L = launched();
    if (L) bad('A formatação está desativada: a plataforma foi lançada em ' + String(L.at || '').slice(0, 10).split('-').reverse().join('/') + '.', 423);
    const scopes = Array.isArray(b.scopes) ? [...new Set(b.scopes.map(String))].filter(k => SCOPES[k]) : [];
    if (!scopes.length) bad('Escolha o que será apagado');
    checkPass(req, b.password);
    if (String(b.phrase || '').trim() !== 'FORMATAR TUDO') wrong(req, 'Digite exatamente: FORMATAR TUDO');
    confirmCheck(req);
    const backup = runBackup(true);
    if (!backup) bad('Não consegui fazer o backup. Nada foi apagado.', 500);
    const removed = {};
    db.exec('BEGIN');
    try {
      for (const k of scopes) { for (const t of SCOPES[k].tables) { removed[t] = count(t); db.exec(`DELETE FROM ${t}`); } if (SCOPES[k].extra) SCOPES[k].extra(); }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); console.error('formatar:', e.message); bad('Falhou e nada foi apagado: ' + e.message, 500); }
    fails.delete(req.user.id);
    logAct(req, 'Dados formatados', `${scopes.map(k => SCOPES[k].name).join(', ')} · backup ${backup}`);
    res.json({ ok: true, backup, removed, scopes: preview() });
  }));
  app.post('/api/admin/launch', auth, adminOnly, wrap((req, res) => {
    guard(req);
    if (launched()) bad('A plataforma já foi marcada como lançada.', 409);
    const b = req.body || {};
    checkPass(req, b.password);
    if (String(b.phrase || '').trim() !== 'LANÇAR') wrong(req, 'Digite exatamente: LANÇAR');
    confirmCheck(req);
    const at = new Date().toISOString();
    put('launched', { at, by: req.user.name });
    logAct(req, 'Plataforma lançada (formatação desativada para sempre)', '');
    res.json({ ok: true, launched: { at, by: req.user.name } });
  }));
}
