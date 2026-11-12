"""双轨入草稿：轨 A 官方 API / 轨 B Playwright 浏览器自动化（完整版实现）。

轨 B 不依赖 chromium 真跑也能 import —— playwright 是 lazy import。
选择器标注了 ⚠️ 待实测 —— 第一次跑通后要把 Playwright Inspector 里拿到的
真实选择器替换进来。

用法:
    python3 publish_draft.py article.html --title "..." --digest "..." --cover covers/xxx.png --route playwright
    python3 publish_draft.py article.html --title "..." --route api            # 需 AppID/Secret
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 上游只读依赖
WECHAT_FLOW_TOOLKIT = ROOT.parent / "wechat-flow" / "toolkit"
WECHAT_FLOW_FILM = ROOT.parent / "wechat-flow-film"

# ⚠️ 待实测 — 这些是常见模式，第一次跑通后用 Playwright Inspector 替换
SELECTORS = {
    # 编辑器内容主区域（微信编辑器核心 contenteditable）
    "content_editor": [
        "#edui1_body",                                          # 最常见
        "[contenteditable='true'][class*='edui']",
        "[contenteditable][aria-label*='正文']",
        "#ueditor_0",                                           # 旧版
    ],
    # 标题输入（input 或 contenteditable）
    "title_field": [
        "input[data-placeholder*='标题']",
        "input[placeholder*='标题']",
        "[contenteditable][aria-label*='标题']",
        "#title",
    ],
    # 摘要
    "digest_field": [
        "textarea[data-placeholder*='摘要']",
        "textarea[placeholder*='摘要']",
        "[contenteditable][aria-label*='摘要']",
    ],
    # 封面按钮 / 区域
    "cover_area": [
        "div[class*='cover']",
        "a[class*='cover']",
        "[class*='set-cover']",
        "[class*='choose-file']",
    ],
    # "保存草稿" 按钮
    "save_btn": [
        "a:has-text('保存草稿')",
        "button:has-text('保存草稿')",
        "[class*='save'][class*='draft']",
        "#edui1_btn_save",
    ],
    # 新建图文素材按钮
    "new_article_btn": [
        "a:has-text('写新图文')",
        "a:has-text('新建图文素材')",
        "[class*='new-article']",
    ],
}

EDITOR_URL_GLOB = "**/cgi/appmsg?t=media/appmsg_edit**"
MATERIAL_LIST_URL = (
    "https://mp.weixin.qq.com/cgi-bin/appmsg"
    "?t=media/appmsg_edit_list&action=list&type=10&lang=zh_CN&token={token}"
)
COOKIES_PATH = WECHAT_FLOW_FILM / "cookies.json"


# ── 凭证加载 ──────────────────────────────────────────────────

def _load_credentials() -> dict:
    """双源加载: config.env + 环境变量。"""
    cred = {"appid": "", "secret": ""}
    env_file = ROOT / "config.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" not in line or line.startswith("#"):
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip("\"'")
            if k == "WECHAT_APPID":
                cred["appid"] = v
            elif k == "WECHAT_APPSECRET":
                cred["secret"] = v
    cred["appid"] = cred["appid"] or os.environ.get("WECHAT_APPID", "")
    cred["secret"] = cred["secret"] or os.environ.get("WECHAT_APPSECRET", "")
    return cred


# ── 轨 A: 官方 API ─────────────────────────────────────────────

def _route_api(title: str, html: str, digest: str, cover_path: Path) -> dict:
    sys.path.insert(0, str(WECHAT_FLOW_TOOLKIT))
    from wechat_api import get_access_token, upload_thumb  # type: ignore
    from publisher import create_draft  # type: ignore

    cred = _load_credentials()
    if not cred["appid"] or not cred["secret"]:
        raise RuntimeError(
            "缺少 AppID/Secret — 在 config.env 里填 WECHAT_APPID / WECHAT_APPSECRET。"
            "个人订阅号也能用 draft/add。"
        )

    access_token = get_access_token(cred["appid"], cred["secret"])
    thumb_media_id = None
    if cover_path and cover_path.exists():
        thumb_media_id = upload_thumb(access_token, str(cover_path))

    result = create_draft(
        access_token=access_token,
        title=title, html=html, digest=digest,
        thumb_media_id=thumb_media_id,
    )
    return {"route": "api", "media_id": getattr(result, "media_id", str(result)), "ok": True}


# ── 轨 B: Playwright（完整版） ───────────────────────────────────

def _first_match(page, selectors: list[str], label: str = "element"):
    """多选择器降级匹配。找到第一个存在的元素就返回。"""
    for sel in selectors:
        try:
            el = page.wait_for_selector(sel, timeout=3000, state="attached")
            if el:
                return el
        except Exception:
            continue
    raise RuntimeError(
        f"轨 B 未找到{label} — 已尝试:\n  " + "\n  ".join(selectors) +
        f"\n⚠️  这是待实测选择器，第一次跑通后要用 Playwright Inspector 替换"
    )


def _inject_html_into_contenteditable(page, selector: str, html: str) -> None:
    """把 HTML 注入 contenteditable 元素。用 innerHTML（不是 .fill，因为 .fill 会转义 HTML）。"""
    page.evaluate(
        """
        ([sel, html]) => {
            const el = document.querySelector(sel);
            if (!el) throw new Error('element not found: ' + sel);
            el.innerHTML = html;
            // 触发 input 事件，让微信编辑器框架知道内容变了
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        }
        """,
        [selector, html],
    )


def _save_playwright(page) -> str:
    """点"保存草稿"，等待保存成功。返回 media_id 或 URL。"""
    save_btn = _first_match(page, SELECTORS["save_btn"], "保存草稿按钮")
    save_btn.click()
    # 保存成功后编辑器会关闭 / 弹窗提示 / 跳素材列表
    try:
        page.wait_for_url("**/appmsg_edit_list**", timeout=15000)
    except Exception:
        try:
            page.wait_for_selector("text=保存成功", timeout=10000)
        except Exception:
            pass  # 有些版本没任何提示

    # 从 URL 或最近草稿卡片里抽 media_id
    url = page.url
    m = re.search(r"media_id=(\d+)", url) or re.search(r"mid=(\d+)", url)
    if m:
        return m.group(1)

    # 退而求其次：从草稿卡片里找最新的那个
    try:
        latest = page.query_selector("[class*='draft']:first-child a, [data-mid]:first-child")
        if latest:
            mid = latest.get_attribute("data-mid") or ""
            if mid:
                return mid
    except Exception:
        pass
    return "saved_no_id"


def _route_playwright(title: str, html: str, digest: str, cover_path: Path,
                      headless: bool = False) -> dict:
    """轨 B：Playwright 浏览器自动化。

    流程:
      1. 读 cookies.json（Phase 1.2 auth.py login 生成）
      2. 进公众号后台素材列表
      3. 点"写新图文"进编辑器
      4. 注入标题
      5. 注入摘要
      6. 注入封面（选本地文件，微信自动调 thumb_media_id）
      7. 注入正文 HTML（innerHTML → contenteditable）
      8. 点"保存草稿"
      9. 返回 media_id

    所有 contenteditable 注入都用 evaluate 设置 innerHTML，
    因为 page.fill() 会转义 HTML 标签成纯文本。
    """
    from playwright.sync_api import sync_playwright

    if not COOKIES_PATH.exists():
        raise RuntimeError(
            f"cookies.json 不存在（{COOKIES_PATH}） — 先跑:\n"
            f"  cd ../wechat-flow-film && python3 auth.py login"
        )

    # 从 cookies.json 或 storage_state 里切 token
    token = ""
    try:
        storage = json.loads(COOKIES_PATH.read_text())
        for c in storage.get("cookies", []):
            if c.get("name") == "slave_sid":
                pass  # token 通常在 URL params 里，不直接存 cookie
        # storage_state 里 pages[0].url 有 token（Playwright 持久化格式）
        pages = storage.get("pages", [])
        if pages:
            m = re.search(r"[?&]token=(\d+)", pages[0].get("url", ""))
            if m:
                token = m.group(1)
    except Exception:
        pass

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        ctx = browser.new_context(storage_state=str(COOKIES_PATH))
        page = ctx.new_page()

        # 1. 进素材列表
        if token:
            page.goto(MATERIAL_LIST_URL.format(token=token), wait_until="domcontentloaded", timeout=20000)
        else:
            page.goto("https://mp.weixin.qq.com/", wait_until="domcontentloaded", timeout=20000)
            # 等跳转到带 token 的 URL（登录后会自动跳转）
            try:
                page.wait_for_url("**token=**", timeout=15000)
            except Exception:
                pass
            m = re.search(r"[?&]token=(\d+)", page.url)
            if m:
                token = m.group(1)

        if not token:
            raise RuntimeError("Playwright 登录态过期 — 重新扫一次码")

        # 2. 点"写新图文"进编辑器
        try:
            new_btn = _first_match(page, SELECTORS["new_article_btn"], "'写新图文' 按钮")
            new_btn.click()
            page.wait_for_url(EDITOR_URL_GLOB, timeout=15000)
        except RuntimeError:
            # 有些版本直接有编辑器入口，退而尝试直接导航
            page.goto(MATERIAL_LIST_URL.format(token=token).replace("list&type=10", "edit&type=10"),
                      wait_until="domcontentloaded", timeout=20000)

        # 3. 注入标题
        # ⚠️ 标题元素可能是 input 也可能是 contenteditable — 记录真实 selector
        title_sel = None
        for sel in SELECTORS["title_field"]:
            if page.query_selector(sel):
                title_sel = sel
                break
        if title_sel:
            try:
                if "contenteditable" in title_sel or "edui1_title" in title_sel:
                    _inject_html_into_contenteditable(page, title_sel, title)
                else:
                    title_el = page.query_selector(title_sel)
                    title_el.fill("")
                    title_el.fill(title)
                print(f"  ✅ 标题已注入: {title}")
            except Exception as e:
                print(f"  ⚠️  标题注入失败（非阻塞）: {e}")

        # 4. 注入摘要
        if digest:
            try:
                digest_el = _first_match(page, SELECTORS["digest_field"], "摘要字段")
                digest_el.fill("")
                digest_el.fill(digest[:120])
                print(f"  ✅ 摘要已注入")
            except RuntimeError as e:
                print(f"  ⚠️  摘要注入失败（非阻塞）: {e}")

        # 5. 注入封面（选本地文件）
        if cover_path and cover_path.exists():
            try:
                # 微信编辑器的封面上传通常是 file input + 预览区域
                file_input = page.query_selector("input[type='file']")
                if file_input:
                    file_input.set_input_files(str(cover_path))
                    print(f"  ✅ 封面已上传: {cover_path}")
                else:
                    print(f"  ⚠️  未找到 file input — 封面可能没传")
            except Exception as e:
                print(f"  ⚠️  封面上传失败: {e}")

        # 6. 注入正文（核心步骤 — innerHTML → contenteditable）
        # ⚠️ 这是最关键的选择器，第一次跑通后要确认是哪个
        content_sel = None
        for sel in SELECTORS["content_editor"]:
            try:
                if page.query_selector(sel):
                    content_sel = sel
                    break
            except Exception:
                continue
        if not content_sel:
            raise RuntimeError(
                "⚠️  未找到编辑器 contenteditable — 用 Playwright Inspector 看一下编辑器里"
                "正文区域的真实 selector，常见模式有 #edui1_body / #ueditor_0"
            )

        _inject_html_into_contenteditable(page, content_sel, html)
        print(f"  ✅ 正文已注入 ({len(html)} chars, selector={content_sel})")

        # 7. 保存草稿
        media_id = _save_playwright(page)
        print(f"  ✅ 草稿已保存 media_id={media_id}")

        ctx.storage_state(path=str(COOKIES_PATH))  # 更新 cookie
        browser.close()

    return {
        "route": "playwright",
        "media_id": media_id,
        "ok": True,
        "editor_selector_used": content_sel,  # 回传给 run_daily.sh 用于调试
    }


# ── 主入口 ──────────────────────────────────────────────────

def publish(title: str, html_path: Path, digest: str, cover_path: Path,
            route: str | None = None, config_path: Path = Path("config.yaml"),
            headless: bool = False) -> dict:
    try:
        import yaml  # lazy import（轨 B 不需要）
    except ImportError:
        yaml = None

    html = html_path.read_text(encoding="utf-8")
    config = {}
    if yaml and config_path.exists():
        config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}

    chosen = route or (config.get("draft_route") if isinstance(config, dict) else None) or "playwright"

    print(f"[publish_draft] route={chosen} title='{title[:40]}...' html={len(html)} chars")

    if chosen == "api":
        return _route_api(title, html, digest, cover_path)
    elif chosen == "playwright":
        return _route_playwright(title, html, digest, cover_path, headless=headless)
    else:
        raise ValueError(f"未知 draft_route: {chosen}，应为 api / playwright")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("html", help="排版后的 HTML 文件路径")
    p.add_argument("--title", required=True)
    p.add_argument("--digest", default="")
    p.add_argument("--cover", default="")
    p.add_argument("--route", choices=["api", "playwright"], help="手动指定轨")
    p.add_argument("--config", default="config.yaml")
    p.add_argument("--headless", action="store_true", default=True,
                   help="Playwright headless 模式（默认 True；Phase 1.4 调试时可 --no-headless）")
    p.add_argument("--no-headless", dest="headless", action="store_false")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    cover = Path(args.cover) if args.cover else Path("")
    result = publish(
        title=args.title,
        html_path=Path(args.html),
        digest=args.digest,
        cover_path=cover,
        route=args.route,
        config_path=Path(args.config),
        headless=args.headless,
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"[publish_draft] ok={result.get('ok')} route={result.get('route')} "
              f"media_id={result.get('media_id')}")


if __name__ == "__main__":
    main()
