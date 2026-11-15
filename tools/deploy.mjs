#!/usr/bin/env node
// 部署到 Cloudflare Pages 的免费子域（*.pages.dev）。
// 不涉及任何域名 / DNS 操作：这个脚本只会碰 Pages 项目。
//
// 需要两个环境变量（只在当前终端生效，不写进仓库）：
//   CLOUDFLARE_API_TOKEN   —— 权限只勾「Cloudflare Pages: Edit」
//   CLOUDFLARE_ACCOUNT_ID  —— Cloudflare 面板右侧的 Account ID
//
// 用法：
//   npm run deploy                 # 构建 + 打包 + 上传 + 线上自检
//   npm run deploy -- --dry-run    # 只构建打包，不上传
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.ZHUOLU_PAGES_PROJECT || 'zhuolu';
const dryRun = process.argv.includes('--dry-run');

function step(msg) {
  console.log('\n== ' + msg + ' ==');
}

function run(cmd, args, opts = {}) {
  const useShell = process.platform === 'win32';
  const quote = (s) => (/[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s);
  const line = [cmd, ...args].map(quote).join(' ');
  const res = spawnSync(useShell ? line : cmd, useShell ? [] : args, {
    cwd: root,
    stdio: opts.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: useShell,
    env: Object.assign({}, process.env, opts.env || {})
  });
  if (res.status !== 0) {
    const detail = opts.capture ? String(res.stderr || '') + String(res.stdout || '') : '';
    throw new Error(cmd + ' 失败（退出码 ' + res.status + '）' + (detail ? '\n' + detail.slice(-1200) : ''));
  }
  return String(res.stdout || '');
}

// Account ID 不再要求手填：这个 token 有账户级权限，能列出自己所在的账户
async function getJson(url, t) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  return res.json();
}

// /accounts 会按 token 权限过滤（只有 Pages:Edit 的 token 常常返回空列表），
// 所以再试一次 /memberships —— 它按"用户属于哪个账户"来列，和 Pages 权限无关。
async function resolveAccount(t) {
  try {
    const json = await getJson('https://api.cloudflare.com/client/v4/accounts?per_page=50', t);
    const list = json.result || [];
    if (list.length === 1) return list[0].id;
    if (list.length > 1) {
      console.log('  这个 token 能看到多个账户，请手动设置 CLOUDFLARE_ACCOUNT_ID');
      return null;
    }
  } catch (err) {
    console.log('  查询 /accounts 失败：' + err.message);
  }
  try {
    const json = await getJson('https://api.cloudflare.com/client/v4/memberships?per_page=50&status=accepted', t);
    const list = (json.result || []).filter((m) => m.account && m.account.id);
    if (list.length === 1) {
      console.log('  账户名 ' + (list[0].account.name || '(未命名)'));
      return list[0].account.id;
    }
    if (list.length > 1) {
      console.log('  属于多个账户，请手动设置 CLOUDFLARE_ACCOUNT_ID：');
      for (const m of list) console.log('    ' + m.account.id + '  ' + (m.account.name || ''));
      return null;
    }
    console.log('  /memberships 也列不出账户');
  } catch (err) {
    console.log('  查询 /memberships 失败：' + err.message);
  }
  return null;
}

step('构建与打包');
run(process.execPath, ['tools/pack.mjs']);
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/index.html 不存在');

