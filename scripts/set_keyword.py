"""日期关键词自动回复（YYYYMMDD 每日 +1）。

封装 wechat-flow-film/keyword.py 的 set_auto_reply / delete_keyword_if_exists /
compute_next_keyword，和 publish_draft.py 共用 cookies.json 持久化登录态。

流程:
  1. 从 history.json 读上次跑的日期（wechat-loop 自己的 history）
  2. compute_next_keyword(last_date) → 明天的 YYYYMMDD
  3. 起 Playwright 读 cookies.json 进公众号后台
  4. delete_keyword_if_exists （防重复）
  5. set_auto_reply（关键词 = YYYYMMDD，回复 = 预设的站点列表）
  6. 更新 history.json

回复内容读 config.env 的 WECHAT_KEYWORD_REPLY（或用 --reply-file 指定），没配则报错退出。

用法:
    python3 scripts/set_keyword.py                       # 自动算明天日期 + config.env 里的回复
    python3 scripts/set_keyword.py --date 20261113       # 手动指定日期
    python3 scripts/set_keyword.py --reply-file sites.txt # 自定义回复内容
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WECHAT_FLOW_FILM = ROOT.parent / "wechat-flow-film"
COOKIES_PATH = WECHAT_FLOW_FILM / "cookies.json"
HISTORY_PATH = ROOT / "loop" / "history.json"

# 回复内容不入代码 —— 从 --reply-file / config.env / 环境变量读取
DEFAULT_REPLY = ""


def load_history() -> list[dict]:
    if not HISTORY_PATH.exists():
        return []
    try:
        return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def last_keyword_date() -> str | None:
    """从 history.json 里找最近一条 keyword 设置记录。"""
    for e in reversed(load_history()):
        if "keyword_date" in e:
            return str(e["keyword_date"])
    return None


def load_reply_content(reply_file: str = "") -> str:
    """回复内容优先级: --reply-file > config.env > 环境变量。都没配返回空串。"""
    if reply_file and Path(reply_file).exists():
        return Path(reply_file).read_text(encoding="utf-8").strip()

    # config.env
    env_file = ROOT / "config.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("WECHAT_KEYWORD_REPLY="):
                return line.split("=", 1)[1].strip().strip("\"'")

    env_reply = os.environ.get("WECHAT_KEYWORD_REPLY", "").strip()
    if env_reply:
        return env_reply

    return DEFAULT_REPLY


def run(keyword_date: str, reply_text: str, headless: bool = True) -> dict:
    """完整跑一遍。返回 {keyword_date, ok, reply_text}。"""
    from playwright.sync_api import sync_playwright

    # 确保上游 keyword.py 能被 import
    sys.path.insert(0, str(WECHAT_FLOW_FILM))
    import keyword as kw  # noqa: E402 — 上游有遮蔽修复，正常 import 即可

    if not COOKIES_PATH.exists():
        raise RuntimeError(
            f"cookies.json 不存在（{COOKIES_PATH}）— 先跑:\n"
            f"  cd ../wechat-flow-film && python3 auth.py login"
        )

    print(f"[set_keyword] 目标日期: {keyword_date}")
    print(f"[set_keyword] 回复长度: {len(reply_text)} 字")

    result = {"keyword_date": keyword_date, "ok": False, "reply_text": reply_text}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        ctx = browser.new_context(storage_state=str(COOKIES_PATH))
        page = ctx.new_page()

        try:
            # 先导航到后台首页，让 cookies 生效 + 拿到 token
            page.goto("https://mp.weixin.qq.com/", wait_until="domcontentloaded", timeout=20000)
            print(f"[set_keyword] 当前 URL: {page.url[:80]}...")

            # 删旧的（如果有）
            deleted = kw.delete_keyword_if_exists(page, keyword_date)
            print(f"[set_keyword] delete_keyword_if_exists: {'OK' if deleted else 'skip'}")

            # 设新的
            reply_id = kw.set_auto_reply(page, keyword_date, reply_text)
            result["ok"] = reply_id is not None
            result["reply_id"] = str(reply_id) if reply_id else ""
            print(f"[set_keyword] set_auto_reply: {'OK reply_id=' + str(reply_id) if reply_id else 'FAIL'}")

        finally:
            ctx.storage_state(path=str(COOKIES_PATH))
            browser.close()

    # 写 history.json
    entries = load_history()
    entries.append({
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "article_id": f"keyword_{keyword_date}",
        "title": f"关键词自动回复: {keyword_date}",
        "keyword_date": keyword_date,
        "kind": "keyword_auto_reply",
    })
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[set_keyword] history.json 已更新（累计 {len(entries)} 条）")

    return result


def main():
    p = argparse.ArgumentParser(description="设置 YYYYMMDD 日期关键词自动回复")
    p.add_argument("--date", help="手动指定日期，格式 YYYYMMDD（默认自动算明天）")
    p.add_argument("--reply-file", help="自定义回复内容的文本文件")
    p.add_argument("--headless", action="store_true", default=True)
    p.add_argument("--no-headless", dest="headless", action="store_false")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    # 算日期
    if args.date:
        keyword_date = args.date
    else:
        sys.path.insert(0, str(WECHAT_FLOW_FILM))
        import keyword as kw  # noqa: E402
        last = last_keyword_date()
        keyword_date = kw.compute_next_keyword(last)
        print(f"[set_keyword] last_date={last!r} → next={keyword_date}")

    reply_text = load_reply_content(args.reply_file)
    if not reply_text:
        print("[set_keyword] ❌ 未配置回复内容 —— 在 config.env 设置 WECHAT_KEYWORD_REPLY，"
              "或用 --reply-file 指定文本文件", file=sys.stderr)
        sys.exit(1)

    try:
        result = run(keyword_date, reply_text, headless=args.headless)
    except Exception as e:
        print(f"[set_keyword] ❌ 失败: {e}")
        sys.exit(1)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        status = "✅" if result["ok"] else "❌"
        print(f"\n{status} set_keyword {result['keyword_date']}: ok={result['ok']}")


if __name__ == "__main__":
    main()
