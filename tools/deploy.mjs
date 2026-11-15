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
const argAccount = (() => {
  const i = process.argv.indexOf('--account');
  return i > -1 ? process.argv[i + 1] : null;
})();

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
    env: (() => {
      const env = Object.assign({}, process.env, opts.env || {});
      for (const k of opts.dropEnv || []) delete env[k];
      return env;
    })()
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

// 只读诊断：token 本身是否有效、两个账户接口各自怎么回
async function diagnose(t) {
  const show = (label, obj) => {
    const errs = (obj && obj.errors) || [];
    console.log('  ' + label.padEnd(16) + 'success=' + (obj && obj.success) + ' result=' +
      (Array.isArray(obj && obj.result) ? obj.result.length + ' 条' : '-') +
      (errs.length ? ' errors=' + JSON.stringify(errs.slice(0, 2)) : ''));
  };
  try {
    show('/tokens/verify', await getJson('https://api.cloudflare.com/client/v4/user/tokens/verify', t));
  } catch (err) {
    console.log('  /tokens/verify 请求失败：' + err.message);
  }
  try {
    show('/accounts', await getJson('https://api.cloudflare.com/client/v4/accounts?per_page=50', t));
  } catch (err) {
    console.log('  /accounts 请求失败：' + err.message);
  }
  try {
    show('/memberships', await getJson('https://api.cloudflare.com/client/v4/memberships?per_page=50&status=accepted', t));
  } catch (err) {
    console.log('  /memberships 请求失败：' + err.message);
  }
  console.log('');
}

step('构建与打包');
run(process.execPath, ['tools/pack.mjs']);
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/index.html 不存在');

if (dryRun) {
  console.log('\n--dry-run：已生成 dist/，没有上传。');
  process.exit(0);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
let account = argAccount || process.env.CLOUDFLARE_ACCOUNT_ID;

// 文档里的示例 ID 长得和真的一样，被复制走过一次，这里挡死
const PLACEHOLDER_IDS = ['023e105f4ecef8ad9ca31a8372d0c353', '4a7c8f2d9b1e3a506c7d8e9f0a1b2c3d'];
if (account && PLACEHOLDER_IDS.includes(String(account).toLowerCase())) {
  console.log('');
  console.log('  ' + account + ' 是文档里的示例 ID，不是你账户的 ID，已忽略。');
  console.log('  真 ID 在 Cloudflare 面板地址栏那 32 位十六进制里。');
  account = null;
}

step('确认账户');
if (!account && token) {
  account = await resolveAccount(token);
  if (!account) {
    await diagnose(token);
    console.log('  token 读不出账户，改用 wrangler 的浏览器登录态继续（需要先 npx wrangler login）');
  } else {
    console.log('  Account ID ' + account + '（从 token 自动识别）');
  }
} else if (account) {
  console.log('  Account ID ' + account);
} else {
  console.log('  没有 token，也没有 Account ID：交给 wrangler 的浏览器登录态');
  console.log('  从没登录过的话，先在另一个窗口跑一次：npx wrangler login');
}

const deployEnv = { CI: 'true' };
if (account) deployEnv.CLOUDFLARE_ACCOUNT_ID = account;

const dropEnv = account ? [] : ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const wranglerArgs = ['--yes', 'wrangler@4', 'pages', 'deploy', 'dist', '--project-name', project, '--branch', 'main', '--commit-dirty=true'];
step('上传到 Cloudflare Pages');
try {
  run('npx', wranglerArgs, { env: deployEnv, dropEnv });
} catch (err) {
  console.log('首次部署可能要先建项目，重试一次……');
  try {
    run('npx', ['--yes', 'wrangler@4', 'pages', 'project', 'create', project, '--production-branch', 'main'], { env: deployEnv, dropEnv });
  } catch {
    /* 项目已存在时会报错，忽略 */
  }
  try {
    run('npx', wranglerArgs, { env: deployEnv, dropEnv });
  } catch (second) {
    const msg = String(second.message || '');
    if (/code: 10000|Authentication error/i.test(msg)) {
      console.error([
        '',
        '认证失败（Cloudflare code 10000），只可能是这三种之一：',
        '  1. Account ID 不对，不是你 token 所属的那个账户',
        '  2. token 没复制完整，或者已经过期',
        '  3. token 权限里没有 Account · Cloudflare Pages · Edit',
        '',
        '最省事的绕法（不用 token、不用 Account ID）：',
        '  npx wrangler login      # 浏览器里点一次允许',
        '  npm run deploy',
        ''
      ].join('\n'));
      process.exit(1);
    }
    throw second;
  }
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