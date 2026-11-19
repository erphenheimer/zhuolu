#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""0.9.0 长跨度：两年的打卡（730 行）+ 2000 条记录，看启动、回顾、检索、导出还顶不顶得住。

用法：
    python tools/horizon.py
"""

import json
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import qa  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

REPO = ROOT
OUT = ROOT / "hist" / ("horizon-" + time.strftime("%Y%m%d-%H%M%S"))
COLLS = ["sos", "rum", "cert", "tr", "sleep", "parked"]
DAYS = 730
MIX = {"rum": 900, "tr": 400, "sos": 300, "sleep": 300, "cert": 60, "parked": 40}
LIMIT = {"boot": 4000, "review": 4000, "search": 3000, "export": 8000}


def mk(kind, i, t):
    if kind == "rum":
        return {"id": "hz-rum-%d" % i, "t": t, "kind": "self",
                "thought": "第 %d 条反刍：工作上的事" % i, "action": ""}
    if kind == "tr":
        return {"id": "hz-tr-%d" % i, "t": t, "situation": "", "thought": "第 %d 条思维：工作" % i,
                "belief": 60, "emotion": "", "intensity": 50, "for": "", "against": "",
                "balanced": "", "after": 40}
    if kind == "sos":
        return {"id": "hz-sos-%d" % i, "t": t, "before": 7, "after": 4, "need": ["喝水"]}
    if kind == "sleep":
        return {"id": "hz-sl-%d" % i, "t": t, "fact": "第 %d 天" % i, "did": "起床", "tomorrow": "喝水"}
    if kind == "cert":
        return {"id": "hz-cert-%d" % i, "t": t, "fact": "事实 %d" % i, "interp": "",
                "unknown": "", "next": ""}
    return {"id": "hz-pk-%d" % i, "t": t, "text": "盒子第 %d 条" % i}


def build():
    today = date.today()
    daily = {}
    for i in range(DAYS):
        key = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        n = i % 5 + 1
        daily[key] = {"sleep": n >= 2, "eat": n >= 3, "move": n >= 4,
                      "connect": n >= 5, "push": n >= 1}
    start = int(datetime.combine(today - timedelta(days=DAYS), datetime.min.time()).timestamp() * 1000)
    span = int(datetime.combine(today, datetime.min.time()).timestamp() * 1000) - start
    state = {
        "v": 1, "firstSeen": start,
        "sos": [], "rum": [], "cert": [], "tr": [], "sleep": [], "parked": [],
        "daily": daily,
        "window": {"time": "19:30", "minutes": 15, "openedAt": 0, "closedDay": ""},
        "safety": {"signals": [], "coping": [], "distract": [], "people": [],
                   "pros": [], "env": [], "reasons": [], "updatedAt": 0},
        "settings": {"theme": "auto", "motion": "auto", "support": ["", ""],
                     "lastExportAt": 0, "nudgeSnoozeUntil": 0,
                     "quickExit": "search", "quickExitUrl": ""},
    }
    for kind, n in MIX.items():
        step = max(1, span // (n + 1))
        state[kind] = [mk(kind, i, start + (i + 1) * step) for i in range(n)]
    return state


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    state = build()
    total = sum(len(state[k]) for k in COLLS)
    server = qa.StaticServer(REPO)
    rows = []
    faults = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=qa.CHROME_PATH, headless=True)
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(server.base + "index.html", wait_until="domcontentloaded")
            page.wait_for_selector("#boot-splash", state="detached", timeout=20000)
            page.evaluate("() => { location.hash = '#/now'; }")

            t0 = time.time()
            qa.seed_state(page, state)
            seed_ms = (time.time() - t0) * 1000

            t0 = time.time()
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#boot-splash", state="detached", timeout=30000)
            boot_ms = (time.time() - t0) * 1000

            dumped = qa.app_state(page)
            keys = dumped["__keys"]
            days = [k for k in keys if k.startswith("daily|")]
            recs = [k for k in keys if not k.startswith("daily|")]
            rows.append(("写入", "%d 条记录 + %d 天打卡" % (total, DAYS), "%.0fms" % seed_ms, True))
            rows.append(("首次启动", "带 %d 行数据冷启" % (total + DAYS), "%.0fms" % boot_ms,
                         boot_ms <= LIMIT["boot"]))
            if boot_ms > LIMIT["boot"]:
                faults.append("首次启动 %.0fms 超过 %dms" % (boot_ms, LIMIT["boot"]))
            ok = len(days) == DAYS and len(recs) == total
            rows.append(("落盘", "%d 行记录 / %d 行打卡" % (len(recs), len(days)), "一天一行", ok))
            if not ok:
                faults.append("落盘行数不对：记录 %d（期望 %d）、打卡 %d（期望 %d）"
                              % (len(recs), total, len(days), DAYS))

            t0 = time.time()
            qa.nav(page, "review")
            page.wait_for_selector(".view[data-view='review'].is-active")
            page.wait_for_function("() => (document.querySelector('#review-summary')||{}).textContent.length > 0",
                                   timeout=15000)
            review_ms = (time.time() - t0) * 1000
            rows.append(("回顾页", "7 天 / 30 天 / 两段对比", "%.0fms" % review_ms,
                         review_ms <= LIMIT["review"]))
            if review_ms > LIMIT["review"]:
                faults.append("回顾页 %.0fms 超过 %dms" % (review_ms, LIMIT["review"]))

            t0 = time.time()
            page.fill("#review-q", "工作")
            page.wait_for_function(
                "() => { const n = document.querySelector('#filter-count');"
                " if (!n) return false; const t = n.textContent.trim();"
                " return t !== '—' && t.indexOf('条') > 0; }", timeout=20000)
            count_text = page.eval_on_selector("#filter-count", "el => el.textContent").strip()
            shown = page.eval_on_selector_all("#filter-hits li", "els => els.length")
            search_ms = (time.time() - t0) * 1000
            hits = int(count_text.replace("条", "").strip() or 0)
            ok = hits > 400 and shown == 21 and search_ms <= LIMIT["search"]
            rows.append(("检索「工作」", "命中 %d 条，显示 %d 条（20 + 提示）" % (hits, shown),
                         "%.0fms" % search_ms, ok))
            if not ok:
                faults.append("检索异常：命中 %d、显示 %d、耗时 %.0fms" % (hits, shown, search_ms))

            qa.nav(page, "more")
            t0 = time.time()
            with page.expect_download(timeout=30000) as info:
                page.click(".data-actions [data-action='export-json']")
            text = Path(info.value.path()).read_text(encoding="utf-8")
            export_ms = (time.time() - t0) * 1000
            payload = json.loads(text)
            mc = payload["manifest"]["counts"]
            good = mc["days"] == DAYS and mc["total"] == total
            rows.append(("导出备份", "%.1f KB · 清单 %d 天 / %d 条" % (len(text.encode()) / 1024.0, mc["days"], mc["total"]),
                         "%.0fms" % export_ms, good and export_ms <= LIMIT["export"]))
            if not good:
                faults.append("导出清单不对：%s" % mc)

            t0 = time.time()
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#boot-splash", state="detached", timeout=30000)
            warm_ms = (time.time() - t0) * 1000
            rows.append(("再开一次", "同样 %d 行" % len(keys), "%.0fms" % warm_ms,
                         warm_ms <= LIMIT["boot"]))
            if warm_ms > LIMIT["boot"]:
                faults.append("二次启动 %.0fms 超过 %dms" % (warm_ms, LIMIT["boot"]))
            if not errors:
                pass
            else:
                faults.append("页面报错：%s" % errors)

            ctx.close()
            browser.close()
    finally:
        server.stop()

    print("长跨度 · %d 天打卡 + %d 条记录" % (DAYS, total))
    print("-" * 74)
    for what, detail, cost, ok in rows:
        print("%-10s %-34s %-10s %s" % (what, detail, cost, "OK" if ok else "FAIL"))
    print("-" * 74)
    if faults:
        print("失败：")
        for f in faults:
            print("  - " + f)
        return 1
    print("全部通过：两年数据下启动 / 回顾 / 检索 / 导出都在预算内")
    return 0


if __name__ == "__main__":
    sys.exit(main())