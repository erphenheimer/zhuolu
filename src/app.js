/* ============================================================
   着陆台 · 交互逻辑 01
   数据层 / 路由 / 现在页 / 反刍页 / 着陆浮层
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'zhuolu.v1';
  var APP_VERSION = '0.2.1';
  var SCHEMA_VERSION = 1;
  var ROUTES = ['now', 'rumination', 'certainty', 'today', 'more'];
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
      settings: { theme: 'auto', motion: 'auto', support: ['', ''], lastExportAt: 0, nudgeSnoozeUntil: 0 }
    };
  }

  var storageOK = true;

  function normalize(raw) {
    var b = blank();
    if (!raw || typeof raw !== 'object') return b;
    ['sos', 'rum', 'cert', 'tr', 'sleep', 'parked'].forEach(function (k) {
      if (Array.isArray(raw[k])) b[k] = raw[k];
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
    }
    if (raw.firstSeen) b.firstSeen = Number(raw.firstSeen) || Date.now();
    return b;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      return normalize(JSON.parse(raw));
    } catch (e) {
      storageOK = false;
      return blank();
    }
  }

  function save() {
    if (!storageOK) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      storageOK = false;
      try { showToast('浏览器没能保存，建议导出备份。'); } catch (err) { /* ignore */ }
    }
  }

  var state = load();

  /* ---------------- 主题 / 动效 ---------------- */

  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function applyTheme() {
    var t = state.settings.theme || 'auto';
    var dark = t === 'dark' || (t === 'auto' && mqDark && mqDark.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var m = state.settings.motion || 'auto';
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

  /* ---------------- 路由 ---------------- */

  function currentRoute() {
    var h = String(location.hash || '').replace(/^#\/?/, '');
    return ROUTES.indexOf(h) >= 0 ? h : 'now';
  }

  function renderRoute() {
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
    if (currentRoute() === route) {
      renderRoute();
      return;
    }
    location.hash = '#/' + route;
  }

  window.addEventListener('hashchange', function () {
    window.scrollTo(0, 0);
    renderRoute();
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
    var s = streak();
    var parts = [];
    if (st.sos) parts.push('<span><b>' + st.sos + '</b>次着陆（近 7 天）</span>');
    if (st.rum) parts.push('<span><b>' + st.rum + '</b>次反刍登记</span>');
    if (st.n >= 2) parts.push('<span>着陆后平均降 <b>' + st.drop.toFixed(1) + '</b> 分</span>');
    if (s >= 2) parts.push('<span>连续记录 <b>' + s + '</b> 天</span>');
    if (!parts.length) parts.push('<span>还没有记录。难受的时候，按上面那个大按钮就行。</span>');
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
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }

  function refreshStorageNote() {
    var bytes = stateBytes();
    var parts = [];
    if (persistNote) parts.push(persistNote);
    if (bytes > 0) parts.push('本机数据约 ' + fmtBytes(bytes) + ' / 浏览器上限约 5 MB');
    if (bytes > 4194304) parts.push('空间快满了，建议导出后清理旧记录。');
    setStorageNote(parts.join(' · '));
    if (bytes > 4194304 && !quotaWarned) {
      quotaWarned = true;
      showToast('本地存储快满了，先导出一份备份。');
    }
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

  function openOverlay(id) {
    lastFocus = document.activeElement;
    var o = $(id);
    if (!o) return;
    o.hidden = false;
    document.body.classList.add('is-locked');
    var c = $('.panel__close', o);
    if (c) setTimeout(function () { c.focus(); }, 40);
  }

  function anyOverlayOpen() {
    return $$('.overlay').some(function (o) { return !o.hidden; });
  }

  function closeOverlay(id) {
    var o = $(id);
    if (!o) return;
    o.hidden = true;
    if (!anyOverlayOpen()) document.body.classList.remove('is-locked');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
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
    if (!$('#intercept-overlay').hidden) closeOverlay('#intercept-overlay');
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
      done.innerHTML = '今天它出现了第 <b>' + count + '</b> 次。' + extra +
        (count >= 3 ? '<br><span class="muted">今天已经第 ' + count + ' 次了。重复出现不是新证据。</span>' : '');
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
        '</div><button class="icon-btn" data-action="del-cert" data-id="' + esc(c.id) + '" aria-label="删除这份整理">×</button></li>';
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
    if (p) p.textContent = done + ' / 5';
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

  /* ---------------- 记录 ---------------- */

  function emptyItem(text) { return '<li class="empty">' + text + '</li>'; }

  function delBtnHtml(kind, id, label) {
    return '<button class="icon-btn" data-action="del-record" data-kind="' + kind + '" data-id="' + esc(id) + '" aria-label="删除这条' + label + '记录">×</button>';
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
          delBtnHtml('rum', r.id, '反刍') + '</li>';
      }).join('') : emptyItem('还没有反刍记录。');
    }

    var certEl = $('#rec-cert');
    if (certEl) certEl.innerHTML = cert.length ? cert.map(function (c) {
      return '<li class="item"><div class="item__main"><div class="item__meta">' + fmtDayTime(c.t) + '</div>' +
        '<div class="cert-lines">' + certSummaryHtml(c) + '</div></div>' +
        delBtnHtml('cert', c.id, '确定性') + '</li>';
    }).join('') : emptyItem('还没有确定性整理。');

    var trEl = $('#rec-tr');
    if (trEl) {
      trEl.innerHTML = tr.length ? tr.map(function (r) {
        return '<li class="item"><div class="item__main"><div class="item__text">' + esc(r.thought || '（没写自动思维）') + '</div>' +
          '<div class="small muted">情境：' + esc((r.situation || '').slice(0, 60)) + '</div>' +
          '<div class="item__meta">' + (r.intensity != null ? r.intensity : '?') + ' → ' + (r.after != null ? r.after : '?') + ' · ' + fmtDayTime(r.t) + '</div></div>' +
          delBtnHtml('tr', r.id, '思维') + '</li>';
      }).join('') : emptyItem('还没有思维记录。');
    }

    var sleepEl = $('#rec-sleep');
    if (sleepEl) {
      sleepEl.innerHTML = sleep.length ? sleep.map(function (r) {
        return '<li class="item"><div class="item__main"><div class="item__text">' + esc(r.did || r.fact || '（没写内容）') + '</div>' +
          '<div class="small muted">' + esc(r.tomorrow ? '明天：' + r.tomorrow : '') + '</div>' +
          '<div class="item__meta">' + fmtDayTime(r.t) + '</div></div>' +
          delBtnHtml('sleep', r.id, '睡前') + '</li>';
      }).join('') : emptyItem('还没有睡前记录。');
    }

    var sosEl = $('#rec-sos');
    if (sosEl) {
      sosEl.innerHTML = sosList.length ? sosList.map(function (r) {
        var d = (r.before != null && r.after != null) ? (r.before - r.after) : 0;
        return '<li class="item"><div class="item__main"><div class="item__text">强度 ' + r.before + ' → ' + r.after + (d > 0 ? '（降 ' + d + '）' : '') + '</div>' +
          '<div class="item__meta">' + (r.need && r.need.length ? esc(r.need.join('、')) + ' · ' : '') + fmtDayTime(r.t) + '</div></div>' +
          delBtnHtml('sos', r.id, '着陆') + '</li>';
      }).join('') : emptyItem('还没有着陆记录。');
    }
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
    refreshStorageNote();
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
    saveFile('zhuolu-backup-' + dayKey() + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8', '已导出 JSON 备份。');
    renderAll();
  }

  function exportMD() {
    var lines = [];
    lines.push('# 着陆台 · 记录导出');
    lines.push('');
    lines.push('导出时间：' + fmtDateFull(new Date()) + ' ' + fmtClock(Date.now()));
    lines.push('');
    lines.push('## 着陆记录（' + state.sos.length + '）');
    state.sos.slice(0, 100).forEach(function (r) {
      lines.push('- ' + fmtDayTime(r.t) + '：强度 ' + r.before + ' → ' + r.after + (r.need && r.need.length ? '；需要：' + r.need.join('、') : ''));
    });
    lines.push('');
    lines.push('## 反刍登记（' + state.rum.length + '）');
    state.rum.slice(0, 100).forEach(function (r) {
      lines.push('- ' + fmtDayTime(r.t) + ' [' + KIND_LABEL[r.kind] + '] ' + r.thought + (r.action ? '；下一步：' + r.action : ''));
    });
    lines.push('');
    lines.push('## 确定性整理（' + state.cert.length + '）');
    state.cert.slice(0, 50).forEach(function (c) {
      lines.push('- ' + fmtDayTime(c.t));
      if (c.fact) lines.push('  - 事实：' + c.fact);
      if (c.interp) lines.push('  - 解释：' + c.interp);
      if (c.unknown) lines.push('  - 不可知：' + c.unknown);
      if (c.next) lines.push('  - 下一步：' + c.next);
    });
    lines.push('');
    lines.push('## 思维记录（' + state.tr.length + '）');
    state.tr.slice(0, 50).forEach(function (r) {
      lines.push('- ' + fmtDayTime(r.t) + '：' + r.thought + '（' + r.intensity + ' → ' + r.after + '）');
      if (r.balanced) lines.push('  - 平衡句：' + r.balanced);
    });
    lines.push('');
    lines.push('## 睡前 3 行（' + state.sleep.length + '）');
    state.sleep.slice(0, 50).forEach(function (r) {
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

  function importJSON() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad backup');
          if (parsed.app && parsed.app !== 'zhuolu') {
            showToast('这不是着陆台的备份文件。');
            return;
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
            name: f.name,
            total: total,
            warning: warning,
            blocked: blocked
          };
          renderImportDialog();
          openOverlay('#import-overlay');
        } catch (e) {
          showToast('这个文件读不出来，可能不是本工具的备份。');
        }
      };
      reader.readAsText(f, 'utf-8');
    };
    input.click();
  }

  function closeImport() {
    pendingImport = null;
    closeOverlay('#import-overlay');
  }

  function overwriteImport() {
    if (!pendingImport || pendingImport.blocked) return;
    if (!confirm('覆盖当前全部数据？建议先导出当前备份。')) return;
    state = normalize(pendingImport.data);
    save();
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
    window.print();
  }

  /* ---------------- 总渲染 ---------------- */

  function renderAll() {
    renderTopbar();
    renderHome();
    renderBackupNudge();
    renderWindow();
    renderRum();
    renderCert();
    renderToday();
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
    'import-json': importJSON,
    'close-import': closeImport,
    'import-merge': mergeImport,
    'import-overwrite': overwriteImport,
    'install-app': installApp,
    'print-pocket': printPocket,
    'clear-all': clearAll,
    'timer-start': toggleTimer,
    'timer-reset': resetTimer,
    'shuffle-step': shuffleStep
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

    var chip = e.target.closest ? e.target.closest('[data-need]') : null;
    if (chip) {
      chip.classList.toggle('is-on');
      return;
    }

    var kind = e.target.closest ? e.target.closest('#it-kinds [data-kind]') : null;
    if (kind) {
      it.kind = kind.getAttribute('data-kind');
      $$('#it-kinds .kind-btn').forEach(function (b) { b.classList.toggle('is-on', b === kind); });
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
      $$('#step-chips .chip').forEach(function (c) { c.classList.toggle('is-on', c === stepCatBtn); });
      stepIdx = 0;
      renderToday();
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
    if (!t || t.tagName !== 'INPUT' || t.type !== 'range') return;
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
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if ($('#import-overlay') && !$('#import-overlay').hidden) { closeImport(); return; }
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

  function init() {
    applyTheme();
    initRanges();
    var toastBtn = $('#toast-action');
    if (toastBtn) {
      toastBtn.addEventListener('click', function () {
        var fn = toastAction;
        hideToast();
        if (fn) fn();
      });
    }
    renderAll();
    updateInstallUI();
    requestPersist();
    initSW();
    if (!location.hash) {
      location.replace('#/now');
    } else {
      renderRoute();
    }
    if (!storageOK) {
      setTimeout(function () { showToast('这个浏览器不能本地保存，记录只在本次打开有效。'); }, 900);
    }
    setInterval(updateWindowTimer, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
