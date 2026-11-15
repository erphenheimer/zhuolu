#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""着陆台（zhuolu）纯前端单文件应用的自动化回归测试。

用法（脚本自己启动本地 HTTP 服务，测试结束自动关闭）：
    python tools/qa.py
    python tools/qa.py --headed
    python tools/qa.py --url http://127.0.0.1:8000/

只写 tools/ 与 D:\document\zhuolu-qa\，不修改应用源码。
每个检查独立 try/except；最后输出 PASS/FAIL 列表与失败详情，退出码 0/1。
"""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import traceback
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError:
    print("缺少 Playwright：先执行 python -m pip install playwright")
    raise SystemExit(2)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_QA_ROOT = Path(r"D:\document\zhuolu-qa")
CHROME_PATH = os.environ.get(
    "ZHUOLU_CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe"
)
KEY = "zhuolu.v1"
ROUTES = ["now", "rumination", "certainty", "today", "review", "safety", "more"]
ROUTE_TITLES = {
    "now": "现在",
    "rumination": "反刍",
    "certainty": "确定性",
    "today": "今日",
    "more": "更多",
}
IOS_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)
MOBILE = {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}
FENCE = chr(96) * 3


# ---------------------------------------------------------------- 工具函数


def now_ms():
    return int(time.time() * 1000)


def today_key():
    return datetime.now().strftime("%Y-%m-%d")


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_port(port, timeout=20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.25):
                return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("本地 HTTP 服务端口 %d 在 %.0f 秒内没有就绪" % (port, timeout))


ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}


def is_local_url(url):
    if url.startswith(("data:", "blob:", "about:", "chrome-extension:", "chrome:", "devtools:")):
        return True
    try:
        host = urllib.parse.urlparse(url).hostname
    except Exception:
        return False
    return host in ALLOWED_HOSTS


def is_http(url):
    return url.startswith("http://") or url.startswith("https://")


def split_base_url(raw):
    raw = raw.strip()
    if raw.endswith(".html"):
        index_url = raw
        base = raw.rsplit("/", 1)[0] + "/"
    else:
        base = raw if raw.endswith("/") else raw + "/"
        index_url = base + "index.html"
    return base, index_url


def http_get(url, timeout=15):
    request = urllib.request.Request(url, headers={"User-Agent": "zhuolu-qa/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.headers.get("Content-Type", ""), response.read()


def visible(page, selector, timeout=8000):
    page.wait_for_selector(selector, state="visible", timeout=timeout)


def hidden(page, selector, timeout=8000):
    page.wait_for_selector(selector, state="hidden", timeout=timeout)


def wait_text(page, selector, needle, timeout=8000):
    page.wait_for_function(
        "([s, t]) => { const el = document.querySelector(s);"
        " return !!el && el.textContent.indexOf(t) >= 0; }",
        arg=[selector, needle],
        timeout=timeout,
    )


def nav(page, route):
    page.evaluate("(r) => { location.hash = '#/' + r; }", route)
    visible(page, ".view[data-view='%s'].is-active" % route)


def app_state(page):
    return page.evaluate(
        "() => { const raw = localStorage.getItem('zhuolu.v1');"
        " return raw ? JSON.parse(raw) : null; }"
    )


def set_range(page, selector, value):
    page.eval_on_selector(
        selector,
        "(el, v) => { el.value = String(v);"
        " el.dispatchEvent(new Event('input', { bubbles: true }));"
        " el.dispatchEvent(new Event('change', { bubbles: true })); }",
        value,
    )


def download_with(page, action):
    with page.expect_download(timeout=15000) as info:
        page.click("[data-action='%s']" % action)
    download = info.value
    path = download.path()
    text = Path(path).read_text(encoding="utf-8") if path else ""
    return download.suggested_filename, text


def choose_import(page, file_path):
    with page.expect_file_chooser(timeout=15000) as chooser:
        page.click("[data-action='import-json']")
    chooser.value.set_files(str(file_path))
    visible(page, "#import-overlay")


def assert_no_overflow(page, label):
    dims = page.evaluate(
        "() => { const de = document.documentElement, b = document.body;"
        " return { sw: de.scrollWidth, cw: de.clientWidth,"
        " bsw: b.scrollWidth, bcw: b.clientWidth }; }"
    )
    assert dims["sw"] <= dims["cw"] + 1, (
        "%s 横向溢出：documentElement.scrollWidth=%s > clientWidth=%s"
        % (label, dims["sw"], dims["cw"])
    )
    assert dims["bsw"] <= dims["bcw"] + 1, (
        "%s 横向溢出：body.scrollWidth=%s > clientWidth=%s"
        % (label, dims["bsw"], dims["bcw"])
    )
    return "scrollWidth=%s clientWidth=%s" % (dims["sw"], dims["cw"])


# ---------------------------------------------------------------- 本地服务


class StaticServer:
    def __init__(self, repo):
        self.port = free_port()
        self.proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "http.server",
                str(self.port),
                "--bind",
                "127.0.0.1",
                "--directory",
                str(repo),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=str(repo),
        )
        wait_port(self.port)
        self.base = "http://127.0.0.1:%d/" % self.port

    def stop(self):
        if not self.proc:
            return
        try:
            self.proc.terminate()
            self.proc.wait(timeout=8)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        self.proc = None


# ---------------------------------------------------------------- 记录器


class Recorder:
    """收集一个 BrowserContext 内的 console error、pageerror 与网络请求。"""

    def __init__(self, context):
        self.console_errors = []
        self.page_errors = []
        self.external_requests = []
        self.bad_local_responses = []
        self.allow_console_noise = False
        context.on("page", self._attach)
        for page in context.pages:
            self._attach(page)

    def _attach(self, page):
        page.on("console", self._on_console)
        page.on("pageerror", self._on_pageerror)
        page.on("request", self._on_request)
        page.on("response", self._on_response)

    def _on_console(self, message):
        if message.type == "error":
            self.console_errors.append(message.text)

    def _on_pageerror(self, error):
        self.page_errors.append(str(error))

    def _on_request(self, request):
        url = request.url
        if is_http(url) and not is_local_url(url):
            self.external_requests.append(url)

    def _on_response(self, response):
        if is_local_url(response.url) and response.status >= 400:
            self.bad_local_responses.append("%s %s" % (response.status, response.url))


# ---------------------------------------------------------------- 运行器


class Runner:
    def __init__(self, base, index_url, out_dir):
        self.base = base
        self.index_url = index_url
        self.out_dir = out_dir
        self.results = []
        self.recorders = []
        self.browser = None
        self.started_at = time.time()
        self.chrome_version = "unknown"
        self.app_version = None
        (out_dir / "failures").mkdir(parents=True, exist_ok=True)
        (out_dir / "fixtures").mkdir(parents=True, exist_ok=True)

    # -- 单个检查：独立 try/except -------------------------------------
    def check(self, group, name, func, page=None):
        started = time.time()
        detail = ""
        ok = True
        try:
            detail = func() or ""
        except Exception as exc:
            ok = False
            detail = "%s: %s" % (type(exc).__name__, exc)
            if page is not None:
                detail = self._with_url(detail, page)
                self._screenshot(page, len(self.results) + 1, name)
        elapsed = time.time() - started
        self.results.append(
            {
                "group": group,
                "name": name,
                "ok": ok,
                "detail": detail,
                "seconds": round(elapsed, 2),
            }
        )
        print("%s  [%s] %s (%.2fs)" % ("PASS" if ok else "FAIL", group, name, elapsed))
        if not ok:
            print("       原因: %s" % detail)
        return ok

    def _with_url(self, detail, page):
        try:
            return "%s（页面: %s）" % (detail, page.url)
        except Exception:
            return detail

    def _screenshot(self, page, index, name):
        safe = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "_", name)[:48].strip("_")
        path = self.out_dir / "failures" / ("%02d-%s.png" % (index, safe or "check"))
        try:
            page.screenshot(path=str(path), timeout=6000)
        except Exception:
            pass

    # -- 测试组：组级异常也要落成一次 FAIL，不中断后续组 ----------------
    def run_group(self, group, func):
        try:
            func(self)
        except Exception as exc:
            detail = "".join(
                traceback.format_exception_only(type(exc), exc)
            ).strip()
            self.results.append(
                {
                    "group": group,
                    "name": "测试组执行中断",
                    "ok": False,
                    "detail": detail,
                    "seconds": 0,
                }
            )
            print("FAIL  [%s] 测试组执行中断" % group)
            print("       原因: %s" % detail)

    def counts(self):
        passed = sum(1 for r in self.results if r["ok"])
        failed = len(self.results) - passed
        return passed, failed, len(self.results)


class Session:
    def __init__(self, run, **options):
        self.run = run
        merged = {"accept_downloads": True}
        merged.update(options)
        self.context = run.browser.new_context(**merged)
        self.recorder = Recorder(self.context)
        run.recorders.append(self.recorder)
        self.page = self.context.new_page()

    def open(self, route="now"):
        url = self.run.index_url + ("#/" + route if route else "")
        self.page.goto(url, wait_until="domcontentloaded")
        if route:
            visible(self.page, ".view[data-view='%s'].is-active" % route)
        return self.page

    def close(self):
        try:
            self.context.close()
        except Exception:
            pass


# ---------------------------------------------------------------- A 加载 / 结构 / 路由


def group_smoke(run):
    session = Session(run, viewport={"width": 1280, "height": 900})
    page = session.open()
    run.check(
        "加载与结构",
        "页面加载无 console error / pageerror",
        lambda: _check_load_errors(page, session.recorder),
        page,
    )
    run.check(
        "加载与结构",
        "5 个视图齐全且默认渲染「现在」",
        lambda: _check_views(page),
        page,
    )

    for route in ROUTES:
        def route_check(route=route):
            if route == "more":
                page.click(".rail .rail__link[href='#/more']")
            else:
                page.click(".rail .nav-item[data-route='%s']" % route)
            visible(page, ".view[data-view='%s'].is-active" % route)
            assert page.evaluate("location.hash") == "#/" + route, (
                "hash 未变为 #/%s，实际 %s" % (route, page.evaluate("location.hash"))
            )
            if route != "more":
                classes = page.get_attribute(
                    ".rail .nav-item[data-route='%s']" % route, "class"
                )
                assert "is-on" in (classes or ""), "侧栏导航未高亮 #/%s" % route
            return "hash=#/%s，视图可见" % route

        run.check(
            "加载与结构",
            "路由 #/%s 切换并渲染" % route,
            route_check,
            page,
        )

    def extra_route_check(route):
        page.evaluate("(r) => { location.hash = '#/' + r; }", route)
        visible(page, ".view[data-view='%s'].is-active" % route)
        assert page.evaluate("location.hash") == "#/" + route, (
            "hash 未变为 #/%s，实际 %s" % (route, page.evaluate("location.hash"))
        )
        return "附加路由 #/%s 可渲染" % route

    present_routes = page.eval_on_selector_all(
        ".view", "els => els.map(el => el.getAttribute('data-view'))"
    )
    for route in [item for item in present_routes if item not in ROUTES]:
        run.check(
            "加载与结构",
            "附加路由 #/%s 可渲染" % route,
            lambda route=route: extra_route_check(route),
            page,
        )

    def refresh_keeps_route():
        page.goto(run.index_url + "#/today", wait_until="domcontentloaded")
        visible(page, ".view[data-view='today'].is-active")
        page.reload(wait_until="domcontentloaded")
        visible(page, ".view[data-view='today'].is-active")
        assert page.evaluate("location.hash") == "#/today", "刷新后 hash 丢失"
        assert page.locator(".view.is-active").count() == 1, "刷新后激活视图不唯一"
        return "刷新后仍为 #/today"

    run.check(
        "加载与结构",
        "刷新后 hash 路由保持",
        refresh_keeps_route,
        page,
    )

    def unknown_hash():
        other = session.context.new_page()
        other.goto(run.index_url + "#/nope", wait_until="domcontentloaded")
        visible(other, ".view[data-view='now'].is-active")
        assert other.locator(".view.is-active").count() == 1, "未知路由下激活视图不唯一"
        assert other.evaluate("location.hash") == "#/nope", "未知 hash 被改写"
        other.close()
        return "未知 hash 回退到「现在」"

    run.check(
        "加载与结构",
        "未知 hash 回退到「现在」",
        unknown_hash,
        page,
    )

    def no_duplicate_ids():
        duplicates = page.evaluate(
            "() => { const seen = {};"
            " document.querySelectorAll('[id]').forEach(el => {"
            " seen[el.id] = (seen[el.id] || 0) + 1; });"
            " return Object.keys(seen).filter(k => seen[k] > 1); }"
        )
        assert not duplicates, "重复 id: %s" % ", ".join(duplicates)
        return "无重复 id（共 %d 个 id）" % page.evaluate(
            "() => document.querySelectorAll('[id]').length"
        )

    run.check(
        "加载与结构",
        "页面无重复 id",
        no_duplicate_ids,
        page,
    )

    def structure_counts():
        counts = {
            "视图": page.locator(".view").count(),
            "侧栏导航": page.locator(".rail .nav-item").count(),
            "底部导航": page.locator(".bnav-item").count(),
            "记录 tab": page.locator("[data-rec-tab]").count(),
            "今日打卡": page.locator("#today-checks .check-row").count(),
            "反刍类型": page.locator("#it-kinds .kind-btn").count(),
            "接地感官": page.locator("#ground-list .ground-row").count(),
            "SOS 步骤": page.locator("#sos-overlay .step").count(),
            "安装卡片": page.locator("#install-card").count(),
        }
        assert counts["视图"] >= 5, "视图数量 %s，期望至少 5" % counts["视图"]
        assert counts["侧栏导航"] >= 4, "侧栏导航数量 %s，期望至少 4" % counts["侧栏导航"]
        assert counts["底部导航"] >= 5, "底部导航数量 %s，期望至少 5" % counts["底部导航"]
        for route in ROUTES:
            assert page.locator(".view[data-view='%s']" % route).count() == 1, (
                "基线视图 %s 不存在或重复" % route
            )
            assert page.locator("[data-route='%s']" % route).count() >= 1, (
                "基线路由 %s 缺少导航入口" % route
            )
        expected = {
            "记录 tab": 5,
            "今日打卡": 5,
            "反刍类型": 5,
            "接地感官": 5,
            "SOS 步骤": 5,
            "安装卡片": 1,
        }
        for key, want in expected.items():
            assert counts[key] == want, "%s 数量 %s，期望 %s" % (
                key,
                counts[key],
                want,
            )
        return "视图/导航/打卡/tab/步骤数量均符合"

    run.check(
        "加载与结构",
        "核心结构元素数量正确",
        structure_counts,
        page,
    )

    def title_and_version():
        assert "着陆台" in page.title(), "标题缺少「着陆台」: %s" % page.title()
        nav(page, "more")
        text = page.inner_text("body")
        match = re.search(r"开源版本 v(\d+\.\d+\.\d+)", text)
        assert match, "「更多」页缺少「开源版本 vX.Y.Z」标识"
        run.app_version = match.group(1)
        nav(page, "now")
        assert "使用第" in page.inner_text("#topbar-date"), "顶栏缺少使用天数"
        return "标题、版本号 v%s、使用天数均存在" % run.app_version

    run.check(
        "加载与结构",
        "页面标题与版本标识",
        title_and_version,
        page,
    )

    def no_external_requests():
        assert not session.recorder.external_requests, "外部请求: %s" % ", ".join(
            session.recorder.external_requests[:5]
        )
        return "0 个非 127.0.0.1/localhost 请求"

    run.check(
        "加载与结构",
        "无外部网络请求",
        no_external_requests,
        page,
    )

    def no_bad_local_resources():
        assert not session.recorder.bad_local_responses, "本地资源 4xx/5xx: %s" % ", ".join(
            session.recorder.bad_local_responses[:5]
        )
        return "本地资源无 4xx/5xx"

    run.check(
        "加载与结构",
        "本地资源无 4xx/5xx",
        no_bad_local_resources,
        page,
    )
    session.close()


def _check_load_errors(page, recorder):
    page.wait_for_load_state("networkidle")
    messages = ["console: " + m for m in recorder.console_errors] + [
        "pageerror: " + m for m in recorder.page_errors
    ]
    assert not messages, "；".join(messages[:5])
    return "console error 0，pageerror 0"


def _check_views(page):
    views = page.eval_on_selector_all(
        ".view", "els => els.map(el => el.getAttribute('data-view'))"
    )
    missing = [route for route in ROUTES if route not in views]
    assert not missing, "缺少基线视图: %s（实际 %s）" % (missing, views)
    active = page.eval_on_selector_all(
        ".view.is-active", "els => els.map(el => el.getAttribute('data-view'))"
    )
    assert active == ["now"], "初始激活视图应为 now，实际 %s" % active
    return "%d 个基线视图齐全（页面共 %d 个），初始激活 now" % (len(ROUTES), len(views))


# ---------------------------------------------------------------- B SOS 着陆


def group_sos(run):
    session = Session(run, **MOBILE)
    page = session.open("now")
    run.check(
        "SOS 着陆",
        "打开 SOS 浮层并锁定滚动",
        lambda: _sos_open(page),
        page,
    )
    run.check(
        "SOS 着陆",
        "跳过呼吸进入接地，点击计数生效",
        lambda: _sos_ground(page),
        page,
    )
    run.check(
        "SOS 着陆",
        "完成 4 步进入结果页（强度 7→4）",
        lambda: _sos_finish(page),
        page,
    )
    run.check(
        "SOS 着陆",
        "关闭浮层后写入 localStorage",
        lambda: _sos_closed(page),
        page,
    )
    run.check(
        "SOS 着陆",
        "刷新后着陆记录仍显示在「更多→着陆」",
        lambda: _sos_persisted(page),
        page,
    )
    run.check(
        "SOS 着陆",
        "Esc 可关闭 SOS 浮层",
        lambda: _sos_escape(page),
        page,
    )
    run.check(
        "SOS 着陆",
        "「再来一轮」重置回首步",
        lambda: _sos_restart(page),
        page,
    )
    session.close()


def _sos_open(page):
    page.click(".sos")
    visible(page, "#sos-overlay")
    assert page.locator("[data-sos-step='1'].is-on").count() == 1, "第 1 步未激活"
    assert page.evaluate("document.body.classList.contains('is-locked')"), "未锁定滚动"
    assert "1 / 4" in page.inner_text("#sos-kicker"), "步骤指示不是 1 / 4"
    return "浮层可见，第 1 步，body.is-locked"


def _sos_ground(page):
    page.click("[data-sos-step='1'] [data-action='sos-skip-breath']")
    visible(page, "[data-sos-step='3'].is-on")
    row = ".ground-row[data-sense='see']"
    page.click(row)
    page.click(row)
    dots = page.locator(row + " .ground-dots i.is-on").count()
    assert dots == 2, "接地「看」点数 %s，期望 2" % dots
    return "跳过呼吸到第 3 步，看/5 点击 2 次"


def _sos_finish(page):
    page.click("[data-sos-step='3'] [data-action='sos-next']")
    visible(page, "[data-sos-step='4'].is-on")
    page.click("#sos-need [data-need='被抱一下']")
    set_range(page, "#sos-after", "4")
    wait_text(page, "#sos-after-num", "4")
    page.click("[data-sos-step='4'] [data-action='sos-finish']")
    visible(page, "[data-sos-step='5'].is-on")
    wait_text(page, "#sos-delta", "降了 3 分")
    assert page.inner_text("#sos-delta-before") == "7", "结果页起始强度不是 7"
    assert page.inner_text("#sos-delta-after") == "4", "结果页结束强度不是 4"
    return "结果页显示 7→4，降 3 分"


def _sos_closed(page):
    page.click("[data-sos-step='5'] [data-action='close-sos']")
    hidden(page, "#sos-overlay")
    assert not page.evaluate("document.body.classList.contains('is-locked')"), "关闭后仍锁定滚动"
    state = app_state(page)
    assert state and len(state.get("sos", [])) == 1, "localStorage.sos 数量不是 1"
    entry = state["sos"][0]
    assert entry["before"] == 7 and entry["after"] == 4, "保存的强度不是 7→4: %s" % entry
    assert "被抱一下" in (entry.get("need") or []), "未保存选择的「需要」"
    return "sos 记录已保存 7→4，需要=被抱一下"


def _sos_persisted(page):
    page.reload(wait_until="domcontentloaded")
    visible(page, ".view[data-view='now'].is-active")
    nav(page, "more")
    page.click("[data-rec-tab='sos']")
    visible(page, "[data-rec-panel='sos'].is-on")
    wait_text(page, "#rec-sos", "强度 7 → 4")
    text = page.inner_text("#rec-sos")
    assert "被抱一下" in text, "记录未显示需要标签"
    return "刷新后「着陆」tab 显示强度 7 → 4"


def _sos_escape(page):
    nav(page, "now")
    page.click(".topbar [data-action='open-sos']")
    visible(page, "#sos-overlay")
    page.keyboard.press("Escape")
    hidden(page, "#sos-overlay")
    assert not page.evaluate("document.body.classList.contains('is-locked')"), "Esc 关闭后仍锁定"
    return "Esc 关闭浮层并解锁滚动"


def _sos_restart(page):
    page.click(".sos")
    visible(page, "#sos-overlay")
    page.click("[data-sos-step='1'] [data-action='sos-skip-breath']")
    visible(page, "[data-sos-step='3'].is-on")
    page.click("[data-sos-step='3'] [data-action='sos-next']")
    visible(page, "[data-sos-step='4'].is-on")
    page.click("[data-sos-step='4'] [data-action='sos-finish']")
    visible(page, "[data-sos-step='5'].is-on")
    page.click("[data-action='sos-restart']")
    visible(page, "[data-sos-step='1'].is-on")
    assert page.inner_text("#sos-before-num") == "7", "重置后起始强度不是 7"
    page.keyboard.press("Escape")
    hidden(page, "#sos-overlay")
    return "结果页「再来一轮」回到第 1 步且强度重置为 7"


# ---------------------------------------------------------------- C 反刍


def group_rumination(run):
    session = Session(run, **MOBILE)
    page = session.open("rumination")
    run.check(
        "反刍",
        "登记一条念头并保存",
        lambda: _rum_save(page),
        page,
    )
    run.check(
        "反刍",
        "反刍日志显示记录与今日计数",
        lambda: _rum_list(page),
        page,
    )
    run.check(
        "反刍",
        "存一个念头进盒子",
        lambda: _park_save(page),
        page,
    )
    run.check(
        "反刍",
        "担忧窗口时间保存",
        lambda: _window_time(page),
        page,
    )
    run.check(
        "反刍",
        "担忧窗口开 / 关状态",
        lambda: _window_open_close(page),
        page,
    )
    run.check(
        "反刍",
        "刷新后盒子与窗口时间保留",
        lambda: _rum_persisted(page),
        page,
    )
    session.close()


def _rum_save(page):
    page.click("[data-action='start-intercept']")
    visible(page, "#intercept-overlay")
    page.fill("#it-thought", "我是不是把这件事搞砸了")
    page.click("#it-kinds [data-kind='why']")
    page.click("[data-action='it-next']")
    visible(page, "[data-it-step='2'].is-on")
    assert "为什么" in page.inner_text("#it-answer-title"), "第 2 步答案标题异常"
    page.fill("#it-action", "明天先问一句，不猜")
    page.click("[data-action='it-save']")
    visible(page, "[data-it-step='3'].is-on")
    wait_text(page, "#it-done-text", "它今天来过 1 次")
    page.click("[data-it-step='3'] [data-action='close-intercept']")
    hidden(page, "#intercept-overlay")
    state = app_state(page)
    assert state and len(state.get("rum", [])) == 1, "rum 记录数量不是 1"
    entry = state["rum"][0]
    assert entry["thought"] == "我是不是把这件事搞砸了", "念头文本未保存"
    assert entry["kind"] == "why", "类型未保存"
    return "rum 记录已保存（why，含下一步）"


def _rum_list(page):
    wait_text(page, "#rum-list", "我是不是把这件事搞砸了")
    count = page.inner_text("#rum-count")
    assert "今天 1 次" in count, "今日计数异常: %s" % count
    return "日志与「今天 1 次」均显示"


def _park_save(page):
    page.click("[data-action='park-thought']")
    visible(page, "#park-form")
    page.fill("#park-text", "先把这个念头放进盒子")
    page.click("[data-action='save-park']")
    hidden(page, "#park-form")
    state = app_state(page)
    assert state and len(state.get("parked", [])) == 1, "parked 数量不是 1"
    assert "先把这个念头放进盒子" == state["parked"][0]["text"], "盒子文本未保存"
    wait_text(page, "#parked-hint", "1 个念头")
    return "盒子 1 条，提示文案已更新"


def _window_time(page):
    page.click("[data-action='toggle-window-edit']")
    visible(page, "#window-edit")
    page.fill("#window-time-input", "20:15")
    page.click("[data-action='save-window']")
    wait_text(page, "#window-time", "20:15")
    state = app_state(page)
    assert state["window"]["time"] == "20:15", "window.time 未保存: %s" % state["window"]
    return "担忧窗口时间保存为 20:15"


def _window_open_close(page):
    page.click("[data-action='open-window']")
    visible(page, "#window-timer")
    countdown = page.inner_text("#window-countdown")
    assert re.match(r"^\d{2}:\d{2}$", countdown), "倒计时格式异常: %s" % countdown
    page.click("[data-action='close-window']")
    hidden(page, "#window-timer")
    status = page.inner_text("#window-status")
    assert "未到时间" in status, "关闭后状态异常: %s" % status
    assert "20:15" in status, "关闭后未显示窗口时间"
    return "开窗倒计时 %s，关窗后状态=未到时间" % countdown


def _rum_persisted(page):
    page.reload(wait_until="domcontentloaded")
    visible(page, ".view[data-view='rumination'].is-active")
    assert page.inner_text("#window-time") == "20:15", "刷新后窗口时间丢失"
    wait_text(page, "#parked-hint", "1 个念头")
    state = app_state(page)
    assert len(state["rum"]) == 1 and len(state["parked"]) == 1, "刷新后记录数量异常"
    return "刷新后 rum=1、parked=1、窗口时间=20:15"


# ---------------------------------------------------------------- D 确定性


def group_certainty(run):
    session = Session(run, **MOBILE)
    page = session.open("certainty")
    run.check(
        "确定性",
        "四格输入保存",
        lambda: _cert_save(page),
        page,
    )
    run.check(
        "确定性",
        "已存列表显示四行摘要",
        lambda: _cert_list(page),
        page,
    )
    run.check(
        "确定性",
        "删除已存整理",
        lambda: _cert_delete(page),
        page,
    )
    session.close()


def _cert_save(page):
    page.fill("#cert-fact", "事实：他三天没回消息")
    page.fill("#cert-interp", "解释：他讨厌我了")
    page.fill("#cert-unknown", "不可知：他真实的想法")
    page.fill("#cert-next", "下一步：明天中午发一句问候")
    page.click("[data-action='save-cert']")
    wait_text(page, "#cert-count", "1 份")
    state = app_state(page)
    assert state and len(state.get("cert", [])) == 1, "cert 记录数量不是 1"
    entry = state["cert"][0]
    for key, want in (
        ("fact", "事实：他三天没回消息"),
        ("interp", "解释：他讨厌我了"),
        ("unknown", "不可知：他真实的想法"),
        ("next", "下一步：明天中午发一句问候"),
    ):
        assert entry[key] == want, "%s 未保存: %s" % (key, entry[key])
    for selector in ("#cert-fact", "#cert-interp", "#cert-unknown", "#cert-next"):
        assert page.input_value(selector) == "", "保存后 %s 未清空" % selector
    return "四格均写入 localStorage 且输入框已清空"


def _cert_list(page):
    assert page.locator("#cert-list li.item").count() == 1, "已存列表不是 1 条"
    text = page.inner_text("#cert-list")
    for needle in ("事实：他三天没回消息", "解释：他讨厌我了", "不可知：他真实的想法", "下一步：明天中午发一句问候"):
        assert needle in text, "列表缺少: %s" % needle
    return "列表显示事实/解释/不可知/下一步四行"


def _cert_delete(page):
    page.click("#cert-list [data-action='del-cert']")
    page.wait_for_function(
        "() => document.querySelectorAll('#cert-list li.item').length === 0"
    )
    state = app_state(page)
    assert len(state["cert"]) == 0, "删除后 cert 数量不为 0"
    wait_text(page, "#cert-list", "还没有存过整理")
    return "删除后列表为空，存储同步清空"


# ---------------------------------------------------------------- E 今日


def group_today(run):
    session = Session(run, **MOBILE)
    page = session.open("today")
    run.check(
        "今日",
        "5 项打卡可切换并更新进度",
        lambda: _today_checks(page),
        page,
    )
    run.check(
        "今日",
        "7 天格显示且今日计数正确",
        lambda: _today_week(page),
        page,
    )
    run.check(
        "今日",
        "5 分钟计时开始",
        lambda: _today_timer_start(page),
        page,
    )
    run.check(
        "今日",
        "计时归零",
        lambda: _today_timer_reset(page),
        page,
    )
    run.check(
        "今日",
        "睡前 3 行保存",
        lambda: _today_sleep(page),
        page,
    )
    run.check(
        "今日",
        "最小一步分类与「换一个」",
        lambda: _today_step(page),
        page,
    )
    run.check(
        "今日",
        "刷新后打卡状态保留",
        lambda: _today_reload(page),
        page,
    )
    session.close()


def _today_checks(page):
    for key in ("sleep", "eat", "move", "connect", "push"):
        page.click("#today-checks [data-check='%s']" % key)
    wait_text(page, "#today-progress", "已做到 5 件")
    state = app_state(page)
    daily = state["daily"][today_key()]
    for key in ("sleep", "eat", "move", "connect", "push"):
        assert daily[key] is True, "打卡 %s 未保存为 true" % key
    assert page.get_attribute("#today-checks [data-check='sleep']", "aria-checked") == "true", (
        "打卡 aria-checked 未更新"
    )
    page.click("#today-checks [data-check='sleep']")
    wait_text(page, "#today-progress", "已做到 4 件")
    assert app_state(page)["daily"][today_key()]["sleep"] is False, "取消打卡未保存"
    assert page.get_attribute("#today-checks [data-check='sleep']", "aria-checked") == "false", (
        "取消打卡 aria-checked 未更新"
    )
    return "5/5 → 取消 1 项 → 4/5，存储与 aria 同步"


def _today_week(page):
    assert page.locator("#week .week__day").count() == 7, "7 天格数量不是 7"
    dot = page.inner_text("#week .week__day.is-today .week__dot")
    assert dot == "4", "今日格计数是 %s，期望 4" % dot
    title = page.get_attribute("#week .week__day.is-today .week__dot", "title") or ""
    assert "做到 4 件" in title, "今日格 title 异常: %s" % title
    return "7 天格，今日显示 4 件"


def _today_timer_start(page):
    page.click("[data-action='timer-start']")
    page.wait_for_function(
        "() => document.querySelector('#today-timer').textContent !== '05:00'",
        timeout=5000,
    )
    label = page.inner_text("[data-action='timer-start']")
    assert label == "暂停", "计时开始后按钮应为「暂停」，实际 %s" % label
    value = page.inner_text("#today-timer")
    assert re.match(r"^0[45]:\d{2}$", value), "倒计时格式异常: %s" % value
    width = page.eval_on_selector("#today-bar", "el => el.style.width")
    assert width not in ("", "0%"), "进度条未前进: %s" % width
    return "倒计时 %s，按钮=暂停，进度条 %s" % (value, width)


def _today_timer_reset(page):
    page.click("[data-action='timer-reset']")
    wait_text(page, "#today-timer", "05:00")
    assert page.inner_text("[data-action='timer-start']") == "开始", "归零后按钮不是「开始」"
    width = page.eval_on_selector("#today-bar", "el => el.style.width")
    assert width in ("", "0%"), "归零后进度条未复位: %s" % width
    return "归零到 05:00，按钮=开始"


def _today_sleep(page):
    page.fill("#sleep-fact", "今天发生的事实")
    page.fill("#sleep-did", "今天做到的一件")
    page.fill("#sleep-tomorrow", "明天最小的一件")
    page.click("[data-action='save-sleep']")
    wait_text(page, "#sleep-last", "上次收工")
    state = app_state(page)
    assert len(state["sleep"]) == 1, "sleep 记录数量不是 1"
    entry = state["sleep"][0]
    assert entry["did"] == "今天做到的一件", "睡前记录未保存"
    for selector in ("#sleep-fact", "#sleep-did", "#sleep-tomorrow"):
        assert page.input_value(selector) == "", "保存后 %s 未清空" % selector
    return "睡前 3 行写入 localStorage，输入框已清空"


def _today_step(page):
    before = page.inner_text("#step-text")
    page.click("#step-chips [data-step-cat='连接']")
    page.wait_for_function(
        "(old) => document.querySelector('#step-text').textContent !== old",
        arg=before,
        timeout=5000,
    )
    after = page.inner_text("#step-text")
    assert after.strip(), "分类切换后步骤文案为空"
    classes = page.get_attribute("#step-chips [data-step-cat='连接']", "class") or ""
    assert "is-on" in classes, "「连接」chip 未高亮"
    page.click("[data-action='shuffle-step']")
    page.wait_for_function(
        "(old) => document.querySelector('#step-text').textContent !== old",
        arg=after,
        timeout=5000,
    )
    shuffled = page.inner_text("#step-text")
    assert shuffled.strip() and shuffled != after, "「换一个」没有换文案"
    return "分类切换到连接，「换一个」更新文案"


def _today_reload(page):
    page.reload(wait_until="domcontentloaded")
    visible(page, ".view[data-view='today'].is-active")
    wait_text(page, "#today-progress", "已做到 4 件")
    state = app_state(page)
    assert state["daily"][today_key()]["sleep"] is False, "刷新后打卡状态丢失"
    wait_text(page, "#sleep-last", "上次收工")
    assert page.inner_text("#today-timer") == "05:00", "刷新后计时器未复位"
    return "刷新后 4/5、睡前记录仍在，计时器复位"


# ---------------------------------------------------------------- F 更多 / 设置


def group_more(run):
    session = Session(run, **MOBILE)
    page = session.open("more")
    run.check(
        "更多",
        "记录 5 个 tab 切换",
        lambda: _more_tabs(page),
        page,
    )
    run.check(
        "更多",
        "思维记录保存",
        lambda: _more_tr(page),
        page,
    )
    run.check(
        "更多",
        "支持网保存",
        lambda: _more_support(page),
        page,
    )
    run.check(
        "更多",
        "主题切换生效",
        lambda: _more_theme(page),
        page,
    )
    run.check(
        "更多",
        "动效切换生效",
        lambda: _more_motion(page),
        page,
    )
    run.check(
        "更多",
        "安装卡片提示渲染",
        lambda: _more_install(page),
        page,
    )
    run.check(
        "更多",
        "导出 Markdown 触发下载",
        lambda: _more_export_md(page),
        page,
    )
    session.close()


def _more_tabs(page):
    for key in ("rum", "cert", "tr", "sleep", "sos"):
        page.click("[data-rec-tab='%s']" % key)
        visible(page, "[data-rec-panel='%s'].is-on" % key)
        assert page.get_attribute("[data-rec-tab='%s']" % key, "aria-selected") == "true", (
            "%s tab 的 aria-selected 不是 true" % key
        )
        assert page.locator("[data-rec-panel].is-on").count() == 1, "同时激活多个面板"
    return "5 个 tab 均能切换，aria-selected 同步"


def _more_tr(page):
    page.fill("#tr-situation", "情境：开会时被点名")
    page.fill("#tr-thought", "自动思维：我肯定说错了")
    set_range(page, "#tr-belief", "60")
    set_range(page, "#tr-intensity", "30")
    page.fill("#tr-emotion", "慌")
    page.fill("#tr-for", "支持它的证据")
    page.fill("#tr-against", "反对它的证据")
    page.fill("#tr-balanced", "平衡句：我只是紧张")
    set_range(page, "#tr-after", "20")
    page.click("[data-action='save-tr']")
    wait_text(page, "#rec-tr", "自动思维：我肯定说错了")
    state = app_state(page)
    assert len(state["tr"]) == 1, "tr 记录数量不是 1"
    entry = state["tr"][0]
    assert entry["thought"] == "自动思维：我肯定说错了", "自动思维未保存"
    assert (entry["belief"], entry["intensity"], entry["after"]) == (60, 30, 20), (
        "信念/强度/之后强度未保存: %s" % entry
    )
    return "思维记录写入 localStorage（60/30/20）"


def _more_support(page):
    page.fill("#support-name-1", "朋友甲")
    page.fill("#support-name-2", "朋友乙")
    page.click("[data-action='save-support']")
    wait_text(page, "#support-saved", "已保存")
    support = app_state(page)["settings"]["support"]
    assert support == ["朋友甲", "朋友乙"], "支持网未保存: %s" % support
    return "支持网保存为 [朋友甲, 朋友乙]"


def _more_theme(page):
    page.select_option("#setting-theme", "dark")
    page.wait_for_function(
        "() => document.documentElement.getAttribute('data-theme') === 'dark'"
    )
    assert app_state(page)["settings"]["theme"] == "dark", "主题 dark 未写入存储"
    page.select_option("#setting-theme", "light")
    page.wait_for_function(
        "() => document.documentElement.getAttribute('data-theme') === 'light'"
    )
    assert app_state(page)["settings"]["theme"] == "light", "主题 light 未写入存储"
    return "data-theme 与 localStorage 均随 dark/light 切换"


def _more_motion(page):
    page.select_option("#setting-motion", "reduce")
    page.wait_for_function(
        "() => document.documentElement.getAttribute('data-motion') === 'reduce'"
    )
    assert app_state(page)["settings"]["motion"] == "reduce", "减少动效未写入存储"
    page.select_option("#setting-motion", "auto")
    page.wait_for_function(
        "() => localStorage.getItem('zhuolu.v1') &&"
        " JSON.parse(localStorage.getItem('zhuolu.v1')).settings.motion === 'auto'"
    )
    return "data-motion=reduce 生效，auto 已写回存储"


def _more_install(page):
    visible(page, "#install-card")
    tip = page.inner_text("#install-tip").strip()
    badge = page.inner_text("#install-badge").strip()
    assert len(tip) > 5, "安装提示文案为空"
    assert badge, "安装徽标为空"
    return "安装卡片可见，徽标=%s" % badge


def _more_export_md(page):
    filename, text = download_with(page, "export-md")
    assert re.match(r"^zhuolu-\d{4}-\d{2}-\d{2}\.md$", filename), "Markdown 文件名异常: %s" % filename
    for needle in ("# 着陆台 · 记录导出", "## 思维记录", "自动思维：我肯定说错了"):
        assert needle in text, "Markdown 缺少内容: %s" % needle
    return "下载 %s，内容含思维记录" % filename


# ---------------------------------------------------------------- G 导出 / 导入


def write_fixtures(fixtures_dir):
    stamp = now_ms()
    data = {
        "v": 1,
        "firstSeen": stamp - 86400000,
        "sos": [],
        "rum": [
            {
                "id": "import-rum-1",
                "t": stamp - 1000,
                "thought": "导入的反刍念头",
                "kind": "why",
                "action": "导入的下一步",
            }
        ],
        "cert": [
            {
                "id": "import-cert-1",
                "t": stamp - 2000,
                "fact": "导入事实",
                "interp": "导入解释",
                "unknown": "导入不可知",
                "next": "导入下一步",
            }
        ],
        "tr": [
            {
                "id": "import-tr-1",
                "t": stamp - 3000,
                "situation": "导入情境",
                "thought": "导入思维",
                "belief": 70,
                "emotion": "慌",
                "intensity": 60,
                "for": "支持",
                "against": "反对",
                "balanced": "平衡",
                "after": 40,
            }
        ],
        "sleep": [
            {
                "id": "import-sleep-1",
                "t": stamp - 4000,
                "fact": "导入睡前事实",
                "did": "导入睡前做到",
                "tomorrow": "导入睡前明天",
            }
        ],
        "parked": [
            {"id": "import-parked-1", "t": stamp - 5000, "text": "导入盒子念头"}
        ],
        "daily": {
            "2026-01-02": {
                "sleep": True,
                "eat": True,
                "move": False,
                "connect": False,
                "push": False,
            }
        },
        "window": {"time": "21:00", "minutes": 15, "openedAt": 0, "closedDay": ""},
        "settings": {
            "theme": "auto",
            "motion": "auto",
            "support": ["甲", "乙"],
            "lastExportAt": 0,
        },
    }
    wrapped = {
        "app": "zhuolu",
        "schemaVersion": 1,
        "appVersion": "0.2.0",
        "exportedAt": "2026-01-02T03:04:05.000Z",
        "data": data,
    }
    raw = json.loads(json.dumps(data))
    raw["rum"] = [
        {
            "id": "raw-rum-1",
            "t": stamp - 6000,
            "thought": "原始状态念头",
            "kind": "if",
            "action": "",
        }
    ]
    raw["cert"] = []
    raw["tr"] = []
    raw["sleep"] = []
    raw["parked"] = []
    raw["daily"] = {}
    paths = {
        "wrapped": fixtures_dir / "backup-wrapped.json",
        "raw": fixtures_dir / "raw-state.json",
        "bad": fixtures_dir / "bad.txt",
    }
    paths["wrapped"].write_text(
        json.dumps(wrapped, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    paths["raw"].write_text(
        json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    paths["bad"].write_text("这不是 JSON 备份", encoding="utf-8")
    return paths


def _seed_export_state(page):
    stamp = now_ms()
    today = today_key()
    state = {
        "v": 1,
        "firstSeen": stamp - 86400000,
        "sos": [],
        "rum": [
            {
                "id": "seed-rum",
                "t": stamp - 1000,
                "thought": "导出校验：反刍",
                "kind": "why",
                "action": "导出校验：下一步",
            }
        ],
        "cert": [],
        "tr": [
            {
                "id": "seed-tr",
                "t": stamp - 2000,
                "situation": "导出校验：情境",
                "thought": "导出校验：思维",
                "belief": 70,
                "emotion": "慌",
                "intensity": 60,
                "for": "支持",
                "against": "反对",
                "balanced": "平衡",
                "after": 40,
            }
        ],
        "sleep": [
            {
                "id": "seed-sleep",
                "t": stamp - 3000,
                "fact": "导出校验：事实",
                "did": "导出校验：做到",
                "tomorrow": "导出校验：明天",
            }
        ],
        "parked": [
            {"id": "seed-parked", "t": stamp - 4000, "text": "导出校验：盒子"}
        ],
        "daily": {
            today: {
                "sleep": True,
                "eat": True,
                "move": False,
                "connect": False,
                "push": False,
            }
        },
        "window": {"time": "18:45", "minutes": 20, "openedAt": 0, "closedDay": ""},
        "settings": {
            "theme": "light",
            "motion": "auto",
            "support": ["甲", "乙"],
            "lastExportAt": 0,
        },
    }
    page.evaluate(
        "s => localStorage.setItem('zhuolu.v1', JSON.stringify(s))", state
    )
    page.reload(wait_until="domcontentloaded")
    visible(page, ".view[data-view='more'].is-active")
    nav(page, "certainty")
    page.fill("#cert-fact", "导出校验：刚才写入的事实")
    page.fill("#cert-interp", "导出校验：刚才写入的解释")
    page.fill("#cert-unknown", "导出校验：刚才写入的不可知")
    page.fill("#cert-next", "导出校验：刚才写入的下一步")
    page.click("[data-action='save-cert']")
    wait_text(page, "#cert-count", "1 份")
    nav(page, "more")
    state = app_state(page)
    assert len(state["cert"]) == 1, "导出前写入的确定性记录未保存"
    assert len(state["rum"]) == 1, "导出前种子数据缺失"
    return "种子状态 + UI 写入确定性四格"

def group_export_import(run):
    fixtures = write_fixtures(run.out_dir / "fixtures")
    export_session = Session(run, **MOBILE)
    page = export_session.open("more")
    holder = {}
    run.check(
        "导出/导入",
        "导出前写入待导出记录",
        lambda: _seed_export_state(page),
        page,
    )
    run.check(
        "导出/导入",
        "导出 JSON 触发下载且文件名正确",
        lambda: _export_download(page, holder),
        page,
    )
    run.check(
        "导出/导入",
        "导出 JSON 顶层结构正确",
        lambda: _export_structure(run, holder),
        page,
    )
    run.check(
        "导出/导入",
        "导出内容包含已写入记录",
        lambda: _export_content(holder, page),
        page,
    )
    run.check(
        "导出/导入",
        "导出后「上次导出」时间更新",
        lambda: _export_note(page, holder),
        page,
    )
    export_session.close()

    import_session = Session(run, **MOBILE)
    import_page = import_session.open("more")
    run.check(
        "导出/导入",
        "导入 wrapper 备份显示预览",
        lambda: _import_preview(import_page, fixtures["wrapped"]),
        import_page,
    )
    run.check(
        "导出/导入",
        "合并导入生效",
        lambda: _import_merge(import_page),
        import_page,
    )
    run.check(
        "导出/导入",
        "重复合并去重",
        lambda: _import_dedupe(import_page, fixtures["wrapped"]),
        import_page,
    )
    import_session.close()

    raw_session = Session(run, **MOBILE)
    raw_page = raw_session.open("more")
    run.check(
        "导出/导入",
        "导入原始 state（无 wrapper）生效",
        lambda: _import_raw(raw_page, fixtures["raw"]),
        raw_page,
    )
    raw_session.close()

    overwrite_session = Session(run, **MOBILE)
    overwrite_page = overwrite_session.open("more")
    run.check(
        "导出/导入",
        "覆盖导入替换现有数据",
        lambda: _import_overwrite(overwrite_page, fixtures["wrapped"]),
        overwrite_page,
    )
    run.check(
        "导出/导入",
        "非法文件被拒绝",
        lambda: _import_invalid(overwrite_page, fixtures["bad"]),
        overwrite_page,
    )
    overwrite_session.close()


def _export_download(page, holder):
    with page.expect_download(timeout=15000) as info:
        page.click(".data-actions [data-action='export-json']")
    download = info.value
    filename = download.suggested_filename
    path = download.path()
    assert path, "下载没有落盘路径"
    text = Path(path).read_text(encoding="utf-8")
    holder["filename"] = filename
    holder["text"] = text
    assert re.match(r"^zhuolu-backup-\d{4}-\d{2}-\d{2}\.json$", filename), (
        "JSON 文件名异常: %s" % filename
    )
    assert len(text) > 200, "导出文件内容过短"
    return "下载 %s（%d 字节）" % (filename, len(text.encode("utf-8")))


def _export_structure(run, holder):
    assert holder.get("text"), "未取得导出内容"
    payload = json.loads(holder["text"])
    holder["payload"] = payload
    expected = {"app", "schemaVersion", "appVersion", "exportedAt", "data"}
    assert set(payload.keys()) == expected, "顶层字段异常: %s" % sorted(payload.keys())
    assert payload["app"] == "zhuolu", "app 不是 zhuolu"
    assert payload["schemaVersion"] == 1, "schemaVersion 不是 1"
    assert re.match(r"^\d+\.\d+\.\d+$", str(payload["appVersion"])), (
        "appVersion 格式异常: %s" % payload["appVersion"]
    )
    if run.app_version:
        assert payload["appVersion"] == run.app_version, (
            "导出 appVersion=%s 与页面版本 %s 不一致"
            % (payload["appVersion"], run.app_version)
        )
    try:
        datetime.fromisoformat(str(payload["exportedAt"]).replace("Z", "+00:00"))
    except ValueError as exc:
        raise AssertionError("exportedAt 不是 ISO 时间: %s" % payload["exportedAt"]) from exc
    assert isinstance(payload["data"], dict), "data 不是对象"
    assert payload["data"].get("v") == 1, "data.v 不是 1"
    return "字段齐全，appVersion=%s" % payload["appVersion"]


def _export_content(holder, page):
    payload = holder.get("payload")
    assert payload, "未取得导出 payload"
    data = payload["data"]
    assert len(data["cert"]) == 1 and data["cert"][0]["fact"] == "导出校验：刚才写入的事实", (
        "导出的 cert 不含刚才写入的四格"
    )
    assert data["rum"][0]["thought"] == "导出校验：反刍", "导出的 rum 不含种子记录"
    assert data["tr"][0]["thought"] == "导出校验：思维", "导出的 tr 不含种子记录"
    assert data["sleep"][0]["did"] == "导出校验：做到", "导出的 sleep 不含种子记录"
    assert data["parked"][0]["text"] == "导出校验：盒子", "导出的 parked 不含种子记录"
    assert data["settings"]["support"] == ["甲", "乙"], "导出的支持网不正确"
    assert data["window"]["time"] == "18:45", "导出的窗口时间不正确"
    assert data["daily"][today_key()]["sleep"] is True, "导出的今日打卡不正确"
    return "cert/rum/tr/sleep/parked/设置/打卡均出现在 data 中"


def _export_note(page, holder):
    wait_text(page, "#export-note", "上次导出")
    state = app_state(page)
    assert state["settings"]["lastExportAt"] > 0, "lastExportAt 未写入 localStorage"
    payload = holder.get("payload") or {}
    assert payload.get("data", {}).get("settings", {}).get("lastExportAt", 0) > 0, (
        "导出 payload 里的 lastExportAt 未更新"
    )
    return "页面提示与存储中的 lastExportAt 均已更新"


def _import_preview(page, fixture):
    choose_import(page, fixture)
    meta = page.inner_text("#import-meta")
    counts = page.inner_text("#import-counts")
    assert "backup-wrapped.json" in meta, "预览未显示文件名: %s" % meta
    assert "版本 0.2.0" in meta, "预览未显示备份版本: %s" % meta
    assert "反刍 1" in counts, "预览计数没有反刍 1: %s" % counts.replace("\n", " ")
    assert "今日打卡 1 天" in counts, "预览计数没有今日打卡 1 天"
    return "预览显示文件、版本 0.2.0、反刍 1、打卡 1 天"


def _import_merge(page):
    before_state = app_state(page) or {}
    before_window = (before_state.get("window") or {}).get("time", "19:30")
    page.click("[data-action='import-merge']")
    hidden(page, "#import-overlay")
    state = app_state(page)
    assert [r["id"] for r in state["rum"]] == ["import-rum-1"], "合并后的 rum 异常"
    assert [c["id"] for c in state["cert"]] == ["import-cert-1"], "合并后的 cert 异常"
    assert [t["id"] for t in state["tr"]] == ["import-tr-1"], "合并后的 tr 异常"
    assert [s["id"] for s in state["sleep"]] == ["import-sleep-1"], "合并后的 sleep 异常"
    assert [p["id"] for p in state["parked"]] == ["import-parked-1"], "合并后的 parked 异常"
    assert state["daily"]["2026-01-02"]["sleep"] is True, "合并后的打卡记录缺失"
    # 合并语义只合并记录与打卡，不覆盖当前窗口时间/支持网（覆盖导入才替换全部）
    assert state["window"]["time"] == before_window, "合并不应改写当前窗口时间"
    return "五类记录 + 今日打卡合并；窗口/设置保持当前值"


def _import_dedupe(page, fixture):
    before = app_state(page)
    choose_import(page, fixture)
    page.click("[data-action='import-merge']")
    hidden(page, "#import-overlay")
    after = app_state(page)
    for key in ("rum", "cert", "tr", "sleep", "parked"):
        assert len(after[key]) == len(before[key]), "重复合并后 %s 数量变化" % key
        ids = [item.get("id") for item in after[key]]
        assert len(ids) == len(set(ids)), "重复合并后 %s 出现重复 id" % key
    return "同一备份二次合并，五类记录数量不变、id 无重复"


def _import_raw(page, fixture):
    choose_import(page, fixture)
    meta = page.inner_text("#import-meta")
    assert "旧版备份（无版本信息）" in meta, "原始 state 未识别为旧版备份: %s" % meta
    page.click("[data-action='import-merge']")
    hidden(page, "#import-overlay")
    state = app_state(page)
    assert len(state["rum"]) == 1, "原始 state 合并后 rum 数量不是 1"
    assert state["rum"][0]["id"] == "raw-rum-1", "原始 state 的 rum id 不正确"
    assert state["rum"][0]["thought"] == "原始状态念头", "原始 state 的内容不正确"
    return "无 wrapper 的 state 可直接预览并合并"


def _import_overwrite(page, fixture):
    stamp = now_ms()
    local = {
        "v": 1,
        "firstSeen": stamp,
        "sos": [],
        "rum": [
            {
                "id": "local-rum",
                "t": stamp,
                "thought": "本地旧念头",
                "kind": "if",
                "action": "",
            }
        ],
        "cert": [],
        "tr": [],
        "sleep": [],
        "parked": [],
        "daily": {},
        "window": {"time": "19:30", "minutes": 15, "openedAt": 0, "closedDay": ""},
        "settings": {
            "theme": "auto",
            "motion": "auto",
            "support": ["", ""],
            "lastExportAt": 0,
        },
    }
    page.evaluate("s => localStorage.setItem('zhuolu.v1', JSON.stringify(s))", local)
    page.reload(wait_until="domcontentloaded")
    visible(page, ".view[data-view='more'].is-active")
    assert app_state(page)["rum"][0]["id"] == "local-rum", "本地种子记录未写入"
    choose_import(page, fixture)
    page.once("dialog", lambda dialog: dialog.accept())
    page.click("[data-action='import-overwrite']")
    hidden(page, "#import-overlay")
    state = app_state(page)
    assert [r["id"] for r in state["rum"]] == ["import-rum-1"], (
        "覆盖后 rum 不是备份内容: %s" % state["rum"]
    )
    assert state["window"]["time"] == "21:00", "覆盖后窗口时间不是备份内容"
    assert state["settings"]["support"] == ["甲", "乙"], "覆盖后支持网不是备份内容"
    return "local-rum 被替换为 import-rum-1，窗口/支持网来自备份"


def _import_invalid(page, fixture):
    before = app_state(page)
    with page.expect_file_chooser(timeout=15000) as chooser:
        page.click("[data-action='import-json']")
    chooser.value.set_files(str(fixture))
    page.wait_for_function(
        "() => { const t = document.querySelector('#toast');"
        " return !!t && t.classList.contains('is-on')"
        " && t.textContent.indexOf('读不出来') >= 0; }",
        timeout=8000,
    )
    assert page.locator("#import-overlay").is_hidden(), "非法文件仍打开了导入预览"
    after = app_state(page)
    for key in ("rum", "cert", "tr", "sleep", "parked"):
        assert len(after[key]) == len(before[key]), "非法导入改变了 %s" % key
    return "非 JSON 文件被拒绝，预览未打开，数据未变"


# ---------------------------------------------------------------- H 320px 布局


def group_layout(run):
    session = Session(
        run, viewport={"width": 320, "height": 800}, is_mobile=True, has_touch=True
    )
    page = session.open("now")
    for route in ROUTES:
        def layout_check(route=route):
            nav(page, route)
            return assert_no_overflow(page, "320px #/%s" % route)

        run.check(
            "320px 布局",
            "320px #/%s 无横向溢出" % route,
            layout_check,
            page,
        )
    run.check(
        "320px 布局",
        "320px SOS 浮层无横向溢出",
        lambda: _layout_sos(page),
        page,
    )
    session.close()


def _layout_sos(page):
    nav(page, "now")
    page.click(".sos")
    visible(page, "#sos-overlay")
    detail = assert_no_overflow(page, "320px SOS 浮层")
    width = page.evaluate(
        "() => document.querySelector('#sos-overlay .panel').getBoundingClientRect().width"
    )
    client = page.evaluate("() => document.documentElement.clientWidth")
    assert width <= client + 1, "浮层宽度 %s 超过视口 %s" % (width, client)
    return "%s，浮层宽 %.1f" % (detail, width)


# ---------------------------------------------------------------- I iPhone UA


def group_ios(run):
    session = Session(
        run,
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        user_agent=IOS_UA,
    )
    page = session.open("more")
    run.check(
        "iPhone UA",
        "显示安装到主屏指引",
        lambda: _ios_install(page),
        page,
    )
    run.check(
        "iPhone UA",
        "文本输入控件 font-size ≥ 16px",
        lambda: _ios_font_size(page),
        page,
    )
    run.check(
        "iPhone UA",
        "390px 各路由无横向溢出",
        lambda: _ios_layout(page),
        page,
    )
    session.close()


def _ios_install(page):
    visible(page, "#install-card")
    tip = page.inner_text("#install-tip")
    badge = page.inner_text("#install-badge").strip()
    assert "Safari" in tip, "iOS 提示未提到 Safari: %s" % tip
    assert "添加到主屏幕" in tip, "iOS 提示未提到添加到主屏幕"
    assert badge == "iOS", "安装徽标不是 iOS，实际 %s" % badge
    assert page.locator("#install-btn").is_hidden(), "iOS 下不应显示安装按钮"
    return "提示含 Safari / 添加到主屏幕，徽标=iOS"


def _ios_font_size(page):
    script = (
        "() => Array.from(document.querySelectorAll("
        "'input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select'))"
        ".filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);"
        " return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })"
        ".map(e => ({ id: e.id || e.getAttribute('aria-label') || e.tagName,"
        " fs: parseFloat(getComputedStyle(e).fontSize) }))"
    )
    items = page.evaluate(script)
    assert items, "「更多」页没有可见的文本输入控件"
    nav(page, "rumination")
    page.click("[data-action='start-intercept']")
    visible(page, "#intercept-overlay")
    overlay = page.evaluate(
        "() => Array.from(document.querySelectorAll('#intercept-overlay input:not([type=range]), #intercept-overlay textarea, #intercept-overlay select'))"
        ".filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })"
        ".map(e => ({ id: e.id || e.tagName, fs: parseFloat(getComputedStyle(e).fontSize) }))"
    )
    page.keyboard.press("Escape")
    hidden(page, "#intercept-overlay")
    items += overlay
    assert overlay, "拦截浮层没有可见的文本输入控件"
    smallest = min(items, key=lambda item: item["fs"])
    assert smallest["fs"] >= 16, (
        "输入控件 %s 的 font-size=%s < 16px（会触发 iOS 聚焦缩放）"
        % (smallest["id"], smallest["fs"])
    )
    return "%d 个文本控件，最小 %.0fpx（%s；range 滑块不计）" % (
        len(items),
        smallest["fs"],
        smallest["id"],
    )


def _ios_layout(page):
    assert page.locator(".bottom-nav").is_visible(), "390px 下底部导航不可见"
    details = []
    for route in ROUTES:
        nav(page, route)
        details.append(route + ":" + assert_no_overflow(page, "390px #/%s" % route))
    return "；".join(details)


# ---------------------------------------------------------------- J PWA / 离线


def group_pwa(run):
    run.check(
        "PWA / 离线",
        "manifest 可访问且字段完整",
        lambda: _manifest_check(run),
    )
    run.check(
        "PWA / 离线",
        "图标文件 HTTP 200 且为 PNG",
        lambda: _icons_check(run),
    )
    run.check(
        "PWA / 离线",
        "sw.js 可访问且包含缓存逻辑",
        lambda: _sw_check(run),
    )

    session = Session(run, **MOBILE)
    page = session.open("now")
    run.check(
        "PWA / 离线",
        "Service Worker 注册并接管页面",
        lambda: _sw_registered(page),
        page,
    )
    # 为离线检查准备一条今天的打卡记录
    nav(page, "today")
    page.click("#today-checks [data-check='sleep']")
    wait_text(page, "#today-progress", "已做到 1 件")
    nav(page, "now")
    session.recorder.allow_console_noise = True

    run.check(
        "PWA / 离线",
        "离线 reload 仍能渲染",
        lambda: _offline_reload(page, session.context),
        page,
    )
    run.check(
        "PWA / 离线",
        "离线时路由与本地状态仍可用",
        lambda: _offline_routes(page, session.context),
        page,
    )
    session.close()


def _manifest_check(run):
    url = urllib.parse.urljoin(run.base, "manifest.webmanifest")
    try:
        status, content_type, body = http_get(url)
    except Exception as exc:
        raise AssertionError("manifest 请求失败: %s" % exc) from exc
    assert status == 200, "manifest 状态码 %s" % status
    try:
        manifest = json.loads(body.decode("utf-8"))
    except Exception as exc:
        raise AssertionError("manifest 不是合法 JSON: %s" % exc) from exc
    assert "着陆台" in manifest.get("name", ""), "manifest.name 缺少「着陆台」"
    assert manifest.get("display") == "standalone", "display 不是 standalone"
    assert manifest.get("start_url") in ("./", ".", "index.html"), (
        "start_url 异常: %s" % manifest.get("start_url")
    )
    icons = manifest.get("icons") or []
    sizes = " ".join(str(item.get("sizes", "")) for item in icons)
    assert "192x192" in sizes, "manifest 图标缺少 192x192"
    assert "512x512" in sizes, "manifest 图标缺少 512x512"
    return "200，name/display/start_url/192+512 图标齐全（%s）" % content_type


def _icons_check(run):
    status, content_type, body = http_get(
        urllib.parse.urljoin(run.base, "manifest.webmanifest")
    )
    manifest = json.loads(body.decode("utf-8"))
    sources = [item.get("src") for item in manifest.get("icons", []) if item.get("src")]
    sources.append("icons/apple-touch-icon-180.png")
    checked = []
    for src in sources:
        url = urllib.parse.urljoin(run.base, src)
        try:
            code, ctype, data = http_get(url)
        except Exception as exc:
            raise AssertionError("图标 %s 请求失败: %s" % (src, exc)) from exc
        assert code == 200, "图标 %s 状态码 %s" % (src, code)
        assert data.startswith(b"\x89PNG\r\n\x1a\n"), "图标 %s 不是 PNG" % src
        checked.append(src)
    return "%d 个图标均 200 且 PNG 签名正确" % len(checked)


def _sw_check(run):
    url = urllib.parse.urljoin(run.base, "sw.js")
    try:
        status, content_type, body = http_get(url)
    except Exception as exc:
        raise AssertionError("sw.js 请求失败: %s" % exc) from exc
    assert status == 200, "sw.js 状态码 %s" % status
    text = body.decode("utf-8", "replace")
    for needle in ("addEventListener('install'", "addEventListener('fetch'", "caches.open", "zhuolu-v"):
        assert needle in text, "sw.js 缺少 %s" % needle
    return "200，install/fetch/caches/zhuolu-v 缓存逻辑存在"


def _sw_registered(page):
    page.wait_for_function(
        "async () => { const reg = await navigator.serviceWorker.ready;"
        " return !!reg.active; }",
        timeout=15000,
    )
    page.wait_for_function(
        "() => !!navigator.serviceWorker.controller",
        timeout=15000,
    )
    script = page.evaluate(
        "() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL"
    )
    assert script and script.endswith("/sw.js"), "controller 不是 sw.js: %s" % script
    cache_info = page.evaluate(
        "async () => { const keys = await caches.keys();"
        " const mine = keys.filter(k => k.indexOf('zhuolu-v') === 0);"
        " let count = 0;"
        " if (mine.length) { const cache = await caches.open(mine[0]);"
        " count = (await cache.keys()).length; }"
        " return { keys: keys, mine: mine, count: count }; }"
    )
    assert cache_info["mine"], "没有 zhuolu-v* 缓存: %s" % cache_info["keys"]
    assert cache_info["count"] >= 7, "缓存条目只有 %s 条" % cache_info["count"]
    return "controller=%s，缓存 %s（%d 条）" % (
        script.rsplit("/", 1)[-1],
        cache_info["mine"][0],
        cache_info["count"],
    )


def block_network(page, blocked):
    """真正断开网络：CDP 屏蔽全部请求。

    不用 context.set_offline()：Chrome 的网络模拟对 localhost 不生效，
    本地跑永远是"假离线"；对远端站点又会连 Service Worker 一起掐掉，
    结果测的是模拟器行为，不是"缓存能不能顶住"。
    """
    cdp = page.context.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setBlockedURLs", {"urls": ["*"] if blocked else []})


def _offline_reload(page, context):
    block_network(page, True)
    page.reload(wait_until="domcontentloaded")
    visible(page, ".view[data-view='now'].is-active")
    assert page.locator(".bottom-nav").is_visible(), "离线后底部导航不可见"
    assert "着陆台" in page.title(), "离线后标题异常: %s" % page.title()
    heading = page.inner_text(".view[data-view='now'] .hero__title")
    assert "不用把任何事" in heading, "离线后首屏内容未渲染"
    return "离线 reload 后「现在」首屏与导航正常"


def _offline_routes(page, context):
    try:
        page.click(".bnav-item[data-route='more']")
        visible(page, ".view[data-view='more'].is-active")
        assert page.locator("#install-card").is_visible(), "离线时更多页未渲染"
        page.click(".bnav-item[data-route='today']")
        visible(page, ".view[data-view='today'].is-active")
        assert page.get_attribute("#today-checks [data-check='sleep']", "aria-checked") == "true", (
            "离线时今日打卡状态丢失"
        )
        page.click(".bnav-item[data-route='now']")
        visible(page, ".view[data-view='now'].is-active")
        return "离线时可切换 更多/今日/现在，打卡状态保留"
    finally:
        block_network(page, False)



# ---------------------------------------------------------------- L 隐私与安全（0.4.0）

LOCK_PASS = "qa-lock-2026"
LOCK_PASS2 = "qa-lock-9876"
ENC_PASS = "qa-backup-4321"
SEED_TEXT = "QA-锁测试-记录"


def _sp_sections(page):
    count = page.eval_on_selector_all(".sp-step", "els => els.length")
    assert count == 7, "安全计划应有 7 节，实际 %d" % count
    titles = page.eval_on_selector_all(".sp-step .h3", "els => els.map(e => e.textContent.trim())")
    assert all(titles), "有节标题为空"
    empty = page.eval_on_selector_all(".sp-empty", "els => els.length")
    assert empty == 7, "初始应 7 节都显示空态，实际 %d" % empty
    status = page.inner_text("#sp-status")
    assert "还没写" in status, "初始状态文案不对：%s" % status
    return "7 节 · 标题 %s" % "／".join(titles[:2])


def _sp_add(page):
    page.fill("#sp-input-signals", "QA-安全计划-1")
    page.press("#sp-input-signals", "Enter")
    wait_text(page, "[data-sp-list='signals']", "QA-安全计划-1")
    assert page.eval_on_selector("#sp-input-signals", "e => e.value") == "", "加入后输入框应清空"
    state = app_state(page)
    assert state["safety"]["signals"] == ["QA-安全计划-1"], "落盘内容不对: %s" % state["safety"]
    assert state["safety"]["updatedAt"] > 0, "没有记录更新时间"
    return "已写入 signals，落盘 1 条"


def _sp_suggest(page):
    chip = page.locator("[data-sp-presets='coping'] .chip").first
    text = chip.inner_text().strip()
    chip.click()
    page.wait_for_function(
        "([t]) => Array.from(document.querySelectorAll(\"[data-sp-list='coping'] .sp-item__t\"))"
        ".some(e => e.textContent.trim() === t)",
        arg=[text],
    )
    on = page.eval_on_selector(
        "[data-sp-presets='coping'] .chip", "e => e.getAttribute('aria-pressed')"
    )
    assert on == "true", "加入后预置项应标记为已选"
    page.locator("[data-sp-presets='coping'] .chip").first.click()
    page.wait_for_function(
        "() => !document.querySelector(\"[data-sp-list='coping'] .sp-item\")",
    )
    return "预置项「%s」加入 / 再点移除" % text


def _sp_undo(page):
    page.locator("[data-sp-list='signals'] [data-action='sp-del']").first.click()
    visible(page, ".toast.is-on")
    page.wait_for_function("() => !document.querySelector(\"[data-sp-list='signals'] .sp-item\")")
    page.click("#toast-action")
    wait_text(page, "[data-sp-list='signals']", "QA-安全计划-1")
    return "删除后 6 秒内可撤销"


def _sp_tel(page):
    page.fill("#sp-input-people", "妈妈 13800138000")
    page.press("#sp-input-people", "Enter")
    href = page.wait_for_function(
        "() => { const a = document.querySelector(\"[data-sp-list='people'] a\");"
        " return a ? a.getAttribute('href') : null; }"
    ).json_value()
    assert href == "tel:13800138000", "号码应渲染成 tel: 链接，实际 %s" % href
    return "tel:%s" % href.replace("tel:", "")


def _sp_print(page):
    html = page.eval_on_selector("#safety-print", "e => e.innerHTML")
    assert "QA-安全计划-1" in html, "打印版没带上有内容的条目"
    assert "12356" in html, "打印版缺少热线"
    assert page.locator("#safety-print").is_hidden(), "打印版在屏幕上不应显示"
    return "打印版 %d 字符，屏幕上隐藏" % len(html)


def _sp_reload(page):
    page.reload(wait_until="domcontentloaded")
    wait_text(page, "[data-sp-list='signals']", "QA-安全计划-1")
    wait_text(page, "[data-sp-list='people']", "13800138000")
    assert page.locator(".sp-empty").count() < 7, "刷新后仍有整节空态"
    return "刷新后 2 节内容都在"


def _qe_settings(page):
    assert page.eval_on_selector("#setting-quick-exit", "e => e.value") == "search", "默认目标应为搜索首页"
    page.select_option("#setting-quick-exit", "custom")
    visible(page, "#setting-quick-url")
    page.fill("#setting-quick-url", "https://example.com/plain")
    page.press("#setting-quick-url", "Tab")
    page.wait_for_function(
        "() => { const s = JSON.parse(localStorage.getItem('zhuolu.v1') || '{}');"
        " return s.settings && s.settings.quickExit === 'custom'; }"
    )
    state = app_state(page)
    assert state["settings"]["quickExitUrl"] == "https://example.com/plain", "自定义网址没存下"
    return "默认 search → 自定义 %s" % state["settings"]["quickExitUrl"]


def _qe_go(page):
    page.select_option("#setting-quick-exit", "blank")
    page.wait_for_timeout(150)
    before = page.evaluate("() => history.length")
    with page.expect_navigation(timeout=10000):
        page.click("[data-action='quick-exit']")
    after = page.evaluate("() => history.length")
    assert page.url == "about:blank", "快速离开目标不对：%s" % page.url
    assert after <= before, "快速离开不应该新增历史记录（%s → %s）" % (before, after)
    return "跳到 about:blank，history %s → %s" % (before, after)


def _lock_seed(page):
    page.evaluate(
        "(t) => localStorage.setItem('zhuolu.v1', JSON.stringify({"
        "v: 1, rum: [{ id: 'qa-lock-1', t: Date.now(), kind: 'why', thought: t }] }))",
        SEED_TEXT,
    )
    page.reload(wait_until="domcontentloaded")
    wait_text(page, "#rec-rum", SEED_TEXT)


def _lock_on(page):
    _lock_seed(page)
    page.click("[data-action='lock-set']")
    visible(page, "#pass-overlay")
    assert page.locator("#pass-cur-field").is_hidden(), "设置口令时不该要当前口令"
    assert page.locator("#pass-new-field").is_visible(), "应有新口令输入"
    page.fill("#pass-new", "12345")
    page.fill("#pass-new2", "12345")
    page.click("#pass-submit")
    visible(page, "#pass-err")
    assert "至少 6 位" in page.inner_text("#pass-err"), "太短的口令应被拒绝"
    page.fill("#pass-new", LOCK_PASS)
    page.fill("#pass-new2", LOCK_PASS + "x")
    page.click("#pass-submit")
    visible(page, "#pass-err")
    assert "两次输入不一样" in page.inner_text("#pass-err"), "两次不一致应被拒绝"
    page.fill("#pass-new", LOCK_PASS)
    page.fill("#pass-new2", LOCK_PASS)
    page.click("#pass-submit")
    hidden(page, "#pass-overlay")
    page.wait_for_function(
        "() => { const e = JSON.parse(localStorage.getItem('zhuolu.v1') || '{}');"
        " return e.locked === true && e.lock && !!e.lock.ct; }"
    )
    raw = page.evaluate("() => localStorage.getItem('zhuolu.v1')")
    assert SEED_TEXT not in raw, "加密后本地仍有明文记录"
    env = json.loads(raw)
    assert sorted(env.keys()) == ["lock", "locked", "ui", "v"], "信封字段异常: %s" % sorted(env.keys())
    assert env["lock"]["alg"] == "AES-GCM-256", "算法不对: %s" % env["lock"]["alg"]
    assert env["lock"]["kdf"] == "PBKDF2-SHA256", "KDF 不对"
    assert env["lock"]["iter"] >= 200000, "迭代次数太低: %s" % env["lock"]["iter"]
    assert env["ui"]["theme"] in ("auto", "light", "dark"), "ui 镜像缺失"
    assert page.inner_text("#lock-badge").strip() == "已加密", "徽标没更新"
    return "信封 %s · iter %d · 密文 %d 字符" % (
        "/".join(sorted(env.keys())),
        env["lock"]["iter"],
        len(env["lock"]["ct"]),
    )


def _lock_reload(page):
    page.reload(wait_until="domcontentloaded")
    visible(page, "#lock-overlay")
    assert page.locator(".shell").get_attribute("inert") is not None, "锁屏时主界面应 inert"
    assert SEED_TEXT not in page.evaluate("() => document.body.innerText"), "锁屏时 DOM 里不该有记录"
    assert page.locator("#sos-overlay").is_hidden(), "锁屏时不该有其他浮层"
    return "锁屏可见，DOM 无记录，主界面 inert"


def _lock_bad(page):
    page.fill("#lock-pass", "not-the-pass")
    page.click("#lock-btn")
    visible(page, "#lock-err")
    assert "口令不对" in page.inner_text("#lock-err"), "错误口令应给出提示"
    assert page.locator("#lock-overlay").is_visible(), "错误口令不该解锁"
    return "错误口令被拒，锁屏保持"


def _lock_unlock(page):
    page.fill("#lock-pass", LOCK_PASS)
    page.click("#lock-btn")
    hidden(page, "#lock-overlay")
    wait_text(page, "#rec-rum", SEED_TEXT)
    assert "已解锁" in page.inner_text("#toast-msg"), "解锁后应有提示"
    return "解锁成功，记录回到页面"


def _lock_change(page):
    page.click("[data-action='lock-change']")
    visible(page, "#pass-overlay")
    page.fill("#pass-cur", "wrong-one")
    page.fill("#pass-new", LOCK_PASS2)
    page.fill("#pass-new2", LOCK_PASS2)
    page.click("#pass-submit")
    visible(page, "#pass-err")
    assert "当前口令不对" in page.inner_text("#pass-err"), "改口令应校验当前口令"
    page.fill("#pass-cur", LOCK_PASS)
    page.click("#pass-submit")
    hidden(page, "#pass-overlay")
    page.wait_for_timeout(500)
    page.reload(wait_until="domcontentloaded")
    visible(page, "#lock-overlay")
    page.fill("#lock-pass", LOCK_PASS)
    page.click("#lock-btn")
    visible(page, "#lock-err")
    page.fill("#lock-pass", LOCK_PASS2)
    page.click("#lock-btn")
    hidden(page, "#lock-overlay")
    assert SEED_TEXT in page.evaluate("() => document.body.innerText"), "改口令后记录丢了"
    return "旧口令失效，新口令可用，记录完整"


def _lock_off(page):
    page.once("dialog", lambda d: d.accept())
    page.click("[data-action='lock-off']")
    visible(page, "#pass-overlay")
    page.fill("#pass-cur", LOCK_PASS2)
    page.click("#pass-submit")
    hidden(page, "#pass-overlay")
    page.wait_for_function(
        "() => { const s = JSON.parse(localStorage.getItem('zhuolu.v1') || '{}');"
        " return s.locked !== true && Array.isArray(s.rum); }"
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(400)
    assert page.locator("#lock-overlay").is_hidden(), "关锁后不该再出现锁屏"
    wait_text(page, "#rec-rum", SEED_TEXT)
    assert page.inner_text("#lock-badge").strip() == "未设口令", "徽标没复位"
    return "回到明文存放，刷新不再要口令"


def _enc_export(page, holder):
    page.evaluate(
        "(t) => localStorage.setItem('zhuolu.v1', JSON.stringify({"
        "v: 1, rum: [{ id: 'qa-enc-1', t: Date.now(), kind: 'why', thought: t }] }))",
        SEED_TEXT,
    )
    page.reload(wait_until="domcontentloaded")
    wait_text(page, "#rec-rum", SEED_TEXT)
    page.click("[data-action='export-enc']")
    visible(page, "#pass-overlay")
    page.fill("#pass-new", ENC_PASS)
    page.fill("#pass-new2", ENC_PASS)
    with page.expect_download(timeout=20000) as info:
        page.click("#pass-submit")
    download = info.value
    path = download.path()
    text = Path(path).read_text(encoding="utf-8") if path else ""
    holder["text"] = text
    holder["name"] = download.suggested_filename
    hidden(page, "#pass-overlay")
    return len(text)


def _enc_structure(holder):
    assert holder.get("text"), "没有拿到加密备份内容"
    data = json.loads(holder["text"])
    assert sorted(data.keys()) == ["app", "appVersion", "enc", "exportedAt", "schemaVersion"], (
        "加密备份顶层字段异常: %s" % sorted(data.keys())
    )
    assert data["app"] == "zhuolu", "app 标记缺失"
    assert data["enc"]["alg"] == "AES-GCM-256", "算法不对"
    assert data["enc"]["kdf"] == "PBKDF2-SHA256", "KDF 不对"
    for key in ("salt", "iv", "ct"):
        assert data["enc"][key], "缺字段 %s" % key
    assert SEED_TEXT not in holder["text"], "加密备份里出现了明文"
    assert holder["name"].endswith(".enc.json"), "文件名应标明加密: %s" % holder["name"]
    return "%s · %d 字节 · 无明文" % (holder["name"], len(holder["text"]))


def _enc_import_bad(page, fixture):
    with page.expect_file_chooser(timeout=15000) as chooser:
        page.click("[data-action='import-json']")
    chooser.value.set_files(str(fixture))
    visible(page, "#pass-overlay")
    assert page.eval_on_selector("#pass-title", "e => e.textContent") == "输入备份口令", "应弹出口令框"
    assert page.locator("#pass-one-field").is_visible(), "加密备份只需一个口令框"
    page.fill("#pass-one", "wrong-backup-pass")
    page.click("#pass-submit")
    visible(page, "#pass-err")
    assert "口令不对" in page.inner_text("#pass-err"), "错误口令应被拒绝"
    assert page.locator("#import-overlay").is_hidden(), "口令不对时不该进入预览"
    return "错误口令被拒，未进入预览"


def _enc_import_ok(page):
    page.fill("#pass-one", ENC_PASS)
    page.click("#pass-submit")
    hidden(page, "#pass-overlay")
    visible(page, "#import-overlay")
    meta = page.inner_text("#import-meta")
    assert "加密备份" in meta, "预览里应标明是加密备份: %s" % meta
    assert "反刍 1" in page.inner_text("#import-counts").replace("\n", " "), "预览条数不对"
    page.click("[data-action='import-merge']")
    hidden(page, "#import-overlay")
    wait_text(page, "#rec-rum", SEED_TEXT)
    return "口令正确 → 预览 → 合并成功"


def group_privacy(run):
    desktop = {"viewport": {"width": 1280, "height": 900}}

    session = Session(run, **desktop)
    page = session.open("safety")
    run.check("隐私与安全", "安全计划 7 节渲染", lambda: _sp_sections(page), page)
    run.check("隐私与安全", "安全计划：回车添加并落盘", lambda: _sp_add(page), page)
    run.check("隐私与安全", "安全计划：预置项加入 / 再点移除", lambda: _sp_suggest(page), page)
    run.check("隐私与安全", "安全计划：删除后可撤销", lambda: _sp_undo(page), page)
    run.check("隐私与安全", "安全计划：号码变拨号链接", lambda: _sp_tel(page), page)
    run.check("隐私与安全", "安全计划：打印版齐全且屏幕隐藏", lambda: _sp_print(page), page)
    run.check("隐私与安全", "安全计划：刷新后仍在", lambda: _sp_reload(page), page)
    run.check(
        "隐私与安全",
        "320px 安全计划无横向溢出",
        lambda: _safety_overflow(page),
        page,
    )
    session.close()

    session = Session(run, **desktop)
    page = session.open("more")
    run.check("隐私与安全", "快速离开：默认值与自定义保存", lambda: _qe_settings(page), page)
    run.check("隐私与安全", "快速离开：跳转不写进历史", lambda: _qe_go(page), page)
    session.close()

    session = Session(run, **desktop)
    page = session.open("more")
    run.check("隐私与安全", "应用锁：口令校验与密文落盘", lambda: _lock_on(page), page)
    run.check("隐私与安全", "应用锁：刷新后锁屏且不渲染记录", lambda: _lock_reload(page), page)
    run.check("隐私与安全", "应用锁：错误口令被拒绝", lambda: _lock_bad(page), page)
    run.check("隐私与安全", "应用锁：正确口令解锁", lambda: _lock_unlock(page), page)
    run.check("隐私与安全", "应用锁：改口令后旧口令失效", lambda: _lock_change(page), page)
    run.check("隐私与安全", "应用锁：关闭后回到明文", lambda: _lock_off(page), page)
    session.close()

    holder = {}
    session = Session(run, **desktop)
    page = session.open("more")
    run.check(
        "隐私与安全",
        "加密备份：导出触发下载",
        lambda: "%d 字节" % _enc_export(page, holder),
        page,
    )
    run.check("隐私与安全", "加密备份：结构正确且无明文", lambda: _enc_structure(holder), page)
    session.close()

    fixture = run.out_dir / "fixtures" / "enc-backup.json"
    fixture.write_text(holder.get("text", ""), encoding="utf-8")
    session = Session(run, **desktop)
    page = session.open("more")
    run.check("隐私与安全", "加密备份：错误口令打不开", lambda: _enc_import_bad(page, fixture), page)
    run.check("隐私与安全", "加密备份：正确口令导入", lambda: _enc_import_ok(page), page)
    session.close()


def _safety_overflow(page):
    page.set_viewport_size({"width": 320, "height": 720})
    nav(page, "safety")
    detail = assert_no_overflow(page, "320px #/safety")
    page.set_viewport_size({"width": 1280, "height": 900})
    nav(page, "safety")
    return detail


# ---------------------------------------------------------------- K 全局汇总


def group_global(run):
    def no_js_errors():
        errors = []
        used = 0
        for recorder in run.recorders:
            if recorder.allow_console_noise:
                continue
            used += 1
            errors.extend("console: " + item for item in recorder.console_errors)
            errors.extend("pageerror: " + item for item in recorder.page_errors)
        assert not errors, "；".join(errors[:6])
        return "%d 个 context 全程 0 条 console error / pageerror" % used

    run.check(
        "全局汇总",
        "全流程无未捕获 JS 错误",
        no_js_errors,
    )

    def no_external():
        external = []
        for recorder in run.recorders:
            external.extend(recorder.external_requests)
        assert not external, "外部请求: %s" % ", ".join(external[:6])
        return "%d 个 context 均无非本地请求" % len(run.recorders)

    run.check(
        "全局汇总",
        "全流程无外部网络请求",
        no_external,
    )


# ---------------------------------------------------------------- 主流程
def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="着陆台自动化回归测试")
    parser.add_argument(
        "--url",
        default=None,
        help="已有站点地址（如 http://127.0.0.1:8000/）；默认自行启动本地 HTTP 服务",
    )
    parser.add_argument("--headed", action="store_true", help="显示浏览器窗口")
    parser.add_argument(
        "--browser",
        choices=["chromium", "webkit"],
        default="chromium",
        help="测试引擎：chromium（默认，系统 Chrome）或 webkit（Safari 内核）",
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_QA_ROOT),
        help="测试产物目录（默认 D:\\document\\zhuolu-qa）",
    )
    parser.add_argument(
        "--serve-dir",
        default=None,
        help="测试指定的构建目录（默认仓库根；用于回归某个已构建产物）",
    )
    return parser.parse_args(argv)


GROUPS = [
    ("加载与结构", group_smoke),
    ("SOS 着陆", group_sos),
    ("反刍", group_rumination),
    ("确定性", group_certainty),
    ("今日", group_today),
    ("更多", group_more),
    ("导出/导入", group_export_import),
    ("320px 布局", group_layout),
    ("iPhone UA", group_ios),
    ("PWA / 离线", group_pwa),
    ("隐私与安全", group_privacy),
    ("全局汇总", group_global),
]


def main(argv=None):
    args = parse_args(argv)
    if args.browser == "chromium" and not os.path.exists(CHROME_PATH):
        print("找不到 Chrome: %s（可用环境变量 ZHUOLU_CHROME 覆盖）" % CHROME_PATH)
        return 2

    server = None
    if args.url:
        base, index_url = split_base_url(args.url)
        ALLOWED_HOSTS.add((urllib.parse.urlparse(base).hostname or "").lower())
    else:
        serve_root = Path(args.serve_dir).resolve() if args.serve_dir else REPO_ROOT
        if not (serve_root / "index.html").exists():
            print("测试目录缺少 index.html: %s" % serve_root)
            return 2
        server = StaticServer(serve_root)
        base = server.base
        index_url = base + "index.html"

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = Path(args.out) / "runs" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    run = Runner(base, index_url, out_dir)

    print("着陆台 QA · %s" % index_url)
    print("产物目录: %s" % out_dir)
    print("-" * 72)

    exit_code = 0
    try:
        with sync_playwright() as playwright:
            if args.browser == "webkit":
                # WebKit 是 Safari 的内核，用来在没有 iOS 真机时先挡住引擎级差异
                run.browser = playwright.webkit.launch(headless=not args.headed)
            else:
                run.browser = playwright.chromium.launch(
                    executable_path=CHROME_PATH,
                    headless=not args.headed,
                )
            try:
                run.chrome_version = run.browser.version
            except Exception:
                pass
            for group_name, group_func in GROUPS:
                run.run_group(group_name, group_func)
            try:
                run.browser.close()
            except Exception:
                pass
    finally:
        if server:
            server.stop()

    passed, failed, total = run.counts()
    duration = time.time() - run.started_at
    print("-" * 72)
    print("PASS %d / FAIL %d / 共 %d 项 · %.1fs" % (passed, failed, total, duration))
    if failed:
        print("失败项：")
        index = 0
        for result in run.results:
            if result["ok"]:
                continue
            index += 1
            print("%d. [%s] %s" % (index, result["group"], result["name"]))
            print("   %s" % result["detail"])
    report_md = render_markdown(run, duration, index_url)
    (out_dir / "report.md").write_text(report_md, encoding="utf-8")
    (out_dir / "results.json").write_text(
        json.dumps(
            {
                "url": index_url,
                "chrome": run.chrome_version,
                "startedAt": datetime.fromtimestamp(run.started_at).isoformat(),
                "durationSeconds": round(duration, 2),
                "passed": passed,
                "failed": failed,
                "total": total,
                "results": run.results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    latest = Path(args.out)
    (latest / "latest-report.md").write_text(report_md, encoding="utf-8")
    (latest / "latest-results.json").write_text(
        (out_dir / "results.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    print("报告: %s" % (out_dir / "report.md"))
    print("结果: %s" % (out_dir / "results.json"))
    print("最新: %s" % (latest / "latest-report.md"))
    exit_code = 0 if failed == 0 else 1
    return exit_code


def render_markdown(run, duration, index_url):
    passed, failed, total = run.counts()
    lines = [
        "# 着陆台 QA 回归报告",
        "",
        "- 时间：%s" % datetime.fromtimestamp(run.started_at).strftime("%Y-%m-%d %H:%M:%S"),
        "- 地址：%s" % index_url,
        "- Chrome：%s" % run.chrome_version,
        "- 结论：**%s**（PASS %d / FAIL %d / 共 %d，%.1fs）"
        % ("通过" if failed == 0 else "存在失败", passed, failed, total, duration),
        "",
    ]
    if failed:
        lines.append("## 失败详情")
        lines.append("")
        for result in run.results:
            if result["ok"]:
                continue
            lines.append("### [%s] %s" % (result["group"], result["name"]))
            lines.append("")
            lines.append(FENCE)
            lines.append(result["detail"])
            lines.append(FENCE)
            lines.append("")
    lines.append("## 全部检查")
    lines.append("")
    lines.append("| # | 组 | 检查 | 结果 | 耗时 | 详情 |")
    lines.append("|---:|---|---|---|---:|---|")
    for index, result in enumerate(run.results, 1):
        detail = result["detail"].replace("|", "\\|").replace("\n", " ")
        lines.append(
            "| %d | %s | %s | %s | %.2fs | %s |"
            % (
                index,
                result["group"],
                result["name"],
                "PASS" if result["ok"] else "FAIL",
                result["seconds"],
                detail,
            )
        )
    lines.append("")
    lines.append("失败截图：failures/；原始结果：results.json。")
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
