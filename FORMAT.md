# 备份文件格式

这份文档是**导出文件的契约**：写出来的是什么、读的时候按什么规则处理、旧文件怎么算合法。
它和本机的存储布局无关——你怎么存是你的事，文件长什么样是这里说了算。

当前版本：`format` 1 · `schemaVersion` 1 · 对应应用 0.9.0。

---

## 三种号，别混

| 号 | 写在哪 | 管什么 | 什么时候变 |
|---|---|---|---|
| `format` | 信封 | 文件这个壳：信封字段、清单、指纹 | 壳变了才动（0.9.0 引入，值 1） |
| `schemaVersion` | 信封 | `data` 里有哪些字段、字段什么意思 | 记录或设置加字段、改含义 |
| `appVersion` | 信封 | 哪个版本导出的 | 每次发版 |
| （内部存储标记） | 本机 IndexedDB | 本机怎么分条存 | 0.7 / 0.8 各变过一次，**文件格式没变** |

`schemaVersion` 和 `format` 分开是有意的：读文件的人只关心「这份数据的字段我认不认识」（`schemaVersion`），
壳里多一个给人看的清单不该让旧版本拒收。

---

## 信封

```json
{
  "app": "zhuolu",
  "format": 1,
  "schemaVersion": 1,
  "appVersion": "0.9.0",
  "exportedAt": "2026-11-19T12:34:56.789Z",
  "manifest": {
    "counts": { "sos": 3, "rum": 5, "cert": 1, "tr": 2, "sleep": 4, "parked": 0, "days": 12, "cells": 34, "total": 15 },
    "digest": "fnv1a32:78b0476e"
  },
  "data": { "...": "下面一整份" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app` | string | 是 | 恒为 `"zhuolu"`。不是这个值就不是本工具的备份，直接拒收 |
| `format` | number | 否 | 信封版本。缺省视为 0（0.9.0 之前导出的文件都没有） |
| `schemaVersion` | number | 否 | `data` 的字段版本。缺省视为 0（很老的裸数据） |
| `appVersion` | string | 否 | 导出它的应用版本，只用于显示 |
| `exportedAt` | string | 否 | ISO 8601，UTC，毫秒精度 |
| `manifest` | object | 否 | 清单，见下。0.9.0 之前没有 |
| `data` | object | 是 | 全部数据。没有它，整份文件就当 `data` 用（见「旧文件」） |

---

## manifest：清单与指纹

`counts` 是**导出那一刻**从 `data` 里数出来的，不是缓存的旧数：

| 键 | 含义 |
|---|---|
| `sos` `rum` `cert` `tr` `sleep` `parked` | 六个集合各自的元素个数（含重复 id，因为写文件时还没去重） |
| `days` | 至少打了一个勾的天数。整天没打勾的空日子不算 |
| `cells` | 所有打勾的格子总数 |
| `total` | 六个集合之和 |

`digest` 是内容指纹：

- 算法：**FNV-1a 32 位**，输入是 `JSON.stringify(data)` 的 **UTF-8 字节**
- 写法：`"fnv1a32:" + 8 位小写十六进制`
- `JSON.stringify(data)` 按 ECMAScript 规则：紧凑（无空格换行）、键按对象自身顺序、非 ASCII 不转义

换个编辑器改缩进、换行、重新排版，指纹**不变**；改任何一个值，指纹**变**。
只改记录顺序也会变——所以它是「内容没被动过」的证据，不是「内容一样」的语义比较。

校验向量（第三方实现可以对这几个）：

| 输入字符串 | 指纹 |
|---|---|
| `""` | `fnv1a32:811c9dc5` |
| `{"a":1}` | `fnv1a32:8b9e4511` |
| `中文` | `fnv1a32:c488f045` |
| `{"daily":{"2026-11-18":{"sleep":true},"2026-11-19":{"eat":true}}}` | `fnv1a32:863c3010` |

---

## data

```json
{
  "v": 1,
  "firstSeen": 1731830400000,
  "sos": [], "rum": [], "cert": [], "tr": [], "sleep": [], "parked": [],
  "daily": { "2026-11-18": { "sleep": true, "eat": false, "move": true, "connect": false, "push": false } },
  "window": { "time": "19:30", "minutes": 15, "openedAt": 0, "closedDay": "" },
  "safety": { "signals": [], "coping": [], "distract": [], "people": [], "pros": [], "env": [], "reasons": [], "updatedAt": 0 },
  "settings": {
    "theme": "auto", "motion": "auto", "support": ["", ""],
    "lastExportAt": 0, "nudgeSnoozeUntil": 0,
    "quickExit": "search", "quickExitUrl": "", "lastImport": null
  }
}
```

