// Análise automática do arquivo do jogo: tamanho, motor, memória estimada e requisitos.
import { analyze, fmtBytes } from '../src/scan.js';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'OK   ' : 'FALHA'} ${n}${c ? '' : ' ' + x}`); };

const tiny = '<!doctype html><canvas id=c></canvas><script>var x=document.getElementById("c").getContext("2d");x.fillRect(0,0,9,9)</script>';
let r = analyze(tiny);
ok('jogo pequeno em Canvas 2D é leve (512 MB)', r.ram === '512 MB' && r.gfx === 'Canvas 2D' && r.level === 'leve' && r.android === '7.0', JSON.stringify(r));
ok('o tamanho vem do arquivo', r.bytes === Buffer.byteLength(tiny) && /B$/.test(r.size));
ok('sem endereços externos: funciona sem internet', r.online === false);
ok('recomendado fica um degrau acima', r.ramRec === '1 GB');

const three = '<script>const s=new THREE.Scene();const gl=canvas.getContext("webgl2")</script>';
r = analyze(three);
ok('Three.js com WebGL 2 é detectado', r.engines.includes('Three.js') && r.gfx === 'WebGL 2' && r.webgl, JSON.stringify(r));
ok('3D pede mais memória que o 2D simples', r.ramMb > analyze(tiny).ramMb);

const big = '<img src="data:image/png;base64,' + 'A'.repeat(40_000_000) + '"><canvas></canvas>';
r = analyze(big);
ok('imagens embutidas contam no tamanho e na memória', r.files.img > 29_000_000 && r.bytes > 40_000_000 && r.ramMb > 400 && r.ram !== '512 MB' && r.level !== 'leve', JSON.stringify(r));
ok('o tamanho aparece em MB', /MB$/.test(r.size));

r = analyze('<script>createUnityInstance(c,{})</script>');
ok('Unity: WebAssembly, Android 8 e bem pesado', r.engines.includes('Unity') && r.wasm && r.android === '8.0' && r.level !== 'leve' && r.level !== 'médio', JSON.stringify(r));

r = analyze('<script src="https://cdn.exemplo.com/a.js"></script><canvas></canvas>');
ok('endereço externo: precisa de internet', r.online === true);
r = analyze('<canvas></canvas>', ['phaser']);
ok('biblioteca marcada entra na conta', r.engines.includes('Phaser'));
ok('formata bytes', fmtBytes(512) === '512 B' && fmtBytes(1536) === '1,5 KB' && fmtBytes(5 * 1024 * 1024) === '5,0 MB');

// ---- pelo servidor ----
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'gps-'));
const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), ADMIN_EMAIL: 'admin@teste.com', STUDIO_GATE: 'off', CONFIRM_GATE: 'off', BACKUP_AUTO: 'off', JWT_SECRET: 'x'.repeat(40) }, stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function call(m, u, b, t) { const x = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); const txt = await x.text(); let j = {}; try { j = JSON.parse(txt); } catch {} return { s: x.status, j }; }
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  const a = (await call('POST', '/api/auth/register', { name: 'Ana', email: 'ana@teste.com', password: 'senha12345' })).j;
  const base = { title: 'Jogo Leve', description: 'x', category: 'Ação', age: 'Livre', dim: '2D', libs: [], code: tiny, orientation: 'auto', tags: [], version: '1.0.0', visibility: 'public', settings: {} };
  const pub = await call('POST', '/api/games', base, a.token);
  ok('publicar funciona', pub.s === 201, JSON.stringify(pub.j));
  const g = (await call('GET', '/api/games/' + pub.j.id, null, a.token)).j.game || (await call('GET', '/api/games/' + pub.j.id, null, a.token)).j;
  const req = (g.settings || {}).req;
  ok('o servidor guarda a análise junto com o jogo', req && req.ram === '512 MB' && req.bytes === Buffer.byteLength(tiny), JSON.stringify(g).slice(0, 300));
  ok('o criador não consegue forjar a análise', (await call('POST', '/api/games', { ...base, title: 'Forjado', settings: { req: { ram: '1 GB' } } }, a.token)).s === 201
    && ((await call('GET', '/api/games', null, a.token)).j.games.find(x => x.title === 'Forjado').settings.req.ram === '512 MB'));
  const an = await call('POST', '/api/games/analyze', { code: three, libs: ['three'] }, a.token);
  ok('analisar antes de publicar', an.s === 200 && an.j.req.engines.includes('Three.js'), JSON.stringify(an.j));
  ok('analisar exige login', (await call('POST', '/api/games/analyze', { code: three })).s === 401);
  ok('analisar sem código é recusado', (await call('POST', '/api/games/analyze', { code: '' }, a.token)).s === 400);
} catch (e) { console.error(e); fail++; }
srv.kill();
console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
