/* ============================================================
   着陆台 · 交互逻辑 01
   数据层 / 路由 / 现在页 / 反刍页 / 着陆浮层
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'zhuolu.v1';
  var APP_VERSION = '0.8.0';
  var SCHEMA_VERSION = 1;
  var ROUTES = ['now', 'rumination', 'certainty', 'today', 'review', 'safety', 'more'];
  var KDF_ITER = 210000;
  var MIN_PASS = 6;
  var QUICK_EXIT = {
    search: 'https://www.baidu.com/',
    weather: 'https://www.weather.com.cn/',
    blank: 'about:blank'
  };
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  var KIND_LABEL = { why: '为什么', if: '如果', self: '自我否定', others: '猜别人的想法或结果', her: '猜别人的想法或结果', other: '说不清' };
  var REC_LABEL = { sos: '着陆', rum: '反刍', cert: '确定性', tr: '思维记录', sleep: '睡前' };
  var NUDGE_AFTER_DAYS = 14;
  var NUDGE_FIRST_DAYS = 3;
  var NUDGE_SNOOZE_MS = 3 * 86400000;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(n, a, b) { n = Number(n); if (isNaN(n)) n = a; return Math.max(a, Math.min(b, n)); }
  function avg(arr) {
    if (!arr || !arr.length) return 0;
    var s = 0;
    arr.forEach(function (v) { s += v; });
    return s / arr.length;
  }
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtDateFull(d) { d = d || new Date(); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()]; }
  function fmtClock(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDayTime(ts) { var d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + fmtClock(ts); }
  function fmtShortDate(ts) { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function startOfDay(d) { d = d || new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

  /* ---------------- 状态 ---------------- */

  function blank() {
    return {
      v: 1,
      firstSeen: Date.now(),
      sos: [],
      rum: [],
      cert: [],
      tr: [],
      sleep: [],
      parked: [],
      daily: {},
      window: { time: '19:30', minutes: 15, openedAt: 0, closedDay: '' },
      safety: { signals: [], coping: [], distract: [], people: [], pros: [], env: [], reasons: [], updatedAt: 0 },
      settings: {
        theme: 'auto', motion: 'auto', support: ['', ''], lastExportAt: 0, nudgeSnoozeUntil: 0,
        quickExit: 'search', quickExitUrl: ''
      }
    };
  }

  var storageOK = true;

  function normalize(raw) {
    var b = blank();
    if (!raw || typeof raw !== 'object') return b;
    ['sos', 'rum', 'cert', 'tr', 'sleep', 'parked'].forEach(function (k) {
      if (!Array.isArray(raw[k])) return;
      var seen = {};
      var out = [];
      raw[k].forEach(function (x) {
        if (!x || typeof x !== 'object' || Array.isArray(x)) return;   // 数组和标量不是记录
        // 没有 id 的老记录补一个：分条存储要按 id 对齐，导入去重也靠它
        if (!x.id) x.id = uid();
        var id = String(x.id);
        if (seen[id]) return;                                          // 同一份文件里 id 重复，只留第一条
        seen[id] = true;
        out.push(x);
      });
      b[k] = out;
    });
    if (raw.daily && typeof raw.daily === 'object') b.daily = raw.daily;
    if (raw.window && typeof raw.window === 'object') {
      b.window.time = raw.window.time || '19:30';
      b.window.minutes = clamp(raw.window.minutes || 15, 5, 60);
      b.window.openedAt = Number(raw.window.openedAt) || 0;
      b.window.closedDay = raw.window.closedDay || '';
    }
    if (raw.settings && typeof raw.settings === 'object') {
      b.settings.theme = raw.settings.theme === 'dark' || raw.settings.theme === 'light' ? raw.settings.theme : 'auto';
      b.settings.motion = raw.settings.motion === 'reduce' ? 'reduce' : 'auto';
      if (Array.isArray(raw.settings.support)) b.settings.support = [String(raw.settings.support[0] || ''), String(raw.settings.support[1] || '')];
      b.settings.lastExportAt = Number(raw.settings.lastExportAt) || 0;
      b.settings.nudgeSnoozeUntil = Number(raw.settings.nudgeSnoozeUntil) || 0;
      var qe = raw.settings.quickExit;
      b.settings.quickExit = ['search', 'weather', 'blank', 'custom'].indexOf(qe) >= 0 ? qe : 'search';
      b.settings.quickExitUrl = String(raw.settings.quickExitUrl || '').slice(0, 400);
    }
    if (raw.safety && typeof raw.safety === 'object') {
      ['signals', 'coping', 'distract', 'people', 'pros', 'env', 'reasons'].forEach(function (k) {
        if (!Array.isArray(raw.safety[k])) return;
        b.safety[k] = raw.safety[k]
          .filter(function (x) { return typeof x === 'string'; })
          .map(function (x) { return x.slice(0, 200); })
          .filter(Boolean);
      });
      b.safety.updatedAt = Number(raw.safety.updatedAt) || 0;
    }
    if (raw.firstSeen) b.firstSeen = Number(raw.firstSeen) || Date.now();
    return b;
  }

  /* ---------------- 加解密（WebCrypto） ---------------- */

  var cryptoOK = (function () {
    try {
      return !!(window.crypto && window.crypto.subtle && window.crypto.subtle.importKey &&
        window.crypto.getRandomValues && window.TextEncoder && window.TextDecoder);
    } catch (e) { return false; }
  })();

  function b64FromBytes(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function bytesFromB64(str) {
    var s = atob(String(str || ''));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function randBytes(n) {
    var b = new Uint8Array(n);
    window.crypto.getRandomValues(b);
    return b;
  }

  // 口令先加应用前缀再进 KDF：同一个口令在别的工具里不会派生出同一把钥匙
  function deriveKey(pass, saltB64, iter) {
    return window.crypto.subtle
      .importKey('raw', new TextEncoder().encode('zhuolu|' + pass), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (base) {
        return window.crypto.subtle.deriveKey({
          name: 'PBKDF2', salt: bytesFromB64(saltB64), iterations: iter || KDF_ITER, hash: 'SHA-256'
        }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  function encryptText(key, text) {
    var iv = randBytes(12);
    return window.crypto.subtle
      .encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text))
      .then(function (buf) { return { iv: b64FromBytes(iv), ct: b64FromBytes(new Uint8Array(buf)) }; });
  }

  function decryptText(key, ivB64, ctB64) {
    return window.crypto.subtle
      .decrypt({ name: 'AES-GCM', iv: bytesFromB64(ivB64) }, key, bytesFromB64(ctB64))
      .then(function (buf) { return new TextDecoder().decode(new Uint8Array(buf)); });
  }

  /* ---------------- 本地存储：明文 / 加密信封 ---------------- */

  var lastStorageToast = 0;

  function storageFailed() {
    storageOK = false;
    renderStorageAlert();
    var now = Date.now();
    if (now - lastStorageToast > 20000) {
      lastStorageToast = now;
      try { showToast('这次修改没有保存。先导出备份，或换一个浏览器。'); } catch (err) { /* ignore */ }
    }
  }

  function renderStorageAlert() {
    var el = $('#storage-alert');
    if (el) el.hidden = storageOK;
  }

  // lock.on：本地数据是加密信封；lock.unlocked：当前会话已解锁（钥匙只在内存里）
  var lock = { on: false, unlocked: false, key: null, meta: null, tries: 0, blockedUntil: 0 };
  var uiHint = { theme: 'auto', motion: 'auto' };
  var state = null;
  var saveChain = Promise.resolve();
  var saveSeq = 0;

  function themeOf() {
    if (state && state.settings) return state.settings.theme || 'auto';
    return uiHint.theme || 'auto';
  }

  function motionOf() {
    if (state && state.settings) return state.settings.motion || 'auto';
    return uiHint.motion || 'auto';
  }

  /* ---------------- 存储层 0.7.0 ----------------
     一条记录一个键，按条读、按条写；整份数据不再每次重写。
     旧版（0.6.x）的单块 JSON 在第一次打开时原子搬进来，原文留一份快照。
     IndexedDB 打不开（隐私模式、老旧浏览器）就整份退回旧方式，行为与 0.6.x 一致。 */

  var UI_KEY = 'zhuolu.ui';
  var COLLS = ['sos', 'rum', 'cert', 'tr', 'sleep', 'parked'];
  var DB_NAME = 'zhuolu';
  var DB_VER = 1;
  var DB_REC = 'rec';
  var DB_META = 'meta';
  var SCHEMA_MARK = 2;            // 2：打卡从 meta 里拆出来，一天一行
  var DAY_PREFIX = 'daily|';

  var store = { backend: 'ls', db: null, migrationFailed: false, quota: 0, usage: 0 };
  var cache = null;          // 已落盘的快照，用来算差量
  var idxDirty = {};         // 原地改过的记录：'tr|id' -> true

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function safeJson(v) {
    try { return JSON.stringify(v); } catch (e) { return ''; }
  }

  function reqP(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('idb')); };
    });
  }

  function txDone(tx) {
    return new Promise(function (res, rej) {
      tx.oncomplete = function () { res(null); };
      tx.onerror = function () { rej(tx.error || new Error('tx')); };
      tx.onabort = function () { rej(tx.error || new Error('abort')); };
    });
  }

  function idbOpen() {
    return new Promise(function (res, rej) {
      var idb = null;
      try { idb = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.msIndexedDB; } catch (e) { idb = null; }
      if (!idb) { rej(new Error('no-idb')); return; }
      var req = null;
      try { req = idb.open(DB_NAME, DB_VER); } catch (e) { rej(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_REC)) db.createObjectStore(DB_REC);
        if (!db.objectStoreNames.contains(DB_META)) db.createObjectStore(DB_META);
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('open')); };
      req.onblocked = function () { rej(new Error('blocked')); };
    });
  }

  function idbReadAll() {
    var tx = store.db.transaction([DB_REC, DB_META], 'readonly');
    var rs = tx.objectStore(DB_REC);
    var ms = tx.objectStore(DB_META);
    return Promise.all([
      reqP(rs.getAllKeys()), reqP(rs.getAll()),
      reqP(ms.getAllKeys()), reqP(ms.getAll())
    ]).then(function (out) {
      var all = { recs: [], meta: {} };
      for (var i = 0; i < out[0].length; i++) all.recs.push({ k: String(out[0][i]), v: out[1][i] });
      for (var j = 0; j < out[2].length; j++) all.meta[String(out[2][j])] = out[3][j];
      return all;
    });
  }

  // 一次保存 = 一个事务：要么全落盘，要么一条都不变
  function idbWrite(plan) {
    var db = store.db;
    if (!db) return Promise.reject(new Error('no-db'));
    var tx;
    try { tx = db.transaction([DB_REC, DB_META], 'readwrite'); } catch (e) { return Promise.reject(e); }
    var rs = tx.objectStore(DB_REC);
    var ms = tx.objectStore(DB_META);
    (plan.rec || []).forEach(function (p) { rs.put(p[1], p[0]); });
    // 打卡按格子合并：同一个事务里读-改-写，两个标签页各打各的勾不会互相盖掉
    (plan.merge || []).forEach(function (m) {
      var req = rs.get(m.key);
      req.onsuccess = function () {
        var cur = {};
        try { cur = JSON.parse(req.result || '{}') || {}; } catch (e) { cur = {}; }
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
        Object.keys(m.cells || {}).forEach(function (c) { cur[c] = m.cells[c]; });
        rs.put(safeJson(cur), m.key);
      };
    });
    (plan.del || []).forEach(function (k) { rs.delete(k); });
    (plan.meta || []).forEach(function (p) { ms.put(p[1], p[0]); });
    (plan.mdel || []).forEach(function (k) { ms.delete(k); });
    return txDone(tx);
  }

  function idbMetaPut(key, val) {
    var db = store.db;
    if (!db) return Promise.reject(new Error('no-db'));
    var tx = db.transaction([DB_META], 'readwrite');
    tx.objectStore(DB_META).put(val, key);
    return txDone(tx);
  }

  function idbCount() {
    if (!store.db) return Promise.resolve(0);
    var tx = store.db.transaction([DB_REC], 'readonly');
    return reqP(tx.objectStore(DB_REC).count());
  }

  function metaObj() {
    return { v: 1, firstSeen: state.firstSeen, window: state.window, safety: state.safety, settings: state.settings };
  }

  // 把一份 state 摊成待写入的行（打卡一天一行，不再挤在 meta 里）
  function rowsFrom(st) {
    var plan = { rec: [], del: [], merge: [], meta: [], mdel: [] };
    COLLS.forEach(function (c) {
      (st[c] || []).forEach(function (item) {
        if (!item || !item.id) return;
        plan.rec.push([c + '|' + String(item.id), safeJson(item)]);
      });
    });
    dayList(st).forEach(function (day) {
      plan.rec.push([DAY_PREFIX + day, safeJson(st.daily[day])]);
    });
    var head = { v: 1, firstSeen: st.firstSeen, window: st.window, safety: st.safety, settings: st.settings };
    plan.meta.push(['state', safeJson(head)]);
    return plan;
  }

  // 合法的日子：字符串键，值是对象
  function dayList(st) {
    var out = [];
    Object.keys((st && st.daily) || {}).forEach(function (day) {
      var v = st.daily[day];
      if (!day || !v || typeof v !== 'object' || Array.isArray(v)) return;
      out.push(day);
    });
    return out;
  }

  // 把行拼回一份 state。记录顺序由时间戳决定（unshift 是倒序，等价）
  function stateFromRows(all) {
    var head = {};
    try { head = JSON.parse(all.meta.state || '{}') || {}; } catch (e) { head = {}; }
    var out = { v: 1, firstSeen: head.firstSeen, window: head.window, safety: head.safety, settings: head.settings };
    out.daily = {};
    COLLS.forEach(function (c) { out[c] = []; });
    all.recs.forEach(function (row) {
      var p = row.k.indexOf('|');
      if (p < 0) return;
      var ns = row.k.slice(0, p);
      var rest = row.k.slice(p + 1);
      if (ns === 'daily') {
        var day = null;
        try { day = JSON.parse(row.v); } catch (e) { day = null; }
        if (day && typeof day === 'object' && !Array.isArray(day)) out.daily[rest] = day;
        return;
      }
      if (!out[ns]) return;
      var item = null;
      try { item = JSON.parse(row.v); } catch (e) { item = null; }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      if (!item.id) {
        item.id = rest;
        markRec(ns, rest);              // 从键里补的 id 要写回盘上，不然只有内存里有
      }
      out[ns].push(item);
    });
    // 0.7.x 的打卡还在 meta 里：读到就并进来，等迁移把它拆成行
    if (all.meta.daily) {
      try {
        var legacy = JSON.parse(all.meta.daily) || {};
        Object.keys(legacy).forEach(function (day) {
          var v = legacy[day];
          if (!out.daily[day] && v && typeof v === 'object' && !Array.isArray(v)) out.daily[day] = v;
        });
      } catch (e) { /* ignore */ }
    }
    COLLS.forEach(function (c) {
      out[c].sort(function (a, b) {
        var ta = Number(a && a.t) || 0;
        var tb = Number(b && b.t) || 0;
        if (ta !== tb) return tb - ta;
        var ia = String((a && a.id) || '');
        var ib = String((b && b.id) || '');
        return ia < ib ? 1 : ia > ib ? -1 : 0;
      });
    });
    return normalize(out);
  }

  function buildCache() {
    cache = { rec: {}, daily: { byKey: {} }, meta: { state: '' } };
    COLLS.forEach(function (c) {
      var byKey = {};
      (state[c] || []).forEach(function (item) {
        if (!item || !item.id) return;
        byKey[String(item.id)] = { ref: item, json: safeJson(item) };
      });
      cache.rec[c] = { byKey: byKey };
    });
    dayList(state).forEach(function (day) {
      cache.daily.byKey[day] = { json: safeJson(state.daily[day]) };
    });
    cache.meta.state = safeJson(metaObj());
  }

  function markRec(kind, id) {
    idxDirty[kind + '|' + id] = true;
  }

  // 只把变了的记录拿出来。没变的集合只做指针比较，不重新序列化。
  function buildPlanRows(force) {
    if (!cache) buildCache();
    var plan = { rec: [], del: [], merge: [], meta: [], mdel: [] };
    var mj = safeJson(metaObj());
    if (force || mj !== cache.meta.state) { plan.meta.push(['state', mj]); cache.meta.state = mj; }
    // 打卡：只写这一天里变过的格子，写的时候在事务里和盘上的合并
    var prevDaily = (cache.daily && cache.daily.byKey) || {};
    var nextDaily = {};
    dayList(state).forEach(function (day) {
      var json = safeJson(state.daily[day]);
      var old = prevDaily[day];
      nextDaily[day] = { json: json };
      if (force) { plan.rec.push([DAY_PREFIX + day, json]); return; }
      if (old && old.json === json) return;
      var cells = {};
      var prev = {};
      if (old) { try { prev = JSON.parse(old.json) || {}; } catch (e) { prev = {}; } }
      Object.keys(state.daily[day]).forEach(function (c) {
        var now = !!state.daily[day][c];
        if (old ? (!!prev[c] !== now) : now) cells[c] = now;
      });
      if (!Object.keys(cells).length) return;      // 全是「没打勾」且盘上本来就没有，不写
      plan.merge.push({ key: DAY_PREFIX + day, cells: cells });
    });
    Object.keys(prevDaily).forEach(function (day) {
      if (!nextDaily[day]) plan.del.push(DAY_PREFIX + day);
    });
    cache.daily = { byKey: nextDaily };
    COLLS.forEach(function (c) {
      var prev = cache.rec[c] || { byKey: {} };
      var next = {};
      (state[c] || []).forEach(function (item) {
        if (!item || !item.id) return;
        var id = String(item.id);
        var old = prev.byKey[id];
        var dirty = !!idxDirty[c + '|' + id];
        if (!force && old && old.ref === item && !dirty) { next[id] = old; return; }
        var j = safeJson(item);
        // dirty：盘上那一行是旧的（比如 id 是从键里补出来的），即使内存里的 JSON 没变也要重写
        if (dirty || force || !old || old.json !== j) plan.rec.push([c + '|' + id, j]);
        next[id] = { ref: item, json: j };
      });
      Object.keys(prev.byKey).forEach(function (id) {
        if (!next[id]) plan.del.push(c + '|' + id);
      });
      cache.rec[c] = { byKey: next };
    });
    idxDirty = {};
    return plan;
  }

  function planEmpty(plan) {
    return !plan.rec.length && !plan.del.length && !plan.merge.length &&
      !plan.meta.length && !plan.mdel.length;
  }

  function writeUiHint() {
    var v = (uiHint.theme || 'auto') + '|' + (uiHint.motion || 'auto');
    if (uiHint.written === v) return;
    if (lsSet(UI_KEY, v)) uiHint.written = v;
  }

  function readUiHint() {
    var v = lsGet(UI_KEY);
    if (!v) return;
    var p = String(v).split('|');
    if (p[0] === 'dark' || p[0] === 'light' || p[0] === 'auto') uiHint.theme = p[0];
    if (p[1] === 'reduce' || p[1] === 'auto') uiHint.motion = p[1];
    uiHint.written = v;
  }

  /* ---------------- 启动：先试 IndexedDB，不行就整份退回旧方式 ---------------- */

  function bootStore() {
    return idbOpen().then(function (db) {
      store.db = db;
      store.backend = 'idb';
      return idbReadAll().then(function (all) {
        if (!all.meta.marker) return migrateLegacy(all);
        var mark = null;
        try { mark = JSON.parse(all.meta.marker); } catch (e) { mark = null; }
        if (mark && Number(mark.schema) < SCHEMA_MARK) return upgradeSchema(all);
        adoptMigrated(all);
        return null;
      });
    }, function () {
      store.backend = 'ls';
      store.db = null;
      bootLegacyStore();
      return null;
    }).catch(function () {
      store.backend = 'ls';
      store.db = null;
      store.migrationFailed = true;
      bootLegacyStore();
      return null;
    });
  }

  function adoptPlain(st) {
    lock.on = false;
    lock.unlocked = true;
    state = st;
    uiHint.theme = state.settings.theme || 'auto';
    uiHint.motion = state.settings.motion || 'auto';
  }

  function adoptLocked(env) {
    lock.on = true;
    lock.unlocked = false;
    lock.meta = env.lock;
    if (env.ui) {
      uiHint.theme = env.ui.theme === 'dark' || env.ui.theme === 'light' ? env.ui.theme : 'auto';
      uiHint.motion = env.ui.motion === 'reduce' ? 'reduce' : 'auto';
    }
  }

  function bootLegacyStore() {
    var raw = lsGet(KEY);
    var rs = null;
    if (raw) {
      try {
        rs = JSON.parse(raw);
        if (!rs || typeof rs !== 'object') { rs = null; storageOK = false; }
      } catch (e) {
        rs = null;
        storageOK = false;
      }
    }
    if (rs && rs.locked === true && rs.lock && rs.lock.ct && rs.lock.iv && rs.lock.salt) {
      adoptLocked(rs);
      return;
    }
    lock.unlocked = true;
    adoptPlain(normalize(rs));
  }

  function adoptMigrated(all) {
    try {
      if (all.meta.env) {
        var env = JSON.parse(all.meta.env);
        if (env && env.locked === true && env.lock) { adoptLocked(env); return; }
      }
      adoptPlain(stateFromRows(all));
      buildCache();
      writeUiHint();
      reconcileLegacy();
    } catch (e) {
      state = normalize(null);
      cache = null;
      storageFailed();
    }
  }

  // 0.7.x → 0.8.0：打卡从 meta 里拆出来，一天一行
  // 全在一个事务里：拆完才删 meta.daily、才改 marker；中途失败就按旧布局继续跑
  function upgradeSchema(all) {
    var plan = { rec: [], del: [], merge: [], meta: [], mdel: [] };
    var legacy = {};
    try { legacy = JSON.parse(all.meta.daily || '{}') || {}; } catch (e) { legacy = {}; }
    var have = {};
    (all.recs || []).forEach(function (row) {
      if (row.k.indexOf(DAY_PREFIX) === 0) have[row.k] = true;
    });
    Object.keys(legacy).forEach(function (day) {
      var v = legacy[day];
      if (!day || !v || typeof v !== 'object' || Array.isArray(v)) return;
      if (have[DAY_PREFIX + day]) return;
      plan.rec.push([DAY_PREFIX + day, safeJson(v)]);
    });
    plan.mdel.push('daily');
    plan.meta.push(['marker', safeJson({ schema: SCHEMA_MARK, at: Date.now(), from: 'v0.7' })]);
    return idbWrite(plan).then(function () {
      return idbReadAll();
    }).then(function (all2) {
      adoptMigrated(all2);
      return null;
    }).catch(function () {
      adoptMigrated(all);          // 升级没成功：旧布局照样能读，不丢记录
      return null;
    });
  }

  // 旧标签页可能还在往 localStorage 写；有就按 id 并进来，不丢
  function reconcileLegacy() {
    var raw = lsGet(KEY);
    if (!raw) return;
    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    lsDel(KEY);
    if (!obj || typeof obj !== 'object' || obj.locked === true) return;
    var add = normalize(obj);
    var changed = false;
    COLLS.forEach(function (c) {
      var before = (state[c] || []).length;
      state[c] = mergeList(state[c], add[c]);
      if (state[c].length !== before) changed = true;
    });
    Object.keys(add.daily || {}).forEach(function (day) {
      if (!state.daily[day]) { state.daily[day] = add.daily[day]; changed = true; }
    });
    if (changed) save();
  }

  // 第一次用 0.7.0：把旧数据原子搬进 IndexedDB，原文留快照，成功后才删旧键
  function migrateLegacy(all) {
    var raw = lsGet(KEY);
    var stamp = Date.now();

    if (!raw) {
      adoptPlain(normalize(null));
      var freshPlan = rowsFrom(state);
      freshPlan.meta.push(['marker', safeJson({ schema: SCHEMA_MARK, at: stamp, from: 'new' })]);
      return idbWrite(freshPlan).then(function () {
        buildCache();
        writeUiHint();
        return null;
      });
    }

    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (!obj || typeof obj !== 'object') return Promise.reject(new Error('legacy-corrupt'));

    if (obj.locked === true && obj.lock && obj.lock.ct && obj.lock.iv && obj.lock.salt) {
      var envText = safeJson(obj);
      return idbWrite({
        rec: [], del: [],
        meta: [
          ['env', envText],
          ['marker', safeJson({ schema: SCHEMA_MARK, at: stamp, from: 'locked' })],
          ['snapshot-v1', raw]
        ]
      }).then(function () {
        adoptLocked(obj);
        lsDel(KEY);
        return null;
      });
    }

    var st = normalize(obj);
    var plan = rowsFrom(st);
    plan.meta.push(['marker', safeJson({ schema: SCHEMA_MARK, at: stamp, from: 'v1' })]);
    plan.meta.push(['snapshot-v1', raw]);
    return idbWrite(plan).then(function () {
      return idbCount();
    }).then(function (n) {
      if (n !== plan.rec.length) return Promise.reject(new Error('count-mismatch'));
      adoptPlain(st);
      buildCache();
      writeUiHint();
      lsDel(KEY);
      return null;
    });
  }

  // 加密信封：salt 不变时只换 iv / ct（每次加密必须用新 iv）
  function envelopeObject(iv, ct, salt) {
    var m = lock.meta || {};
    return {
      v: 1,
      locked: true,
      ui: { theme: themeOf(), motion: motionOf() },
      lock: {
        v: 1,
        alg: 'AES-GCM-256',
        kdf: 'PBKDF2-SHA256',
        iter: m.iter || KDF_ITER,
        salt: salt || m.salt || '',
        iv: iv,
        ct: ct,
        autoMin: typeof m.autoMin === 'number' ? m.autoMin : 5,
        hint: m.hint || '',
        createdAt: m.createdAt || Date.now()
      }
    };
  }

  // 旧方式（localStorage 单块）：0.6.x 的行为，作为兜底
  function persistEnvelope(iv, ct, salt) {
    var env = envelopeObject(iv, ct, salt);
    lock.meta = env.lock;
    if (!lsSet(KEY, JSON.stringify(env))) storageFailed();
  }

  // 新方式：信封整块存进 IndexedDB 的 meta
  function writeEnvelope(iv, ct, salt) {
    var env = envelopeObject(iv, ct, salt);
    lock.meta = env.lock;
    if (store.backend !== 'idb') {
      if (!lsSet(KEY, JSON.stringify(env))) storageFailed();
      return Promise.resolve(null);
    }
    return idbMetaPut('env', safeJson(env)).catch(function () { storageFailed(); });
  }

  function save(opts) {
    if (!storageOK) { storageFailed(); return; }
    if (!state) return;                              // 还没解锁：一个字节都不写
    uiHint.theme = state.settings.theme || 'auto';
    uiHint.motion = state.settings.motion || 'auto';
    writeUiHint();
    if (store.backend !== 'idb') { saveLegacy(); return; }
    if (lock.on) { saveLocked(); return; }
    saveRows(opts && opts.full);
  }

  // 兜底：整份 JSON 写 localStorage（0.6.x 的老路）
  function saveLegacy() {
    var text;
    try { text = JSON.stringify(state); } catch (e) { storageFailed(); return; }
    if (!lock.on) {
      if (!lsSet(KEY, text)) storageFailed();
      return;
    }
    if (!cryptoOK) { storageFailed(); return; }
    var seq = ++saveSeq;
    saveChain = saveChain.then(function () {
      var key = lock.key;
      if (!key) return null;
      return encryptText(key, text).then(function (out) {
        if (seq !== saveSeq) return null;            // 后面还有更新的状态，这次丢弃
        persistEnvelope(out.iv, out.ct, null);
        return null;
      });
    }).catch(function () { storageFailed(); });
  }

  // 锁定状态：整份加密成一个信封（锁本来就只能整块加密）
  function saveLocked() {
    if (!cryptoOK) { storageFailed(); return; }
    var text;
    try { text = JSON.stringify(state); } catch (e) { storageFailed(); return; }
    var seq = ++saveSeq;
    saveChain = saveChain.then(function () {
      var key = lock.key;
      if (!key) return null;
      return encryptText(key, text).then(function (out) {
        if (seq !== saveSeq) return null;
        return writeEnvelope(out.iv, out.ct, null);
      });
    }).catch(function () { storageFailed(); });
  }

  // 明文状态：只写变了的记录，一次一个事务
  function saveRows(full) {
    if (!store.db) { storageFailed(); return; }
    var plan = buildPlanRows(!!full);
    if (planEmpty(plan)) return;
    saveChain = saveChain.then(function () {
      return idbWrite(plan).catch(function () { return idbWrite(plan); });
    }).catch(function () { storageFailed(); });
    return saveChain;
  }

  function savePending() {
    return saveChain.then(function () { return null; }, function () { return null; });
  }

  /* ---------------- 主题 / 动效 ---------------- */

  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function applyTheme() {
    var t = themeOf();
    var dark = t === 'dark' || (t === 'auto' && mqDark && mqDark.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#141410' : '#f2eee3');
    var m = motionOf();
    var reduce = m === 'reduce' || (m === 'auto' && mqReduce && mqReduce.matches);
    document.documentElement.setAttribute('data-motion', reduce ? 'reduce' : 'full');
  }

  if (mqDark && mqDark.addEventListener) mqDark.addEventListener('change', applyTheme);
  if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener('change', applyTheme);

  /* ---------------- 提示 ---------------- */

  var toastTimer = null;
  var toastAction = null;

  function hideToast() {
    var el = $('#toast');
    if (el) el.classList.remove('is-on');
    toastAction = null;
  }

  function showToast(msg, actionLabel, actionFn, ms) {
    var el = $('#toast');
    if (!el) return;
    var msgEl = $('#toast-msg');
    if (msgEl) msgEl.textContent = msg; else el.textContent = msg;
    var btn = $('#toast-action');
    toastAction = actionFn || null;
    if (btn) {
      if (actionLabel && actionFn) { btn.textContent = actionLabel; btn.hidden = false; }
      else { btn.hidden = true; }
    }
    el.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || (actionFn ? 6000 : 2600));
  }

  /* ---------------- 口令对话框 ---------------- */

  var passCfg = null;

  function passVal(id) { var el = $('#' + id); return el ? String(el.value || '') : ''; }

  function passError(msg) {
    var el = $('#pass-err');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function passBusy(on) {
    var btn = $('#pass-submit');
    if (!btn) return;
    btn.disabled = !!on;
    btn.textContent = on ? '处理中…' : ((passCfg && passCfg.ok) || '确定');
  }

  function openPass(cfg) {
    passCfg = cfg;
    var kick = $('#pass-kicker');
    if (kick) kick.textContent = cfg.kicker || '口令';
    var title = $('#pass-title');
    if (title) title.textContent = cfg.title || '';
    var lede = $('#pass-lede');
    if (lede) { lede.textContent = cfg.lede || ''; lede.hidden = !cfg.lede; }
    [['#pass-cur-field', cfg.cur], ['#pass-new-field', cfg.new], ['#pass-new2-field', cfg.new2], ['#pass-one-field', cfg.one]]
      .forEach(function (pair) {
        var el = $(pair[0]);
        if (el) el.hidden = !pair[1];
      });
    var nl = $('#pass-new-label');
    if (nl) nl.textContent = cfg.newLabel || '新口令';
    var ol = $('#pass-one-label');
    if (ol) ol.textContent = cfg.oneLabel || '口令';
    ['pass-cur', 'pass-new', 'pass-new2', 'pass-one'].forEach(function (id) {
      var el = $('#' + id);
      if (el) el.value = '';
    });
    passError('');
    passBusy(false);
    var foot = $('#pass-foot');
    if (foot) { foot.textContent = cfg.foot || ''; foot.hidden = !cfg.foot; }
    var str = $('#pass-strength');
    if (str) {
      str.textContent = '至少 ' + MIN_PASS + ' 位。长一点更安全；首尾空格会被忽略。';
      str.hidden = !cfg.new;
    }
    openOverlay('#pass-overlay', cfg.one ? '#pass-one' : (cfg.cur ? '#pass-cur' : '#pass-new'));
  }

  function closePass() {
    var btn = $('#pass-submit');
    if (btn && btn.disabled) return;          // 正在算密钥，别让它半路关掉
    passBusy(false);
    passCfg = null;
    closeOverlay('#pass-overlay');
  }

  function submitPass() {
    var cfg = passCfg;
    if (!cfg) return;
    var v = {
      cur: passVal('pass-cur'),
      np: passVal('pass-new').trim(),
      np2: passVal('pass-new2').trim(),
      one: passVal('pass-one')
    };
    if (cfg.cur && !v.cur) { passError('先输入当前口令。'); return; }
    if (cfg.one && !v.one) { passError('先输入口令。'); return; }
    if (cfg.new) {
      if (v.np.length < MIN_PASS) { passError('口令至少 ' + MIN_PASS + ' 位。'); return; }
      if (v.np !== v.np2) { passError('两次输入不一样。'); return; }
    }
    passError('');
    passBusy(true);
    var out;
    try { out = cfg.run(v); } catch (e) { out = '出错了，再试一次。'; }
    Promise.resolve(out).then(function (err) {
      passBusy(false);
      if (err) { passError(err); return; }
      var after = cfg.after;
      closePass();
      if (after) after();
    }, function () {
      passBusy(false);
      passError('出错了，再试一次。');
    });
  }

  /* ---------------- 应用锁 ---------------- */

  function verifyPass(pass) {
    var m = lock.meta;
    if (!m || !m.ct || !cryptoOK) return Promise.resolve(null);
    return deriveKey(pass, m.salt, m.iter || KDF_ITER).then(function (key) {
      return decryptText(key, m.iv, m.ct).then(function () { return key; });
    }).catch(function () { return null; });
  }

  function unlockApp(pass) {
    var m = lock.meta;
    if (!m || !m.ct || !cryptoOK) return Promise.resolve(false);
    return deriveKey(pass, m.salt, m.iter || KDF_ITER).then(function (key) {
      return decryptText(key, m.iv, m.ct).then(function (text) {
        state = normalize(JSON.parse(text));
        lock.key = key;
        lock.unlocked = true;
        lock.tries = 0;
        lock.blockedUntil = 0;
        uiHint.theme = state.settings.theme || 'auto';
        uiHint.motion = state.settings.motion || 'auto';
        return true;
      });
    }).catch(function () { return false; });
  }

  function enableLock(pass) {
    var salt = b64FromBytes(randBytes(16));
    return deriveKey(pass, salt, KDF_ITER).then(function (key) {
      return encryptText(key, JSON.stringify(state)).then(function (out) {
        var env = envelopeObject(out.iv, out.ct, salt);
        var done = function () {
          lock.on = true;
          lock.unlocked = true;
          lock.key = key;
          lock.meta = env.lock;
          cache = null;
          saveChain = Promise.resolve();
          return null;
        };
        if (store.backend !== 'idb') {
          if (!lsSet(KEY, JSON.stringify(env))) return '写不进去，先导出一份备份。';
          return done();
        }
        // 上锁之后明文不能再留在盘上：同一事务里删掉所有行和升级前的快照
        var tx = store.db.transaction([DB_REC, DB_META], 'readwrite');
        tx.objectStore(DB_REC).clear();
        var ms = tx.objectStore(DB_META);
        ['state', 'daily', 'snapshot-v1'].forEach(function (k) { ms.delete(k); });
        ms.put(safeJson(env), 'env');
        return txDone(tx).then(done);
      });
    }).catch(function () { return '这台设备上的浏览器没能完成加密。'; });
  }

  function changeLock(pass) {
    var salt = b64FromBytes(randBytes(16));
    return deriveKey(pass, salt, KDF_ITER).then(function (key) {
      return encryptText(key, JSON.stringify(state)).then(function (out) {
        lock.key = key;
        return writeEnvelope(out.iv, out.ct, salt).then(function () { return null; });
      });
    }).catch(function () { return '改口令没成功，原来的口令还能用。'; });
  }

  function disableLock() {
    if (store.backend !== 'idb') {
      if (!lsSet(KEY, JSON.stringify(state))) return '写不进去，先导出一份备份。';
      return finishUnlockOff();
    }
    if (!store.db) return '写不进去，先导出一份备份。';
    cache = null;
    var plan = buildPlanRows(true);      // 全量摊成行
    plan.mdel = ['env'];
    return idbWrite(plan).then(finishUnlockOff, function () { return '写不进去，先导出一份备份。'; });
  }

  function finishUnlockOff() {
    lock.on = false;
    lock.key = null;
    lock.unlocked = true;
    lock.meta = null;
    saveChain = Promise.resolve();
    return null;
  }

  function lockError(msg) {
    var el = $('#lock-err');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function showLock() {
    var hint = $('#lock-hint');
    if (hint) {
      var h = lock.meta && lock.meta.hint;
      hint.textContent = h ? '提示：' + h : '';
      hint.hidden = !h;
    }
    lockError('');
    var el = $('#lock-pass');
    if (el) el.value = '';
    openOverlay('#lock-overlay', '#lock-pass');
  }

  function hideLock() {
    var o = $('#lock-overlay');
    if (!o) return;
    o.hidden = true;
    lastFocus = null;
    if (!anyOverlayOpen()) {
      document.body.classList.remove('is-locked');
      setBackgroundInert(false);
    }
  }

  function tryUnlock() {
    var el = $('#lock-pass');
    var pass = el ? el.value : '';
    if (!pass) { lockError('先输入口令。'); return; }
    if (lock.blockedUntil && Date.now() < lock.blockedUntil) {
      lockError('试错太多次，等 ' + Math.ceil((lock.blockedUntil - Date.now()) / 1000) + ' 秒。');
      return;
    }
    var btn = $('#lock-btn');
    if (btn) { btn.disabled = true; btn.textContent = '解锁中…'; }
    unlockApp(pass).then(function (ok) {
      if (btn) { btn.disabled = false; btn.textContent = '解锁'; }
      if (!ok) {
        lock.tries++;
        if (lock.tries >= 5) {
          lock.blockedUntil = Date.now() + 30000;
          lock.tries = 0;
        }
        lockError('口令不对。');
        return;
      }
      hideLock();
      bootApp();
      showToast('已解锁。');
    }, function () {
      if (btn) { btn.disabled = false; btn.textContent = '解锁'; }
      lockError('解锁失败，再试一次。');
    });
  }

  function lockForgot() {
    if (!confirm('忘记口令，就打不开本机的这些记录——这台设备上只有加密后的密文，没有任何地方存着原口令。\n\n如果你在别处存过备份，可以清空本机数据，重新打开后把备份导进来。')) return;
    if (!confirm('最后确认：删除这台设备上的全部数据？这个动作不能撤销。')) return;
    if (store.backend === 'idb' && store.db) {
      var tx = store.db.transaction([DB_REC, DB_META], 'readwrite');
      tx.objectStore(DB_REC).clear();
      tx.objectStore(DB_META).clear();
      txDone(tx).then(function () { location.reload(); }, function () { location.reload(); });
      return;
    }
    lsDel(KEY);
    location.reload();
  }

  function lockNow() {
    if (!lock.on || !lock.unlocked) return;
    lock.unlocked = false;
    lock.key = null;
    state = null;
    savePending().then(function () {
      try { location.reload(); } catch (e) { /* ignore */ }
    });
  }

  function autoLockMin() {
    var m = lock.meta && typeof lock.meta.autoMin === 'number' ? lock.meta.autoMin : 5;
    return Math.max(0, Math.min(120, m));
  }

  function setAutoLock(min) {
    min = Math.max(0, Math.min(120, Number(min) || 0));
    if (!lock.on || !lock.meta) return;
    lock.meta.autoMin = min;
    writeEnvelope(lock.meta.iv, lock.meta.ct, lock.meta.salt);
    lastActive = Date.now();
  }

  var lastActive = Date.now();
  var hiddenAt = 0;
  var idleTimer = null;

  function startIdleWatch() {
    if (idleTimer) return;
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      var away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      lastActive = Date.now();
      if (!lock.on || !lock.unlocked) return;
      var min = autoLockMin();
      if (min > 0 && away >= min * 60000) lockNow();
    });
    idleTimer = setInterval(function () {
      if (!lock.on || !lock.unlocked) return;
      var min = autoLockMin();
      if (min <= 0 || document.visibilityState !== 'visible') return;
      if (Date.now() - lastActive >= min * 60000) lockNow();
    }, 15000);
  }

  /* ---------------- 快速离开 ---------------- */

  function quickExitUrl() {
    var mode = (state && state.settings && state.settings.quickExit) || 'search';
    if (mode === 'custom') {
      var u = String((state && state.settings && state.settings.quickExitUrl) || '').trim();
      if (/^https?:\/\/[^\s]+$/i.test(u)) return u;
      return QUICK_EXIT.search;
    }
    return QUICK_EXIT[mode] || QUICK_EXIT.search;
  }

  function quickExit() {
    var url = quickExitUrl();
    try { location.replace(url); } catch (e) { /* ignore */ }
    // 目标被拦下来时退回一个普通网站，不让按钮失效
    setTimeout(function () {
      try { location.replace(QUICK_EXIT.search); } catch (e) { /* ignore */ }
    }, 250);
  }

  /* ---------------- 安全计划 ---------------- */

  var SP_SECTIONS = [
    { key: 'signals', n: '01', title: '我快撑不住的时候，是这样', hint: '越具体越有用：几点、在做什么、脑子里冒的是哪句话。' },
    { key: 'coping', n: '02', title: '我自己一个人就能做的', hint: '不花钱、不用别人帮忙、十分钟内能开始的。' },
    { key: 'distract', n: '03', title: '能把我从脑子里拽出来的人或地方', hint: '写具体的人名和地点。不用谈心事，待着就行。' },
    { key: 'people', n: '04', title: '可以打电话的人', hint: '写名字和号码。到时候不用组织语言。' },
    { key: 'pros', n: '05', title: '专业人士和热线', hint: '写下来。手机没电、记不住号码的时候照着拨。' },
    { key: 'env', n: '06', title: '让身边的东西不那么危险', hint: '把药、刀、酒交给别人保管——这是最有效的一步。' },
    { key: 'reasons', n: '07', title: '让我还愿意待着的理由', hint: '可以很小：一只猫、没看完的剧、答应过谁的事。' }
  ];

  var SP_PRESETS = {
    signals: ['凌晨还醒着', '反复翻聊天记录', '不想回任何人消息', '觉得自己没价值', '开始想“消失”这个词'],
    coping: ['冲个热水澡', '出门走十五分钟', '延长呼气做十轮', '把想法写下来，不定论', '把手机放到另一个房间'],
    distract: ['去楼下便利店', '去图书馆二楼', '看一部看过的剧', '给朋友发一句“在忙吗”'],
    people: ['妈妈', '最好的朋友', '舍友'],
    pros: ['12356 全国心理援助热线', '010-82951332 北京 24 小时', '学校心理中心'],
    env: ['把药交给家人保管', '把刀收进柜子', '不在深夜一个人出门'],
    reasons: ['我妈会受不了', '还有没看完的书', '想看看三年后的自己']
  };

  function spData() {
    if (!state.safety) state.safety = { signals: [], coping: [], distract: [], people: [], pros: [], env: [], reasons: [], updatedAt: 0 };
    SP_SECTIONS.forEach(function (s) {
      if (!Array.isArray(state.safety[s.key])) state.safety[s.key] = [];
    });
    return state.safety;
  }

  function spCount() {
    if (!state || !state.safety) return 0;
    return SP_SECTIONS.reduce(function (n, s) {
      var list = state.safety[s.key];
      return n + (Array.isArray(list) ? list.length : 0);
    }, 0);
  }

  function spTextHtml(t) {
    var raw = String(t);
    var out = esc(raw);
    var m = raw.match(/1[3-9]\d{9}|0\d{2,3}-?\d{7,8}/);
    if (!m) return out;
    return out.replace(esc(m[0]), function () {
      return '<a href="tel:' + esc(m[0].replace(/-/g, '')) + '">' + esc(m[0]) + '</a>';
    });
  }

  function buildSafetyScaffold() {
    var host = $('#safety-steps');
    if (!host || host.getAttribute('data-built') === '1') return;
    host.innerHTML = SP_SECTIONS.map(function (s) {
      return '<div class="sp-step">' +
        '<div class="sp-step__head"><span class="sp-k">' + s.n + '</span><h2 class="h3">' + esc(s.title) + '</h2></div>' +
        '<p class="small muted sp-hint">' + esc(s.hint) + '</p>' +
        '<ul class="sp-list" data-sp-list="' + s.key + '"></ul>' +
        '<div class="sp-add">' +
          '<input type="text" id="sp-input-' + s.key + '" data-sp-input="' + s.key + '" maxlength="200" ' +
            'placeholder="自己加一条，按回车" aria-label="' + esc(s.title) + '：加一条">' +
          '<button class="btn btn--ghost btn--sm" data-action="sp-add" data-key="' + s.key + '">加入</button>' +
        '</div>' +
        '<div class="chips sp-presets" data-sp-presets="' + s.key + '" aria-label="点一下加进来"></div>' +
      '</div>';
    }).join('');
    host.setAttribute('data-built', '1');
  }

  function renderSafety() {
    if (!state) return;
    buildSafetyScaffold();
    var d = spData();
    SP_SECTIONS.forEach(function (s) {
      var list = $('[data-sp-list="' + s.key + '"]');
      if (list) {
        list.innerHTML = d[s.key].length
          ? d[s.key].map(function (t, i) {
            return '<li class="sp-item"><span class="sp-item__t">' + spTextHtml(t) + '</span>' +
              '<button class="icon-btn" data-action="sp-del" data-key="' + s.key + '" data-i="' + i + '" aria-label="删掉这一条">×</button></li>';
          }).join('')
          : '<li class="sp-empty">还没写。</li>';
      }
      var pres = $('[data-sp-presets="' + s.key + '"]');
      if (pres) {
        pres.innerHTML = (SP_PRESETS[s.key] || []).map(function (t) {
          var on = d[s.key].indexOf(t) >= 0;
          return '<button class="chip' + (on ? ' is-on' : '') + '" data-action="sp-suggest" data-key="' + s.key + '" ' +
            'data-text="' + esc(t) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(t) + '</button>';
        }).join('');
      }
    });
    var total = spCount();
    var status = $('#sp-status');
    if (status) {
      status.textContent = total
        ? '已写 ' + total + ' 条' + (d.updatedAt ? ' · 最后更新 ' + fmtDayTime(d.updatedAt) : '')
        : '还没写。下面每节里的例子，点一下就能加进来。';
    }
    var badge = $('#safety-entry-badge');
    if (badge) badge.textContent = total ? '已写 ' + total + ' 条' : '未写';
    renderSafetyPrint(d);
    syncSOSPlanLink();
  }

  function renderSafetyPrint(d) {
    var host = $('#safety-print');
    if (!host) return;
    var out = ['<div class="pp__head"><b>我的安全计划</b><span>' + esc(fmtDateFull(new Date())) + '</span></div>'];
    SP_SECTIONS.forEach(function (s) {
      if (!d[s.key].length) return;
      out.push('<div class="pp__block"><h3><span class="pp__k">' + s.n + '</span>' + esc(s.title) + '</h3><ul>' +
        d[s.key].map(function (t) { return '<li>' + spTextHtml(t) + '</li>'; }).join('') + '</ul></div>');
    });
    out.push('<div class="pp__foot">12356 全国心理援助热线 · 010-82951332（北京 24 小时）· 120 / 110（紧急）</div>');
    host.innerHTML = out.join('');
  }

  function spAdd(key, text) {
    text = String(text || '').trim();
    if (!text) return;
    if (!SP_PRESETS[key] && !SP_SECTIONS.some(function (s) { return s.key === key; })) return;
    var d = spData();
    if (d[key].indexOf(text) >= 0) { showToast('这一条已经在里面了。'); return; }
    d[key].push(text.slice(0, 200));
    d.updatedAt = Date.now();
    save();
    renderSafety();
  }

  function spDel(key, i) {
    var d = spData();
    var t = d[key][i];
    if (t == null) return;
    d[key].splice(i, 1);
    d.updatedAt = Date.now();
    save();
    renderSafety();
    showToast('删掉了。', '撤销', function () {
      var dd = spData();
      dd[key].splice(Math.min(i, dd[key].length), 0, t);
      dd.updatedAt = Date.now();
      save();
      renderSafety();
    });
  }

  function printSafety() {
    document.body.setAttribute('data-print', 'safety');
    try { window.print(); } catch (e) { /* ignore */ }
    setTimeout(function () { document.body.removeAttribute('data-print'); }, 1200);
  }

  /* ---------------- 安全计划速览（浮层） ---------------- */

  function renderSpView() {
    var host = $('#sp-view');
    if (!host) return;
    var d = spData();
    var parts = ['<div class="sp-view__crisis"><b>如果现在就有危险</b>打 <a href="tel:12356">12356</a>，' +
      '或 <a href="tel:120">120</a> / <a href="tel:110">110</a>。这一步比看计划更要紧。</div>'];
    SP_SECTIONS.forEach(function (s) {
      var list = d[s.key];
      if (!list.length) return;
      parts.push('<section class="sp-view__block"><h3><span class="sp-k">' + s.n + '</span>' + esc(s.title) + '</h3><ul>' +
        list.map(function (t) { return '<li>' + spTextHtml(t) + '</li>'; }).join('') + '</ul></section>');
    });
    if (parts.length === 1) {
      parts.push('<p class="small muted">这份计划还是空的。等稳一点，去「06 安全计划」写两节就够：' +
        '可以打电话的人、让身边的东西不那么危险。</p>');
    }
    host.innerHTML = parts.join('');
  }

  function openSpView() {
    renderSpView();
    openOverlay('#sp-overlay', '.panel__close');
  }

  function closeSpView() {
    closeOverlay('#sp-overlay');
  }

  function syncSOSPlanLink() {
    var has = spCount() > 0;
    ['#sos-sp-link', '#sos-sp-btn5', '#sos-sp-hint5'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.hidden = !has;
    });
  }

  /* ---------------- 路由 ---------------- */

  function currentRoute() {
    var h = String(location.hash || '').replace(/^#\/?/, '');
    return ROUTES.indexOf(h) >= 0 ? h : 'now';
  }

  var routedHash = '';

  function renderRoute() {
    routedHash = String(location.hash || '');
    var route = currentRoute();
    $$('.view').forEach(function (v) {
      v.classList.toggle('is-active', v.getAttribute('data-view') === route);
    });
    $$('.nav-item, .bnav-item').forEach(function (a) {
      a.classList.toggle('is-on', a.getAttribute('data-route') === route);
    });
    renderAll();
  }

  function go(route) {
    if (ROUTES.indexOf(route) < 0) route = 'now';
    if (currentRoute() !== route) {
      try { location.hash = '#/' + route; } catch (e) { /* ignore */ }
    }
    window.scrollTo(0, 0);
    renderRoute();
  }

  // 站内跳转已经由 go() 立刻渲染，hashchange 只负责后退 / 前进 / 手改地址。
  // WebKit 偶尔把 hashchange 派发在地址更新之前，所以延后一拍再核对一次地址，
  // 避免"点了导航、地址变了、界面没动"。
  window.addEventListener('hashchange', function () {
    var want = String(location.hash || '');
    if (want === routedHash) return;
    setTimeout(function () {
      if (String(location.hash || '') !== want) return;
      if (want === routedHash) return;
      window.scrollTo(0, 0);
      renderRoute();
    }, 0);
  });

  /* ---------------- 现在页 ---------------- */

  var TINY = [
    '把手机翻过去，屏幕朝下。',
    '站起来，接一杯水，慢慢喝完。',
    '去洗把脸，用凉一点的水。',
    '打开窗，站一分钟，只感觉空气。',
    '把桌面上的三样东西放回原位。',
    '走到门口，再走回来。',
    '给自己泡一杯热的，双手握住。',
    '把明天要穿的衣服拿出来。',
    '删掉一个不再需要的提醒。',
    '给一个人发一句：在干嘛。',
    '把房间的灯调暗一点。',
    '坐着，脚掌贴地，感觉十秒。'
  ];
  var lastTiny = 0;

  function pickTiny() {
    var i = Math.floor(Math.random() * TINY.length);
    if (TINY.length > 1 && i === lastTiny) i = (i + 1) % TINY.length;
    lastTiny = i;
    var el = $('#one-thing');
    if (el) el.textContent = TINY[i];
  }

  function weekStats() {
    var since = Date.now() - 7 * 86400000;
    var sos = state.sos.filter(function (e) { return e.t >= since; });
    var rum = state.rum.filter(function (e) { return e.t >= since; });
    var total = 0, n = 0;
    sos.forEach(function (e) {
      if (typeof e.before === 'number' && typeof e.after === 'number') { total += (e.before - e.after); n++; }
    });
    return { sos: sos.length, rum: rum.length, drop: n ? total / n : 0, n: n };
  }

  function activityDays() {
    var set = {};
    function mark(ts) { if (ts) set[dayKey(new Date(ts))] = true; }
    state.sos.forEach(function (e) { mark(e.t); });
    state.rum.forEach(function (e) { mark(e.t); });
    state.cert.forEach(function (e) { mark(e.t); });
    state.tr.forEach(function (e) { mark(e.t); });
    state.sleep.forEach(function (e) { mark(e.t); });
    Object.keys(state.daily).forEach(function (k) {
      var d = state.daily[k];
      if (d && (d.sleep || d.eat || d.move || d.connect || d.push)) set[k] = true;
    });
    return set;
  }

  function streak() {
    var set = activityDays();
    var n = 0;
    var d = new Date();
    while (n < 365) {
      if (!set[dayKey(d)]) break;
      n++;
      d = new Date(d.getTime() - 86400000);
    }
    return n;
  }

  function renderTopbar() {
    var d = new Date();
    var dayNo = Math.max(1, Math.floor((startOfDay(d) - startOfDay(new Date(state.firstSeen))) / 86400000) + 1);
    var el = $('#topbar-date');
    if (el) el.textContent = fmtDateFull(d) + ' · 使用第 ' + dayNo + ' 天';
    var g = $('#greet');
    if (g) {
      var h = d.getHours();
      var word = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午' : h < 14 ? '下午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜';
      g.textContent = word + '好 · 现在';
    }
  }

  function renderHome() {
    var st = weekStats();
    var act = activityDays();
    var active7 = 0;
    Object.keys(act).forEach(function (k) {
      var d = new Date(k + 'T00:00:00');
      if (!isNaN(d.getTime()) && Date.now() - d.getTime() < 7 * 86400000) active7++;
    });
    var parts = [];
    if (st.sos) parts.push('<span><b>' + st.sos + '</b>次着陆（近 7 天）</span>');
    if (st.rum) parts.push('<span><b>' + st.rum + '</b>次反刍登记</span>');
    if (st.n >= 2) parts.push('<span>着陆后平均降 <b>' + st.drop.toFixed(1) + '</b> 分</span>');
    if (active7 >= 2) parts.push('<span>最近 7 天有 <b>' + active7 + '</b> 天记过东西</span>');
    if (!parts.length) parts.push('<span>还没有记录。难受的时候，按上面那个按钮就行。</span>');
    var el = $('#home-stats');
    if (el) el.innerHTML = parts.join('');

    var w = windowInfo();
    var hw = $('#home-window');
    if (hw) {
      if (!w.open && state.parked.length) {
        hw.hidden = false;
        hw.innerHTML = '<span>盒子里有 <b>' + state.parked.length + '</b> 个念头 · 担忧窗口 <b>' + (w.closedToday ? '明天 ' : '') + esc(state.window.time) + '</b> 打开</span>';
      } else if (w.open) {
        hw.hidden = false;
        hw.innerHTML = '<span>担忧窗口开着 · 现在可以处理盒子里的念头</span>';
      } else {
        hw.hidden = true;
      }
    }
  }

  /* ---------------- 备份与存储 ---------------- */

  var persistNote = '';
  var quotaWarned = false;

  function recordCount() {
    return ['sos', 'rum', 'cert', 'tr', 'sleep', 'parked'].reduce(function (n, k) {
      return n + (state[k] || []).length;
    }, 0);
  }

  function backupStatus() {
    var count = recordCount();
    if (!count) return { show: false };
    var now = Date.now();
    if (Number(state.settings.nudgeSnoozeUntil) > now) return { show: false };
    var last = Number(state.settings.lastExportAt) || 0;
    var since = last || Number(state.firstSeen) || now;
    var days = Math.max(0, Math.floor((now - since) / 86400000));
    if (last) {
      if (days < NUDGE_AFTER_DAYS) return { show: false, days: days };
      return { show: true, days: days, never: false };
    }
    if (days < NUDGE_FIRST_DAYS) return { show: false, days: days };
    return { show: true, days: days, never: true };
  }

  function renderBackupNudge() {
    var st = backupStatus();
    var nudge = $('#backup-nudge');
    if (nudge) {
      nudge.hidden = !st.show;
      if (st.show) {
        var title = $('#backup-nudge-title');
        var text = $('#backup-nudge-text');
        if (title) title.textContent = st.never ? '还没有导出过备份' : '距离上次备份 ' + st.days + ' 天';
        if (text) {
          text.textContent = st.never
            ? '记录只存在这台设备的浏览器里。导出一份 JSON 存到网盘或电脑，换手机、清缓存时才不会丢。'
            : '浏览器数据可能被系统清理。现在导出一份，换设备或清缓存时能接上。';
        }
      }
    }
    var badge = $('#backup-badge');
    if (badge) badge.hidden = !st.show;
    var ex = $('#export-note');
    if (ex) {
      if (!state.settings.lastExportAt) {
        ex.textContent = '还没有导出过备份。';
      } else {
        var d = Math.max(0, Math.floor((Date.now() - state.settings.lastExportAt) / 86400000));
        ex.textContent = '上次导出：' + fmtDayTime(state.settings.lastExportAt) + (d >= 1 ? '（' + d + ' 天前）' : '（今天）');
      }
    }
  }

  function stateBytes() {
    try {
      return JSON.stringify(state).length * 2;
    } catch (e) { return 0; }
  }

  function fmtBytes(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }

  function refreshStorageNote() {
    var bytes = stateBytes();
    var parts = [];
    if (!storageOK) parts.push('当前浏览器不允许本地存储：记录只在本次打开有效，请立即导出');
    else if (persistNote) parts.push(persistNote);
    if (store.backend === 'idb') {
      if (bytes > 0) parts.push('本机数据约 ' + fmtBytes(bytes));
      if (store.quota > 0) parts.push('浏览器已占 ' + fmtBytes(store.usage) + ' / 上限 ' + fmtBytes(store.quota));
    } else {
      if (store.migrationFailed) parts.push('新版存储没能启用，仍按旧方式保存，记录不会丢');
      if (bytes > 0) parts.push('本机数据约 ' + fmtBytes(bytes) + ' / 浏览器上限约 5 MB');
      if (bytes > 4194304) parts.push('空间快满了，建议导出后清理旧记录。');
      if (bytes > 4194304 && !quotaWarned) {
        quotaWarned = true;
        showToast('本地存储快满了，先导出一份备份。');
      }
    }
    setStorageNote(parts.join(' · '));
  }

  // 浏览器给这个站点多少空间：只用于显示，取不到就不显示
  function updateQuotaNote() {
    try {
      if (!(navigator.storage && navigator.storage.estimate)) return;
      navigator.storage.estimate().then(function (est) {
        if (!est || !est.quota) return;
        store.quota = Number(est.quota) || 0;
        store.usage = Number(est.usage) || 0;
        refreshStorageNote();
      }, function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 担忧窗口 ---------------- */

  function windowMinutes() { return clamp(state.window.minutes || 15, 5, 60); }

  function windowInfo() {
    var now = Date.now();
    var mins = windowMinutes();
    var opened = Number(state.window.openedAt) || 0;
    if (opened) {
      var end = opened + mins * 60000;
      if (now < end) return { open: true, end: end, total: mins * 60000, start: opened };
      state.window.openedAt = 0;
      save();
    }
    var parts = String(state.window.time || '19:30').split(':');
    var d = new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), clamp(parts[0] || 19, 0, 23), clamp(parts[1] || 30, 0, 59), 0, 0).getTime();
    var end2 = start + mins * 60000;
    var closedToday = state.window.closedDay === dayKey();
    if (!closedToday && now >= start && now < end2) return { open: true, end: end2, total: mins * 60000, start: start, scheduled: true };
    var next = now < start ? start : start + 86400000;
    if (closedToday) next = start + 86400000;
    return { open: false, next: next, closedToday: closedToday };
  }

  var lastWindowOpen = null;

  // 跨过午夜：页面一直开着也要换成新的一天，别让昨天的对勾挂到今天
  var daySeen = '';
  function checkDayChange() {
    var k = dayKey();
    if (k === daySeen) return;
    var first = !daySeen;
    daySeen = k;
    if (first || !booted) return;
    renderToday();
    renderReview();
    renderRum();
  }

  function updateWindowTimer() {
    var w = windowInfo();
    if (lastWindowOpen !== null && lastWindowOpen !== !!w.open) {
      lastWindowOpen = !!w.open;
      renderWindow();
      return;
    }
    lastWindowOpen = !!w.open;
    var timer = $('#window-timer');
    if (!timer) return;
    if (!w.open) {
      timer.hidden = true;
      return;
    }
    timer.hidden = false;
    var left = Math.max(0, w.end - Date.now());
    var mm = Math.floor(left / 60000);
    var ss = Math.floor((left % 60000) / 1000);
    var cd = $('#window-countdown');
    if (cd) cd.textContent = pad(mm) + ':' + pad(ss);
    var bar = $('#window-bar');
    if (bar) bar.style.width = Math.max(0, Math.min(100, left / w.total * 100)) + '%';
    if (left <= 0) {
      state.window.openedAt = 0;
      save();
      renderWindow();
    }
  }

  function parkedItemHtml(p, canDelete) {
    return '<li class="item"><div class="item__main"><div class="item__text">' + esc(p.text) + '</div>' +
      '<div class="item__meta">' + fmtClock(p.t) + ' 存入</div></div>' +
      (canDelete ? '<button class="icon-btn" data-action="del-parked" data-id="' + esc(p.id) + '" aria-label="删除这个念头">×</button>' : '') +
      '</li>';
  }

  function renderWindow() {
    var w = windowInfo();
    var mins = windowMinutes();
    var timeEl = $('#window-time');
    if (timeEl) timeEl.textContent = state.window.time;
    var input = $('#window-time-input');
    if (input) input.value = state.window.time;

    var timer = $('#window-timer');
    if (timer) timer.hidden = !w.open;
    var openBtn = $('#window-open-btn');
    if (openBtn) openBtn.hidden = !!w.open;
    var closeBtn = $('#window-close-btn');
    if (closeBtn) closeBtn.hidden = !w.open;
    var list = $('#parked-list');
    if (list) list.hidden = !w.open;

    var status = $('#window-status');
    if (status) {
      if (w.open) {
        status.innerHTML = '<span class="window-state">窗口开着</span> · 处理盒子里的念头，到点就关。一次只处理一件。';
      } else {
        if (w.closedToday) {
          status.innerHTML = '<span class="window-state is-closed">今天已关</span> · 剩下的明天 <b>' + esc(state.window.time) + '</b> 再说。现在想到的，存进盒子。';
        } else {
          var nextTxt = fmtClock(w.next);
          status.innerHTML = '<span class="window-state is-closed">未到时间</span> · 现在想到的念头，先存进盒子，<b>' + nextTxt + '</b> 再打开。';
        }
      }
    }

    var listEl = $('#parked-list');
    if (listEl) {
      listEl.innerHTML = w.open
        ? (state.parked.length ? state.parked.map(function (p) { return parkedItemHtml(p, true); }).join('') : '<li class="empty">盒子里是空的。</li>')
        : '';
    }

    var hint = $('#parked-hint');
    if (hint) {
      if (w.open) {
        hint.textContent = state.parked.length ? '处理完一个就删掉一个。处理不了也没关系，明天再说。' : '有念头就写进来。现在只处理，不展开。';
      } else {
        var when = w.closedToday ? '明天 ' + state.window.time : state.window.time;
        hint.textContent = state.parked.length
          ? '盒子里有 ' + state.parked.length + ' 个念头，' + when + ' 再打开。'
          : '想到什么，先存进来。' + (w.closedToday ? '明天 ' + state.window.time + ' 再一起看。' : '到点再一起看。');
      }
    }
    updateWindowTimer();
  }

  function openWindow() {
    var w = windowInfo();
    if (w.open) { showToast('窗口已经开着。'); return; }
    state.window.openedAt = Date.now();
    state.window.closedDay = '';
    save();
    renderWindow();
    renderHome();
    showToast('窗口开着，' + windowMinutes() + ' 分钟。到点自动关。');
  }

  function closeWindow() {
    var w = windowInfo();
    state.window.openedAt = 0;
    state.window.closedDay = w.scheduled ? dayKey() : '';
    save();
    renderWindow();
    renderHome();
    showToast('窗口已关。剩下的，明天再说。');
  }

  function ensureParkForm() {
    var form = $('#park-form');
    if (form) return form;
    var host = $('.window-card') || $('#window-card');
    if (!host) return null;
    form = document.createElement('div');
    form.id = 'park-form';
    form.className = 'park-form';
    form.hidden = true;
    form.innerHTML = '<textarea id="park-text" placeholder="把念头压成一句。只存，不展开。"></textarea>' +
      '<div class="step-actions"><button class="btn btn--primary btn--sm" data-action="save-park">存进盒子</button>' +
      '<button class="btn btn--ghost btn--sm" data-action="cancel-park">取消</button></div>';
    host.appendChild(form);
    return form;
  }

  function toggleParkForm(show) {
    var form = ensureParkForm();
    if (!form) return;
    form.hidden = !show;
    if (show) {
      var ta = $('#park-text');
      if (ta) { ta.value = ''; setTimeout(function () { ta.focus(); }, 30); }
    }
  }

  function savePark() {
    var ta = $('#park-text');
    var text = ta ? ta.value.trim() : '';
    if (!text) { showToast('写一句再存。'); return; }
    state.parked.unshift({ id: uid(), t: Date.now(), text: text });
    save();
    toggleParkForm(false);
    renderWindow();
    renderHome();
    showToast('已放进盒子。到窗口时间再看。');
  }

  function renderRum() {
    var today = dayKey();
    var count = state.rum.filter(function (r) { return dayKey(new Date(r.t)) === today; }).length;
    var badge = $('#rum-count');
    if (badge) badge.textContent = '今天 ' + count + ' 次';
    var list = $('#rum-list');
    if (!list) return;
    var items = state.rum.slice(0, 8);
    if (!items.length) {
      list.innerHTML = '<li class="empty">还没有登记。反刍来的时候，点上面的按钮。</li>';
      return;
    }
    list.innerHTML = items.map(function (r) {
      return '<li class="item"><div class="item__main"><div class="item__text">' + esc(r.thought || '（没有写内容）') + '</div>' +
        '<div class="item__meta">' + KIND_LABEL[r.kind] + ' · ' + fmtDayTime(r.t) + '</div></div></li>';
    }).join('');
  }

  /* ---------------- 着陆浮层 ---------------- */

  var sos = {
    step: 1,
    before: 7,
    after: 5,
    need: [],
    timer: null,
    startedAt: 0,
    lastPhase: '',
    ground: { see: 0, touch: 0, hear: 0, smell: 0, taste: 0 }
  };

  var lastFocus = null;
  var FOCUS_SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function overlayFocusables(overlay) {
    return $$(FOCUS_SEL, overlay).filter(function (el) {
      return el.getClientRects().length > 0;
    });
  }

  function setBackgroundInert(on) {
    ['.skip', '.rail', '.shell', '.bottom-nav'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    });
  }

  function openOverlay(id, focusSel) {
    lastFocus = document.activeElement;
    var o = $(id);
    if (!o) return;
    o.hidden = false;
    document.body.classList.add('is-locked');
    setBackgroundInert(true);
    hideToast();
    var f = (focusSel && $(focusSel, o)) || $('.panel__close', o);
    if (f) setTimeout(function () { try { f.focus(); } catch (e) { /* ignore */ } }, 40);
  }

  function anyOverlayOpen() {
    return $$('.overlay').some(function (o) { return !o.hidden; });
  }

  function closeOverlay(id) {
    var o = $(id);
    if (!o) return;
    o.hidden = true;
    if (!anyOverlayOpen()) {
      document.body.classList.remove('is-locked');
      setBackgroundInert(false);
    }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
  }

  function focusStepHeading(overlay, n, attr) {
    var step = $('[data-' + attr + '="' + n + '"]', overlay);
    if (!step) return;
    var h = step.querySelector('h2');
    if (!h) return;
    h.setAttribute('tabindex', '-1');
    setTimeout(function () { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }, 30);
  }

  function showSOSStep(n) {
    sos.step = n;
    var overlay = $('#sos-overlay');
    if (!overlay) return;
    $$('[data-sos-step]', overlay).forEach(function (s) {
      s.classList.toggle('is-on', Number(s.getAttribute('data-sos-step')) === n);
    });
    var kicker = $('#sos-kicker');
    if (kicker) {
      var stage = n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : 4;
      kicker.textContent = '着陆 · ' + stage + ' / 4';
    }
    var dots = $$('#sos-dots i');
    dots.forEach(function (dot, i) {
      dot.classList.toggle('is-on', i === Math.min(3, n - 1));
      dot.classList.toggle('is-done', i < Math.min(4, n - 1));
    });
    focusStepHeading(overlay, n, 'sos-step');
  }

  function resetBreathingUI() {
    var stage = $('#breathe-stage');
    if (stage) stage.className = 'breathe__stage is-idle';
    var phase = $('#breathe-phase');
    if (phase) phase.textContent = '准备';
    var count = $('#breathe-count');
    if (count) count.textContent = '第 0 / 5 轮';
    var bar = $('#breathe-bar');
    if (bar) bar.style.width = '0%';
    sos.lastPhase = '';
  }

  function stopBreathing() {
    if (sos.timer) { clearInterval(sos.timer); sos.timer = null; }
  }

  function finishBreathing() {
    stopBreathing();
    var bar = $('#breathe-bar');
    if (bar) bar.style.width = '100%';
    var phase = $('#breathe-phase');
    if (phase) phase.textContent = '完成';
    var stage = $('#breathe-stage');
    if (stage) stage.className = 'breathe__stage is-idle';
    sos.step = 3;
    setTimeout(function () { showSOSStep(3); }, 420);
  }

  function tickBreathing() {
    var elapsed = (Date.now() - sos.startedAt) / 1000;
    if (elapsed >= 60) { finishBreathing(); return; }
    var cycle = Math.floor(elapsed / 12);
    var within = elapsed - cycle * 12;
    var phase, label;
    if (within < 4) { phase = 'in'; label = '吸气'; }
    else if (within < 6) { phase = 'hold'; label = '停'; }
    else { phase = 'out'; label = '呼气'; }
    if (sos.lastPhase !== phase) {
      sos.lastPhase = phase;
      var stage = $('#breathe-stage');
      if (stage) stage.className = 'breathe__stage is-' + phase;
      var ph = $('#breathe-phase');
      if (ph) ph.textContent = label;
    }
    var count = $('#breathe-count');
    if (count) count.textContent = '第 ' + (cycle + 1) + ' / 5 轮';
    var bar = $('#breathe-bar');
    if (bar) bar.style.width = Math.min(100, elapsed / 60 * 100) + '%';
  }

  function startBreathing() {
    stopBreathing();
    sos.startedAt = Date.now();
    sos.lastPhase = '';
    resetBreathingUI();
    tickBreathing();
    sos.timer = setInterval(tickBreathing, 200);
  }

  function resetGround() {
    sos.ground = { see: 0, touch: 0, hear: 0, smell: 0, taste: 0 };
    $$('#ground-list .ground-row').forEach(function (row) {
      row.classList.remove('is-done');
      $$('.ground-dots i', row).forEach(function (d) { d.classList.remove('is-on'); });
    });
  }

  function resetSOS() {
    stopBreathing();
    sos.before = 7;
    sos.after = 5;
    sos.need = [];
    sos.lastPhase = '';
    var before = $('#sos-before');
    if (before) before.value = '7';
    var beforeNum = $('#sos-before-num');
    if (beforeNum) beforeNum.textContent = '7';
    var after = $('#sos-after');
    if (after) after.value = '5';
    var afterNum = $('#sos-after-num');
    if (afterNum) afterNum.textContent = '5';
    $$('#sos-need .chip').forEach(function (c) { c.classList.remove('is-on'); });
    resetBreathingUI();
    resetGround();
  }

  function openSOS() {
    if ($('#intercept-overlay') && !$('#intercept-overlay').hidden) closeOverlay('#intercept-overlay');
    syncSOSPlanLink();
    resetSOS();
    openOverlay('#sos-overlay');
    showSOSStep(1);
  }

  function closeSOS() {
    stopBreathing();
    closeOverlay('#sos-overlay');
    renderAll();
  }

  function sosStart() {
    var before = $('#sos-before');
    sos.before = before ? Number(before.value) : 7;
    var beforeNum = $('#sos-before-num');
    if (beforeNum) beforeNum.textContent = String(sos.before);
    showSOSStep(2);
    startBreathing();
  }

  function sosSkipBreath() {
    stopBreathing();
    showSOSStep(3);
  }

  function sosToAfter() {
    stopBreathing();
    var after = $('#sos-after');
    sos.after = after ? Number(after.value) : 5;
    showSOSStep(4);
  }

  function sosFinish() {
    var after = $('#sos-after');
    sos.after = after ? Number(after.value) : 5;
    var afterNum = $('#sos-after-num');
    if (afterNum) afterNum.textContent = String(sos.after);
    var need = [];
    $$('#sos-need .chip').forEach(function (c) { if (c.classList.contains('is-on')) need.push(c.getAttribute('data-need')); });
    sos.need = need;
    state.sos.unshift({ id: uid(), t: Date.now(), before: sos.before, after: sos.after, need: need });
    save();
    renderAll();
    var b = $('#sos-delta-before');
    var a = $('#sos-delta-after');
    if (b) b.textContent = String(sos.before);
    if (a) a.textContent = String(sos.after);
    var d = sos.before - sos.after;
    var delta = $('#sos-delta');
    if (delta) {
      delta.textContent = d > 0 ? '降了 ' + d + ' 分' : d === 0 ? '没有变化，也正常' : '反而升了 ' + Math.abs(d) + ' 分';
      delta.className = 'delta' + (d < 0 ? ' is-up' : '');
    }
    showSOSStep(5);
  }

  function sosRestart() {
    resetSOS();
    showSOSStep(1);
  }

  /* ---------------- 反刍拦截 ---------------- */

  var IT_ANSWERS = {
    why: {
      title: '“为什么”没有出口，只有下一步。',
      html: '<p>你在找一个解释：为什么会发生、为什么是我。但就算找到原因，结果也不会改变。反刍会把“找一个解释”伪装成“解决问题”。</p><p>把它换成一句具体的：<span class="em">下次我会……</span> 只写一条，写完就停。</p>',
      label: '下次我会…（只写一条）',
      ph: '例：下次我会更早表达，不憋到最后一刻。'
    },
    if: {
      title: '你在提前演练一个还没发生的结果。',
      html: '<p>“如果……怎么办”的答案不能靠想出来，只能靠预案。现在只写一次应对，不要推演第二层。</p><p>写下最坏情况和你打算怎么应对，各一句。写完，今天就不用再算了。</p>',
      label: '最坏会怎样 / 我会怎么应对',
      ph: '例：最坏是事情没有按我想的走；我会先找朋友吃顿饭，然后继续手头的事。'
    },
    self: {
      title: '一次结果，不是对你整个人的评分。',
      html: '<p>“是我不够好”把一次结果升级成了全局评价。事情没做好、被否定、被误解，通常只说明：这一次的条件、时机、能力或状态不理想，不说明你的价值。</p><p>写三条与这件事无关、但依然成立的事实。</p>',
      label: '三条与这件事无关的事实',
      ph: '例：我上周帮舍友搬了东西；我能按时交作业；我做饭不难吃。'
    },
    others: {
      title: '别人的想法和结果，在“不可知区”。',
      html: '<p>别人真实的想法、事情最终会怎样、以后会不会好——这些都无法验证。你可以猜，但猜不产生信息，只会产生更多猜测。</p><p>把它归到不可知区：不求解，只存放。写下要放进盒子的那句。</p>',
      label: '要存进盒子的那句（可留空）',
      ph: '例：他们到底怎么看我；这件事最后会不会好。'
    },
    other: {
      title: '先承认它来过，不急着解释。',
      html: '<p>有些反刍没有清晰的主题，只是脑子停不下来。这时候不需要分析，只需要给它一个落点。</p><p>写一句：我现在感觉到的是……不用解释为什么。</p>',
      label: '我现在感觉到的是…',
      ph: '例：胸口很紧，说不清的难受。'
    }
  };

  var it = { step: 1, kind: '', thought: '', action: '' };

  function showITStep(n) {
    it.step = n;
    var overlay = $('#intercept-overlay');
    if (!overlay) return;
    $$('[data-it-step]', overlay).forEach(function (s) {
      s.classList.toggle('is-on', Number(s.getAttribute('data-it-step')) === n);
    });
    var kicker = $('#it-kicker');
    if (kicker) kicker.textContent = '反刍拦截 · ' + n + ' / 3';
    $$('#it-dots i').forEach(function (dot, i) {
      dot.classList.toggle('is-on', i === Math.min(2, n - 1));
      dot.classList.toggle('is-done', i < Math.min(3, n - 1));
    });
    focusStepHeading(overlay, n, 'it-step');
  }

  function resetIntercept() {
    it = { step: 1, kind: '', thought: '', action: '' };
    var ta = $('#it-thought');
    if (ta) ta.value = '';
    var act = $('#it-action');
    if (act) act.value = '';
    $$('#it-kinds .kind-btn').forEach(function (b) { b.classList.remove('is-on'); });
  }

  function openIntercept() {
    if (!$('#sos-overlay').hidden) closeOverlay('#sos-overlay');
    resetIntercept();
    openOverlay('#intercept-overlay');
    showITStep(1);
  }

  function closeIntercept() {
    closeOverlay('#intercept-overlay');
    renderAll();
  }

  function itNext() {
    var ta = $('#it-thought');
    var text = ta ? ta.value.trim() : '';
    if (!text) { showToast('写一句再继续。写不完整也可以。'); if (ta) ta.focus(); return; }
    if (!it.kind) { showToast('先选一个类型，不做判断也可以选“说不清”。'); return; }
    it.thought = text;
    var a = IT_ANSWERS[it.kind] || IT_ANSWERS.other;
    var title = $('#it-answer-title');
    if (title) title.textContent = a.title;
    var answer = $('#it-answer');
    if (answer) answer.innerHTML = a.html;
    var label = $('#it-action-label');
    if (label) label.textContent = a.label;
    var action = $('#it-action');
    if (action) { action.value = ''; action.placeholder = a.ph; }
    showITStep(2);
  }

  function itSave() {
    var act = $('#it-action');
    it.action = act ? act.value.trim() : '';
    state.rum.unshift({ id: uid(), t: Date.now(), thought: it.thought, kind: it.kind, action: it.action });
    save();
    var today = dayKey();
    var count = state.rum.filter(function (r) { return dayKey(new Date(r.t)) === today; }).length;
    var done = $('#it-done-text');
    if (done) {
      var extra = (it.kind === 'others' || it.kind === 'her') ? '它现在属于不可知区，先存放。' : '如果还想继续，把它留到担忧窗口。';
      done.innerHTML = '它今天来过 <b>' + count + '</b> 次。' + extra +
        (count >= 3 ? '<br><span class="muted">次数多，不代表它更真。</span>' : '');
    }
    renderAll();
    showITStep(3);
  }

  /* ---------------- 确定性 ---------------- */

  function certFields() {
    return {
      fact: ($('#cert-fact') || {}).value || '',
      interp: ($('#cert-interp') || {}).value || '',
      unknown: ($('#cert-unknown') || {}).value || '',
      next: ($('#cert-next') || {}).value || ''
    };
  }

  function clearCertFields() {
    ['cert-fact', 'cert-interp', 'cert-unknown', 'cert-next'].forEach(function (id) {
      var el = $('#' + id);
      if (el) el.value = '';
    });
  }

  function saveCert() {
    var f = certFields();
    var any = [f.fact, f.interp, f.unknown, f.next].some(function (v) { return String(v).trim(); });
    if (!any) { showToast('至少写一格再存。'); return; }
    state.cert.unshift({ id: uid(), t: Date.now(), fact: f.fact.trim(), interp: f.interp.trim(), unknown: f.unknown.trim(), next: f.next.trim() });
    save();
    clearCertFields();
    renderAll();
    showToast('已存下。下次再想不通，翻出来看这张。');
  }

  function certSummaryHtml(c) {
    var rows = [
      ['1', '事实', c.fact],
      ['2', '解释', c.interp],
      ['3', '不可知', c.unknown],
      ['4', '下一步', c.next]
    ];
    var out = '';
    rows.forEach(function (r) {
      if (!r[2]) return;
      var txt = String(r[2]).replace(/\s+/g, ' ').slice(0, 90);
      if (String(r[2]).length > 90) txt += '…';
      out += '<p class="cert-line"><span class="cert-k">' + r[0] + '</span><span class="cert-v">' + esc(txt) + '</span></p>';
    });
    return out;
  }

  function certItemsHtml(limit) {
    var items = state.cert.slice(0, limit || 20);
    if (!items.length) return '<li class="empty">还没有存过整理。第一次写，能写两格就算完成。</li>';
    return items.map(function (c) {
      return '<li class="item"><div class="item__main">' +
        '<div class="item__meta">' + fmtDayTime(c.t) + '</div>' +
        '<div class="cert-lines">' + certSummaryHtml(c) + '</div>' +
        '</div>' + recordActsHtml('cert', c.id, '确定性') + '</li>';
    }).join('');
  }

  function renderCert() {
    var list = $('#cert-list');
    if (list) list.innerHTML = certItemsHtml(6);
    var count = $('#cert-count');
    if (count) count.textContent = state.cert.length + ' 份';
  }

  /* ---------------- 今日 ---------------- */

  var CHECKS = ['sleep', 'eat', 'move', 'connect', 'push'];

  var STEPS = {
    '身体': ['站起来，接一杯水，慢慢喝完。', '走到楼下，呼吸三次，再回来。', '做十个深蹲，或者伸一个懒腰。', '洗把脸，用凉一点的水。', '躺下，把腿抬高两分钟。'],
    '连接': ['给一个朋友发：在干嘛。', '和舍友说一句今天发生的事。', '给家里人发一条语音。', '问旁边的人一个具体的小问题。', '在常去的群里回一句。'],
    '推进': ['打开作业，只写开头三行。', '把要洗的衣服放进洗衣机。', '回掉一条拖着的消息。', '列出明天要做的三件事，只列。', '整理桌面的一个角。'],
    '离开屏幕': ['把手机放到另一个房间，待 5 分钟。', '关掉所有通知 10 分钟。', '出门走到楼下，不带耳机。', '看窗外 60 秒，只数车。', '把屏幕调成灰度，待一会儿。']
  };
  var stepCat = '身体';
  var stepIdx = 0;

  function todayData() {
    var k = dayKey();
    if (!state.daily[k] || typeof state.daily[k] !== 'object') state.daily[k] = { sleep: false, eat: false, move: false, connect: false, push: false };
    var d = state.daily[k];
    CHECKS.forEach(function (c) { if (typeof d[c] !== 'boolean') d[c] = false; });
    return d;
  }

  function renderToday() {
    var d = todayData();
    $$('#today-checks .check-row').forEach(function (row) {
      var on = !!d[row.getAttribute('data-check')];
      row.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var done = CHECKS.filter(function (c) { return d[c]; }).length;
    var p = $('#today-progress');
    if (p) p.textContent = done ? '已做到 ' + done + ' 件' : '还没开始';
    var week = $('#week');
    if (week) {
      var html = '';
      for (var i = 6; i >= 0; i--) {
        var dt = new Date(Date.now() - i * 86400000);
        var k = dayKey(dt);
        var dd = state.daily[k] || {};
        var n = CHECKS.filter(function (c) { return dd[c]; }).length;
        var cls = n >= 5 ? 'is-3' : n >= 3 ? 'is-2' : n >= 1 ? 'is-1' : '';
        html += '<div class="week__day' + (i === 0 ? ' is-today' : '') + '">' +
          '<div class="week__dot ' + cls + '" title="' + k + ' 做到 ' + n + ' 件">' + (n || '·') + '</div>' +
          '<span>' + WEEK[dt.getDay()] + '</span></div>';
      }
      week.innerHTML = html;
    }
    var st = $('#step-text');
    if (st) st.textContent = STEPS[stepCat][stepIdx];
  }

  function shuffleStep() {
    var arr = STEPS[stepCat];
    stepIdx = (stepIdx + 1 + Math.floor(Math.random() * (arr.length - 1))) % arr.length;
    var st = $('#step-text');
    if (st) st.textContent = arr[stepIdx];
  }

  /* ---------------- 5 分钟计时 ---------------- */

  var timer = { remain: 300, running: false, id: null, end: 0 };

  function renderTimer() {
    var t = $('#today-timer');
    if (t) t.textContent = pad(Math.floor(timer.remain / 60)) + ':' + pad(timer.remain % 60);
    var bar = $('#today-bar');
    if (bar) bar.style.width = Math.min(100, (1 - timer.remain / 300) * 100) + '%';
    var btn = $('[data-action="timer-start"]');
    if (btn) btn.textContent = timer.running ? '暂停' : '开始';
  }

  function stopTimer() {
    if (timer.id) { clearInterval(timer.id); timer.id = null; }
    timer.running = false;
  }

  function tickTimer() {
    var left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
    timer.remain = left;
    renderTimer();
    if (left <= 0) {
      stopTimer();
      showToast('5 分钟到了。可以停，也可以再来 5 分钟。');
    }
  }

  function toggleTimer() {
    if (timer.running) {
      stopTimer();
      renderTimer();
      return;
    }
    if (timer.remain <= 0) timer.remain = 300;
    timer.end = Date.now() + timer.remain * 1000;
    timer.running = true;
    timer.id = setInterval(tickTimer, 250);
    renderTimer();
  }

  function resetTimer() {
    stopTimer();
    timer.remain = 300;
    renderTimer();
  }

  /* ---------------- 睡前 3 行 ---------------- */

  function saveSleep() {
    var fact = ($('#sleep-fact') || {}).value || '';
    var did = ($('#sleep-did') || {}).value || '';
    var tomorrow = ($('#sleep-tomorrow') || {}).value || '';
    if (!fact.trim() && !did.trim() && !tomorrow.trim()) { showToast('写一行也算。'); return; }
    state.sleep.unshift({ id: uid(), t: Date.now(), fact: fact.trim(), did: did.trim(), tomorrow: tomorrow.trim() });
    save();
    ['sleep-fact', 'sleep-did', 'sleep-tomorrow'].forEach(function (id) { var el = $('#' + id); if (el) el.value = ''; });
    renderSleepLast();
    renderRecords();
    showToast('今天收工了。');
  }

  function renderSleepLast() {
    var el = $('#sleep-last');
    if (!el) return;
    if (!state.sleep.length) { el.textContent = ''; return; }
    el.textContent = '上次收工：' + fmtDayTime(state.sleep[0].t);
  }

  /* ---------------- 回顾 ---------------- */

  var reviewDays = 7;

  function reviewDayList(days) {
    var out = [];
    var base = startOfDay();
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(base - i * 86400000);
      out.push({ key: dayKey(d), d: d });
    }
    return out;
  }

  function buildReviewData(days) {
    var list = reviewDayList(days);
    var since = list[0].d.getTime();
    var byKey = {};
    list.forEach(function (item) {
      byKey[item.key] = { key: item.key, d: item.d, sosCount: 0, before: [], after: [], rum: 0, done: 0 };
    });
    state.sos.forEach(function (r) {
      if (!r || !r.t) return;
      var b = byKey[dayKey(new Date(r.t))];
      if (!b) return;
      b.sosCount++;
      if (typeof r.before === 'number') b.before.push(r.before);
      if (typeof r.after === 'number') b.after.push(r.after);
    });
    state.rum.forEach(function (r) {
      if (!r || !r.t) return;
      var b = byKey[dayKey(new Date(r.t))];
      if (b) b.rum++;
    });
    var checkDone = 0, checkTotal = 0, checkDays = 0, fullDays = 0;
    list.forEach(function (item) {
      var dd = state.daily[item.key];
      var b = byKey[item.key];
      var n = 0;
      if (dd && typeof dd === 'object') {
        CHECKS.forEach(function (c) { if (dd[c]) n++; });
      }
      b.done = n;
      checkDone += n;
      checkTotal += CHECKS.length;
      if (n > 0) checkDays++;
      if (n >= 3) fullDays++;
    });
    var sosCount = 0, beforeSum = 0, beforeN = 0, afterSum = 0, afterN = 0;
    var deltaSum = 0, deltaN = 0, activeSosDays = 0;
    var rumCount = 0, activeRumDays = 0;
    list.forEach(function (item) {
      var b = byKey[item.key];
      sosCount += b.sosCount;
      if (b.sosCount) activeSosDays++;
      b.before.forEach(function (v) { beforeSum += v; beforeN++; });
      b.after.forEach(function (v) { afterSum += v; afterN++; });
      if (b.before.length && b.after.length) {
        var n = Math.min(b.before.length, b.after.length);
        for (var i = 0; i < n; i++) { deltaSum += b.before[i] - b.after[i]; deltaN++; }
      }
      if (b.rum) { rumCount += b.rum; activeRumDays++; }
    });
    var prevSince = since - days * 86400000;
    var prevSos = state.sos.filter(function (r) { return r && r.t >= prevSince && r.t < since; }).length;
    var prevRum = state.rum.filter(function (r) { return r && r.t >= prevSince && r.t < since; }).length;
    return {
      days: days,
      list: list,
      byKey: byKey,
      sosCount: sosCount,
      beforeAvg: beforeN ? beforeSum / beforeN : 0,
      afterAvg: afterN ? afterSum / afterN : 0,
      deltaAvg: deltaN ? deltaSum / deltaN : null,
      activeSosDays: activeSosDays,
      rumCount: rumCount,
      activeRumDays: activeRumDays,
      checkDone: checkDone,
      checkTotal: checkTotal,
      checkDays: checkDays,
      fullDays: fullDays,
      prevSos: prevSos,
      prevRum: prevRum
    };
  }

  function reviewXLabels(data) {
    var labels = [];
    if (data.days <= 7) {
      data.list.forEach(function (item, i) {
        labels.push({ i: i, text: WEEK[item.d.getDay()] + ' ' + item.d.getDate() });
      });
    } else {
      data.list.forEach(function (item, i) {
        if (i === 0 || i === data.list.length - 1 || i % 5 === 0) {
          labels.push({ i: i, text: (item.d.getMonth() + 1) + '/' + item.d.getDate() });
        }
      });
    }
    return labels;
  }

  function svgLineChart(host, data) {
    var w = chartWidth(host);
    var h = 170;
    var padL = 26, padR = 10, padT = 14, padB = 26;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var days = data.days;
    function x(i) { return padL + (days <= 1 ? plotW / 2 : (i / (days - 1)) * plotW); }
    function y(v) { return padT + (1 - v / 10) * plotH; }

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="presentation" focusable="false">';
    [0, 5, 10].forEach(function (v) {
      svg += '<line class="chart__grid" x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y(v).toFixed(1) + '"></line>';
      svg += '<text class="chart__axis" x="' + (padL - 7) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    });
    reviewXLabels(data).forEach(function (lb) {
      svg += '<text class="chart__axis" x="' + x(lb.i).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle">' + lb.text + '</text>';
    });

    function drawSeries(values, cls, dotCls) {
      var segs = [], cur = [];
      values.forEach(function (v, i) {
        if (v == null) { if (cur.length) { segs.push(cur); cur = []; } return; }
        cur.push([i, v]);
      });
      if (cur.length) segs.push(cur);
      var out = '';
      segs.forEach(function (seg) {
        if (seg.length > 1) {
          out += '<polyline class="chart__line ' + cls + '" points="' + seg.map(function (pt) {
            return x(pt[0]).toFixed(1) + ',' + y(pt[1]).toFixed(1);
          }).join(' ') + '"></polyline>';
        }
        seg.forEach(function (pt) {
          var d = data.list[pt[0]].d;
          out += '<circle class="chart__dot ' + dotCls + '" cx="' + x(pt[0]).toFixed(1) + '" cy="' + y(pt[1]).toFixed(1) +
            '" r="' + (days <= 7 ? 2.8 : 2) + '"><title>' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + pt[1] + '</title></circle>';
        });
      });
      return out;
    }

    var beforeVals = data.list.map(function (item) {
      var b = data.byKey[item.key];
      return b.before.length ? avg(b.before) : null;
    });
    var afterVals = data.list.map(function (item) {
      var b = data.byKey[item.key];
      return b.after.length ? avg(b.after) : null;
    });
    svg += drawSeries(beforeVals, 'chart__line--before', 'chart__dot--before');
    svg += drawSeries(afterVals, 'chart__line--after', 'chart__dot--after');
    svg += '</svg>';
    host.innerHTML = svg;
  }

  function svgBarChart(host, data, valueOf, maxY) {
    var w = chartWidth(host);
    var h = 148;
    var padL = 26, padR = 10, padT = 12, padB = 24;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var bars = data.list.map(function (item) {
      return { i: data.list.indexOf(item), v: valueOf(data.byKey[item.key], data) };
    });
    var maxV = 0;
    bars.forEach(function (b) { if (b.v > maxV) maxV = b.v; });
    var top = maxY || Math.max(3, maxV);
    var slot = plotW / data.days;
    var barW = Math.min(data.days <= 7 ? 26 : 10, slot * 0.56);
    function xc(i) { return padL + (i + 0.5) * slot; }
    function y(v) { return padT + (1 - v / top) * plotH; }
    var base = y(0);

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="presentation" focusable="false">';
    var ticks = top <= 5 ? [0, top] : [0, Math.round(top / 2), top];
    ticks.forEach(function (v) {
      svg += '<line class="chart__grid" x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y(v).toFixed(1) + '"></line>';
      svg += '<text class="chart__axis" x="' + (padL - 7) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    });
    reviewXLabels(data).forEach(function (lb) {
      svg += '<text class="chart__axis" x="' + xc(lb.i).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle">' + lb.text + '</text>';
    });
    svg += '<line class="chart__grid" x1="' + padL + '" y1="' + base.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + base.toFixed(1) + '"></line>';
    bars.forEach(function (b) {
      var cx = xc(b.i);
      var d = data.list[b.i].d;
      var title = '<title>' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + b.v + '</title>';
      if (b.v <= 0) {
        svg += '<rect class="chart__bar is-zero" x="' + (cx - barW / 2).toFixed(1) + '" y="' + (base - 2).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="2" rx="1">' + title + '</rect>';
      } else {
        var yv = y(b.v);
        var full = maxY ? b.v >= maxY : b.v >= maxV;
        svg += '<rect class="chart__bar' + (full ? ' is-full' : '') + '" x="' + (cx - barW / 2).toFixed(1) + '" y="' + yv.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(2, base - yv).toFixed(1) + '" rx="3">' + title + '</rect>';
      }
    });
    var todayIdx = data.list.length - 1;
    svg += '<line class="chart__today" x1="' + (xc(todayIdx) + slot / 2 - 1).toFixed(1) + '" y1="' + padT + '" x2="' + (xc(todayIdx) + slot / 2 - 1).toFixed(1) + '" y2="' + base.toFixed(1) + '"></line>';
    svg += '</svg>';
    host.innerHTML = svg;
  }

  function chartWidth(host) {
    var w = host ? Math.round(host.getBoundingClientRect().width) : 0;
    return w && w > 200 ? w : 600;
  }

  function renderReviewSummary(data) {
    var host = $('#review-summary');
    if (!host) return;
    var rate = data.checkTotal ? Math.round(data.checkDone / data.checkTotal * 100) : 0;
    var drop = data.deltaAvg;
    function stat(v, label, empty) {
      return '<div class="review-stat' + (empty ? ' is-empty' : '') + '"><b>' + v + '</b><span>' + label + '</span></div>';
    }
    host.innerHTML =
      stat(data.sosCount || '—', '次着陆', !data.sosCount) +
      stat(drop == null ? '—' : (drop >= 0 ? drop.toFixed(1) : '升 ' + Math.abs(drop).toFixed(1)), '平均降幅（分）', drop == null) +
      stat(data.rumCount || '—', '次反刍', !data.rumCount) +
      stat(data.checkDone ? rate + '%' : '—', '打卡完成率', !data.checkDone);
  }

  function reviewNotes(data) {
    var days = data.days;
    var notes = [];
    if (data.sosCount) {
      notes.push('这 ' + days + ' 天着陆 <b>' + data.sosCount + '</b> 次，着陆前平均 <b>' + data.beforeAvg.toFixed(1) + '</b>，着陆后平均 <b>' + data.afterAvg.toFixed(1) + '</b>' +
        (data.deltaAvg != null ? '，平均降 <b>' + data.deltaAvg.toFixed(1) + '</b> 分。' : '。'));
      var diff = data.sosCount - data.prevSos;
      if (Math.abs(diff) >= 2) {
        notes.push('和上一个 ' + days + ' 天相比，着陆次数' + (diff < 0 ? '少了 <b>' + Math.abs(diff) + '</b> 次' : '多了 <b>' + diff + '</b> 次') + '。次数少不等于更好，只作一个参照。');
      }
    } else {
      notes.push('这 ' + days + ' 天没有着陆记录。难受的时候，按「我现在很难受」就行。');
    }
    if (data.rumCount) notes.push('反刍登记 <b>' + data.rumCount + '</b> 次，分布在 <b>' + data.activeRumDays + '</b> 天。');
    if (data.checkDone) notes.push('打卡完成率 <b>' + Math.round(data.checkDone / data.checkTotal * 100) + '%</b>，有 <b>' + data.fullDays + '</b> 天做到 3 件以上。');
    if (!data.sosCount && !data.rumCount && !data.checkDone) {
      notes = ['这段时间还没有记录。做一次着陆、一次打卡，这里就会开始有东西可看。'];
    }
    return notes;
  }

  /* ---------------- 周期对比 ---------------- */

  function windowStats(days, offset) {
    var end = startOfDay() - offset * 86400000;
    var start = end - (days - 1) * 86400000;
    var stop = end + 86400000;
    var s = { sos: 0, beforeSum: 0, beforeN: 0, afterSum: 0, afterN: 0, rum: 0, checkDone: 0 };
    (state.sos || []).forEach(function (r) {
      if (!r || !r.t || r.t < start || r.t >= stop) return;
      s.sos++;
      if (typeof r.before === 'number') { s.beforeSum += r.before; s.beforeN++; }
      if (typeof r.after === 'number') { s.afterSum += r.after; s.afterN++; }
    });
    (state.rum || []).forEach(function (r) {
      if (r && r.t && r.t >= start && r.t < stop) s.rum++;
    });
    for (var i = 0; i < days; i++) {
      var dd = state.daily[dayKey(new Date(start + i * 86400000))];
      if (dd && typeof dd === 'object') {
        CHECKS.forEach(function (c) { if (dd[c]) s.checkDone++; });
      }
    }
    s.drop = (s.beforeN && s.afterN) ? (s.beforeSum / s.beforeN) - (s.afterSum / s.afterN) : null;
    return s;
  }

  function deltaText(a, b, digits) {
    if (a == null || b == null) return '—';
    var d = b - a;
    if (Math.abs(d) < (digits ? 0.05 : 0.5)) return '持平';
    return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(digits ? 1 : 0);
  }

  function numText(v, digits) {
    if (v == null) return '—';
    if (digits) return v.toFixed(digits);
    return v === Math.round(v) ? String(v) : v.toFixed(1);
  }

  function renderPeriod() {
    var host = $('#period-compare');
    if (!host || !state) return;
    var days = reviewDays;
    var cur = windowStats(days, 0);
    var prev = windowStats(days, days);
    var badge = $('#period-badge');
    if (badge) badge.textContent = days + ' 天 / ' + days + ' 天';
    var rows = [
      { label: '着陆次数', a: prev.sos, b: cur.sos, d: deltaText(prev.sos, cur.sos) },
      { label: '平均降幅', a: prev.drop, b: cur.drop, d: deltaText(prev.drop, cur.drop, 1), digits: 1 },
      { label: '反刍登记', a: prev.rum, b: cur.rum, d: deltaText(prev.rum, cur.rum) },
      { label: '打卡完成', a: prev.checkDone, b: cur.checkDone, d: deltaText(prev.checkDone, cur.checkDone) }
    ];
    host.innerHTML =
      '<div class="period-row period-row--head"><span>指标</span><span>上一段</span><span>这一段</span><span>变化</span></div>' +
      rows.map(function (r) {
        return '<div class="period-row"><span>' + r.label + '</span><span>' + numText(r.a, r.digits) +
          '</span><span>' + numText(r.b, r.digits) + '</span><span class="period-delta">' + r.d + '</span></div>';
      }).join('');
    var note = $('#period-note');
    if (note) {
      note.textContent = (prev.sos + cur.sos === 0)
        ? '两段都还没有着陆记录。等有记录了再来看方向。'
        : '上一段 ' + fmtShortDate(startOfDay() - (days * 2 - 1) * 86400000) + ' – ' +
          fmtShortDate(startOfDay() - days * 86400000) + '，这一段 ' +
          fmtShortDate(startOfDay() - (days - 1) * 86400000) + ' – 今天。只看方向，不评好坏。';
    }
  }

  function renderRumMerge() {
    var host = $('#rum-merge');
    if (!host || !state) return;
    var days = reviewDays;
    var since = startOfDay() - (days - 1) * 86400000;
    var ORDER = ['why', 'if', 'self', 'others', 'other'];
    var by = {}, last = {};
    (state.rum || []).forEach(function (r) {
      if (!r || !r.t || r.t < since) return;
      var k = KIND_LABEL[r.kind] ? r.kind : 'other';
      by[k] = (by[k] || 0) + 1;
      if (!last[k] || r.t > last[k].t) last[k] = r;
    });
    var keys = Object.keys(by).sort(function (a, b) {
      if (by[b] !== by[a]) return by[b] - by[a];
      return ORDER.indexOf(a) - ORDER.indexOf(b);
    });
    var total = 0;
    keys.forEach(function (k) { total += by[k]; });
    var badge = $('#rum-merge-badge');
    if (badge) badge.textContent = keys.length ? '近 ' + days + ' 天 · ' + total + ' 次' : '—';
    if (!keys.length) {
      host.innerHTML = '<li class="empty">这 ' + days + ' 天没有反刍登记。有登记时，这里会按类型归并，能看出反复绕的是哪一类。</li>';
      return;
    }
    host.innerHTML = keys.map(function (k) {
      var r = last[k];
      var text = [r.thought, r.action].filter(function (x) { return x; }).join(' · ');
      return '<li class="item"><div class="item__main">' +
        '<div class="item__text">' + esc(snippetOf(text, '', 60)) + '</div>' +
        '<div class="item__meta">' + KIND_LABEL[k] + ' · ' + by[k] + ' 次 · 最近 ' + fmtDayTime(r.t) + '</div>' +
        '</div></li>';
    }).join('');
  }

  function renderReview() {
    var data = buildReviewData(reviewDays);
    renderReviewSummary(data);

    var legend = $('#legend-sos');
    if (legend) legend.hidden = !data.sosCount;

    var sosHost = $('#chart-sos');
    if (sosHost) {
      if (!data.sosCount) {
        sosHost.innerHTML = '<p class="chart-empty">这 ' + data.days + ' 天还没有着陆记录。</p>';
        sosHost.removeAttribute('role');
        sosHost.removeAttribute('aria-label');
      } else {
        svgLineChart(sosHost, data);
        sosHost.setAttribute('role', 'img');
        sosHost.setAttribute('aria-label', '着陆强度折线图：近 ' + data.days + ' 天共 ' + data.sosCount + ' 次，着陆前平均 ' + data.beforeAvg.toFixed(1) + '，着陆后平均 ' + data.afterAvg.toFixed(1) + '。');
      }
    }

    var checkHost = $('#chart-check');
    if (checkHost) {
      if (!data.checkDone) {
        checkHost.innerHTML = '<p class="chart-empty">这 ' + data.days + ' 天还没有打卡记录。</p>';
        checkHost.removeAttribute('role');
        checkHost.removeAttribute('aria-label');
      } else {
        svgBarChart(checkHost, data, function (b) { return b.done; }, 5);
        checkHost.setAttribute('role', 'img');
        checkHost.setAttribute('aria-label', '每天做到几件的柱状图：近 ' + data.days + ' 天共完成 ' + data.checkDone + ' 件，有 ' + data.checkDays + ' 天有打卡。');
      }
    }

    var rumHost = $('#chart-rum');
    if (rumHost) {
      if (!data.rumCount) {
        rumHost.innerHTML = '<p class="chart-empty">这 ' + data.days + ' 天没有反刍登记。</p>';
        rumHost.removeAttribute('role');
        rumHost.removeAttribute('aria-label');
      } else {
        svgBarChart(rumHost, data, function (b) { return b.rum; }, null);
        rumHost.setAttribute('role', 'img');
        rumHost.setAttribute('aria-label', '反刍登记柱状图：近 ' + data.days + ' 天共 ' + data.rumCount + ' 次，分布在 ' + data.activeRumDays + ' 天。');
      }
    }

    var notesHost = $('#review-notes');
    if (notesHost) {
      notesHost.innerHTML = reviewNotes(data).map(function (n) { return '<li>' + n + '</li>'; }).join('');
    }

    var homeLink = $('#home-review-link');
    if (homeLink) homeLink.hidden = recordCount() === 0;

    renderPeriod();
    renderRumMerge();
    renderFilter();
  }

  function exportReview() {
    var data = buildReviewData(reviewDays);
    var lines = ['# 着陆台 · ' + reviewDays + ' 天回顾', '', '导出时间：' + fmtDateFull(new Date()) + ' ' + fmtClock(Date.now()), ''];
    lines.push('- 着陆：' + data.sosCount + ' 次' + (data.sosCount ? '，平均 ' + data.beforeAvg.toFixed(1) + ' → ' + data.afterAvg.toFixed(1) : ''));
    lines.push('- 反刍登记：' + data.rumCount + ' 次');
    lines.push('- 打卡完成率：' + (data.checkTotal ? Math.round(data.checkDone / data.checkTotal * 100) : 0) + '%（' + data.checkDone + ' / ' + data.checkTotal + '）');
    lines.push('');
    lines.push('| 日期 | 着陆 | 着陆前 | 着陆后 | 做到几件 | 反刍 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    data.list.forEach(function (item) {
      var b = data.byKey[item.key];
      lines.push('| ' + (item.d.getMonth() + 1) + '/' + item.d.getDate() + ' | ' + b.sosCount + ' | ' +
        (b.before.length ? avg(b.before).toFixed(1) : '—') + ' | ' +
        (b.after.length ? avg(b.after).toFixed(1) : '—') + ' | ' + b.done + ' | ' + b.rum + ' |');
    });
    lines.push('');
    lines.push('回顾不是评分；空白的日子也算数。');
    saveFile('zhuolu-review-' + dayKey() + '.md', lines.join('\n'), 'text/markdown;charset=utf-8', '已导出这段回顾。');
  }

  /* ---------------- 按主题找记录 ---------------- */

  var HIT_META = {
    rum: { label: '反刍', fields: ['thought', 'action'] },
    tr: { label: '思维记录', fields: ['situation', 'thought', 'emotion', 'for', 'against', 'balanced'] },
    cert: { label: '确定性', fields: ['fact', 'interp', 'unknown', 'next'] },
    sleep: { label: '睡前', fields: ['fact', 'did', 'tomorrow'] },
    sos: { label: '着陆', fields: ['before', 'after', 'need'] }
  };
  var HIT_ORDER = ['rum', 'tr', 'cert', 'sleep', 'sos'];

  var rvFilter = { q: '', kind: 'all', range: 'all' };
  var rvTimer = null;
  var RV_RANGE = { all: 0, '30': 30, '7': 7 };

  function rvRangeDays() { return RV_RANGE[rvFilter.range] || 0; }

  function rvSince() {
    var d = rvRangeDays();
    return d ? startOfDay() - (d - 1) * 86400000 : 0;
  }

  function rvWhere() { return rvRangeDays() ? '近 ' + rvRangeDays() + ' 天里' : '全部记录里'; }

  function allSpanDays() {
    if (!state) return 1;
    var first = 0;
    HIT_ORDER.forEach(function (k) {
      (state[k] || []).forEach(function (r) {
        if (r && r.t && (!first || r.t < first)) first = r.t;
      });
    });
    if (!first) return 1;
    return Math.min(3650, Math.max(1, Math.floor((startOfDay() - startOfDay(new Date(first))) / 86400000) + 1));
  }

  function recordText(r, fields) {
    return fields.map(function (f) {
      var v = r[f];
      if (Array.isArray(v)) return v.join('、');
      return v == null ? '' : String(v);
    }).filter(function (s) { return s !== ''; }).join(' · ');
  }

  function collectHits() {
    if (!state) return [];
    var since = rvSince();
    var q = rvFilter.q.trim().toLowerCase();
    var kinds = rvFilter.kind === 'all' ? HIT_ORDER : [rvFilter.kind];
    var out = [];
    kinds.forEach(function (k) {
      if (!HIT_META[k]) return;
      (state[k] || []).forEach(function (r) {
        if (!r || !r.t || r.t < since) return;
        var text = recordText(r, HIT_META[k].fields);
        if (q && text.toLowerCase().indexOf(q) < 0) return;
        out.push({ kind: k, t: r.t, text: text });
      });
    });
    out.sort(function (a, b) { return b.t - a.t; });
    return out;
  }

  function hitCountText(hits) {
    var by = {};
    hits.forEach(function (h) { by[h.kind] = (by[h.kind] || 0) + 1; });
    return HIT_ORDER.filter(function (k) { return by[k]; }).map(function (k) {
      return HIT_META[k].label + ' ' + by[k];
    }).join(' · ');
  }

  function snippetOf(text, q, width) {
    width = width || 70;
    var s = String(text).replace(/\s+/g, ' ');
    if (!q) return s.length > width ? s.slice(0, width) + '…' : s;
    var at = s.toLowerCase().indexOf(q.toLowerCase());
    if (at < 0) return s.length > width ? s.slice(0, width) + '…' : s;
    var start = Math.max(0, at - 26);
    var end = Math.min(s.length, start + width);
    return (start > 0 ? '…' : '') + s.slice(start, end) + (end < s.length ? '…' : '');
  }

  function hlText(text, q) {
    var s = String(text);
    if (!q) return esc(s);
    var low = s.toLowerCase();
    var needle = q.toLowerCase();
    var out = '', i = 0, at;
    while ((at = low.indexOf(needle, i)) >= 0) {
      out += esc(s.slice(i, at)) + '<mark>' + esc(s.slice(at, at + needle.length)) + '</mark>';
      i = at + needle.length;
    }
    return out + esc(s.slice(i));
  }

  function renderFilter() {
    if (!state) return;
    var input = $('#review-q');
    if (input && document.activeElement !== input && input.value !== rvFilter.q) input.value = rvFilter.q;
    $$('[data-rv-kind]').forEach(function (b) {
      var on = b.getAttribute('data-rv-kind') === rvFilter.kind;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('[data-rv-range]').forEach(function (b) {
      var onR = b.getAttribute('data-rv-range') === rvFilter.range;
      b.classList.toggle('is-on', onR);
      b.setAttribute('aria-pressed', onR ? 'true' : 'false');
    });
    var q = rvFilter.q.trim();
    var count = $('#filter-count');
    var note = $('#filter-note');
    var host = $('#filter-hits');
    if (!q && rvFilter.kind === 'all') {
      if (count) count.textContent = '—';
      if (note) note.textContent = '还没有输入关键词。写一个最近反复出现的词就行：那个人、那件事、那句总在的话。';
      if (host) host.innerHTML = '';
      return;
    }
    var hits = collectHits();
    if (count) count.textContent = hits.length + ' 条';
    var cond = (q ? '含「' + q + '」的' : '') + (rvFilter.kind === 'all' ? '记录' : HIT_META[rvFilter.kind].label + '记录');
    if (note) {
      note.textContent = hits.length
        ? rvWhere() + cond + '有 ' + hits.length + ' 条' + (hitCountText(hits) ? '：' + hitCountText(hits) + '。' : '。')
        : rvWhere() + '没有' + cond + '。' + (rvRangeDays() ? '换个词，或者把范围切到全部时间。' : '换个词试试。');
    }
    if (!host) return;
    if (!hits.length) { host.innerHTML = ''; return; }
    var shown = hits.slice(0, 20);
    host.innerHTML = shown.map(function (h) {
      return '<li class="item"><div class="item__main">' +
        '<div class="item__text">' + hlText(snippetOf(h.text, q), q) + '</div>' +
        '<div class="item__meta">' + HIT_META[h.kind].label + ' · ' + fmtDayTime(h.t) + '</div>' +
        '</div></li>';
    }).join('') + (hits.length > shown.length
      ? '<li class="empty">只显示最近 20 条；导出的那份是全的。</li>' : '');
  }

  function exportSummary() {
    if (!state) return;
    var q = rvFilter.q.trim();
    if (!q && rvFilter.kind === 'all') {
      showToast('先写一个关键词，再导出。');
      var i = $('#review-q');
      if (i) { try { i.focus(); } catch (e) { /* ignore */ } }
      return;
    }
    var hits = collectHits();
    if (!hits.length) { showToast('这个范围里没有符合条件的记录。'); return; }
    var data = buildReviewData(rvRangeDays() || allSpanDays());
    var first = data.list[0].d, last = data.list[data.list.length - 1].d;
    var lines = [];
    lines.push('# 着陆台 · 阶段性小结');
    lines.push('');
    lines.push('- 时间范围：' + (rvRangeDays() ? '近 ' + rvRangeDays() + ' 天' : '全部记录') + '（' + fmtShortDate(first.getTime()) + ' – ' + fmtShortDate(last.getTime()) + '）');
    lines.push('- 导出时间：' + fmtDateFull(new Date()) + ' ' + fmtClock(Date.now()));
    lines.push('- 筛选：' + (q ? '关键词「' + q + '」' : '没有关键词') + ' · ' + (rvFilter.kind === 'all' ? '全部类型' : HIT_META[rvFilter.kind].label));
    lines.push('- 符合的记录：' + hits.length + ' 条' + (hitCountText(hits) ? '（' + hitCountText(hits) + '）' : ''));
    lines.push('');
    lines.push('## 这段时间的数字');
    lines.push('');
    lines.push('- 着陆 ' + data.sosCount + ' 次' + (data.sosCount ? '，平均 ' + data.beforeAvg.toFixed(1) + ' → ' + data.afterAvg.toFixed(1) : ''));
    lines.push('- 反刍登记 ' + data.rumCount + ' 次');
    lines.push('- 打卡完成率 ' + (data.checkTotal ? Math.round(data.checkDone / data.checkTotal * 100) : 0) + '%（' + data.checkDone + ' / ' + data.checkTotal + '）');
    lines.push('');
    lines.push('## 摘录（按时间倒序）');
    lines.push('');
    hits.forEach(function (h) {
      var d = new Date(h.t);
      lines.push('- **' + HIT_META[h.kind].label + '** ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtClock(h.t) +
        ' — ' + h.text.replace(/\s+/g, ' '));
    });
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('这份小结在浏览器里生成，没有上传任何数据。');
    lines.push('记录是自助练习的副产品，不是诊断材料；判断交给专业人士。');
    saveFile('zhuolu-summary-' + dayKey() + '.md', lines.join('\n'), 'text/markdown;charset=utf-8', '已导出这份小结。');
  }

  function setFilterKind(kind) {
    rvFilter.kind = HIT_META[kind] ? kind : 'all';
    renderFilter();
  }

  function setFilterRange(range) {
    rvFilter.range = RV_RANGE.hasOwnProperty(range) ? range : 'all';
    renderFilter();
  }

  /* ---------------- 记录 ---------------- */

  function emptyItem(text) { return '<li class="empty">' + text + '</li>'; }

  function recordActsHtml(kind, id, label) {
    var canEdit = !!EDIT_SPEC[kind];
    return '<div class="item__acts">' +
      (canEdit
        ? '<button class="icon-btn icon-btn--edit" data-action="edit-record" data-kind="' + kind +
          '" data-id="' + esc(id) + '" aria-label="编辑这条' + label + '记录">改</button>'
        : '') +
      '<button class="icon-btn" data-action="del-record" data-kind="' + kind + '" data-id="' + esc(id) +
        '" aria-label="删除这条' + label + '记录">×</button></div>';
  }

  var undoDelete = null;

  function removeRecord(kind, id) {
    var arr = state[kind];
    if (!arr) return;
    var idx = -1;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    var item = arr[idx];
    arr.splice(idx, 1);
    save();
    renderAll();
    var label = REC_LABEL[kind] || '这条';
    undoDelete = { kind: kind, index: idx, item: item };
    showToast('已删除一条' + label + '记录', '撤销', function () {
      if (!undoDelete) return;
      var u = undoDelete;
      undoDelete = null;
      if (!state[u.kind]) return;
      state[u.kind].splice(Math.min(u.index, state[u.kind].length), 0, u.item);
      save();
      renderAll();
      showToast('已恢复。');
    }, 6000);
  }

  function recordsHtml() {
    var rum = state.rum.slice(0, 40);
    var cert = state.cert.slice(0, 20);
    var tr = state.tr.slice(0, 20);
    var sleep = state.sleep.slice(0, 20);
    var sosList = state.sos.slice(0, 40);

    var rumEl = $('#rec-rum');
    if (rumEl) {
      rumEl.innerHTML = rum.length ? rum.map(function (r) {
        return '<li class="item"><div class="item__main"><div class="item__text">' + esc(r.thought || '（没写内容）') + '</div>' +
          (r.action ? '<div class="small muted">下一步：' + esc(r.action) + '</div>' : '') +
          '<div class="item__meta">' + KIND_LABEL[r.kind] + ' · ' + fmtDayTime(r.t) + '</div></div>' +
          recordActsHtml('rum', r.id, '反刍') + '</li>';
      }).join('') : emptyItem('还没有反刍记录。');
    }

    var certEl = $('#rec-cert');
    if (certEl) certEl.innerHTML = cert.length ? cert.map(function (c) {
      return '<li class="item"><div class="item__main"><div class="item__meta">' + fmtDayTime(c.t) + '</div>' +
        '<div class="cert-lines">' + certSummaryHtml(c) + '</div></div>' +
        recordActsHtml('cert', c.id, '确定性') + '</li>';
    }).join('') : emptyItem('还没有确定性整理。');

    var trEl = $('#rec-tr');
    if (trEl) {
      trEl.innerHTML = tr.length ? tr.map(function (r) {
        return '<li class="item"><div class="item__main"><div class="item__text">' + esc(r.thought || '（没写自动思维）') + '</div>' +
          '<div class="small muted">情境：' + esc((r.situation || '').slice(0, 60)) + '</div>' +
          '<div class="item__meta">' + (r.intensity != null ? r.intensity : '?') + ' → ' + (r.after != null ? r.after : '?') + ' · ' + fmtDayTime(r.t) + '</div></div>' +
          recordActsHtml('tr', r.id, '思维') + '</li>';
      }).join('') : emptyItem('还没有思维记录。');
    }

    var sleepEl = $('#rec-sleep');
    if (sleepEl) {
      sleepEl.innerHTML = sleep.length ? sleep.map(function (r) {
        return '<li class="item"><div class="item__main"><div class="item__text">' + esc(r.did || r.fact || '（没写内容）') + '</div>' +
          '<div class="small muted">' + esc(r.tomorrow ? '明天：' + r.tomorrow : '') + '</div>' +
          '<div class="item__meta">' + fmtDayTime(r.t) + '</div></div>' +
          recordActsHtml('sleep', r.id, '睡前') + '</li>';
      }).join('') : emptyItem('还没有睡前记录。');
    }

    var sosEl = $('#rec-sos');
    if (sosEl) {
      sosEl.innerHTML = sosList.length ? sosList.map(function (r) {
        var d = (r.before != null && r.after != null) ? (r.before - r.after) : 0;
        return '<li class="item"><div class="item__main"><div class="item__text">强度 ' + r.before + ' → ' + r.after + (d > 0 ? '（降 ' + d + '）' : '') + '</div>' +
          '<div class="item__meta">' + (r.need && r.need.length ? esc(r.need.join('、')) + ' · ' : '') + fmtDayTime(r.t) + '</div></div>' +
          recordActsHtml('sos', r.id, '着陆') + '</li>';
      }).join('') : emptyItem('还没有着陆记录。');
    }
  }

  /* ---------------- 记录编辑 ---------------- */

  var KIND_ORDER = ['why', 'if', 'self', 'others', 'other'];

  var EDIT_SPEC = {
    rum: {
      kicker: '反刍日志',
      title: '改这条反刍记录',
      required: ['thought'],
      requiredMsg: '当时脑子里的话不能空着。',
      fields: [
        { k: 'thought', label: '当时脑子里的话', type: 'textarea', rows: 3, max: 2000 },
        { k: 'kind', label: '属于哪一类', type: 'select', options: KIND_ORDER.map(function (k) { return [k, KIND_LABEL[k]]; }) },
        { k: 'action', label: '下次我会…', type: 'textarea', rows: 2, max: 1000, hint: '可以留空。' }
      ]
    },
    tr: {
      kicker: '思维记录',
      title: '改这条思维记录',
      required: ['thought'],
      requiredMsg: '自动思维不能空着。',
      fields: [
        { k: 'situation', label: '1 · 情境', type: 'textarea', rows: 2 },
        { k: 'thought', label: '2 · 自动思维', type: 'textarea', rows: 2 },
        { k: 'belief', label: '3 · 当时有多相信它（0–100）', type: 'number', min: 0, max: 100, step: 5 },
        { k: 'emotion', label: '4 · 情绪', type: 'text' },
        { k: 'intensity', label: '情绪强度（0–100）', type: 'number', min: 0, max: 100, step: 5 },
        { k: 'for', label: '5 · 支持它的证据', type: 'textarea', rows: 2 },
        { k: 'against', label: '6 · 反对它的证据', type: 'textarea', rows: 2 },
        { k: 'balanced', label: '7 · 更平衡的一句话', type: 'textarea', rows: 2 },
        { k: 'after', label: '8 · 现在强度（0–100）', type: 'number', min: 0, max: 100, step: 5 }
      ]
    },
    cert: {
      kicker: '确定性整理',
      title: '改这份四格整理',
      required: [],
      fields: [
        { k: 'fact', label: '1 · 事实', type: 'textarea', rows: 2 },
        { k: 'interp', label: '2 · 解释', type: 'textarea', rows: 2 },
        { k: 'unknown', label: '3 · 不可知', type: 'textarea', rows: 2 },
        { k: 'next', label: '4 · 下一步', type: 'textarea', rows: 2 }
      ]
    },
    sleep: {
      kicker: '睡前 3 行',
      title: '改这条睡前记录',
      required: [],
      fields: [
        { k: 'fact', label: '今天发生了什么（事实）', type: 'textarea', rows: 2 },
        { k: 'did', label: '我今天做到了什么', type: 'textarea', rows: 2 },
        { k: 'tomorrow', label: '明天最小的一件', type: 'textarea', rows: 2 }
      ]
    },
    sos: {
      kicker: '着陆记录',
      title: '改这次着陆的分数',
      required: [],
      fields: [
        { k: 'before', label: '开始前强度（0–10）', type: 'number', min: 0, max: 10 },
        { k: 'after', label: '之后强度（0–10）', type: 'number', min: 0, max: 10 }
      ]
    }
  };

  var editState = null;

  function editFieldHtml(f, val) {
    var id = 'ef-' + f.k;
    var label = '<label for="' + id + '">' + esc(f.label) + '</label>';
    var hint = f.hint ? '<p class="hint">' + esc(f.hint) + '</p>' : '';
    var input;
    if (f.type === 'select') {
      input = '<select id="' + id + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if (f.type === 'number') {
      input = '<input type="number" id="' + id + '" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) +
        '" value="' + esc(val === '' || val == null ? '' : val) + '" inputmode="numeric">';
    } else if (f.type === 'text') {
      input = '<input type="text" id="' + id + '" maxlength="' + (f.max || 200) + '" value="' + esc(val || '') + '">';
    } else {
      input = '<textarea id="' + id + '" rows="' + (f.rows || 3) + '" maxlength="' + (f.max || 2000) + '">' + esc(val || '') + '</textarea>';
    }
    return '<div class="field">' + label + input + hint + '</div>';
  }

  function findRecord(kind, id) {
    var arr = (state && state[kind]) || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) return arr[i];
    }
    return null;
  }

  function editError(msg) {
    var el = $('#edit-err');
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
  }

  function editRecord(kind, id) {
    var spec = EDIT_SPEC[kind];
    if (!spec || !state) return;
    var item = findRecord(kind, id);
    if (!item) return;
    editState = { kind: kind, id: id };
    var k = $('#edit-kicker');
    if (k) k.textContent = spec.kicker + ' · ' + fmtDayTime(item.t);
    var t = $('#edit-title');
    if (t) t.textContent = spec.title;
    var host = $('#edit-fields');
    if (host) {
      host.innerHTML = spec.fields.map(function (f) {
        return editFieldHtml(f, item[f.k] == null ? '' : item[f.k]);
      }).join('');
    }
    var err = $('#edit-err');
    if (err) { err.hidden = true; err.textContent = ''; }
    openOverlay('#edit-overlay', '#ef-' + spec.fields[0].k);
  }

  function closeEdit() {
    editState = null;
    closeOverlay('#edit-overlay');
  }

  function saveEdit() {
    if (!editState || !state) return;
    var spec = EDIT_SPEC[editState.kind];
    if (!spec) { closeEdit(); return; }
    var item = findRecord(editState.kind, editState.id);
    if (!item) { closeEdit(); showToast('这条已经不在了。'); return; }
    var next = {};
    spec.fields.forEach(function (f) {
      var el = $('#ef-' + f.k);
      var raw = el ? String(el.value || '') : '';
      if (f.type === 'number') {
        var n = Number(raw);
        next[f.k] = raw === '' || isNaN(n) ? item[f.k] : clamp(Math.round(n), f.min, f.max);
      } else {
        next[f.k] = raw.trim().slice(0, f.max || 2000);
      }
    });
    var required = spec.required || [];
    for (var i = 0; i < required.length; i++) {
      if (!next[required[i]]) {
        editError(spec.requiredMsg || '有一格不能空着。');
        var first = $('#ef-' + required[i]);
        if (first) { try { first.focus(); } catch (e) { /* ignore */ } }
        return;
      }
    }
    Object.keys(next).forEach(function (key) { item[key] = next[key]; });
    item.editedAt = Date.now();
    markRec(editState.kind, editState.id);   // 原地改的记录，分条存储要单独标出来
    save();
    closeEdit();
    renderAll();
    showToast('改好了。');
  }

  /* ---------------- 思维记录 ---------------- */

  function saveTR() {
    function v(id) { var el = $('#' + id); return el ? el.value : ''; }
    var thought = v('tr-thought').trim();
    if (!thought) { showToast('至少写一句自动思维。'); var t = $('#tr-thought'); if (t) t.focus(); return; }
    state.tr.unshift({
      id: uid(), t: Date.now(),
      situation: v('tr-situation').trim(),
      thought: thought,
      belief: Number(v('tr-belief')) || 0,
      emotion: v('tr-emotion').trim(),
      intensity: Number(v('tr-intensity')) || 0,
      for: v('tr-for').trim(),
      against: v('tr-against').trim(),
      balanced: v('tr-balanced').trim(),
      after: Number(v('tr-after')) || 0
    });
    save();
    ['tr-situation', 'tr-thought', 'tr-emotion', 'tr-for', 'tr-against', 'tr-balanced'].forEach(function (id) { var el = $('#' + id); if (el) el.value = ''; });
    renderRecords();
    showToast('存下了。可以对比前后的强度。');
  }

  /* ---------------- 支持网 / 设置 ---------------- */

  function renderSupport() {
    var s = state.settings.support || ['', ''];
    var a = $('#support-name-1');
    var b = $('#support-name-2');
    if (a) a.value = s[0] || '';
    if (b) b.value = s[1] || '';
  }

  function saveSupport() {
    state.settings.support = [
      ($('#support-name-1') || {}).value || '',
      ($('#support-name-2') || {}).value || ''
    ];
    save();
    var el = $('#support-saved');
    if (el) el.textContent = '已保存';
    showToast('记下了。难受的时候直接发那句话。');
  }

  function renderSettings() {
    var w = $('#setting-window');
    if (w) w.value = state.window.time;
    var th = $('#setting-theme');
    if (th) th.value = state.settings.theme || 'auto';
    var mo = $('#setting-motion');
    if (mo) mo.value = state.settings.motion || 'auto';
    var q = $('#setting-quick-exit');
    if (q) q.value = state.settings.quickExit || 'search';
    var qu = $('#setting-quick-url');
    if (qu) {
      qu.hidden = (state.settings.quickExit || 'search') !== 'custom';
      if (document.activeElement !== qu) qu.value = state.settings.quickExitUrl || '';
    }
    renderPrivacy();
    refreshStorageNote();
  }

  function renderPrivacy() {
    var badge = $('#lock-badge');
    if (badge) {
      badge.textContent = lock.on ? '已加密' : '未设口令';
      badge.classList.toggle('badge--sage', lock.on);
    }
    var note = $('#lock-note');
    if (note) {
      note.textContent = lock.on
        ? '已开启：每次打开都要输口令，本机记录是加密存放的。'
        : '默认关闭。打开后每次进入要输口令，本机记录同时改成加密存放。';
    }
    var host = $('#priv-lock-actions');
    if (!host) return;
    if (!lock.on) {
      host.innerHTML = '<button class="btn btn--ghost btn--sm" data-action="lock-set">设置口令</button>';
      return;
    }
    var min = autoLockMin();
    host.innerHTML = '<select id="setting-autolock" aria-label="多久没动就自动锁上">' +
      [0, 1, 5, 15, 30].map(function (n) {
        return '<option value="' + n + '"' + (n === min ? ' selected' : '') + '>' +
          (n ? n + ' 分钟没动就锁' : '不自动锁') + '</option>';
      }).join('') + '</select>' +
      '<button class="btn btn--ghost btn--sm" data-action="lock-change">改口令</button>' +
      '<button class="btn btn--ghost btn--sm" data-action="lock-now">立即锁上</button>' +
      '<button class="btn btn--danger btn--sm" data-action="lock-off">关闭</button>';
  }

  /* ---------------- 导出 / 导入 / 清空 ---------------- */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 800);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function isLocalFile() { return location.protocol === 'file:'; }

  function saveFile(filename, text, mime, okMsg) {
    var type = mime || 'application/json;charset=utf-8';
    var blob = new Blob([text], { type: type });
    var file = null;
    try { file = new File([blob], filename, { type: type }); } catch (e) { file = null; }
    var share = false;
    try {
      share = !!(file && (isIOS() || isStandalone()) && navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) { share = false; }
    if (share) {
      navigator.share({ files: [file], title: '着陆台备份' }).then(function () {
        showToast('已打开分享面板，保存到「文件」即可。');
      }).catch(function () {
        download(filename, text, type);
        showToast(okMsg);
      });
      return;
    }
    download(filename, text, type);
    showToast(okMsg);
  }

  function exportJSON() {
    state.settings.lastExportAt = Date.now();
    save();
    var payload = {
      app: 'zhuolu',
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: state
    };
    saveFile('zhuolu-backup-' + dayKey() + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8',
      recordCount() ? '已导出 JSON 备份。' : '已导出备份（目前还没有记录）。');
    renderAll();
  }

  function exportMD() {
    var lines = [];
    lines.push('# 着陆台 · 记录导出');
    lines.push('');
    lines.push('导出时间：' + fmtDateFull(new Date()) + ' ' + fmtClock(Date.now()));
    lines.push('');
    lines.push('## 着陆记录（' + state.sos.length + '）');
    state.sos.forEach(function (r) {
      lines.push('- ' + fmtDayTime(r.t) + '：强度 ' + r.before + ' → ' + r.after + (r.need && r.need.length ? '；需要：' + r.need.join('、') : ''));
    });
    lines.push('');
    lines.push('## 反刍登记（' + state.rum.length + '）');
    state.rum.forEach(function (r) {
      lines.push('- ' + fmtDayTime(r.t) + ' [' + KIND_LABEL[r.kind] + '] ' + r.thought + (r.action ? '；下一步：' + r.action : ''));
    });
    lines.push('');
    lines.push('## 确定性整理（' + state.cert.length + '）');
    state.cert.forEach(function (c) {
      lines.push('- ' + fmtDayTime(c.t));
      if (c.fact) lines.push('  - 事实：' + c.fact);
      if (c.interp) lines.push('  - 解释：' + c.interp);
      if (c.unknown) lines.push('  - 不可知：' + c.unknown);
      if (c.next) lines.push('  - 下一步：' + c.next);
    });
    lines.push('');
    lines.push('## 思维记录（' + state.tr.length + '）');
    state.tr.forEach(function (r) {
      lines.push('- ' + fmtDayTime(r.t) + '：' + r.thought + '（' + r.intensity + ' → ' + r.after + '）');
      if (r.balanced) lines.push('  - 平衡句：' + r.balanced);
    });
    lines.push('');
    lines.push('## 睡前 3 行（' + state.sleep.length + '）');
    state.sleep.forEach(function (r) {
      lines.push('- ' + fmtDayTime(r.t));
      if (r.fact) lines.push('  - 事实：' + r.fact);
      if (r.did) lines.push('  - 做到：' + r.did);
      if (r.tomorrow) lines.push('  - 明天：' + r.tomorrow);
    });
    lines.push('');
    lines.push('---');
    lines.push('如果出现伤害自己的念头：12356（全国心理援助热线）· 120 / 110（紧急）。不在中国大陆：拨打当地紧急电话，或在 findahelpline.com 查找本地热线。');
    saveFile('zhuolu-' + dayKey() + '.md', lines.join('\n'), 'text/markdown;charset=utf-8', '已导出 Markdown。');
  }

  var pendingImport = null;

  function itemKey(x) {
    if (x && typeof x === 'object' && x.id) return 'id:' + x.id;
    try { return 'j:' + JSON.stringify(x); } catch (e) { return 'j:' + String(x); }
  }

  function mergeList(cur, incoming) {
    var out = (cur || []).slice();
    var seen = {};
    out.forEach(function (x) { seen[itemKey(x)] = true; });
    (incoming || []).forEach(function (x) {
      var k = itemKey(x);
      if (!seen[k]) { seen[k] = true; out.push(x); }
    });
    return out;
  }

  function renderImportDialog() {
    if (!pendingImport) return;
    var d = pendingImport.data;
    var meta = pendingImport.meta;
    var metaEl = $('#import-meta');
    var countsEl = $('#import-counts');
    var parts = ['文件：' + pendingImport.name];
    if (pendingImport.enc) parts.push('加密备份');
    if (meta) {
      var t = meta.exportedAt ? Date.parse(meta.exportedAt) : NaN;
      if (!isNaN(t)) parts.push('导出于 ' + fmtDayTime(t));
      if (meta.appVersion) parts.push('版本 ' + meta.appVersion);
    } else {
      parts.push('旧版备份（无版本信息）');
    }
    if (metaEl) metaEl.textContent = parts.join(' · ');
    var warn = $('#import-warn');
    if (warn) {
      warn.hidden = !pendingImport.warning;
      warn.textContent = pendingImport.warning || '';
    }
    var mergeBtn = $('[data-action="import-merge"]');
    var overwriteBtn = $('[data-action="import-overwrite"]');
    var blockedImport = !!pendingImport.blocked || !pendingImport.total;
    if (mergeBtn) mergeBtn.disabled = blockedImport;
    if (overwriteBtn) overwriteBtn.disabled = blockedImport;
    var rows = [
      ['反刍', d.rum.length],
      ['确定性', d.cert.length],
      ['思维记录', d.tr.length],
      ['睡前', d.sleep.length],
      ['着陆', d.sos.length],
      ['盒子', d.parked.length],
      ['今日打卡', Object.keys(d.daily || {}).length + ' 天']
    ];
    if (countsEl) countsEl.innerHTML = rows.map(function (r) { return '<span>' + r[0] + ' <b>' + r[1] + '</b></span>'; }).join('');
  }

  var pendingEnc = null;
  var deferredImport = null;

  function acceptParsed(parsed, name, fromEnc) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad backup');
    if (parsed.app && parsed.app !== 'zhuolu') {
      showToast('这不是着陆台的备份文件。');
      return false;
    }
    var raw = parsed;
    var meta = null;
    var warning = '';
    var blocked = false;
    if (parsed.app === 'zhuolu' && parsed.data && typeof parsed.data === 'object') {
      raw = parsed.data;
      meta = parsed;
      var sv = Number(parsed.schemaVersion) || 0;
      if (sv > SCHEMA_VERSION) {
        warning = '这份备份来自更新版本（格式 v' + sv + '），当前版本可能读不全。建议先升级应用，再导入。';
        blocked = true;
      }
    }
    var data = normalize(raw);
    var total = data.sos.length + data.rum.length + data.cert.length + data.tr.length + data.sleep.length + data.parked.length;
    if (!total) warning = warning || '这份备份里没有可导入的记录。';
    pendingImport = {
      data: data,
      meta: meta,
      name: name,
      total: total,
      warning: warning,
      blocked: blocked,
      enc: !!fromEnc
    };
    renderImportDialog();
    openOverlay('#import-overlay');
    return true;
  }

  function openEncrypted(pass) {
    if (!pendingEnc) return '没有待解开的文件。';
    var enc = pendingEnc.env;
    var name = pendingEnc.name;
    return deriveKey(pass, enc.salt, enc.iter || KDF_ITER).then(function (key) {
      return decryptText(key, enc.iv, enc.ct);
    }).then(function (text) {
      deferredImport = { parsed: JSON.parse(text), name: name };
      return null;
    }).catch(function () {
      return '口令不对，或文件被改过。';
    });
  }

  function importJSON() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try { parsed = JSON.parse(String(reader.result)); }
        catch (e) { showToast('这个文件读不出来，可能不是本工具的备份。'); return; }
        if (parsed && parsed.enc && parsed.enc.ct && parsed.enc.iv && parsed.enc.salt) {
          if (!cryptoOK) { showToast('这份备份是加密的，这个浏览器解不开（要用 HTTPS 或 localhost 打开）。'); return; }
          pendingEnc = { env: parsed.enc, name: f.name };
          openPass({
            kicker: '加密备份',
            title: '输入备份口令',
            one: true,
            oneLabel: '备份口令',
            lede: '这份备份导出时设了口令。',
            ok: '打开',
            foot: '口令不对就打不开。文件里没有口令，忘了只能重新导出。',
            run: function (v) { return openEncrypted(v.one); },
            after: function () {
              pendingEnc = null;
              var job = deferredImport;
              deferredImport = null;
              if (!job) return;
              try { acceptParsed(job.parsed, job.name, true); }
              catch (e) { showToast('这份备份读不出来。'); }
            }
          });
          return;
        }
        try { acceptParsed(parsed, f.name, false); }
        catch (e) { showToast('这个文件读不出来，可能不是本工具的备份。'); }
      };
      reader.readAsText(f, 'utf-8');
    };
    input.click();
  }

  function exportEncrypted(pass) {
    if (!cryptoOK) return '这个浏览器不支持加密（要用 HTTPS 或 localhost 打开）。';
    var salt = b64FromBytes(randBytes(16));
    var payload = {
      app: 'zhuolu',
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      locked: true,
      data: state
    };
    return deriveKey(pass, salt, KDF_ITER).then(function (key) {
      return encryptText(key, JSON.stringify(payload));
    }).then(function (out) {
      var env = {
        app: 'zhuolu',
        enc: {
          v: 1,
          alg: 'AES-GCM-256',
          kdf: 'PBKDF2-SHA256',
          iter: KDF_ITER,
          salt: salt,
          iv: out.iv,
          ct: out.ct
        },
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION,
        exportedAt: payload.exportedAt
      };
      state.settings.lastExportAt = Date.now();
      save();
      saveFile('zhuolu-backup-' + dayKey() + '.enc.json', JSON.stringify(env, null, 2),
        'application/json;charset=utf-8', '已导出加密备份。口令不在文件里，别忘。');
      renderAll();
      return null;
    }).catch(function () { return '加密没成功，换一个浏览器再试。'; });
  }

  function closeImport() {
    pendingImport = null;
    closeOverlay('#import-overlay');
  }

  function overwriteImport() {
    if (!pendingImport || pendingImport.blocked) return;
    if (!confirm('覆盖当前全部数据？建议先导出当前备份。')) return;
    state = normalize(pendingImport.data);
    save({ full: true });          // 整份替换：删掉的记录和打卡也要跟着消失
    applyTheme();
    clearCertFields();
    renderAll();
    pendingImport = null;
    closeOverlay('#import-overlay');
    showToast('导入完成。');
  }

  function mergeImport() {
    if (!pendingImport || pendingImport.blocked) return;
    var d = pendingImport.data;
    ['sos', 'rum', 'cert', 'tr', 'sleep', 'parked'].forEach(function (k) {
      state[k] = mergeList(state[k], d[k]);
    });
    if (d.daily && typeof d.daily === 'object') {
      Object.keys(d.daily).forEach(function (day) {
        if (!state.daily[day]) { state.daily[day] = d.daily[day]; return; }
        var a = state.daily[day];
        var b = d.daily[day];
        if (a && b && typeof a === 'object' && typeof b === 'object') {
          Object.keys(b).forEach(function (k) { if (!a[k]) a[k] = b[k]; });
        }
      });
    }
    if (d.firstSeen && d.firstSeen < state.firstSeen) state.firstSeen = d.firstSeen;
    save();
    applyTheme();
    renderAll();
    var added = pendingImport.total;
    pendingImport = null;
    closeOverlay('#import-overlay');
    showToast('已合并 ' + added + ' 条记录。');
  }

  var deferredPrompt = null;

  function updateInstallUI() {
    var tip = $('#install-tip');
    var btn = $('#install-btn');
    var badge = $('#install-badge');
    if (!tip || !btn) return;
    var migrate = $('#install-migrate');
    if (migrate) migrate.hidden = true;
    if (isLocalFile()) {
      tip.innerHTML = '<b>当前是本地文件</b><span>安装到主屏需要网页版本。你也可以继续直接打开这个文件；数据只在本机。</span>';
      btn.hidden = true;
      if (badge) badge.textContent = '本地文件';
      return;
    }
    if (isStandalone()) {
      tip.innerHTML = '<b>已经安装</b><span>以后从桌面上的「着陆台」图标打开，就是全屏应用。数据只存在这台设备。</span>';
      btn.hidden = true;
      if (badge) badge.textContent = '已安装';
      return;
    }
    if (isIOS()) {
      tip.innerHTML = '<b>iPhone / iPad</b><span>用 Safari 打开本页 → 点底部「分享」→「添加到主屏幕」→「添加」。</span>';
      btn.hidden = true;
      if (badge) badge.textContent = 'iOS';
      if (migrate) migrate.hidden = false;
      return;
    }
    var android = /Android/i.test(navigator.userAgent);
    if (deferredPrompt) {
      tip.innerHTML = '<b>' + (android ? 'Android' : '电脑') + '</b><span>点下面的按钮安装；也可以从浏览器菜单里选择「安装应用」。</span>';
      btn.hidden = false;
      if (badge) badge.textContent = android ? 'Android' : '桌面';
      return;
    }
    tip.innerHTML = android
      ? '<b>Android</b><span>Chrome 右上角菜单 →「安装应用」或「添加到主屏幕」。</span>'
      : '<b>电脑</b><span>Chrome / Edge：点地址栏右侧的安装图标，或菜单 →「安装着陆台」。Safari（macOS）：文件 → 添加到程序坞。</span>';
    btn.hidden = true;
    if (badge) badge.textContent = android ? 'Android' : '桌面';
  }

  function installApp() {
    if (!deferredPrompt) { showToast('按上面的方法安装。'); return; }
    var evt = deferredPrompt;
    deferredPrompt = null;
    evt.prompt();
    evt.userChoice.then(function (choice) {
      updateInstallUI();
      if (choice && choice.outcome === 'accepted') showToast('已开始安装。');
    }).catch(function () { updateInstallUI(); });
  }

  function setStorageNote(text) {
    var el = $('#storage-note');
    if (el) el.textContent = text;
  }

  function requestPersist() {
    if (!(navigator.storage && navigator.storage.persisted)) {
      persistNote = '浏览器没有提供持久化存储接口，请定期导出备份。';
      refreshStorageNote();
      return;
    }
    navigator.storage.persisted().then(function (already) {
      if (already) { persistNote = '本机存储已持久化'; refreshStorageNote(); return null; }
      if (!navigator.storage.persist) { persistNote = '浏览器可能自动清理本站数据，请定期导出备份'; refreshStorageNote(); return null; }
      return navigator.storage.persist().then(function (granted) {
        persistNote = granted ? '已申请持久化存储：浏览器不会自动清理' : '未获得持久化存储：清理数据会删除记录，请定期导出';
        refreshStorageNote();
        return null;
      });
    }).catch(function () {
      persistNote = '存储状态未知；请定期导出备份';
      refreshStorageNote();
    });
  }

  var swWaiting = null;
  var updateDismissed = false;
  var reloading = false;
  var hadController = false;

  function showUpdateBar(show) {
    var bar = $('#update-bar');
    if (bar) bar.hidden = !show;
  }

  function trackInstalling(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state !== 'installed') return;
      if (!navigator.serviceWorker.controller) return;
      if (updateDismissed) return;
      swWaiting = worker;
      showUpdateBar(true);
    });
  }

  function initSW() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      trackInstalling(reg.installing);
      reg.addEventListener('updatefound', function () { trackInstalling(reg.installing); });
      if (reg.waiting && navigator.serviceWorker.controller && !updateDismissed) {
        swWaiting = reg.waiting;
        showUpdateBar(true);
      }
      var lastCheck = 0;
      function checkUpdate() {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - lastCheck < 30 * 60000) return;
        lastCheck = Date.now();
        reg.update().catch(function () { /* 忽略：离线或服务器不支持 */ });
      }
      document.addEventListener('visibilitychange', checkUpdate);
      setInterval(checkUpdate, 60 * 60000);
    }).catch(function () { /* 离线缓存不可用时不影响使用 */ });
  }

  function applyUpdate() {
    showUpdateBar(false);
    if (swWaiting) {
      swWaiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    location.reload();
  }

  function dismissUpdate() {
    updateDismissed = true;
    showUpdateBar(false);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallUI();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    updateInstallUI();
    showToast('已安装到这台设备。');
  });

  function clearAll() {
    if (!confirm('清空所有记录？这个动作不能撤销。建议先导出 JSON。')) return;
    if (!confirm('再确认一次：所有记录都会消失。')) return;
    state = blank();
    save();
    applyTheme();
    clearCertFields();
    renderAll();
    showToast('已清空。');
  }

  function printPocket() {
    document.body.setAttribute('data-print', 'pocket');
    try { window.print(); } catch (e) { /* ignore */ }
    setTimeout(function () { document.body.removeAttribute('data-print'); }, 1200);
  }

  /* ---------------- 总渲染 ---------------- */

  function renderAll() {
    if (!state) return;
    renderStorageAlert();
    renderTopbar();
    renderHome();
    renderSafety();
    renderBackupNudge();
    renderWindow();
    renderRum();
    renderCert();
    renderToday();
    renderReview();
    renderRecords();
    renderSleepLast();
    renderSupport();
    renderSettings();
  }

  function renderRecords() { recordsHtml(); }

  /* ---------------- 事件 ---------------- */

  var ACTIONS = {
    'open-sos': openSOS,
    'close-sos': closeSOS,
    'sos-start': sosStart,
    'sos-skip-breath': sosSkipBreath,
    'sos-next': sosToAfter,
    'sos-skip-ground': sosToAfter,
    'sos-finish': sosFinish,
    'sos-restart': sosRestart,
    'shuffle-thing': pickTiny,
    'go': function (el) { go(el.getAttribute('data-route') || 'now'); },
    'toggle-window-edit': function () {
      var f = $('#window-edit');
      if (!f) return;
      f.hidden = !f.hidden;
      if (!f.hidden) { var i = $('#window-time-input'); if (i) { i.value = state.window.time; i.focus(); } }
    },
    'save-window': function () {
      var i = $('#window-time-input');
      var v = i ? i.value : '';
      if (!/^\d{2}:\d{2}$/.test(v)) { showToast('选一个时间再保存。'); return; }
      state.window.time = v;
      state.window.openedAt = 0;
      state.window.closedDay = '';
      save();
      var f = $('#window-edit');
      if (f) f.hidden = true;
      renderAll();
      showToast('担忧窗口改成每天 ' + v + '。');
    },
    'open-window': openWindow,
    'close-window': closeWindow,
    'park-thought': function () { toggleParkForm($('#park-form') && !$('#park-form').hidden ? false : true); },
    'save-park': savePark,
    'cancel-park': function () { toggleParkForm(false); },
    'del-parked': function (el) {
      var id = el.getAttribute('data-id');
      state.parked = state.parked.filter(function (p) { return p.id !== id; });
      save();
      renderWindow();
      renderHome();
    },
    'start-intercept': openIntercept,
    'close-intercept': closeIntercept,
    'it-next': itNext,
    'it-back': function () { showITStep(1); },
    'it-save': itSave,
    'it-again': function () { resetIntercept(); showITStep(1); },
    'save-cert': saveCert,
    'clear-cert': function () { clearCertFields(); showToast('已清空输入。'); },
    'edit-record': function (el) {
      editRecord(el.getAttribute('data-kind'), el.getAttribute('data-id'));
    },
    'save-edit': saveEdit,
    'close-edit': closeEdit,
    'sp-view': openSpView,
    'close-sp-view': closeSpView,
    'sp-edit': function () {
      closeSpView();
      if ($('#sos-overlay') && !$('#sos-overlay').hidden) closeSOS();
      go('safety');
    },
    'del-record': function (el) {
      removeRecord(el.getAttribute('data-kind'), el.getAttribute('data-id'));
    },
    'del-cert': function (el) {
      removeRecord('cert', el.getAttribute('data-id'));
    },
    'dismiss-backup-nudge': function () {
      state.settings.nudgeSnoozeUntil = Date.now() + NUDGE_SNOOZE_MS;
      save();
      renderBackupNudge();
      showToast('好，3 天后再提醒。');
    },
    'apply-update': applyUpdate,
    'dismiss-update': dismissUpdate,
    'save-tr': saveTR,
    'save-sleep': saveSleep,
    'save-support': saveSupport,
    'export-json': exportJSON,
    'export-md': exportMD,
    'export-review': exportReview,
    'export-summary': exportSummary,
    'rv-kind': function (el) { setFilterKind(el.getAttribute('data-rv-kind')); },
    'rv-range': function (el) { setFilterRange(el.getAttribute('data-rv-range')); },
    'import-json': importJSON,
    'close-import': closeImport,
    'import-merge': mergeImport,
    'import-overwrite': overwriteImport,
    'install-app': installApp,
    'print-pocket': printPocket,
    'clear-all': clearAll,
    'timer-start': toggleTimer,
    'timer-reset': resetTimer,
    'shuffle-step': shuffleStep,
    'quick-exit': quickExit,
    'sp-add': function (el) {
      var key = el.getAttribute('data-key');
      var input = $('#sp-input-' + key);
      spAdd(key, input ? input.value : '');
      if (input) { input.value = ''; input.focus(); }
    },
    'sp-suggest': function (el) {
      var key = el.getAttribute('data-key');
      var text = el.getAttribute('data-text');
      var d = spData();
      var i = d[key].indexOf(text);
      if (i >= 0) { spDel(key, i); return; }
      spAdd(key, text);
    },
    'sp-del': function (el) {
      spDel(el.getAttribute('data-key'), Number(el.getAttribute('data-i')));
    },
    'print-safety': printSafety,
    'lock-set': function () {
      if (!cryptoOK) { showToast('这个浏览器不支持加密（要用 HTTPS 或 localhost 打开）。'); return; }
      openPass({
        kicker: '应用锁',
        title: '设置一个口令',
        lede: '设好之后，每次打开都要输口令；这台设备上的记录会改成加密存放。',
        new: true,
        new2: true,
        newLabel: '新口令',
        ok: '开启应用锁',
        foot: '忘记口令就等于数据打不开。先去上面的「导出 JSON」存一份，再设。',
        run: function (v) { return enableLock(v.np); },
        after: function () { renderSettings(); showToast('应用锁已开启。'); }
      });
    },
    'lock-change': function () {
      openPass({
        kicker: '应用锁',
        title: '换一个口令',
        cur: true,
        new: true,
        new2: true,
        newLabel: '新口令',
        ok: '改口令',
        run: function (v) {
          return verifyPass(v.cur).then(function (key) {
            if (!key) return '当前口令不对。';
            return changeLock(v.np);
          });
        },
        after: function () { renderSettings(); showToast('口令已更新。'); }
      });
    },
    'lock-off': function () {
      if (!confirm('关闭应用锁？本机记录会改回明文存放。')) return;
      openPass({
        kicker: '应用锁',
        title: '关闭应用锁',
        lede: '关闭后不再需要口令，本机数据改回明文存放。',
        cur: true,
        ok: '关闭',
        run: function (v) {
          return verifyPass(v.cur).then(function (key) {
            if (!key) return '当前口令不对。';
            return disableLock();
          });
        },
        after: function () { renderSettings(); showToast('应用锁已关闭。'); }
      });
    },
    'lock-now': function () { lockNow(); },
    'lock-forgot': lockForgot,
    'unlock': tryUnlock,
    'pass-submit': submitPass,
    'pass-cancel': closePass,
    'export-enc': function () {
      if (!cryptoOK) { showToast('这个浏览器不支持加密（要用 HTTPS 或 localhost 打开）。'); return; }
      openPass({
        kicker: '加密备份',
        title: '给备份设一个口令',
        lede: '文件和本机记录一样，用这个口令加密。口令不进文件。',
        new: true,
        new2: true,
        newLabel: '备份口令',
        ok: '导出',
        foot: '可以和应用锁口令不同。换设备时用「导入 JSON」选这份文件，再输这个口令。',
        run: function (v) { return exportEncrypted(v.np); }
      });
    }
  };

  document.addEventListener('click', function (e) {
    var actionEl = e.target.closest ? e.target.closest('[data-action]') : null;
    if (actionEl) {
      var name = actionEl.getAttribute('data-action');
      if (ACTIONS[name]) {
        e.preventDefault();
        ACTIONS[name](actionEl, e);
        return;
      }
    }

    var routeLink = e.target.closest ? e.target.closest('a[data-route]') : null;
    if (routeLink && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (e.button === 0 || e.button === undefined)) {
      e.preventDefault();
      go(routeLink.getAttribute('data-route'));
      return;
    }

    var chip = e.target.closest ? e.target.closest('[data-need]') : null;
    if (chip) {
      chip.classList.toggle('is-on');
      chip.setAttribute('aria-pressed', chip.classList.contains('is-on') ? 'true' : 'false');
      return;
    }

    var kind = e.target.closest ? e.target.closest('#it-kinds [data-kind]') : null;
    if (kind) {
      it.kind = kind.getAttribute('data-kind');
      $$('#it-kinds .kind-btn').forEach(function (b) {
        var on = b === kind;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      return;
    }

    var sense = e.target.closest ? e.target.closest('.ground-row') : null;
    if (sense) {
      var key = sense.getAttribute('data-sense');
      var total = Number(sense.getAttribute('data-total')) || 1;
      var n = (sos.ground[key] || 0);
      if (n < total) n++;
      sos.ground[key] = n;
      var dots = $$('.ground-dots i', sense);
      dots.forEach(function (d, i) { d.classList.toggle('is-on', i < n); });
      sense.classList.toggle('is-done', n >= total);
      var titleEl = sense.querySelector('.ground-row__t b');
      var baseLabel = titleEl ? titleEl.textContent : '';
      sense.setAttribute('aria-label', baseLabel + '，已找到 ' + n + ' / ' + total);
      return;
    }

    var check = e.target.closest ? e.target.closest('#today-checks .check-row') : null;
    if (check) {
      var d = todayData();
      var ck = check.getAttribute('data-check');
      d[ck] = !d[ck];
      save();
      renderToday();
      return;
    }

    var stepCatBtn = e.target.closest ? e.target.closest('[data-step-cat]') : null;
    if (stepCatBtn) {
      stepCat = stepCatBtn.getAttribute('data-step-cat');
      $$('#step-chips .chip').forEach(function (c) {
        var on = c === stepCatBtn;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      stepIdx = 0;
      renderToday();
      return;
    }

    var rangeBtn = e.target.closest ? e.target.closest('[data-review-range]') : null;
    if (rangeBtn) {
      reviewDays = Number(rangeBtn.getAttribute('data-review-range')) === 30 ? 30 : 7;
      $$('[data-review-range]').forEach(function (btn) {
        var on = btn === rangeBtn;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderReview();
      return;
    }

    var tab = e.target.closest ? e.target.closest('[data-rec-tab]') : null;
    if (tab) {
      var key2 = tab.getAttribute('data-rec-tab');
      $$('[data-rec-tab]').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $$('[data-rec-panel]').forEach(function (p) {
        p.classList.toggle('is-on', p.getAttribute('data-rec-panel') === key2);
      });
      return;
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'review-q') {
      rvFilter.q = String(t.value || '').slice(0, 40);
      if (rvTimer) clearTimeout(rvTimer);
      rvTimer = setTimeout(renderFilter, 220);
      return;
    }
    if (t.id && t.id.indexOf('ef-') === 0) {
      var errEl = $('#edit-err');
      if (errEl && !errEl.hidden) { errEl.hidden = true; errEl.textContent = ''; }
      return;
    }
    if (t.tagName !== 'INPUT' || t.type !== 'range') return;
    var min = Number(t.min) || 0;
    var max = Number(t.max) || 100;
    var v = Number(t.value);
    var pct = ((v - min) / (max - min)) * 100;
    t.style.setProperty('--p', pct + '%');
    if (t.id === 'sos-before') { var a = $('#sos-before-num'); if (a) a.textContent = String(v); }
    if (t.id === 'sos-after') { var b = $('#sos-after-num'); if (b) b.textContent = String(v); }
    if (t.id === 'tr-belief') { var c = $('#tr-belief-num'); if (c) c.textContent = v + '%'; }
    if (t.id === 'tr-intensity') { var d = $('#tr-intensity-num'); if (d) d.textContent = String(v); }
    if (t.id === 'tr-after') { var f = $('#tr-after-num'); if (f) f.textContent = String(v); }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'setting-window') {
      if (!/^\d{2}:\d{2}$/.test(t.value)) return;
      state.window.time = t.value;
      state.window.openedAt = 0;
      state.window.closedDay = '';
      save();
      renderWindow();
      renderHome();
      showToast('担忧窗口改成每天 ' + t.value + '。');
    }
    if (t.id === 'setting-theme') {
      state.settings.theme = t.value === 'dark' || t.value === 'light' ? t.value : 'auto';
      save();
      applyTheme();
    }
    if (t.id === 'setting-motion') {
      state.settings.motion = t.value === 'reduce' ? 'reduce' : 'auto';
      save();
      applyTheme();
    }
    if (t.id === 'setting-quick-exit') {
      state.settings.quickExit = ['search', 'weather', 'blank', 'custom'].indexOf(t.value) >= 0 ? t.value : 'search';
      save();
      renderSettings();
      showToast('快速离开改成：' + t.options[t.selectedIndex].text + '。');
    }
    if (t.id === 'setting-quick-url') {
      var u = String(t.value || '').trim();
      if (u && !/^https?:\/\/[^\s]+$/i.test(u)) { showToast('要写成 https:// 开头。'); return; }
      state.settings.quickExitUrl = u.slice(0, 400);
      save();
      if (u) showToast('快速离开的网址记下了。');
    }
    if (t.id === 'setting-autolock') {
      setAutoLock(Number(t.value) || 0);
      showToast(Number(t.value) ? '不操作 ' + t.value + ' 分钟就自动锁上。' : '不会自动锁，只在重新打开时要求口令。');
    }
  });

  document.addEventListener('keydown', function (e) {
    var tgt = e.target;
    if (e.key === 'Enter' && tgt && tgt.getAttribute) {
      var spKey = tgt.getAttribute('data-sp-input');
      if (spKey) {
        e.preventDefault();
        spAdd(spKey, tgt.value);
        tgt.value = '';
        return;
      }
      if (tgt.id === 'lock-pass') {
        e.preventDefault();
        tryUnlock();
        return;
      }
    }
    if (e.key === 'Tab') {
      var open = null;
      $$('.overlay').forEach(function (o) { if (!o.hidden) open = o; });
      if (open) {
        var list = overlayFocusables(open);
        if (!list.length) return;
        var first = list[0], last = list[list.length - 1];
        var active = document.activeElement;
        if (!open.contains(active)) {
          e.preventDefault();
          first.focus();
          return;
        }
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    if (e.key === 'Escape') {
      if ($('#pass-overlay') && !$('#pass-overlay').hidden) { closePass(); return; }
      if ($('#import-overlay') && !$('#import-overlay').hidden) { closeImport(); return; }
      if ($('#edit-overlay') && !$('#edit-overlay').hidden) { closeEdit(); return; }
      if ($('#sp-overlay') && !$('#sp-overlay').hidden) { closeSpView(); return; }
      if ($('#sos-overlay') && !$('#sos-overlay').hidden) { closeSOS(); return; }
      if ($('#intercept-overlay') && !$('#intercept-overlay').hidden) { closeIntercept(); return; }
    }
  });

  /* ---------------- 启动 ---------------- */

  function initRanges() {
    $$('input[type="range"]').forEach(function (r) {
      var min = Number(r.min) || 0;
      var max = Number(r.max) || 100;
      var pct = ((Number(r.value) - min) / (max - min)) * 100;
      r.style.setProperty('--p', pct + '%');
    });
  }

  var reviewResizeTimer = null;
  window.addEventListener('resize', function () {
    if (currentRoute() !== 'review') return;
    if (reviewResizeTimer) clearTimeout(reviewResizeTimer);
    reviewResizeTimer = setTimeout(renderReview, 180);
  });

  var booted = false;

  function hideSplash() {
    var el = document.getElementById('boot-splash');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function bootApp() {
    if (booted) { renderAll(); hideSplash(); return; }
    booted = true;
    daySeen = dayKey();
    applyTheme();
    initRanges();
    renderAll();
    updateInstallUI();
    requestPersist();
    updateQuotaNote();
    if (!location.hash) {
      location.replace('#/now');
    } else {
      renderRoute();
    }
    if (!storageOK) {
      setTimeout(function () { showToast('这个浏览器不能保存记录：关掉页面就会消失，先导出。'); }, 900);
    }
    setInterval(function () { updateWindowTimer(); checkDayChange(); }, 1000);
    startIdleWatch();
    hideSplash();
  }

  // 存储是异步打开的（IndexedDB），打开之前不渲染任何东西
  function finishBoot() {
    if (!lock.unlocked) {
      hideSplash();
      showLock();
      return;
    }
    bootApp();
  }

  function init() {
    readUiHint();
    applyTheme();
    var toastBtn = $('#toast-action');
    if (toastBtn) {
      toastBtn.addEventListener('click', function () {
        var fn = toastAction;
        hideToast();
        if (fn) fn();
      });
    }
    $$('.chip[data-need], #step-chips .chip, #it-kinds .kind-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.classList.contains('is-on') ? 'true' : 'false');
    });
    var skip = $('.skip');
    if (skip) {
      skip.addEventListener('click', function () {
        var m = $('#main');
        if (m) setTimeout(function () { try { m.focus(); } catch (e) { /* ignore */ } }, 0);
      });
    }
    var passForm = $('#pass-form');
    if (passForm) {
      passForm.addEventListener('submit', function (e) { e.preventDefault(); submitPass(); });
    }
    var lockForm = $('#lock-form');
    if (lockForm) {
      lockForm.addEventListener('submit', function (e) { e.preventDefault(); tryUnlock(); });
    }
    initSW();
    bootStore().then(finishBoot, finishBoot);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
