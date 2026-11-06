/* Junta um jogo com vários arquivos (.zip) em um único HTML.
   Scripts e CSS entram inline; imagens, sons, fontes e dados viram data: URI.
   Um pequeno código no início da página faz fetch, XMLHttpRequest, Image, Audio e
   <script>.src encontrarem os arquivos pelo caminho original (ex.: "assets/hero.png"). */
(function (root) {
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm',
    json: 'application/json', txt: 'text/plain', xml: 'application/xml', csv: 'text/csv', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css' };
  var MAX_TOTAL = 24e6;          // caracteres base64 somados
  var MAX_FILES = 600;

  function ext(p) { var m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ''; }
  function dir(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function normPath(p) {
    var out = [];
    p.split('/').forEach(function (s) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); });
    return out.join('/');
  }
  function isRemote(u) { return /^(data|blob|https?|about|javascript|mailto|tel|file):|^\/\/|^#/i.test(u); }
  function cleanRef(u) {
    u = String(u).trim().split('#')[0].split('?')[0];
    try { u = decodeURIComponent(u); } catch (e) {}
    return u;
  }
  // caminho de um arquivo referenciado por "ref" dentro do arquivo "from" (ambos relativos à pasta do jogo)
  function resolve(from, ref) {
    if (!ref || isRemote(ref)) return null;
    ref = cleanRef(ref);
    if (!ref) return null;
    return ref.charAt(0) === '/' ? normPath(ref) : normPath(dir(from) + '/' + ref);
  }

  async function bundle(zip) {
    var warnings = [], raw = {}, count = 0;
    zip.forEach(function (name, f) {
      if (f.dir) return;
      if (/(^|\/)(__MACOSX|\.git|node_modules)\//.test(name) || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(name)) return;
      raw[name] = f; count++;
    });
    if (!count) throw new Error('O ZIP está vazio');
    if (count > MAX_FILES) throw new Error('O ZIP tem arquivos demais (limite ' + MAX_FILES + ')');

    // arquivo principal: index.html na raiz; senão o index.html mais próximo da raiz; senão o .html mais raso
    var htmls = Object.keys(raw).filter(function (n) { return /\.html?$/i.test(n); });
    if (!htmls.length) throw new Error('Não achei nenhum arquivo .html dentro do ZIP');
    htmls.sort(function (a, b) {
      var da = a.split('/').length, db = b.split('/').length;
      if (da !== db) return da - db;
      var ia = /(^|\/)index\.html?$/i.test(a) ? 0 : 1, ib = /(^|\/)index\.html?$/i.test(b) ? 0 : 1;
      return ia - ib || a.localeCompare(b);
    });
    var entry = htmls[0], base = dir(entry);
    if (htmls.length > 1) warnings.push('Há ' + htmls.length + ' páginas HTML; usei ' + entry);

    // arquivos visíveis para o jogo: tudo dentro da pasta do arquivo principal, com caminho relativo a ela
    var files = {};
    Object.keys(raw).forEach(function (n) {
      if (base && n.indexOf(base + '/') !== 0) return;
      files[base ? n.slice(base.length + 1) : n] = raw[n];
    });
    var entryRel = base ? entry.slice(base.length + 1) : entry;

    var total = 0, b64 = {}, txt = {};
    async function asB64(p) {
      if (b64[p] === undefined) {
        b64[p] = await files[p].async('base64');
        total += b64[p].length;
        if (total > MAX_TOTAL) throw new Error('O jogo é grande demais (limite de uns 18 MB de arquivos)');
      }
      return b64[p];
    }
    async function asTxt(p) { if (txt[p] === undefined) txt[p] = await files[p].async('string'); return txt[p]; }
    async function dataUri(p) { return 'data:' + (MIME[ext(p)] || 'application/octet-stream') + ';base64,' + await asB64(p); }

    var inlined = {};   // scripts e CSS que entraram direto na página
    async function replaceAsync(str, re, fn) {
      var parts = [], last = 0, m, jobs = [];
      re.lastIndex = 0;
      while ((m = re.exec(str))) { jobs.push({ m: m, i: m.index }); if (m[0] === '') re.lastIndex++; }
      var outs = [];
      for (var k = 0; k < jobs.length; k++) outs.push(await fn.apply(null, jobs[k].m));
      for (var j = 0; j < jobs.length; j++) { parts.push(str.slice(last, jobs[j].i)); parts.push(outs[j]); last = jobs[j].i + jobs[j].m[0].length; }
      parts.push(str.slice(last));
      return parts.join('');
    }

    async function cssFix(css, from, depth) {
      depth = depth || 0;
      css = await replaceAsync(css, /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?\s*([^;]*);/gi, async function (all, q, ref) {
        var p = resolve(from, ref);
        if (p && files[p] && depth < 5) { inlined[p] = 1; return await cssFix(await asTxt(p), p, depth + 1); }
        return all;
      });
      return await replaceAsync(css, /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, async function (all, q, ref) {
        var p = resolve(from, ref);
        return p && files[p] ? 'url("' + await dataUri(p) + '")' : all;
      });
    }

    var html = await asTxt(entryRel);

    // 1) scripts e estilos viram marcadores, para que o texto dentro deles não seja reescrito
    var slots = [];
    function hold(s) { slots.push(s); return '\u0000GP' + (slots.length - 1) + '\u0000'; }
    html = await replaceAsync(html, /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, async function (all, attrs, body) {
      var m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(' ' + attrs);
      if (!m) {
        if (/type\s*=\s*["']?module/i.test(attrs) && /\bimport\b[^;]*from\s*['"]\.{0,2}\//.test(body)) warnings.push('Um script do tipo module importa arquivos locais; isso pode não funcionar.');
        return hold(all);
      }
      var ref = m[1] || m[2] || m[3], p = resolve(entryRel, ref);
      if (!p || !files[p]) return hold(all);
      inlined[p] = 1;
      var code = await asTxt(p);
      if (/type\s*=\s*["']?module/i.test(attrs) && /(^|\n)\s*import\b[^;]*from\s*['"]\.{0,2}\//.test(code)) warnings.push(p + ' é um módulo que importa arquivos locais; isso pode não funcionar.');
      var a = (' ' + attrs).replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '').replace(/\s(?:integrity|crossorigin)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
      return hold('<script' + a + '>' + code.replace(/<\/script/gi, '<\\/script') + '</script>');
    });
    html = await replaceAsync(html, /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, async function (all, attrs, body) {
      return hold('<style' + attrs + '>' + await cssFix(body, entryRel) + '</style>');
    });
    // 2) <link> locais: CSS entra inline, o resto (ícone etc.) vira data URI
    html = await replaceAsync(html, /<link\b[^>]*>/gi, async function (tag) {
      var h = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      if (!h) return tag;
      var ref = h[1] || h[2] || h[3], p = resolve(entryRel, ref);
      if (!p || !files[p]) return tag;
      if (/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) {
        inlined[p] = 1;
        return hold('<style>' + await cssFix(await asTxt(p), p) + '</style>');
      }
      return tag.replace(h[0], ' href="' + await dataUri(p) + '"');
    });
    // 3) src / poster / data-src das demais tags
    html = await replaceAsync(html, /(\s(?:src|poster|data-src)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, async function (all, pre, a, b) {
      var ref = a !== undefined ? a : b, p = resolve(entryRel, ref);
      return p && files[p] ? pre + '"' + await dataUri(p) + '"' : all;
    });
    html = await replaceAsync(html, /\u0000GP(\d+)\u0000/g, async function (all, i) { return slots[+i]; });

    // 4) mapa para o que o código do jogo pede em tempo de execução
    var map = {}, runtime = 0;
    for (var p in files) {
      if (p === entryRel || inlined[p]) continue;
      if (/\.html?$/i.test(p)) continue;
      map[p] = await dataUri(p); runtime++;
    }
    var shim = '<script>(function(){var M=' + JSON.stringify(map).replace(/</g, '\\u003c') + ';'
      + 'function norm(u){u=String(u);if(/^(data|blob|https?|about|javascript):|^\\/\\//i.test(u))return null;u=u.split("#")[0].split("?")[0];try{u=decodeURIComponent(u)}catch(e){}var o=[];u.replace(/^\\.?\\/+/,"").split("/").forEach(function(p){if(p===".."){o.pop()}else if(p&&p!=="."){o.push(p)}});return o.join("/")}'
      + 'function fix(u){if(typeof u!=="string"&&!(window.URL&&u instanceof URL))return u;var k=norm(u);return k!==null&&Object.prototype.hasOwnProperty.call(M,k)?M[k]:u}'
      + 'var F=window.fetch;if(F)window.fetch=function(i,o){return F.call(this,fix(i),o)};'
      + 'var XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fix(u);return XO.apply(this,arguments)};'
      + 'function pp(P,n){var d=P&&Object.getOwnPropertyDescriptor(P,n);if(!d||!d.set)return;Object.defineProperty(P,n,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,fix(v))}})}'
      + '[[HTMLImageElement,"src"],[HTMLMediaElement,"src"],[HTMLSourceElement,"src"],[HTMLScriptElement,"src"],[HTMLLinkElement,"href"],[HTMLTrackElement,"src"]].forEach(function(a){pp(a[0].prototype,a[1])});'
      + 'var SA=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(typeof n==="string"&&/^(src|href|poster)$/i.test(n))v=fix(v);return SA.call(this,n,v)};'
      + 'var AU=window.Audio;window.Audio=function(s){var a=new AU();if(s!==undefined)a.src=fix(s);return a};window.Audio.prototype=AU.prototype;'
      + '})();<\/script>';
    var at;
    if ((at = /<head[^>]*>/i.exec(html))) html = html.slice(0, at.index + at[0].length) + shim + html.slice(at.index + at[0].length);
    else if ((at = /<html[^>]*>/i.exec(html))) html = html.slice(0, at.index + at[0].length) + shim + html.slice(at.index + at[0].length);
    else if ((at = /<!doctype[^>]*>/i.exec(html))) html = html.slice(0, at.index + at[0].length) + shim + html.slice(at.index + at[0].length);
    else html = shim + html;

    var t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return { html: html, title: t ? t[1].trim() : '', files: count, entry: entry, warnings: warnings, bytes: html.length };
  }

  root.GPBundle = { bundle: bundle };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GPBundle;
})(typeof window !== 'undefined' ? window : globalThis);