- `v`：历史遗留，恒为 1，不表示任何版本
- `firstSeen`：第一次打开的时间，毫秒
- `daily`：键是本地日期 `YYYY-MM-DD`（设备时区），值是五个布尔：`sleep` 睡够 / `eat` 吃饭 / `move` 动了 / `connect` 联系人 / `push` 推了一下
- `window.minutes`：5–60，越界会被夹回
- `safety`：七组自由文本，每项最长 200 字
- `settings.support`：两个可以一键拨的号码
- `settings.lastImport`：0.9.0 新增，最近一次导入的报告 `{ at, mode, added, skipped, ignored }`，纯展示用

### 记录字段

每条记录都是对象，必须有 `id`（字符串，导出时已存在；很老的记录没有，导入时补）和 `t`（毫秒时间戳）。

| 集合 | 字段 | 说明 |
|---|---|---|
| `sos` 着陆 | `before` `after` | 0–100 的强度，前后各一次 |
| | `need` | 字符串数组，当时需要什么 |
| `rum` 反刍 | `thought` `action` | 念头、下一步 |
| | `kind` | `why` / `if` / `self` / `others` / `her` / `other` |
| `cert` 确定性 | `fact` `interp` `unknown` `next` | 事实 / 解释 / 不可知 / 下一步 |
| `tr` 思维记录 | `situation` `thought` `emotion` | 情境、自动思维、情绪 |
| | `belief` `intensity` `after` | 0–100 的数字 |
| | `for` `against` `balanced` | 支持、反对、平衡句 |
| `sleep` 睡前 | `fact` `did` `tomorrow` | 三行 |
| `parked` 盒子 | `text` | 先存起来的念头 |

---

## 读取规则

0.9.0 的实现就是这份契约的参考实现（`normalize()`）。按顺序：

1. **`app` 不是 `"zhuolu"`**：拒收，提示「这不是着陆台的备份文件」。
2. **`schemaVersion` 大于当前支持**：标成「来自更新版本」，禁用导入，建议先升级。
3. **集合不是数组**：忽略这个集合，不报错。
4. **元素不是对象**（数组、标量、null）：丢弃，计入「读不懂的行」。
5. **`id` 重复**：只留第一条，其余丢弃并计数。
6. **缺 `id`**：补一个随机 id，计数；导入后写回本机，下次不会再补。
7. **记录里不认识的字段**：**原样保留**。旧版本读新文件不会丢东西。
8. **不认识的顶层键**：忽略（不写进本机）。
9. **没有信封、只有 `data` 的内容**：整份当 `data` 用（0.2.0 之前的样子）。
10. **清单对不上**：不阻止导入，但「检查一份备份」会明说哪一类差几条、指纹对不对。

「检查」只读文件，不动本机数据；确认无误后可以一键转导入，不用再选一次文件。

---

## 加密备份

同一份信封，整个字符串加密后装进一个壳：

```json
{
  "app": "zhuolu",
  "format": 1,
  "enc": { "v": 1, "alg": "AES-GCM-256", "kdf": "PBKDF2-SHA256", "iter": 210000,
           "salt": "base64", "iv": "base64", "ct": "base64" },
  "schemaVersion": 1,
  "appVersion": "0.9.0",
  "exportedAt": "2026-11-19T12:34:56.789Z"
}
```

`ct` 是**明文信封（含 manifest）**的密文，所以清单在加密文件里也受保护，
检查时必须先输对口令、解开之后才能核对。

---

## 版本历史

| 版本 | 文件格式的变化 |
|---|---|
| 0.2.0 | 导出开始带 `schemaVersion` / `appVersion` / `exportedAt` |
| 0.4.0 | 加密备份（AES-GCM-256 + PBKDF2-SHA256） |
| 0.9.0 | 加 `format`、`manifest`（条数 + 指纹）、`settings.lastImport` |
| 0.7.0 / 0.8.0 | 改的是**本机存储布局**（localStorage → IndexedDB、打卡拆成一天一行），文件格式没有变 |

两个方向都验过：

- **新读旧**：0.9.0 读得进 0.2.0 以来任何一份导出的 JSON。`tools/format-matrix.py` 用每个版本的页面各导出一份真实备份，再导进 0.9.0，逐类核对条数与正文——7 个版本全过。
- **旧读新**：0.8.0 打不打开 0.9.0 的备份？打开。清单与 `format` 被旧版本忽略，`schemaVersion` 仍是 1，所以不会被「来自更新版本」拦住；实测 3 条记录 + 1 天打卡原样导入，没有警告。

所以 `format` 只在**加壳字段**时动，`schemaVersion` 只在**改数据字段**时动——两个号各自往后走，不会互相拖住。
