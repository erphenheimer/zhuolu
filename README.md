# 着陆台 · Landing Pad

本地、离线、无账号的中文情绪危机自助小工具。当前版本 **0.3.1**。

情绪冲上来、脑子反复播放同一段的时候，先用 60 秒把身体拉回地面；缓过来之后，再用几张纸面工具把混在一起的东西分开。

> 不是医疗器械，不替代心理咨询或精神科诊疗。
> 有伤害自己的念头：**12356**（全国心理援助热线）· **120 / 110**（紧急）。
> 不在中国大陆：拨打当地紧急电话，或在 [findahelpline.com](https://findahelpline.com) 查找本地热线。

## 使用

**在线版（PWA，可装到主屏 / 桌面）**：<https://zhuolu.pages.dev/> —— 打开网页后按提示安装。自己搭一份也很简单，见下面「本地运行」与 [HOSTING.md](HOSTING.md)。

- iPhone / iPad：用 Safari 打开 → 点「分享」→「添加到主屏幕」
- Android：用 Chrome 打开 → 右上角菜单 →「安装应用」/「添加到主屏幕」
- 电脑：Chrome / Edge 点地址栏右侧的安装图标

装好后从图标打开：全屏、离线可用，数据仍然只存在本机。

**单文件版**：下载 [`index.html`](https://github.com/erphenheimer/zhuolu/releases/latest/download/index.html)，双击用浏览器打开。不用联网，不用安装。想打印随身卡片，可打印 [`口袋卡.pdf`](口袋卡.pdf)。

![首页](preview.png)

## 有什么

- **我现在很难受**：60 秒着陆（呼吸 5 轮 → 5-4-3-2-1 → 记录强度与此刻需要什么）
- **反刍**：写下循环的那句话，得到一句针对性回应，存进盒子，留到担忧窗口
- **确定性**：四格分开「已确定的事实 / 我的解释 / 不可知 / 下一步」
- **今日**：低标准小事、5 分钟启动、睡前 3 行、7 天打卡
- **回顾**：近 7 / 30 天的着陆强度、打卡完成率、反刍次数，纯本地计算并画成图
- **更多**：心理教育卡、思维记录、支持网、危机资源、导出 / 导入备份

## 数据

记录只保存在当前浏览器的本地存储（localStorage，键 `zhuolu.v1`），不上传、不联网、没有账号。

- 主屏应用和 Safari 的存储是分开的：固定从一个入口打开。
- 换设备、清理浏览器数据前，先在「更多 → 导出 JSON」备份。
- 导出的 JSON 带 `schemaVersion` 和导出时间；导入时会先预览条数，可选「合并」或「覆盖」。
- 页面会申请浏览器持久化存储；即使申请成功，定期导出仍然是最可靠的备份。
- 回顾页的图表用已记录的数据在本机计算，不额外上传，也不调用任何外部服务。
- 超过 14 天没导出，首页会出现一次不打断使用的备份提醒，可以延后 3 天。
- iPhone 装到主屏后是独立存储：先导出，装好后再导入，记录才接得上。

## 边界

方法来自 CBT / ACT 中常见的自助技术：情绪命名、延长呼气、接地、担忧推迟、行为激活、思维记录。自助练习不等于治疗。

如果已被诊断为焦虑障碍、适应障碍或其他精神科问题，这个工具最多是日常辅助，治疗计划请跟医生 / 咨询师走。持续两周以上情绪低落或焦虑、睡眠明显受损、无法学习工作、回避越来越多，请优先寻求专业帮助。

## 本地运行

需要 Node.js 18+（只用来起服务和构建，应用本身不依赖任何运行时）。

```bash
git clone https://github.com/erphenheimer/zhuolu.git
cd zhuolu
npm start          # 起本地服务并打印地址，默认 http://127.0.0.1:4173/
```

`localhost` 属于安全上下文，所以在本地就能完整验证 Service Worker、离线启动和安装提示，不需要证书。

- `npm start` 默认服务 `dist/`（存在时），否则服务仓库根目录
- `npm start -- --lan` 让手机通过局域网访问（仅用于看排版；http 下不会注册 Service Worker）
- `npm start -- --open` 顺便打开浏览器

## 开发

```bash
npm run build      # src/ → 单文件 index.html
npm run pack       # 构建 + 生成可直接部署的 dist/
npm test           # Playwright 回归测试（需要 python + playwright）
npm run deploy     # 部署到 Cloudflare Pages（需要 token，见 HOSTING.md）
```

`index.html` 和 `dist/` 都是生成物，不要直接改；改 `src/` 下的源文件。配色与设计变量在 `src/style.css` 顶部。`_headers` 是 CSP 与缓存策略，本地服务器和线上都会应用同一份。

## 版本

0.2.0 完成 PWA 化（可安装、离线、iOS 安全区适配）与导出 / 导入接续；0.2.1 补齐数据可靠性（备份提醒、安装迁移提示、更新提示、记录删除与撤销、导入校验）；0.3.0 加了本地回顾页（7 / 30 天趋势，纯 SVG，无第三方库），并修了一批无障碍与移动端问题（深色对比度、浮层焦点、热线可点击、窄屏布局）。0.3.1 修 iOS Safari 的兼容兜底（`color-mix` 回退、`-webkit-backdrop-filter`），并把托管链路补成可复现的：单文件 CSP、本地服务器、打包、部署与线上自检。1.0 留给真正能「本地运行、长期记录、导出导入接续」的独立软件，计划见 [ROADMAP.md](ROADMAP.md)。

## 许可

[MIT](LICENSE)。按「现状」提供，不构成医疗建议。

---

**English**: Landing Pad is a single-file, offline, account-free Chinese self-help tool for emotional crises, rumination and anxiety. It can also be deployed as an installable PWA (iOS/Android/desktop) on any HTTPS static host. No network requests, no analytics, data stays in your browser. Not a medical device; does not replace professional care.
