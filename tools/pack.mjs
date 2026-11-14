#!/usr/bin/env node
// 打包成可以直接部署的静态站点：dist/
// 只放运行时真正需要的文件，源码、工具、Git 记录都不进去。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

function fail(msg) {
  console.error('打包失败：' + msg);
  process.exit(1);
}

// 1. 先把 src/ 合成单文件 index.html，保证 dist 里永远是最新构建
const build = spawnSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) fail('node build.mjs 退出码 ' + build.status);

// 2. 版本一致性：Service Worker 的缓存名必须跟着 APP_VERSION 走，
//    否则升级后用户会一直拿到旧缓存。
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const swJs = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const appVersion = (appJs.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
const cacheName = (swJs.match(/var CACHE\s*=\s*'([^']+)'/) || [])[1];
if (!appVersion) fail('src/app.js 里找不到 APP_VERSION');
if (!cacheName) fail('sw.js 里找不到 CACHE');
if (cacheName !== 'zhuolu-v' + appVersion) {
  fail('版本不一致：APP_VERSION=' + appVersion + '，但 sw.js 的 CACHE=' + cacheName);
}

// 3. 重建 dist
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const files = ['index.html', 'sw.js', 'manifest.webmanifest', '_headers'];
const dirs = ['icons'];

let total = 0;
const rows = [];
function copy(rel) {
  const from = path.join(root, rel);
  const to = path.join(dist, rel);
  if (!fs.existsSync(from)) fail('缺少文件 ' + rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const size = fs.statSync(to).size;
  if (size === 0) fail('文件为空 ' + rel);
  total += size;
  rows.push([rel, size]);
}

files.forEach(copy);
for (const dir of dirs) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) fail('缺少目录 ' + dir);
  for (const name of fs.readdirSync(abs).sort()) {
    if (name.startsWith('.')) continue;
    copy(path.join(dir, name));
  }
}

// 4. 出厂自检：manifest / sw 引用得到、index.html 指向 manifest
const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!index.includes('rel="manifest"')) fail('index.html 没有引用 manifest');
if (!index.includes('apple-touch-icon')) fail('index.html 没有 apple-touch-icon');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) {
  if (!fs.existsSync(path.join(dist, icon.src))) fail('manifest 引用的图标不存在：' + icon.src);
}
const cached = (swJs.match(/ASSETS = \[([\s\S]*?)\]/) || [])[1] || '';
for (const m of cached.matchAll(/'(\.\/[^']*)'/g)) {
  const rel = m[1].replace(/^\.\//, '');
  if (rel === '' || rel === 'index.html') continue;
  if (!fs.existsSync(path.join(dist, rel))) fail('sw.js 预缓存的资源不存在：' + m[1]);
}

// 5. 报告
const width = Math.max(...rows.map((r) => r[0].length));
for (const [rel, size] of rows) {
  console.log('  ' + rel.padEnd(width) + '  ' + (size / 1024).toFixed(1).padStart(7) + ' KiB');
}
console.log('');
console.log('dist/ 就绪：' + rows.length + ' 个文件，共 ' + (total / 1024).toFixed(1) + ' KiB（版本 ' + appVersion + '）');
console.log('本地预览：npm start        部署：npm run deploy');
