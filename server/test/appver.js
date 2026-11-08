// Central do app: manifesto de versões, interface remota (OTA), versões do APK, eventos e configuração remota.
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3989, GHP = 3988, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gpv-')); mkdirSync(path.join(dir, 'www'));
const HTML = '<!doctype html><html><head><meta name="gp-ui" content="ui-abc123"><meta name="gp-build" content=""></head><body>Game Platform</body></html>';
writeFileSync(path.join(dir, 'www/index.html'), HTML);
const sha = crypto.createHash('sha256').update(HTML).digest('hex');
const APK_SHA = crypto.createHash('sha256').update('apk-bytes').digest('hex');
const gh = http.createServer((req, res) => {
  if (req.url.includes('/releases/tags/apk-latest')) return res.setHeader('content-type', 'application/json'), res.end(JSON.stringify({ name: 'Build 77', body: 'Build 77. APK de teste', assets: [{ name: 'game-platform.apk', size: 12345678, digest: 'sha256:' + APK_SHA, browser_download_url: 'https://github.com/x/y/releases/download/apk-latest/game-platform.apk' }] }));
  res.statusCode = 404; res.end();
}).listen(GHP);
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), STATIC_DIR: path.join(dir, 'www'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'teste', GH_API_BASE: `http://localhost:${GHP}`, TEST_HOSTS: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
  return { s: r.status, j, txt, h: r.headers };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  const reg = async n => (await call('POST', '/api/auth/register', { name: n, email: n.toLowerCase() + '@teste.com', password: 'senha12345' })).j;
  const adm = await reg('Admin'), ana = await reg('Ana');
  const [ADM, A] = [adm.token, ana.token];

  let m = (await call('GET', '/api/app/manifest?platform=android&build=10')).j;
  ok('manifesto é público e traz servidor, interface, conteúdo e configuração', m.ok && m.server.api === 1 && m.ui.version === 'ui-abc123' && m.ui.sha256 === sha && m.content.version.length === 12 && m.config.pollMinutes === 30);
  ok('sem versão publicada não há atualização', m.app.latest === null && m.app.update === false && m.app.mandatory === false);
  ok('entrega a interface com o mesmo SHA-256', await (async () => { const r = await call('GET', '/app/ui.html'); return r.s === 200 && r.h.get('x-gp-sha256') === sha && crypto.createHash('sha256').update(r.txt).digest('hex') === sha && /no-store/.test(r.h.get('cache-control')); })());
  ok('só administrador lê e publica versões', (await call('GET', '/api/admin/versions', null, A)).s === 403 && (await call('POST', '/api/admin/versions', { build: 50 }, A)).s === 403 && (await call('GET', '/api/admin/versions')).s === 401);

  const bad1 = await call('POST', '/api/admin/versions', { build: 50, url: 'https://evil.example.com/a.apk', sha256: APK_SHA }, ADM);
  ok('APK fora do GitHub/servidor oficial é recusado', bad1.s === 400 && /GitHub/.test(bad1.j.error), bad1.txt);
  ok('APK sem SHA-256 é recusado', (await call('POST', '/api/admin/versions', { build: 50, url: 'https://github.com/x/y/a.apk' }, ADM)).s === 400);
  ok('build inválida é recusada', (await call('POST', '/api/admin/versions', { build: 0 }, ADM)).s === 400);
  const pub = await call('POST', '/api/admin/versions', { build: 50, name: '1.2.50', notes: 'Nova tela de atualização', fixes: ['Corrige o chat', 'Melhora a Loja'], url: 'https://github.com/x/y/releases/download/apk-latest/game-platform.apk', sha256: APK_SHA, size: 9999999 }, ADM);
  ok('publica versão opcional', pub.s === 200 && pub.j.build === 50, pub.txt);
  m = (await call('GET', '/api/app/manifest?platform=android&build=40')).j;
  ok('cliente antigo vê a atualização opcional com notas, correções e SHA-256', m.app.update && !m.app.mandatory && m.app.latest.build === 50 && m.app.latest.fixes.length === 2 && m.app.latest.sha256 === APK_SHA, JSON.stringify(m.app));
  m = (await call('GET', '/api/app/manifest?platform=android&build=50')).j;
  ok('cliente em dia não vê atualização', !m.app.update && !m.app.mandatory);
  const vid = (await call('GET', '/api/admin/versions', null, ADM)).j.versions[0].id;
  ok('marcar como obrigatória', (await call('POST', `/api/admin/versions/${vid}/mandatory`, {}, ADM)).j.mandatory === true);
  m = (await call('GET', '/api/app/manifest?platform=android&build=40')).j;
  ok('obrigatória vale para build antiga e não para a atual', m.app.mandatory === true && (await call('GET', '/api/app/manifest?platform=android&build=50')).j.app.mandatory === false);
  await call('POST', `/api/admin/versions/${vid}/mandatory`, {}, ADM);
  ok('build mínima força a atualização', (await call('POST', '/api/admin/app-settings', { minBuild: 45 }, ADM)).s === 200 && (await call('GET', '/api/app/manifest?build=44')).j.app.mandatory === true && (await call('GET', '/api/app/manifest?build=45')).j.app.mandatory === false);
  await call('POST', '/api/admin/app-settings', { minBuild: 0 }, ADM);
  ok('retirar a versão tira da oferta', (await call('POST', `/api/admin/versions/${vid}/toggle`, {}, ADM)).j.active === false && (await call('GET', '/api/app/manifest?build=40')).j.app.latest === null);
  await call('POST', `/api/admin/versions/${vid}/toggle`, {}, ADM);

  const sy = await call('POST', '/api/admin/versions/sync', { notes: 'Sincronizada do GitHub', fixes: ['Ajuste X'] }, ADM);
  ok('sincroniza com o GitHub e guarda o SHA-256', sy.s === 200 && sy.j.build === 77 && sy.j.sha256 === APK_SHA, sy.txt);
  m = (await call('GET', '/api/app/manifest?build=60')).j;
  ok('a versão sincronizada vira a mais nova', m.app.latest.build === 77 && m.app.latest.name === '1.2.77' && m.app.latest.notes === 'Sincronizada do GitHub');

  ok('interface remota: desligar e exigir APK mínimo', (await call('POST', '/api/admin/app-settings', { uiOta: false, uiMinNative: 60 }, ADM)).s === 200 && (await call('GET', '/api/app/manifest')).j.ui.ota === false && (await call('GET', '/api/app/manifest')).j.ui.minNative === 60);
  const cv0 = (await call('GET', '/api/app/manifest')).j.config.version;
  ok('configuração remota muda de versão', (await call('POST', '/api/admin/app-settings', { config: { pollMinutes: 15, shortcuts: ['store', 'ach', 'BAD!'] } }, ADM)).s === 200 && (await call('GET', '/api/app/manifest')).j.config.version === cv0 + 1 && (await call('GET', '/api/app/manifest')).j.config.pollMinutes === 15 && (await call('GET', '/api/app/manifest')).j.config.shortcuts.join() === 'store,ach');
  ok('configuração inválida é recusada', (await call('POST', '/api/admin/app-settings', { config: { pollMinutes: 1 } }, ADM)).s === 400);
  const c1 = (await call('GET', '/api/app/manifest')).j.content.version;
  await call('POST', '/api/games', { title: 'Novo', category: 'Ação', dim: '2D', code: '<h1>x</h1>' }, A);
  ok('versão do conteúdo muda quando entra um jogo', (await call('GET', '/api/app/manifest')).j.content.version !== c1);

  ok('evento de atualização é registrado', (await call('POST', '/api/app/event', { kind: 'download', platform: 'android', from: 40, to: 77, ok: true, detail: 'ok' })).s === 200);
  ok('evento inválido é recusado', (await call('POST', '/api/app/event', { kind: 'hack' })).s === 400);
  await call('POST', '/api/app/event', { kind: 'check', platform: 'android', from: 40 }, A);
  const ad = (await call('GET', '/api/admin/versions', null, ADM)).j;
  ok('histórico traz versões, eventos, estatísticas e builds em uso', ad.versions.length === 2 && ad.events.some(e => e.kind === 'download' && e.to_build === 77) && ad.events.some(e => e.kind === 'check' && e.user === 'Ana') && ad.stats.length >= 2 && ad.builds[0].build === 40 && ad.ui.version === 'ui-abc123');
  ok('auditoria registra as publicações', JSON.stringify((await call('GET', '/api/admin/audit', null, ADM)).j).includes('Versão do app publicada'));
  await call('POST', '/api/admin/maintenance', { on: true, msg: 'Voltamos já' }, ADM);
  ok('o manifesto continua disponível em manutenção', (await call('GET', '/api/app/manifest')).s === 200);

  console.log(`\n${pass} passaram, ${fail} falharam`);
  srv.kill(); gh.close(); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.log('ERRO NO TESTE', e); srv.kill(); gh.close(); process.exit(1); });
