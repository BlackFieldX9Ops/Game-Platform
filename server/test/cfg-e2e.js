// Painel: Configurações (salvar, regras, formatar, lançar) e, no app, Regras e requisitos, aviso e Jogue e compartilhe.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { console.log('jsdom não instalado: rode "npm i --no-save jsdom" para este teste.'); process.exit(0); }

const PORT = 3994, URL_ = `http://localhost:${PORT}/`;
const dir = mkdtempSync(path.join(tmpdir(), 'gp-cf-')), dbf = path.join(dir, 's.db');
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: dbf, ADMIN_EMAIL: 'adm@x.com', JWT_SECRET: 't', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off' }, stdio: ['ignore', 'ignore', 'inherit'] });
const html = readFileSync(existsSync('www/index.html') ? 'www/index.html' : '../app/www/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function open(seed, wide = true) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: URL_,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
      w.fetch = (u, o) => fetch(new URL(u, URL_), o);
      w.WebSocket = WebSocket; w.AbortController = AbortController;
      w.matchMedia = q => ({ matches: /min-width:\s*1000px/.test(q) ? wide : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      if (seed) Object.entries(seed).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
    }
  });
  const w = dom.window, d = w.document, errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  const $ = s => d.querySelector(s);
  const click = s => { const el = $(s); if (!el) { errs.push('faltou ' + s); return; } el.click(); };
  const ws = () => d.getElementById('ws');
  const wtext = () => ws().textContent;
  return { w, d, $, click, ws, wtext, errs, toast: () => d.getElementById('toast').textContent };
}
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(60); } return false; }
async function api(method, url, body, token) {
  const r = await fetch(URL_ + 'api' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const reg = (name) => api('POST', '/auth/register', { name, email: name.toLowerCase() + '@x.com', password: 'senha12345' });

async function main() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL_ + 'api/health')).ok) break; } catch {} await wait(150); }
  const adm = await reg('adm'); adm.user.name = 'Chefe';
  const ana = await reg('Ana');
  await api('POST', '/store/checkout', { id: 'coins500' }, ana.token);

  const A = open({ gp_clean: 2, gp_token: adm.token, gp_user: adm.user });
  ok('painel abre', await until(() => !A.ws().hidden));
  ok('menu tem Configurações', /Configurações/.test(A.wtext()));
  A.click('[data-a="w_sec"][data-v="cfg"]');
  ok('abas de configurações carregam', await until(() => /Cadastro e login/.test(A.wtext()) && /Identidade da plataforma/.test(A.wtext())), A.wtext().slice(0, 200));

  // geral
  A.$('#wsPl_name').value = 'Arena X'; A.$('#wsPl_tagline').value = 'Jogue sem parar.'; A.$('#wsCf_homeNotice').value = 'Manutenção no sábado às 10h';
  A.click('[data-a="w_cfgsave"]');
  ok('salva identidade e aviso', await until(async () => { const r = await api('GET', '/platform'); return r.platform.name === 'Arena X' && r.notice === 'Manutenção no sábado às 10h'; }));
  ok('toast confirma', await until(() => /salvas/.test(A.toast())), A.toast());

  // chat
  A.click('[data-a="w_cftab"][data-v="chat"]');
  ok('aba de chat mostra os campos', await until(() => !!A.$('#wsCf_maxMsgLen') && !!A.$('#wsCf_slowModeSec')));
  A.$('#wsCf_maxMsgLen').value = '40'; A.$('#wsCf_allowImages').checked = false;
  A.click('[data-a="w_cfgsave"]');
  ok('salva limites do chat', await until(async () => { const r = await api('GET', '/admin/config', null, adm.token); return r.values.maxMsgLen === 40 && r.values.allowImages === false; }));
  A.$('#wsCf_maxMsgLen').value = '2'; A.click('[data-a="w_cfgsave"]');
  ok('valor fora do limite é recusado na tela', await until(() => /número de/.test(A.toast())), A.toast());
  A.click('[data-a="w_cftab"][data-v="mod"]');
  await until(() => !!A.$('#wsCf_bannedWords'));
  A.$('#wsCf_bannedWords').value = 'tolo\nboboca'; A.click('[data-a="w_cfgsave"]');
  ok('salva palavras proibidas', await until(async () => (await api('GET', '/admin/config', null, adm.token)).values.bannedWords.length === 2));
  A.click('[data-a="w_cftab"][data-v="push"]');
  ok('notificações: segurança aparece travada', await until(() => !!A.$('#wsCfc_security') && A.$('#wsCfc_security').disabled));

  // regras
  A.click('[data-a="w_cftab"][data-v="rules"]');
  ok('regras abrem com o texto padrão', await until(() => !!A.$('#wsRs_t_0') && /Respeito/.test(A.$('#wsRs_t_0').value)));
  A.click('[data-a="w_rsadd"]');
  ok('nova regra aparece', await until(() => !!A.$('#wsRs_t_6')));
  A.$('#wsRs_t_6').value = 'Regra nova'; A.$('#wsRs_b_6').value = 'Texto da regra nova.';
  A.click('[data-a="w_rddel"][data-v="5"]');
  ok('remove requisito sem perder o texto digitado', await until(() => !A.$('#wsRd_n_5') && A.$('#wsRs_t_6') && A.$('#wsRs_t_6').value === 'Regra nova'));
  A.$('#wsRd_r_0').value = 'Android 8 ou mais novo';
  A.click('[data-a="w_rsave"]');
  ok('publica regras e requisitos', await until(async () => { const r = (await api('GET', '/rules')).rules; return r.sections.length === 7 && r.devices.length === 5 && r.devices[0].req === 'Android 8 ou mais novo'; }));

  // lançamento e formatação
  A.click('[data-a="w_cftab"][data-v="launch"]');
  ok('formatação lista o que será apagado', await until(() => /Compras e vendas/.test(A.wtext()) && /FORMATAR TUDO/.test(A.wtext())));
  A.$('#wsRzPass').value = 'senha12345'; A.$('#wsRzPhr').value = 'errado';
  A.click('[data-a="w_rzgo"]');
  ok('frase errada é barrada antes de enviar', await until(() => /Digite exatamente/.test(A.toast())));
  A.$('#wsRzPhr').value = 'FORMATAR TUDO';
  A.click('[data-a="w_rzgo"]');
  ok('pede uma última confirmação', await until(() => !!A.$('[data-a="w_mok"]')));
  A.click('[data-a="w_mok"]');
  ok('formata e informa o backup', await until(() => /Backup/.test(A.toast())), A.toast());
  ok('o saldo da Ana voltou a zero', await until(async () => (await api('GET', '/store', null, ana.token)).coins === 0));
  A.$('#wsLcPass').value = 'senha12345'; A.$('#wsLcPhr').value = 'LANÇAR';
  A.click('[data-a="w_lcgo"]');
  await until(() => !!A.$('[data-a="w_mok"]')); A.click('[data-a="w_mok"]');
  ok('lança a plataforma', await until(async () => (await api('GET', '/platform')).launched === true));
  ok('depois do lançamento a formatação some', await until(() => /desativada para sempre/.test(A.wtext()) && !A.$('[data-a="w_rzgo"]')));

  // links de outras seções
  A.click('[data-a="w_sec"][data-v="sec"]');
  ok('Segurança leva às configurações', await until(() => !!A.$('[data-a="w_cfgo"][data-v="signup"]')));
  A.click('[data-a="w_cfgo"][data-v="signup"]');
  ok('o atalho abre a aba certa', await until(() => !!A.$('#wsCf_minPassword')));

  // no app (celular)
  const M = open({ gp_clean: 2, gp_token: ana.token, gp_user: ana.user }, false);
  await wait(2200);
  ok('Início mostra o aviso e a frase novos', /Manutenção no sábado às 10h/.test(M.d.getElementById('main') ? M.d.getElementById('main').textContent : M.d.body.textContent) && /Jogue sem parar\./.test(M.d.body.textContent), M.d.body.textContent.slice(0, 200));
  ok('Início tem o painel Jogue e compartilhe', /Jogue e compartilhe/.test(M.d.body.textContent) && !!M.$('[data-a="sharego"]'));
  M.d.querySelector('[data-a="sub"][data-v="settings"]').click();
  ok('Configurações tem Regras e requisitos', !!M.$('[data-a="sub"][data-v="rules"]'));
  M.click('[data-a="sub"][data-v="rules"]');
  ok('a página mostra a regra e o requisito novos', await until(() => /Regra nova/.test(M.d.body.textContent) && /Android 8 ou mais novo/.test(M.d.body.textContent) && /Seu aparelho/.test(M.d.body.textContent)), M.d.body.textContent.slice(0, 200));
  M.click('[data-a="back"]');
  ok('voltar leva às Configurações', await until(() => !!M.$('[data-a="sub"][data-v="rules"]')));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  const errs = [...A.errs, ...M.errs];
  if (errs.length) { console.log('Erros no app:', errs); fail++; }
  srv.kill(); rmSync(dir, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); srv.kill(); process.exit(1); });
