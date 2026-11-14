#!/usr/bin/env node
// 零依赖本地服务器：和线上一样读 _headers、一样给 MIME，方便在 localhost 上
// 验证 Service Worker、离线启动和安装提示（localhost 属于安全上下文）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function parseArgs(argv) {
  const opts = { dir: null, port: 4173, host: '127.0.0.1', open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a === '-d') opts.dir = argv[++i];
    else if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--lan') opts.host = '0.0.0.0';
    else if (a === '--open') opts.open = true;
    else if (a === '--help' || a === '-h') {
      console.log('用法：node tools/serve.mjs [--dir dist] [--port 4173] [--lan] [--open]');
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const serveDir = path.resolve(root, opts.dir || (fs.existsSync(path.join(root, 'dist', 'index.html')) ? 'dist' : '.'));

// ---- 解析 _headers（Cloudflare Pages / Netlify 语法：路径行 + 缩进的 Header: value）
function parseHeaders(dir) {
  const file = path.join(dir, '_headers');
  if (!fs.existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const idx = raw.indexOf(':');
    if (!current || idx < 0) continue;
    current.headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
  }
  return rules.map((r) => ({
    test: new RegExp('^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'),
    headers: r.headers
  }));
}

const rules = parseHeaders(serveDir);

function headersFor(urlPath) {
  const out = {};
  for (const rule of rules) {
    if (!rule.test.test(urlPath)) continue;
    for (const [k, v] of rule.headers) out[k] = v;
  }
  // 本地总是禁用强缓存，避免改完看不到变化
  out['Cache-Control'] = 'no-store';
  return out;
}

function localAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) found.push(net.address);
    }
  }
  return found;
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  let target = path.resolve(serveDir, '.' + urlPath);
  if (target !== serveDir && !target.startsWith(serveDir + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headersFor(urlPath)));
    res.end('404 ' + urlPath + '\n提示：这里没有 SPA 重写，路由都是 hash（#/now）形式。\n');
    console.log('404 ' + urlPath);
    return;
  }

  const stat = fs.statSync(target);
  const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, Object.assign({ 'Content-Type': type, 'Content-Length': stat.size }, headersFor(urlPath)));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(target).pipe(res);
});

let port = opts.port;
let attempts = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempts < 20) {
    attempts++;
    port++;
    server.listen(port, opts.host);
    return;
  }
  console.error('启动失败：' + err.message);
  process.exit(1);
});

server.listen(port, opts.host, () => {
  const rel = path.relative(root, serveDir) || '.';
  console.log('着陆台 · 本地服务');
  console.log('  目录  ' + rel + (rules.length ? '（已应用 _headers 的 ' + rules.length + ' 条规则）' : '（没有 _headers）'));
  console.log('  本机  http://127.0.0.1:' + port + '/');
  if (opts.host === '0.0.0.0') {
    for (const ip of localAddresses()) console.log('  局域网 http://' + ip + ':' + port + '/');
    console.log('  注意：手机用局域网 http 打开时不会注册 Service Worker，离线与安装要用 HTTPS。');
  }
  console.log('  Ctrl+C 停止');
  if (opts.open) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', 'http://127.0.0.1:' + port + '/']]
      : process.platform === 'darwin' ? ['open', ['http://127.0.0.1:' + port + '/']]
        : ['xdg-open', ['http://127.0.0.1:' + port + '/']];
    import('node:child_process').then(({ spawn }) => spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref());
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
