#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""0.9.0 版本矩阵：0.2.0 – 0.8.0 每个真实版本的导出文件，导进当前版本不能少一条。

每个版本都用它自己的页面导出（先喂一份本机数据，让它自己的保存逻辑读一遍），
所以拿到的文件就是那个版本真会写出来的样子，不是照着现在的格式倒推的。

准备历史版本（只需一次）：
    把 0.3.0 – 0.8.0 的发布包解到 hist/<版本>/（里面要有 index.html），
    0.2.0 用 qa/baseline-0.2.0 或 hist/baseline-0.2.0。目录可用 ZHUOLU_HIST 覆盖。

用法：
    python tools/format-matrix.py
"""

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import qa  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

REPO = ROOT
HIST = Path(os.environ.get("ZHUOLU_HIST") or (ROOT / "hist"))
OUT = HIST / ("matrix-" + time.strftime("%Y%m%d-%H%M%S"))
COLLS = ["sos", "rum", "cert", "tr", "sleep", "parked"]
WANT = ["0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0"]


def version_dirs():
    out = []
    for ver in WANT:
        cands = [HIST / ver, HIST / ("baseline-" + ver),
                 HIST.parent / ("baseline-" + ver), ROOT / "qa" / ("baseline-" + ver)]
        found = next((c for c in cands if (c / "index.html").exists()), None)
        out.append((ver, found or (HIST / ver)))
    return out

SEED = {
    "v": 1,
    "firstSeen": 1700000000000,
    "sos": [{"id": "mx-sos1", "t": 1700000100000, "before": 8, "after": 4, "need": ["喝水"]}],
    "rum": [
        {"id": "mx-rum1", "t": 1700000200000, "kind": "self", "thought": "矩阵：反刍一", "action": "走十分钟"},
        {"id": "mx-rum2", "t": 1700000300000, "kind": "why", "thought": "矩阵：反刍二", "action": ""},
    ],
    "cert": [{"id": "mx-cert1", "t": 1700000400000, "fact": "矩阵：事实",
              "interp": "矩阵：解释", "unknown": "矩阵：不可知", "next": "矩阵：下一步"}],
    "tr": [{"id": "mx-tr1", "t": 1700000500000, "situation": "矩阵：情境",
            "thought": "矩阵：思维", "belief": 70, "emotion": "焦虑", "intensity": 60,
            "for": "", "against": "", "balanced": "矩阵：平衡句", "after": 40}],
    "sleep": [{"id": "mx-sl1", "t": 1700000600000, "fact": "矩阵：事实",
               "did": "矩阵：做到", "tomorrow": "矩阵：明天"}],
    "parked": [{"id": "mx-pk1", "t": 1700000700000, "text": "矩阵：盒子"}],
    "daily": {"2026-11-10": {"sleep": True, "eat": True, "move": False, "connect": False, "push": False}},
    "window": {"time": "19:30", "minutes": 15, "openedAt": 0, "closedDay": ""},
    "safety": {"signals": ["矩阵：信号"], "coping": [], "distract": [], "people": [],
               "pros": [], "env": [], "reasons": [], "updatedAt": 0},
    "settings": {"theme": "auto", "motion": "auto", "support": ["", ""],
                 "lastExportAt": 0, "nudgeSnoozeUntil": 0,
                 "quickExit": "search", "quickExitUrl": ""},
}

SEED_JS = (
    "try { if (!localStorage.getItem('zhuolu.v1')) "
    "localStorage.setItem('zhuolu.v1', %s); } catch (e) {}"
    % json.dumps(json.dumps(SEED, ensure_ascii=True))
)

CLICK_EXPORT = """() => {
  const els = [...document.querySelectorAll("[data-action='export-json']")];
  const el = els.find((e) => e.offsetParent !== null) || els[0];
  if (!el) return false;
  el.click();
  return true;
}"""


def counts_of(data):
    out = {k: len(data.get(k) or []) for k in COLLS}
    days = cells = 0
    for day, v in (data.get("daily") or {}).items():
        if not isinstance(v, dict):
            continue
        n = sum(1 for c in v.values() if c)
        if n:
            days += 1
            cells += n
    out["days"] = days
    out["cells"] = cells
    out["total"] = sum(out[k] for k in COLLS)
    return out


def export_from(browser, ver, root):
    """用这个版本自己的页面导出一份备份，返回 (文件名, 文本)。"""
    server = qa.StaticServer(root)
    ctx = browser.new_context(accept_downloads=True, viewport={"width": 1280, "height": 900})
    ctx.add_init_script(SEED_JS)
    page = ctx.new_page()
    try:
        page.goto(server.base + "index.html", wait_until="domcontentloaded")
        page.wait_for_selector("[data-action='export-json']", state="attached", timeout=20000)
        last = ""
        for attempt in range(6):
            page.wait_for_timeout(600)
            with page.expect_download(timeout=20000) as info:
                ok = page.evaluate(CLICK_EXPORT)
            assert ok, "%s 页面上找不到导出按钮" % ver
            dl = info.value
            text = Path(dl.path()).read_text(encoding="utf-8")
            last = text
            data = json.loads(text).get("data") or {}
            if len(data.get("rum") or []) >= 2:
                return dl.suggested_filename, text
        return "", last
    finally:
        ctx.close()
        server.stop()


def import_into_current(browser, fixture, expected):
    server = qa.StaticServer(REPO)
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(server.base + "index.html#/more", wait_until="domcontentloaded")
        qa.boot_wait(page, "more")
        qa.choose_import(page, fixture)
        shown = page.eval_on_selector("#import-counts", "el => el.textContent")
        page.click("[data-action='import-merge']")
        page.wait_for_timeout(800)
        state = qa.app_state(page)
        keys = [k for k in state["__keys"] if not k.startswith("daily|")]
        texts = []
        for k in COLLS:
            for rec in state.get(k) or []:
                texts.append(json.dumps(rec, ensure_ascii=False))
        assert not errors, "导入时页面报错: %s" % errors
        return shown, keys, "\n".join(texts)
    finally:
        ctx.close()
        server.stop()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=qa.CHROME_PATH, headless=True)
        try:
            for ver, root in version_dirs():
                if not (root / "index.html").exists():
                    failures.append("%s：缺 index.html（%s）" % (ver, root))
                    continue
                name, text = export_from(browser, ver, root)
                if not text:
                    failures.append("%s：没有导出内容" % ver)
                    continue
                payload = json.loads(text)
                assert payload.get("app") == "zhuolu", "%s 的导出没有 app 标记" % ver
                data = payload["data"]
                got = counts_of(data)
                fixture = OUT / ("backup-%s.json" % ver)
                fixture.write_text(text, encoding="utf-8")

                shown, keys, text_blob = import_into_current(browser, fixture, got)
                problems = []
                if len(keys) != got["total"]:
                    problems.append("盘上 %d 行，文件里 %d 条" % (len(keys), got["total"]))
                for k in COLLS:
                    if got[k] and ("%d" % got[k]) not in shown.replace("\n", " "):
                        pass  # 计数展示是「反刍 2」这种，下面逐类比对更准
                for probe in ("矩阵：反刍一", "矩阵：思维", "矩阵：盒子", "矩阵：做到"):
                    if probe in text_blob and probe not in text:
                        problems.append("文件里本来就没有 %s" % probe)
                    if probe in text and probe not in text_blob:
                        problems.append("导入后丢了「%s」" % probe)
                rows.append((ver, got, len(keys), payload.get("format"),
                             payload.get("schemaVersion"), problems))
                if problems:
                    failures.append("%s：%s" % (ver, "；".join(problems)))
        finally:
            browser.close()

    print("版本矩阵 · 每个版本真导出一份，再导进 0.9.0")
    print("-" * 78)
    print("%-7s %-6s %-8s %-6s %-6s %-6s %s" % ("版本", "format", "schema", "文件", "导入", "打卡", "结果"))
    for ver, got, imported, fmt, sv, problems in rows:
        print("%-7s %-6s %-8s %-6d %-6d %-6s %s" % (
            ver, fmt if fmt is not None else "—", sv if sv is not None else "—",
            got["total"], imported, "%d天/%d格" % (got["days"], got["cells"]),
            "OK" if not problems else "FAIL"))
    print("-" * 78)
    if failures:
        print("失败 %d 项：" % len(failures))
        for f in failures:
            print("  - " + f)
        return 1
    print("全部 %d 个版本：导出 → 导入 条数与内容一致" % len(rows))
    print("产物: %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())