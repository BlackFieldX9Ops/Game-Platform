// Teste do app de verdade (www/index.html) conversando com o servidor, com dois jogadores.
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
const dir = mkdtempSync(path.join(tmpdir(), 'gp-mis-'));
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 'm.db'), ADMIN_EMAIL: 'adm@x.com', STUDIO_GATE: 'off', JWT_SECRET: 't' }, stdio: ['ignore', 'ignore', 'inherit'] });
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
  w.eval('GPT.forceStudio()');
  w.addEventListener('error', e => errs.push(e.message));
  const $ = s => d.querySelector(s);
  const click = s => { const el = $(s); if (!el) { errs.push('faltou ' + s); return; } el.click(); };
  const set = (id, v) => { $('#' + id).value = v; };
  const text = () => d.getElementById('view').textContent;
  const toast = () => d.getElementById('toast').textContent;
  return { w, d, $, click, set, text, toast, errs };
}
async function until(fn, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(60); } return false; }
const game = { id: 'u1', title: 'Corrida Neon', genre: 'Corrida', cat: 'Corrida', dim: '2D', age: 'Livre', desc: 'x', code: '<h1>ok</h1>', libs: {}, color: ['#7c3aed', '#06b6d4'], dev: 'Eu', status: 'published', created: '2026-01-01 00:00:00', dl: '0', icon: 'pad', rc: 0 };
async function main() {
  let A;
  const startGame = async () => { if (!A.$('[data-a="play"]')) { A.click('[data-a="go"][data-v="home"]'); A.click('[data-a="open"][data-v="u1"]'); } await until(() => A.$('[data-a="play"]')); A.click('[data-a="play"]'); await until(() => !A.$('#player').hidden); };
  await wait(800);
  A = open({ gp_clean: 2, gp_mine: [game], gp_lib: { u1: 1 } });
  await wait(500);
  // jogo: menu compacto, cadeado e botão voltar
  await startGame();
  const shown = () => !A.$('#player').hidden;
  ok('o jogo abre com o menu compacto: Sair e cadeado', await until(shown) && /Sair/.test(A.$('#pClose').textContent) && !!A.$('#pLock'));
  ok('cadeado começa aberto', A.$('#pLock').getAttribute('aria-pressed') === 'false');
  A.click('#pLock');
  ok('cadeado fecha e fica destacado', A.$('#pLock').getAttribute('aria-pressed') === 'true' && A.$('#pLock').classList.contains('on'));
  A.click('#pClose'); await wait(200);
  ok('com o cadeado fechado o botão Sair não sai do jogo', shown() && /travada/i.test(A.toast()));
  A.w.history.back(); await wait(300);
  ok('com o cadeado fechado o botão voltar do celular não sai do jogo', shown() && /travada/i.test(A.toast()));
  A.w.history.back(); await wait(300);
  ok('continua travado depois de voltar de novo', shown());
  A.click('#pLock');
  ok('cadeado abre', A.$('#pLock').getAttribute('aria-pressed') === 'false');
  A.click('#pClose');
  ok('com o cadeado aberto o Sair fecha o jogo', await until(() => !shown())); await wait(400);
  await startGame();
  A.w.history.back();
  ok('com o cadeado aberto o botão voltar do celular fecha o jogo', await until(() => !shown()));

  // missões
  A.click('[data-a="go"][data-v="profile"]');
  ok('perfil tem o atalho de missões', await until(() => /Missões/.test(A.text()) && A.$('[data-a="sub"][data-v="missions"]')));
  A.click('[data-a="sub"][data-v="missions"]');
  ok('missões geradas para o jogo, com botão Aceitar', await until(() => /Primeira corrida/.test(A.text()) && /Corrida Neon/.test(A.text()) && A.$('[data-a="macc"]')), A.text().slice(0, 300));
  ok('missões secretas não aparecem antes do requisito', !/Veterano de|Sem pressa/.test(A.text()));
  ok('histórico mostra as partidas do jogo', /2 partidas/.test(A.text()));
  ok('XP total e nível aparecem', /XP total/.test(A.text()) && /faltam/.test(A.text()));
  A.click('[data-a="macc"][data-v="u1|p5"]');
  ok('aceitar leva a missão para Em andamento', await until(() => A.$('[data-a="mdrop"]') && /0 \/ 5/.test(A.text())));
  A.click('[data-a="mdrop"]');
  ok('abandonar devolve a missão para Disponíveis', await until(() => !A.$('[data-a="mdrop"]') && A.$('[data-a="macc"][data-v="u1|p5"]')));
  A.click('[data-a="macc"][data-v="u1|p1"]');
  ok('missão de uma partida fica em andamento', await until(() => A.$('[data-a="mdrop"][data-v="u1|p1"]')));
  // joga uma partida: conclui sozinha
  await startGame();
  A.click('#pClose'); await until(() => !shown()); await wait(300);
  ok('avisa a missão concluída com o XP', /Missão concluída: \+20 XP/.test(A.toast()), A.toast());
  A.click('[data-a="go"][data-v="profile"]'); A.click('[data-a="sub"][data-v="missions"]');
  ok('missão concluída mostra o XP ganho', await until(() => /\+20 XP ganhos/.test(A.text())));
  ok('XP total soma partidas e missão (3 × 25 + 20)', /XP total\s*95/.test(A.text()) || /95/.test(A.text()), A.text().slice(0, 200));
  ok('nenhum erro de script (jogo e missões)', A.errs.length === 0, JSON.stringify(A.errs));

  // missão secreta depois do requisito
  const B = open({ gp_clean: 2, gp_mine: [game], gp_lib: { u1: 1 }, gp_pc: { u1: 10 } });
  await wait(500);
  B.click('[data-a="go"][data-v="profile"]'); B.click('[data-a="sub"][data-v="missions"]');
  ok('missão secreta aparece depois de 10 partidas', await until(() => /Veterano de Corrida Neon/.test(B.text()) && /Secreta/.test(B.text())));
  // missões do criador: definidas no Studio, valem só para o jogo dele
  const D = open({ gp_clean: 2 });
  await wait(500);
  D.click('[data-a="go"][data-v="studio"]'); D.click('[data-a="stab"][data-v="pub"]');
  D.set('sTitle', 'Torre Sombria'); D.set('sDesc', 'Suba a torre');
  D.click('[data-a="ssect"][data-v="mis"]');
  ok('Studio tem a aba Missões', await until(() => D.$('[data-a="miadd"]')) && /Missões do jogo/.test(D.text()));
  D.click('[data-a="miadd"]'); D.click('[data-a="miadd"]');
  const setMi = (i, f, v) => { const e = D.d.querySelector(`[data-mi="${i}:${f}"]`); e.value = v; };
  setMi(0, 't', 'Derrotar o chefão'); setMi(0, 'd', 'Vença o chefe do andar 3'); setMi(0, 'goal', '2'); setMi(0, 'xp', '70');
  setMi(1, 't', 'Segredo da torre'); setMi(1, 'k', 'minutes'); setMi(1, 'goal', '10'); setMi(1, 'xp', '90');
  D.d.querySelector('[data-mi="1:secret"]').checked = true; D.d.querySelector('[data-mi="1:secret"]').dispatchEvent(new D.w.Event('change', { bubbles: true }));
  ok('missão secreta pede o número de partidas', await until(() => D.d.querySelector('[data-mi="1:req"]')));
  setMi(1, 'req', '3');
  D.click('[data-a="ssect"][data-v="code"]'); D.click('[data-a="smode"][data-v="code"]'); D.click('[data-a="tpl"]');
  D.click('[data-a="ssect"][data-v="rev"]'); D.click('[data-a="spub"]');
  await wait(600);
  D.click('[data-a="go"][data-v="profile"]'); D.click('[data-a="sub"][data-v="missions"]');
  ok('as missões do criador aparecem no lugar das padrão', await until(() => /Derrotar o chefão/.test(D.text()) && /Vença o chefe do andar 3/.test(D.text()) && !/Primeira partida|Meia hora de/.test(D.text())), D.text().slice(0, 300));
  ok('missão secreta do criador fica escondida até o requisito', !/Segredo da torre/.test(D.text()));
  ok('XP da missão do criador é o definido por ele', /\+70 XP/.test(D.text()));
  const C = open({ gp_clean: 2 });
  await wait(400);
  C.click('[data-a="go"][data-v="profile"]'); C.click('[data-a="sub"][data-v="missions"]');
  ok('sem jogos não há missões inventadas', await until(() => /As missões são geradas para cada jogo/.test(C.text())) && !C.$('[data-a="macc"]'));
}
try { await main(); } catch (e) { fail++; console.error('ERRO', e); }
srv.kill(); rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passaram, ${fail} falharam`); process.exit(fail ? 1 : 0);
