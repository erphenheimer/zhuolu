import fs from 'node:fs';

const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const css = fs.readFileSync(root + 'src/style.css', 'utf8');
const body = fs.readFileSync(root + 'src/body.html', 'utf8');
const js = fs.readFileSync(root + 'src/app.js', 'utf8');

if (js.includes('</scr' + 'ipt')) throw new Error('app.js contains script close tag');
if (css.includes('</sty' + 'le')) throw new Error('style.css contains style close tag');

const boot = [
  '<script>',
  "(function(){try{",
  "var raw=localStorage.getItem('zhuolu.v1');var s=raw?JSON.parse(raw):{};",
  "var t=(s.settings&&s.settings.theme)||'auto';",
  "var dark=t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);",
  "document.documentElement.setAttribute('data-theme',dark?'dark':'light');",
  "var m=(s.settings&&s.settings.motion)||'auto';",
  "var reduce=m==='reduce'||(m!=='full'&&window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);",
  "document.documentElement.setAttribute('data-motion',reduce?'reduce':'full');",
  "}catch(e){document.documentElement.setAttribute('data-theme','light');}})();",
  '</script>'
].join('\n');

const html = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="color-scheme" content="light dark">',
  '<meta name="theme-color" content="#f2eee3">',
  '<title>着陆台 · 反刍与焦虑自助工作台</title>',
  '<meta name="description" content="一个本地、离线、无账号的中文心理自助工作台：被拒绝、断联或关系受挫后的反刍与焦虑，先着陆，再整理。">',
  '<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2214%22%20fill=%22%234a6655%22/%3E%3Ccircle%20cx=%2232%22%20cy=%2232%22%20r=%2215%22%20fill=%22none%22%20stroke=%22%23f2eee3%22%20stroke-width=%223%22/%3E%3Ccircle%20cx=%2232%22%20cy=%2232%22%20r=%224%22%20fill=%22%23f2eee3%22/%3E%3C/svg%3E">',
  boot,
  '<style>',
  css,
  '</style>',
  '</head>',
  '<body>',
  body,
  '<script>',
  js,
  '</script>',
  '</body>',
  '</html>'
].join('\n');

fs.writeFileSync(root + 'index.html', html, 'utf8');
console.log('built index.html:', html.length, 'chars');
