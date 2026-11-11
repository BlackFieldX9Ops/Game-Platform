// Análise automática do arquivo do jogo: tamanho, o que ele carrega e uma estimativa dos requisitos de celular.
// É uma ESTIMATIVA feita só lendo o arquivo (não roda o jogo): serve para o jogador saber se vai rodar no aparelho dele.
export const SCAN_VERSION = 1;

const MB = 1024 * 1024;
const TIERS = [[300, '512 MB'], [700, '1 GB'], [1400, '2 GB'], [2400, '3 GB'], [3600, '4 GB'], [Infinity, '6 GB']];
const TIER_MB = [512, 1024, 2048, 3072, 4096, 6144];
const tierOf = mb => TIERS.findIndex(t => mb <= t[0]);

// Tamanho aproximado de cada biblioteca que o app carrega por conta própria (minificadas).
const LIB_KB = { three: 700, phaser: 1100, p5: 1000, pixi: 450 };

// Motores e tecnologias: o que costuma pesar mais em memória (MB de base) e como reconhecer.
const ENGINES = [
  ['Unity', /createUnityInstance|UnityLoader|UnityProgress/, 900],
  ['Godot', /\bGodot\b|godot\.js|Engine\.load\(/, 700],
  ['Babylon.js', /\bBABYLON\./, 550],
  ['PlayCanvas', /\bpc\.Application\b|playcanvas/i, 500],
  ['Three.js', /\bTHREE\./, 380],
  ['Phaser', /\bPhaser\./, 260],
  ['PixiJS', /\bPIXI\./, 240],
  ['p5.js', /\bcreateCanvas\s*\(/, 200],
];
const HEAD_RE = /^data:([a-z]+)\/[\w.+-]+;base64,/;
const KIND = { image: 'img', audio: 'audio', video: 'video', font: 'font' };

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < MB) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' KB';
  return (n / MB).toFixed(n < 10 * MB ? 1 : 0).replace('.', ',') + ' MB';
}

/** @param {string} code HTML/JS do jogo  @param {string[]} libs  @param {{n:string,u?:string,c?:string}[]} ext */
export function analyze(code, libs = [], ext = []) {
  const text = String(code || '');
  const codeBytes = Buffer.byteLength(text, 'utf8');
  // arquivos embutidos no próprio HTML (imagens, sons, fontes…): contam no tamanho e pesam na memória
  const assets = { img: 0, audio: 0, video: 0, font: 0, other: 0, count: 0 };
  // varre à mão (uma regex sobre dezenas de MB estoura a pilha do V8)
  let at = 0;
  while ((at = text.indexOf('data:', at)) >= 0) {
    const h = HEAD_RE.exec(text.slice(at, at + 80));
    if (!h) { at += 5; continue; }
    let e = at + h[0].length;
    for (; e < text.length; e++) { const c = text.charCodeAt(e); if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 47 || c === 61)) break; }
    const n = e - at - h[0].length;
    if (n >= 200) { const bytes = Math.floor(n * 3 / 4), k = KIND[h[1]] || 'other'; assets[k] += bytes; assets.count++; }
    at = e;
  }
  const assetBytes = assets.img + assets.audio + assets.video + assets.font + assets.other;
  const scriptBytes = Math.max(0, codeBytes - Math.round(assetBytes * 4 / 3));
  const extBytes = (ext || []).reduce((a, x) => a + (x && x.c ? Buffer.byteLength(x.c, 'utf8') : 0), 0);
  const libBytes = (libs || []).reduce((a, l) => a + (LIB_KB[l] || 0) * 1024, 0);
  const hay = text.slice(0, 6_000_000) + (ext || []).map(x => (x && x.c) || '').join('\n').slice(0, 1_000_000);

  const engines = ENGINES.filter(e => e[1].test(hay)).map(e => e[0]);
  for (const l of libs || []) { const n = { three: 'Three.js', phaser: 'Phaser', p5: 'p5.js', pixi: 'PixiJS' }[l]; if (n && !engines.includes(n)) engines.push(n); }
  const wasm = /WebAssembly\.(instantiate|compile)|\.wasm\b|\.wasm\.(gz|br)/.test(hay) || engines.includes('Unity') || engines.includes('Godot');
  const webgl2 = /webgl2/i.test(hay);
  const webgl = webgl2 || /webgl|experimental-webgl/i.test(hay) || engines.some(e => ['Three.js', 'Babylon.js', 'PlayCanvas', 'Unity', 'Godot'].includes(e)) || (libs || []).includes('three');
  const canvas2d = /getContext\(\s*['"]2d['"]/.test(hay) || (!webgl && /<canvas|createCanvas|Phaser|PIXI/.test(hay));
  const online = /(?:src|href)\s*=\s*["']https?:\/\/|fetch\(\s*["'`]https?:|XMLHttpRequest|WebSocket\(|new\s+EventSource/.test(text) || (ext || []).some(x => x && x.u);
  const audio = assets.audio > 0 || /AudioContext|new\s+Audio\(|<audio/.test(hay);

  // memória estimada (MB): base do motor + o que os arquivos viram quando carregados (imagem e som descompactados)
  const base = Math.max(...engines.map(e => ENGINES.find(x => x[0] === e)?.[2] || 0), webgl ? 220 : 120);
  const est = base + (wasm ? 200 : 0) + (assets.img * 10 + assets.audio * 8 + assets.video * 2 + assets.font * 2 + assets.other * 2) / MB + scriptBytes / MB * 6 + (extBytes + libBytes) / MB * 4;
  const ti = tierOf(est);
  const rec = Math.min(ti + 1, TIERS.length - 1);
  const gfx = wasm && (engines.includes('Unity') || engines.includes('Godot')) ? 'WebGL 2 e WebAssembly' : webgl2 ? 'WebGL 2' : webgl ? 'WebGL' : 'Canvas 2D';
  const android = wasm ? '8.0' : '7.0';
  const total = codeBytes + extBytes + libBytes;
  return {
    v: SCAN_VERSION,
    bytes: total,
    size: fmtBytes(total),
    files: { img: assets.img, audio: assets.audio, other: assets.video + assets.font + assets.other, count: assets.count },
    engines, gfx, wasm, webgl, online, audio,
    ramMb: Math.round(est), ram: TIERS[ti][1], ramRec: TIERS[rec][1], ramRecMb: TIER_MB[rec],
    android,
    level: ti <= 0 ? 'leve' : ti === 1 ? 'médio' : ti === 2 ? 'pesado' : 'muito pesado',
  };
}
