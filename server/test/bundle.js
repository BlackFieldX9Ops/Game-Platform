// Testa o empacotador de ZIP (app/www/vendor/bundle.js): scripts e CSS entram inline, arquivos viram data: URI.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const { bundle } = require('../../app/www/vendor/bundle.js');

let ok = 0;
const t = (nome, cond) => { assert.ok(cond, nome); ok++; console.log('ok   ' + nome); };

const z = new JSZip();
z.file('jogo/index.html', '<!doctype html><html><head><title>Teste ZIP</title><link rel="stylesheet" href="css/a.css"></head><body><img src="img/p.png"><script src="js/m.js"></script></body></html>');
z.file('jogo/css/a.css', '@import "b.css";body{background:url(../img/p.png)}');
z.file('jogo/css/b.css', '.x{color:red}');
z.file('jogo/js/m.js', 'console.log("oi </script> tchau")');
z.file('jogo/data/l.json', '{"n":1}');
z.file('jogo/img/p.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
z.file('__MACOSX/jogo/._index.html', 'lixo');

const r = await bundle(await JSZip.loadAsync(await z.generateAsync({ type: 'nodebuffer' })));
t('acha o index.html dentro da pasta', r.entry === 'jogo/index.html');
t('lê o título', r.title === 'Teste ZIP');
t('ignora __MACOSX', r.files === 6);
t('CSS entra inline com @import', r.html.includes('.x{color:red}') && !r.html.includes('href="css/a.css"'));
t('script entra inline e escapa </script', r.html.includes('console.log("oi <\\/script> tchau")') && !r.html.includes('src="js/m.js"'));
t('imagem vira data URI', /<img src="data:image\/png;base64,/.test(r.html) && r.html.includes('url("data:image/png;base64,'));
t('mapa de runtime tem data/l.json', r.html.includes('"data/l.json":"data:application/json;base64,'));

let falhou = false;
try { await bundle(await JSZip.loadAsync(await new JSZip().file('a.txt', 'x').generateAsync({ type: 'nodebuffer' }))); } catch (e) { falhou = /html/i.test(e.message); }
t('recusa ZIP sem HTML', falhou);
console.log(`\n${ok} passaram, 0 falharam`);
