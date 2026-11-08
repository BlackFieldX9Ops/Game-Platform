// Central do app: manifesto de versões (app, interface, serviços, conteúdo), atualização remota da interface,
// histórico de versões do APK, eventos de atualização e configuração remota única para Android e Web.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const OFFICIAL = 'https://game-platform-dgvz.onrender.com';
const KINDS = ['check', 'download', 'installed', 'failed', 'ota', 'ota_fail', 'ota_rollback', 'offline'];
const DEF_CONFIG = { pollMinutes: 30, shortcuts: ['store', 'lib', 'missions', 'ach'], uiScaleMax: 140 };
const HOSTS = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|github-releases\.githubusercontent\.com)$/;

export function mountAppVer(c) {
  const { app, auth, softAuth, adminOnly, wrap, bad, int, get, all, run, logAct, confirmCheck, parseJ, wwwDir, version, notifyUpdate } = c;
  const env = process.env, GH = env.GH_REPO || 'BlackFieldX9Ops/Game-Platform', GHAPI = env.GH_API_BASE || 'https://api.github.com';
  const setting = (k, d) => { const r = get('SELECT value FROM settings WHERE key = ?', k); return r ? parseJ(r.value, d) : d; };
  const setSetting = (k, v) => run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
  const cfg = () => ({ ...DEF_CONFIG, ...setting('app_config', {}) });
  const cfgVer = () => Number(setting('app_cfg_ver', 1)) || 1;

  // ---- versão da interface (o index.html que o servidor entrega) ----
  let uiCache = { m: 0, v: null };
  function uiInfo() {
    try {
      const f = path.join(wwwDir || '', 'index.html'), st = fs.statSync(f);
      if (uiCache.m !== st.mtimeMs) {
        const buf = fs.readFileSync(f), sha = sha256(buf), meta = /<meta name="gp-ui" content="([^"]*)">/.exec(buf.subarray(0, 4000).toString('utf8'));
        uiCache = { m: st.mtimeMs, v: { version: (meta && meta[1]) || sha.slice(0, 12), sha256: sha, size: buf.length } };
      }
      return uiCache.v;
    } catch { return null; }
  }
  const contentVersion = () => {
    const g = get("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at),'') AS u FROM games WHERE status = 'published' AND visibility = 'public'");
    const cat = get("SELECT value FROM settings WHERE key = 'categories'"), pr = get("SELECT value FROM settings WHERE key = 'price_ov'");
    return sha256(`${g.n}|${g.u}|${cat ? cat.value : ''}|${pr ? pr.value : ''}|${cfgVer()}`).slice(0, 12);
  };
  const shape = r => !r ? null : ({ id: r.id, build: r.build, name: r.name, platform: r.platform, notes: r.notes, fixes: parseJ(r.fixes, []), mandatory: !!r.mandatory, url: r.url, sha256: r.sha256, size: r.size, active: !!r.active, actor: r.actor, created_at: r.created_at });
  const latestFor = platform => shape(get('SELECT * FROM app_versions WHERE platform = ? AND active = 1 ORDER BY build DESC LIMIT 1', platform));

  app.get('/api/app/manifest', (req, res) => {
    const platform = req.query.platform === 'linux' ? 'linux' : 'android', build = Number(req.query.build) || 0;
    const latest = latestFor(platform), minBuild = Math.max(Number(setting('app_min_build', 0)) || 0, 0);
    const ui = uiInfo(), ota = setting('app_ui_ota', '1') !== '0' && setting('app_ui_ota', '1') !== 0;
    const forced = !!build && !!((minBuild > 0 && build < minBuild) || (latest && latest.mandatory && build < latest.build));
    res.set('Cache-Control', 'no-store').json({
      ok: true, time: Date.now(),
      server: { name: 'Game Platform', version: version || '1.0.0', api: 1, official: OFFICIAL },
      app: { latest, minBuild, update: !!(latest && build && latest.build > build), mandatory: forced },
      ui: ui ? { version: ui.version, sha256: ui.sha256, size: ui.size, url: '/app/ui.html', ota, minNative: Number(setting('app_ui_min_native', 0)) || 0 } : null,
      content: { version: contentVersion() },
      config: { version: cfgVer(), ...cfg() }
    });
  });
  app.get('/app/ui.html', (_req, res) => {
    const ui = uiInfo(); if (!ui) return res.status(404).type('text').send('sem interface');
    res.set({ 'Cache-Control': 'no-store', 'X-GP-UI': ui.version, 'X-GP-SHA256': ui.sha256, 'Content-Type': 'text/html; charset=utf-8' }).send(fs.readFileSync(path.join(wwwDir, 'index.html')));
  });
  const hits = new Map();
  app.post('/api/app/event', softAuth || ((_q, _s, n) => n()), (req, res) => {
    const ip = req.ip || '', now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60_000);
    if (h.length >= 30) return res.status(429).json({ error: 'Muitos eventos' });
    h.push(now); hits.set(ip, h); if (hits.size > 5000) hits.clear();
    const b = req.body || {};
    if (!KINDS.includes(b.kind)) return res.status(400).json({ error: 'Evento inválido' });
    run('INSERT INTO app_events (kind, platform, from_build, to_build, ui, ok, detail, user_id, ip) VALUES (?,?,?,?,?,?,?,?,?)', b.kind, String(b.platform || '').slice(0, 12), Number(b.from) || 0, Number(b.to) || 0, String(b.ui || '').slice(0, 24), b.ok === false ? 0 : 1, String(b.detail || '').slice(0, 160), req.user ? req.user.id : null, ip.slice(0, 45));
    res.json({ ok: true });
  });

  // ---- painel: versões, configuração e histórico ----
  async function fromGithub() {
    const r = await fetch(`${GHAPI}/repos/${GH}/releases/tags/apk-latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GamePlatformServer' } });
    if (!r.ok) bad('Não consegui ler a versão no GitHub (' + r.status + ')', 502);
    const j = await r.json(), m = /build\s*[:=]?\s*(\d+)/i.exec(j.body || '') || /(\d+)/.exec(j.name || ''), a = (j.assets || []).find(x => /\.apk$/i.test(x.name));
    if (!m || !a) bad('A versão do GitHub não tem número de build ou APK', 502);
    let sha = String(a.digest || '').replace(/^sha256:/, '');
    if (!/^[0-9a-f]{64}$/i.test(sha)) {
      const d = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'GamePlatformServer' } });
      if (!d.ok) bad('Não consegui baixar o APK para conferir (' + d.status + ')', 502);
      sha = sha256(Buffer.from(await d.arrayBuffer()));
    }
    return { build: Number(m[1]), name: '1.2.' + m[1], url: a.browser_download_url, sha256: sha.toLowerCase(), size: a.size || 0, notes: String(j.body || '').slice(0, 400) };
  }
  function checkUrl(u) {
    let x; try { x = new URL(u); } catch { bad('Endereço do APK inválido'); }
    const own = (() => { try { return new URL(env.PUBLIC_URL || OFFICIAL).host; } catch { return ''; } })();
    if (x.protocol !== 'https:' || !(HITS_OK(x.host) || x.host === own)) bad('O APK precisa ficar no GitHub ou no servidor oficial (https)');
  }
  const HITS_OK = h => HOSTS.test(h) || (env.TEST_HOSTS === '1' && /^localhost(:\d+)?$/.test(h));
  function upsert(req, v) {
    const build = Number(v.build);
    if (!Number.isInteger(build) || build < 1 || build > 9_999_999) bad('Número de build inválido');
    const url = String(v.url || ''); if (url) checkUrl(url);
    const sha = String(v.sha256 || '').toLowerCase();
    if (url && !/^[0-9a-f]{64}$/.test(sha)) bad('SHA-256 do APK é obrigatório (64 caracteres)');
    const name = String(v.name || '1.2.' + build).trim().slice(0, 24), notes = String(v.notes || '').trim().slice(0, 600);
    const fixes = (Array.isArray(v.fixes) ? v.fixes : String(v.fixes || '').split('\n')).map(x => String(x).trim()).filter(Boolean).slice(0, 12).map(x => x.slice(0, 140));
    const platform = v.platform === 'linux' ? 'linux' : 'android', old = get('SELECT id FROM app_versions WHERE platform = ? AND build = ?', platform, build);
    if (old) run('UPDATE app_versions SET name=?, notes=?, fixes=?, mandatory=?, url=?, sha256=?, size=?, active=1, actor=? WHERE id=?', name, notes, JSON.stringify(fixes), v.mandatory ? 1 : 0, url, sha, Number(v.size) || 0, req.user.name, old.id);
    else run('INSERT INTO app_versions (build, name, platform, notes, fixes, mandatory, url, sha256, size, actor) VALUES (?,?,?,?,?,?,?,?,?,?)', build, name, platform, notes, JSON.stringify(fixes), v.mandatory ? 1 : 0, url, sha, Number(v.size) || 0, req.user.name);
    logAct(req, old ? 'Versão do app atualizada' : 'Versão do app publicada', `build ${build} (${name})${v.mandatory ? ' · obrigatória' : ''}`);
    return build;
  }
  app.get('/api/admin/versions', auth, adminOnly, (_req, res) => {
    const ui = uiInfo();
    res.json({
      versions: all('SELECT * FROM app_versions ORDER BY build DESC, id DESC LIMIT 60').map(shape),
      settings: { minBuild: Number(setting('app_min_build', 0)) || 0, uiOta: setting('app_ui_ota', '1') !== '0' && setting('app_ui_ota', '1') !== 0, uiMinNative: Number(setting('app_ui_min_native', 0)) || 0, config: cfg(), configVersion: cfgVer() },
      ui, content: contentVersion(), server: version || '1.0.0',
      events: all('SELECT e.id, e.kind, e.platform, e.from_build, e.to_build, e.ui, e.ok, e.detail, e.created_at, u.name AS user FROM app_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 80'),
      stats: all("SELECT kind, ok, COUNT(*) AS n FROM app_events WHERE created_at >= datetime('now','-7 days') GROUP BY kind, ok"),
      builds: all("SELECT from_build AS build, COUNT(*) AS n FROM app_events WHERE kind = 'check' AND from_build > 0 AND created_at >= datetime('now','-7 days') GROUP BY from_build ORDER BY n DESC LIMIT 8")
    });
  });
  app.post('/api/admin/versions', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const build = upsert(req, req.body || {});
    if (req.body.notify && notifyUpdate) notifyUpdate(req.body.name || '1.2.' + build, String(req.body.notes || '').slice(0, 120));
    res.json({ ok: true, build });
  }));
  app.post('/api/admin/versions/sync', auth, adminOnly, wrap(async (req, res) => {
    confirmCheck(req);
    const v = await fromGithub();
    const old = get("SELECT * FROM app_versions WHERE platform = 'android' AND build = ?", v.build);
    const build = upsert(req, { ...v, notes: (req.body && req.body.notes) || (old && old.notes) || '', fixes: (req.body && req.body.fixes) || (old && parseJ(old.fixes, [])) || [], mandatory: req.body && req.body.mandatory !== undefined ? req.body.mandatory : old && old.mandatory });
    if (req.body && req.body.notify && notifyUpdate) notifyUpdate(v.name, String((req.body && req.body.notes) || '').slice(0, 120));
    res.json({ ok: true, build, sha256: v.sha256 });
  }));
  app.post('/api/admin/versions/:id/toggle', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const r = get('SELECT * FROM app_versions WHERE id = ?', int(req.params.id, 'id'));
    if (!r) bad('Versão não encontrada', 404);
    run('UPDATE app_versions SET active = ? WHERE id = ?', r.active ? 0 : 1, r.id);
    logAct(req, r.active ? 'Versão retirada' : 'Versão reativada', `build ${r.build}`);
    res.json({ ok: true, active: !r.active });
  }));
  app.post('/api/admin/versions/:id/mandatory', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const r = get('SELECT * FROM app_versions WHERE id = ?', int(req.params.id, 'id'));
    if (!r) bad('Versão não encontrada', 404);
    run('UPDATE app_versions SET mandatory = ? WHERE id = ?', r.mandatory ? 0 : 1, r.id);
    logAct(req, r.mandatory ? 'Atualização opcional' : 'Atualização obrigatória', `build ${r.build}`);
    res.json({ ok: true, mandatory: !r.mandatory });
  }));
  app.post('/api/admin/app-settings', auth, adminOnly, wrap((req, res) => {
    confirmCheck(req);
    const b = req.body || {}, out = [];
    if (b.minBuild !== undefined) { const n = Number(b.minBuild); if (!Number.isInteger(n) || n < 0 || n > 9_999_999) bad('Build mínima inválida'); setSetting('app_min_build', n); out.push('build mínima ' + n); }
    if (b.uiOta !== undefined) { setSetting('app_ui_ota', b.uiOta ? '1' : '0'); out.push('interface remota ' + (b.uiOta ? 'ligada' : 'desligada')); }
    if (b.uiMinNative !== undefined) { const n = Number(b.uiMinNative); if (!Number.isInteger(n) || n < 0) bad('Build nativa mínima inválida'); setSetting('app_ui_min_native', n); out.push('interface exige APK ' + n); }
    if (b.config && typeof b.config === 'object') {
      const cur = cfg(), nx = { ...cur };
      if (b.config.pollMinutes !== undefined) { const n = Number(b.config.pollMinutes); if (!Number.isInteger(n) || n < 5 || n > 720) bad('Verificação a cada 5 a 720 minutos'); nx.pollMinutes = n; }
      if (Array.isArray(b.config.shortcuts)) nx.shortcuts = b.config.shortcuts.map(String).filter(x => /^[a-z_]{2,16}$/.test(x)).slice(0, 8);
      if (b.config.uiScaleMax !== undefined) { const n = Number(b.config.uiScaleMax); if (!Number.isInteger(n) || n < 100 || n > 200) bad('Tamanho máximo de 100 a 200%'); nx.uiScaleMax = n; }
      setSetting('app_config', nx); setSetting('app_cfg_ver', cfgVer() + 1); out.push('configuração remota v' + cfgVer());
    }
    if (!out.length) bad('Nada para alterar');
    logAct(req, 'Configurações do app', out.join(' · '));
    res.json({ ok: true });
  }));
  return { uiInfo, contentVersion };
}
