# 托管约定与部署手册

这个文件是**给未来的自己和任何接手的人看的**：托管怎么做、边界在哪、不许动什么。
先有约定，再有点击，避免同一个项目散落在多个平台、多条域名记录里。

## 1. 三条硬边界

1. **单一真源是本仓库。** 托管站只是只读镜像，任何时候都能从仓库重建。平台挂了、项目删了，都不影响源码和数据。
2. **本项目不碰任何域名。** 不迁 NS、不加 CNAME、不买域名、不改 DNS 记录。应用跑在平台免费子域上（如 `zhuolu.pages.dev`）。
3. **只允许一个托管平台。** 不搞 Cloudflare + Netlify + 图床三处并存。要换平台，先把旧的删掉。

用户只有一个域名（`de5.net` 下的子域，NS 在免费域名服务商手里），任何需要改 DNS 的托管方式一律不采用。

## 2. 部署方式

两种，产物相同，都在 `dist/`：

```bash
npm run pack    # 构建 src/ → index.html，再把运行时需要的文件复制进 dist/
npm run deploy  # 打包 + 上传 Cloudflare Pages + 线上自检（需要 token）
```

### A. 网页拖拽（不需要命令行、不需要 token）

1. `npm run pack`
2. Cloudflare 面板 → Workers & Pages → Create → Pages → Upload assets
3. 把 **`dist/` 里面的内容**（不是 dist 文件夹本身）拖进去，项目名填 `zhuolu`
4. 部署完得到 `https://zhuolu.pages.dev`

### B. 命令行（一次配好，之后一条命令）

1. 面板右侧头像 → My Profile → API Tokens → Create Token → **Custom token → 从头开始**
2. 权限**只勾一项**：`Account · Cloudflare Pages · Edit`；TTL 设 1 天
3. 当前终端里：

```powershell
$env:CLOUDFLARE_API_TOKEN = "粘贴 token"
npm run deploy
```

Account ID 不用手填：脚本会拿这个 token 去列账户，只有一个账户时自动使用（想指定就设 `CLOUDFLARE_ACCOUNT_ID`）。

这个 token 在权限上读不到 DNS、看不到域名列表——不是靠自觉，是靠权限边界。

## 3. 上线自检清单

`npm run deploy` 会自动检查，手动复核时看这几项：

- [ ] `/` 返回 200，`content-type` 是 `text/html`
- [ ] 响应头里有 `content-security-policy`（说明 `_headers` 生效）
- [ ] `/sw.js` 返回 `text/javascript`
- [ ] `/manifest.webmanifest` 返回 JSON
- [ ] 手机 Safari 打开 → 分享 → 添加到主屏幕 → 断网还能打开
- [ ] 安装后数据与浏览器版是分开的：先导出，装好再导入

## 4. 回滚

- 平台侧：Pages → 项目 → Deployments → 选中上一版 → Rollback
- 仓库侧：`git checkout <旧 tag>` → `npm run deploy`
- 用户数据不受影响：数据只在用户自己的浏览器里，和部署版本无关

## 5. 账号与归属（部署后填写）

| 项 | 值 |
| --- | --- |
| 平台 | Cloudflare Pages |
| 注册邮箱 | 待填 |
| 是否开 2FA | 待填 |
| 项目名 | zhuolu |
| 线上地址 | 部署后填 |
| 首次部署日期 | 部署后填 |
| token 保存位置 | 不保存；每次临时设、TTL 1 天 |

## 6. 两个已经踩过的坑

**页面 CSP 会被 Service Worker 继承。** 页面那份 `default-src 'none'` 如果也发给 `/sw.js`，SW 自己的 `fetch()` 就被自己的 CSP 挡住：刷新直接 `ERR_FAILED`，Cache Storage 里 0 条。所以 `_headers` 里给 `/sw.js` 单独写了一份带 `connect-src 'self'` 的 CSP。改 CSP 之后必须重跑一次 `npm test` 加真机离线验证。

**GitHub Pages 项目页在这台机器上用不了。** 用户站的 `erphenheimer.de5.net` 自定义域会把 `/zhuolu/` 这类项目页 301 走，且 Cloudflare 返回 526。别在这上面浪费时间。

## 7. 不要做的事

- 不要为了"看起来更正式"去申请自定义域名，除非用户明确决定；
- 不要在 `index.html` 里加任何外部 CDN、字体、统计脚本（CSP 会把它们挡掉，这是故意的）；
- 不要用 GitHub Pages 项目页：用户站的 `erphenheimer.de5.net` 自定义域会把项目页 301 走；
- 不要把 `src/`、`tools/`、`.git/` 一起上传，`dist/` 之外的东西不进部署。