if (dryRun) {
  console.log('\n--dry-run：已生成 dist/，没有上传。');
  process.exit(0);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token) {
  console.error([
    '',
    '缺少 CLOUDFLARE_API_TOKEN，无法部署。',
    '',
    '一次性做法（GitHub Pages 已经在用，Cloudflare 免费）：',
    '  1. 注册 / 登录 https://dash.cloudflare.com',
    '  2. 右侧头像 → My Profile → API Tokens → Create Token → Custom token',
    '     权限只给一项：Account · Cloudflare Pages · Edit',
    '     账号资源选自己的账号，TTL 设成 1 天（部署完就失效）',
    '  3. 复制 token，在本机 PowerShell 里执行：',
    '       $env:CLOUDFLARE_API_TOKEN = "粘贴 token"',
    '       $env:CLOUDFLARE_ACCOUNT_ID = "面板右侧的 Account ID"',
    '       npm run deploy',
    '',
    '这个 token 在权限上碰不到 DNS，也看不到你的域名。',
    '不想开账号：把 dist/ 目录直接拖进 Cloudflare Pages 的「直接上传」也等价。',
    ''
  ].join('\n'));
  process.exit(2);
}

step('确认账户');
if (!account) {
  account = await resolveAccount(token);
  if (!account) {
    console.error([
      '',
      '读不出 Account ID：只有 Pages 权限的 token 通常列不出账户列表，这是 Cloudflare 的行为，不是 token 配错了。',
      '',
      '最快的拿法：在 Cloudflare 面板随便打开一页，看浏览器地址栏：',
      '  https://dash.cloudflare.com/023e105f4ecef8ad9ca31a8372d0c353/workers-and-pages',
      '                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 这一串就是 Account ID',
      '',
      '然后在同一个 PowerShell 窗口里补一句再跑：',
      '  $env:CLOUDFLARE_ACCOUNT_ID = "那一串"',
      '  npm run deploy',
      ''
    ].join('\n'));
    process.exit(2);
  }
  console.log('  Account ID ' + account + '（从 token 自动识别）');
} else {
  console.log('  Account ID ' + account);
}

const deployEnv = { CLOUDFLARE_ACCOUNT_ID: account, CI: 'true' };
step('上传到 Cloudflare Pages');
try {
  run('npx', ['--yes', 'wrangler@4', 'pages', 'deploy', 'dist', '--project-name', project, '--branch', 'main', '--commit-dirty=true'], { env: deployEnv });
} catch (err) {
  console.log('首次部署可能要先建项目，重试一次……');
  try {
    run('npx', ['--yes', 'wrangler@4', 'pages', 'project', 'create', project, '--production-branch', 'main'], { env: deployEnv });
  } catch {
    /* 项目已存在时会报错，忽略 */
  }
  run('npx', ['--yes', 'wrangler@4', 'pages', 'deploy', 'dist', '--project-name', project, '--branch', 'main', '--commit-dirty=true'], { env: deployEnv });
}

step('线上自检');
const url = 'https://' + project + '.pages.dev/';
async function check(p, label, expectType) {
  const res = await fetch(url.replace(/\/$/, '') + p, { redirect: 'follow' });
  const type = res.headers.get('content-type') || '(无)';
  const ok = res.ok && (!expectType || type.includes(expectType));
  console.log((ok ? '  OK   ' : '  FAIL ') + label.padEnd(22) + res.status + '  ' + type);
  return { res, ok };
}

let allOk = true;
try {
  const base = await check('/', 'index.html', 'text/html');
  allOk = allOk && base.ok;
  if (base.res.headers.get('content-security-policy')) console.log('  OK   CSP 响应头已生效');
  else { console.log('  FAIL 没有 CSP 响应头（_headers 没被识别）'); allOk = false; }
  for (const [p, label, type] of [['/sw.js', 'Service Worker', 'javascript'], ['/manifest.webmanifest', 'PWA manifest', 'json'], ['/icons/icon-192.png', '图标 192', 'image/png']]) {
    const r = await check(p, label, type);
    allOk = allOk && r.ok;
  }
} catch (err) {
  console.log('  自检请求失败：' + err.message);
  allOk = false;
}

console.log('');
console.log(allOk ? '部署完成：' + url : '部署已上传，但线上自检没过，请把上面的 FAIL 行发我。');
console.log('下次改完代码：npm run deploy 即可覆盖同一个地址。');
process.exit(allOk ? 0 : 1);
