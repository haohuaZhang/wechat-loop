#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
扫码登录微信公众平台，自动保存 token + cookie 到 credentials.json。

用法：
  python3 scripts/wx_login.py                # 截二维码并等待扫码（默认 300s）
  python3 scripts/wx_login.py --timeout 600  # 自定义等待时长
  python3 scripts/wx_login.py --probe        # 只检查页面/二维码是否正常，不等待

产物：
  loop/.login/qrcode.png      二维码截图（发给用户扫）
  loop/.login/status.json     当前状态：waiting / success / expired / error
  wechat-digest-skill/credentials.json   token + cookie（已 gitignore）
"""

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRED_FILE = os.environ.get(
    "WECHAT_CREDENTIALS",
    os.path.join(ROOT, "wechat-digest-skill", "credentials.json"),
)
LOGIN_DIR = os.path.join(ROOT, "loop", ".login")
QR_PATH = os.path.join(LOGIN_DIR, "qrcode.png")
STATUS_PATH = os.path.join(LOGIN_DIR, "status.json")

LOGIN_URL = "https://mp.weixin.qq.com/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36")

QR_SELECTORS = [
    ".login__type__container__scan__qrcode img",
    ".login__type__container__scan__qrcode",
    "img.qrcode",
    ".qrcode img",
    "img[src^='data:image']",
    "img[src*='qrcode']",
]


def now():
    return datetime.now().isoformat(timespec="seconds")


def write_status(**kw):
    os.makedirs(LOGIN_DIR, exist_ok=True)
    tmp = STATUS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"updatedAt": now(), **kw}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STATUS_PATH)


def proxy_from_env():
    for key in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = os.environ.get(key)
        if value:
            return {"server": value}
    return None


BROWSER_CHANNELS = ("chrome", "msedge")


def launch_browser(p):
    """优先驱动本机已安装的 Chrome / Edge，最后才回退到 Playwright 自带 chromium。

    本地版不给用户额外下载 100+MB 浏览器；沙箱里没有系统浏览器时自动回退。
    """
    preferred = os.environ.get("WECHAT_BROWSER_CHANNEL", "").strip()
    channels = []
    if preferred:
        channels.append(preferred)
    channels.extend(c for c in BROWSER_CHANNELS if c not in channels)
    channels.append(None)  # 内置 chromium

    last_error = None
    for channel in channels:
        kwargs = {"headless": True, "proxy": proxy_from_env()}
        if channel:
            kwargs["channel"] = channel
        try:
            browser = p.chromium.launch(**kwargs)
            print(f"使用浏览器：{channel or '内置 chromium'}", flush=True)
            return browser
        except Exception as exc:
            last_error = exc
            first_line = str(exc).strip().splitlines()[0][:120] if str(exc).strip() else exc.__class__.__name__
            print(f"  · {channel or '内置 chromium'} 不可用：{first_line}", flush=True)
    raise SystemExit(
        "找不到可用浏览器。请安装 Google Chrome（推荐）或 Microsoft Edge；"
        "也可设置 WECHAT_BROWSER_CHANNEL=chrome / msedge 指定。\n"
        f"最后一个错误：{last_error}")


def save_qr(page):
    """尽量只截二维码区域，找不到就截整页。"""
    os.makedirs(LOGIN_DIR, exist_ok=True)
    for sel in QR_SELECTORS:
        try:
            el = page.query_selector(sel)
            if not el:
                continue
            box = el.bounding_box()
            if box and box.get("width", 0) >= 100 and box.get("height", 0) >= 100:
                page.screenshot(path=QR_PATH, clip=box)
                return sel
        except Exception:
            continue
    page.screenshot(path=QR_PATH, full_page=False)
    return "(整页截图)"


def read_credentials(page, context):
    token = (parse_qs(urlparse(page.url).query).get("token") or [""])[0]
    cookies = [c for c in context.cookies() if "weixin" in c.get("domain", "")]
    cookie = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
    return token.strip(), cookie.strip()


def save_credentials(token, cookie):
    os.makedirs(os.path.dirname(CRED_FILE), exist_ok=True)
    data = {"token": token, "cookie": cookie, "savedAt": now()}
    with open(CRED_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(CRED_FILE, 0o600)
    except OSError:
        pass


def main():
    parser = argparse.ArgumentParser(
        prog="wx_login.py", description="扫码登录微信公众平台并保存 token + cookie")
    parser.add_argument("--timeout", type=int, default=300, help="等待扫码的秒数（默认 300）")
    parser.add_argument("--probe", action="store_true", help="只检查页面与二维码，不等待")
    args = parser.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("缺少 playwright：请重新运行启动脚本，它会自动安装依赖")

    write_status(status="starting")
    with sync_playwright() as p:
        browser = launch_browser(p)
        context = browser.new_context(
            user_agent=UA, viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page = context.new_page()
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        if args.probe:
            hits = {sel: bool(page.query_selector(sel)) for sel in QR_SELECTORS}
            print(json.dumps({
                "url": page.url,
                "title": page.title(),
                "qr_selectors": hits,
            }, ensure_ascii=False, indent=2))
            browser.close()
            return

        sel = save_qr(page)
        write_status(status="waiting", qr=QR_PATH, selector=sel)
        print(f"二维码已保存：{QR_PATH}")
        print(f"选择器：{sel}")
        print(f"请在 {args.timeout}s 内用手机扫码登录…", flush=True)

        deadline = time.time() + args.timeout
        last_qr_refresh = time.time()
        while time.time() < deadline:
            if "token=" in page.url and "/cgi-bin/" in page.url:
                token, cookie = read_credentials(page, context)
                if token and cookie:
                    save_credentials(token, cookie)
                    write_status(status="success", credential=CRED_FILE,
                                 tokenTail=token[-4:])
                    print(f"✓ 登录成功，凭证已保存：{CRED_FILE}")
                    print(f"  token: ***{token[-4:]}  cookie: {len(cookie)} 字符")
                    browser.close()
                    return
            if time.time() - last_qr_refresh > 60:
                save_qr(page)
                last_qr_refresh = time.time()
            page.wait_for_timeout(2000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=1000)
            except Exception:
                pass

        write_status(status="expired")
        print("✗ 等待超时，二维码可能已失效。重新运行本脚本即可。")
        browser.close()
        sys.exit(3)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        write_status(status="error", detail=traceback.format_exc(limit=3))
        raise
