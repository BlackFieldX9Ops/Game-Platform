// Contas no app de verdade: esqueci a senha, verificar e-mail, volta do Google e sincronização do progresso.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { console.log('jsdom não instalado: rode "npm i --no-save jsdom" para este teste.'); process.exit(0); }

const PORT = 3995, URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(path.join(tmpdir(), 'gp-acc-')), dbf = path.join(dir, 's.db');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: dbf, ADMIN_EMAIL: 'adm@x.com', JWT_SECRET: 't' }, stdio: ['ignore', 'ignore', 'inherit'] });
const html = readFileSync(existsSync('www/index.html') ? 'www/index.html' : '../app/www/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function open(seed) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: URL_,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
      w.fetch = (u, o) => fetch(new URL(u, URL_), o);
      w.WebSocket = WebSocket; w.AbortController = AbortController;
      if (seed) Object.entries(seed).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
    }
  });
  const w = dom.window, d = w.document, errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  const $ = s => d.querySelector(s);
  const click = s => { const el = $(s); if (!el) { errs.push('faltou ' + s); return; } el.click(); };
  const set = (id, v) => { $('#' + id).value = v; };
  const text = () => d.getElementById('view').textContent;
  const toast = () => d.getElementById('toast').textContent;
  return { w, d, $, click, set, text, toast, errs };
}
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(60); } return false; }
async function api(method, url, body, token) {
  const r = await fetch(URL_ + 'api' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

const dbq = (sql, ...a) => { const d = new DatabaseSync(dbf); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const dbrun = (sql, ...a) => { const d = new DatabaseSync(dbf); try { d.prepare(sql).run(...a); } finally { d.close(); } };
const mailCode = (email) => dbq('SELECT body FROM dev_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1', email)[0]?.body.match(/: (\d{6})/)?.[1];

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL_ + 'api/health')).ok) break; } catch {} await wait(150); }
  const ana = await api('POST', '/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senha12345' });

  // esqueci a senha, pela tela
  const A = open({ gp_clean: 2 });
  await wait(600);
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="auth"]');
  ok('tela de entrar tem "Esqueci minha senha"', !!A.$('[data-a="authtab"][data-v="forgot"]'), A.text().slice(0, 120));
  A.click('[data-a="authtab"][data-v="forgot"]');
  A.set('fMail', 'ana@teste.com'); A.click('[data-a="fsend"]');
  ok('pede o código', await until(() => A.$('#fCode')));
  const code = mailCode('ana@teste.com');
  ok('o e-mail com o código foi enviado', /^\d{6}$/.test(code || ''));
  A.set('fCode', code); A.set('fPass', 'senhanova77'); A.click('[data-a="freset"]');
  ok('trocar a senha já entra na conta', await until(() => A.w.localStorage.getItem('gp_token')));
  ok('login com a senha nova funciona', !!(await api('POST', '/auth/login', { email: 'ana@teste.com', password: 'senhanova77' })).token);

  // verificar e-mail em Configurações
  const bt = await api('POST', '/auth/register', { name: 'Beto', email: 'beto@teste.com', password: 'senha12345' });
  const V = open({ gp_clean: 2, gp_token: bt.token, gp_user: bt.user });
  await wait(900);
  V.click('[data-a="go"][data-v="profile"]'); V.click('[data-a="sub"][data-v="settings"]');
  ok('configurações mostram "Confirme seu e-mail"', await until(() => /Confirme seu e-mail/.test(V.text())), V.text().slice(0, 200));
  dbrun('DELETE FROM dev_outbox'); V.click('[data-a="vsend"]');
  ok('pede o código de verificação', await until(() => V.$('#vCode')));
  const vc = mailCode('beto@teste.com');
  V.set('vCode', vc); V.click('[data-a="vgo"]');
  ok('e-mail confirmado some o aviso', await until(() => !/Confirme seu e-mail/.test(V.text())));

  // volta do Google: o app recebe o código pelo link e entra
  const gu = dbq("SELECT id FROM users WHERE name = 'Ana'")[0].id;
  const B = open({ gp_clean: 2 });
  await wait(500);
  dbrun('INSERT INTO auth_exchange (code, user_id, expires_at) VALUES (?,?,?)', 'abc123def4567890abc1', gu, Date.now() + 60000);
  B.w.GPAuth('abc123def4567890abc1');
  ok('código do Google entra na conta', await until(() => B.w.localStorage.getItem('gp_token')));
  ok('código do Google só vale uma vez', dbq('SELECT 1 FROM auth_exchange').length === 0);

  // progresso vai para o servidor e fica disponível para outro aparelho
  const tk = JSON.parse(B.w.localStorage.getItem('gp_token'));
  B.w.localStorage.setItem('gp_xp', '700'); await B.w.gpSyncNow();
  ok('progresso sobe para a conta', (await api('GET', '/me/progress', null, tk)).data?.gp_xp === '700');
  const C = open({ gp_clean: 2, gp_token: tk, gp_user: JSON.parse(B.w.localStorage.getItem('gp_user')) });
  ok('outro aparelho traz o progresso da conta', await until(() => C.w.localStorage.getItem('gp_xp') === '700', 5000));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  const errs = [...A.errs, ...B.errs, ...V.errs, ...C.errs].filter(e => !/reload|navigation|not implemented/i.test(e));
  if (errs.length) { console.log('Erros no app:', errs); fail++; }
  srv.kill(); rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
