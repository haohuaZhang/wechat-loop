"""wechat-loop 采集模块 — 基于 wechat-digest-skill 二次开发，把目标公众号的历史文章采进知识库。

知识库的文章来源是**任意目标公众号**（不限于自己运营的号），两条采集路径：
  1. 目标号（知识库主路径）：/cgi-bin/appmsg + searchbiz — 走 mp后台 token + cookie。
     需要先登录 mp.weixin.qq.com 拿到 token（URL 里）和整行 cookie（F12），
     或等 Phase 1.2 跑 auth.py login 后读 cookies.json（Playwright 持久化格式）。
  2. 自己号（可选，用于复盘自己发过的内容）：material/batchget_material —
     走 access_token（AppID/Secret），不碰 cookie，频控更松。

输出: 直接更新 loop/knowledge_base.json + loop/kb/{account}/{slug}.md

用法:
    # 采集目标公众号历史文章（知识库主路径，先把 token+cookie 配好）
    python3 scripts/collect.py "影视风" --count 10 --since 2026-01-01

    # 自己号（可选，先把 AppID/Secret 填进 config.env）
    python3 scripts/collect.py self --count 20

    # credentials.json 会自动读取（../wechat-digest-skill/credentials.json），无需额外参数
"""
from __future__ import annotations

import argparse
import json
import hashlib
import os
import re
import sys
import time
import random
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import requests

ROOT = Path(__file__).resolve().parent.parent
PROFILE_DIR = os.environ.get("CHROME_PROFILE", str(Path.home() / ".chrome-profile"))
STATE_DIR = Path.home() / ".cache" / "chrome-devtools-mcp" / "chrome-profile"
MP_BASE = "https://mp.weixin.qq.com"
REQ_DELAY_MIN, REQ_DELAY_MAX = 1.5, 3.5
CONTENT_DELAY_MIN, CONTENT_DELAY_MAX = 2.0, 4.0
FREQ_COOLDOWN = 300
FREQ_COOLDOWN_FACTOR = 1.5
MAX_FREQ_RETRIES = 3
CONTENT_RETRIES = 3
CONTENT_BLOCKED_COOLDOWN = 60
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


# ── 异常 ──────────────────────────────────────────────────

class AuthError(Exception): ...
class FreqControlError(Exception): ...
class ApiError(Exception): ...


# ── 凭证加载（三源兼容） ────────────────────────────────────────

def load_credentials() -> dict:
    """返回 {'appid', 'secret', 'token', 'cookie', 'cookies_json'} — 任何一项可能为空。"""
    cred = {"appid": "", "secret": "", "token": "", "cookie": "", "cookies_json": ""}

    # 1. 环境变量（优先级最高）
    cred["appid"] = os.environ.get("WECHAT_APPID", "").strip()
    cred["secret"] = os.environ.get("WECHAT_APPSECRET", "").strip()
    cred["token"] = os.environ.get("WECHAT_TOKEN", "").strip()
    cred["cookie"] = os.environ.get("WECHAT_COOKIE", "").strip()

    # 2. config.env（source 里 parse dotenv 简化版）
    env_file = ROOT / "config.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip("\"'")
            if k == "WECHAT_APPID" and not cred["appid"]:
                cred["appid"] = v
            elif k == "WECHAT_APPSECRET" and not cred["secret"]:
                cred["secret"] = v
            elif k == "WECHAT_TOKEN" and not cred["token"]:
                cred["token"] = v
            elif k == "WECHAT_COOKIE" and not cred["cookie"]:
                cred["cookie"] = v

    # 3. Playwright cookies.json（Phase 1.2 后自动生成）
    cookie_file = ROOT / "../wechat-flow-film/cookies.json"
    if cookie_file.exists():
        try:
            data = json.loads(cookie_file.read_text())
            cookies = data.get("cookies", [])
            cred["cookies_json"] = str(cookies)
            cred["cookie"] = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
            # 从 URL 里切 token（Playwright 持久化的 storage_state 不带 URL，但 state 目录可能带）
            if not cred["token"]:
                for search_dir in (Path(PROFILE_DIR), STATE_DIR, ROOT.parent / ".chrome-ide-profile"):
                    if not search_dir.exists():
                        continue
                    for f in search_dir.rglob("*.json"):
                        if f.stat().st_size < 20000:
                            try:
                                txt = f.read_text(errors="ignore")
                                m = re.search(r"[?&]token=(\d+)", txt)
                                if m:
                                    cred["token"] = m.group(1)
                                    break
                            except Exception:
                                pass
                    if cred["token"]:
                        break
        except Exception:
            pass

    # 4. 上游 credentials.json（wechat-digest-skill 兼容）
    upstream_cred = ROOT.parent / "wechat-digest-skill" / "credentials.json"
    if upstream_cred.exists():
        try:
            data = json.loads(upstream_cred.read_text())
            cred["token"] = cred["token"] or str(data.get("token", "")).strip()
            cred["cookie"] = cred["cookie"] or str(data.get("cookie", "")).strip()
        except Exception:
            pass

    # 过滤占位符
    for k in ("token", "cookie"):
        if cred[k] in ("", "在此粘贴 token 数字", "在此粘贴完整 cookie 字符串"):
            cred[k] = ""

    return cred


# ── Session 初始化 ──────────────────────────────────────────────

def make_session(cookie: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": MP_BASE + "/",
    })
    if cookie:
        s.headers["Cookie"] = cookie
    return s


# ── 轨 A1: 自己号 — material API ─────────────────────────────────
# 走 access_token（AppID/Secret），最稳，频控宽松。
# 微信官方接口，个人号也能用（draft/add / material/batchget_material）。

def get_access_token(appid: str, secret: str) -> str:
    url = "https://api.weixin.qq.com/cgi-bin/token"
    r = requests.get(url, params={"grant_type": "client_credential",
                                  "appid": appid, "secret": secret}, timeout=10)
    data = r.json()
    if "access_token" in data:
        return data["access_token"]
    raise AuthError(f"access_token 获取失败: {data}")


def fetch_self_articles(access_token: str, count: int = 20) -> list[dict]:
    """从自己号永久素材接口拉已发布图文列表。"""
    articles = []
    begin = 0
    while begin < count:
        r = requests.post(
            "https://api.weixin.qq.com/cgi-bin/material/batchget_material",
            params={"access_token": access_token},
            json={"type": "news", "offset": begin, "count": min(20, count - begin)},
            timeout=15,
        )
        data = r.json()
        if "item" not in data:
            raise ApiError(f"batchget_material 返回异常: {data}")
        for item in data["item"]:
            # news item 里可能有多篇（单 item 是一个发布批次，可能含 1-8 篇）
            for news in item.get("content", {}).get("news_item", []) or []:
                articles.append({
                    "title": news.get("title", ""),
                    "digest": news.get("digest", ""),
                    "url": news.get("url", ""),
                    "thumb_url": news.get("thumb_url", ""),
                    "update_time": news.get("update_time", 0),
                })
        begin += 20
        if data.get("total_count", 0) <= begin:
            break
    return articles


# ── 轨 A2: 竞品号 — mp 后台 JSON 接口 ─────────────────────────────

def polite_sleep(lo, hi):
    time.sleep(lo + random.random() * (hi - lo))


def api_get(session: requests.Session, token: str, path: str, extra_params: dict) -> dict:
    params = {"token": token, "lang": "zh_CN", "f": "json", "ajax": "1"}
    params.update(extra_params)
    url = MP_BASE + path

    for attempt in range(MAX_FREQ_RETRIES + 1):
        polite_sleep(REQ_DELAY_MIN, REQ_DELAY_MAX)
        try:
            r = session.get(url, params=params, timeout=20)
        except requests.RequestException as e:
            if attempt < MAX_FREQ_RETRIES:
                time.sleep(2 ** attempt + random.random())
                continue
            raise ApiError(f"网络请求失败: {e}")

        try:
            data = r.json()
        except ValueError:
            raise AuthError("接口未返回 JSON — token/cookie 失效被重定向登录页")

        ret = (data.get("base_resp") or {}).get("ret", 0)
        err = (data.get("base_resp") or {}).get("err_msg", "")
        if ret == 0:
            return data
        if ret == 200013:
            if attempt < MAX_FREQ_RETRIES:
                wait = int(FREQ_COOLDOWN * (FREQ_COOLDOWN_FACTOR ** attempt))
                print(f"   ⏳ 命中频控 200013，冷却 {wait}s 后重试")
                time.sleep(wait)
                continue
            raise FreqControlError("多次重试仍被频控，减 --count 或隔一段时间再跑")
        if ret in (200003, 200002, -3) or "session" in str(err).lower() or "token" in str(err).lower():
            raise AuthError(f"凭证失效 ret={ret} err={err}")
        raise ApiError(f"接口错误 ret={ret} err={err}")


def search_biz(session, token, name) -> tuple[str, str]:
    data = api_get(session, token, "/cgi-bin/searchbiz",
                   {"action": "search_biz", "begin": "0", "count": "5", "query": name})
    lst = data.get("list") or []
    if not lst:
        raise ApiError(f"未搜到公众号「{name}」")
    chosen = next((b for b in lst if b.get("nickname") == name), None) or lst[0]
    return chosen.get("fakeid"), chosen.get("nickname", name)


def fetch_content(url: str) -> str:
    """抓单篇正文 HTML → 清洗。用 trafilatura（lazy import，--help 不依赖）。"""
    try:
        import trafilatura
    except ImportError as e:
        raise RuntimeError("缺少依赖 trafilatura —— 运行: pip install trafilatura") from e
    for attempt in range(CONTENT_RETRIES):
        polite_sleep(CONTENT_DELAY_MIN, CONTENT_DELAY_MAX)
        try:
            downloaded = trafilatura.fetch_url(url)
            if downloaded:
                text = trafilatura.extract(downloaded, include_comments=False,
                                           include_tables=False, no_fallback=True) or ""
                if text.strip() and len(text) > 50:
                    return text
        except Exception:
            pass
        if attempt < CONTENT_RETRIES - 1:
            time.sleep(CONTENT_BLOCKED_COOLDOWN * (attempt + 1))
    return ""


def collect_competitor(session, token, name: str, count: int, since: str = "") -> list[dict]:
    """采集竞品号: searchbiz → /cgi-bin/appmsg 列表 → 逐篇抓正文。"""
    fakeid, nickname = search_biz(session, token, name)
    print(f"   fakeid={fakeid} nickname={nickname}")

    articles: list[dict] = []
    begin = 0
    since_ts = 0
    if since:
        try:
            since_ts = int(datetime.strptime(since, "%Y-%m-%d").timestamp())
        except ValueError:
            pass

    while len(articles) < count:
        data = api_get(session, token, "/cgi-bin/appmsg",
                       {"action": "list_appmsg", "fakeid": fakeid,
                        "begin": begin, "count": 10})
        appmsgex = data.get("appmsgex") or []
        if not appmsgex:
            break

        for msg in appmsgex:
            ts = int(msg.get("update_time", 0))
            if since_ts and ts < since_ts:
                break  # 已早于截止日期，按发布时间倒序可以停了
            ext = msg.get("app_msg_ext_info") or {}
            # 主篇 + 所有副篇（multi_app_msg_item_list 在 app_msg_ext_info 里）
            all_items = [ext] + (ext.get("multi_app_msg_item_list") or [])
            for sub in all_items:
                title = sub.get("title", "")
                url = sub.get("content_url", "")
                if not title or not url:
                    continue
                content = fetch_content(url)
                articles.append({
                    "title": title,
                    "url": url,
                    "content": content,
                    "digest": sub.get("digest", ""),
                    "thumb_url": sub.get("cover_url", ""),
                    "publish_date": datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else "",
                })
                if len(articles) >= count:
                    break
            if len(articles) >= count:
                break
        begin += 10

    return articles


# ── knowledge_base.json 读写 ───────────────────────────────────

KB_PATH = ROOT / "loop" / "knowledge_base.json"
KB_DIR = ROOT / "loop" / "kb"


def load_kb() -> dict:
    if not KB_PATH.exists():
        return {"version": "1.0", "accounts": {}, "articles": {}}
    return json.loads(KB_PATH.read_text(encoding="utf-8"))


def save_kb(kb: dict):
    KB_PATH.write_text(json.dumps(kb, ensure_ascii=False, indent=2), encoding="utf-8")


def slug(title: str) -> str:
    """标题 → 安全文件名。"""
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "-", title)
    s = s.strip("-")[:60]
    return s or "untitled"


def merge_into_kb(kb: dict, account_key: str, account_name: str,
                  articles: list[dict]) -> int:
    """把采集到的文章合入 knowledge_base.json，返回新增数。"""
    KB_DIR.mkdir(parents=True, exist_ok=True)
    acc_dir = KB_DIR / account_key
    acc_dir.mkdir(parents=True, exist_ok=True)

    kb.setdefault("accounts", {})
    kb.setdefault("articles", {})
    kb["accounts"].setdefault(account_key, {"name": account_name, "biz": "",
                                             "last_collected": ""})

    added = 0
    seen = set(kb["articles"].keys())
    for art in articles:
        url = art.get("url", "")
        title = art.get("title", "")
        if not title:
            continue
        aid = hashlib.md5(url.encode()).hexdigest()[:12] if url else slug(title)
        if aid in seen:
            continue

        content = art.get("content", "")
        md_path = acc_dir / f"{art.get('publish_date', '')}_{slug(title)}.md"
        if not md_path.name.startswith("None"):
            md_path.write_text(f"# {title}\n\n{content}\n", encoding="utf-8")

        # 简易关键词/主题抽取（TF-IDF 会再处理，这里只粗提）
        body = f"{title} {content[:500]}"
        kw_tokens = list(set(t for t in re.split(r"[\s，。！？、]+", body) if 2 <= len(t) <= 10))[:8]

        kb["articles"][aid] = {
            "source_account": account_key,
            "title": title,
            "publish_date": art.get("publish_date", ""),
            "url": url,
            "local_md_path": str(md_path.relative_to(ROOT)),
            "word_count": len(content),
            "topics": [],
            "keywords": kw_tokens[:6],
            "crossRefs": [],
            "used_as_source": False,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        seen.add(aid)
        added += 1

    kb["accounts"][account_key]["last_collected"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return added


# ── 主入口 ──────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="采集公众号文章进 knowledge_base.json")
    p.add_argument("account", help="账号名: 'self' 走 material API；其它名称走 searchbiz")
    p.add_argument("--count", type=int, default=20, help="采集数量（自己号=永久素材，竞品=列表数）")
    p.add_argument("--since", default="", help="竞品号截止日期 YYYY-MM-DD（只采集这天之后）")
    args = p.parse_args()

    cred = load_credentials()
    kb = load_kb()
    account = args.account

    print(f"═══ wechat-loop collect ═══  account={account}  count={args.count}")

    if account == "self":
        # ── 自己号：优先 material API，退而用 token/cookie ──
        articles: list[dict] = []
        if cred["appid"] and cred["secret"]:
            print("路径 A1: material/batchget_material（access_token）")
            try:
                token = get_access_token(cred["appid"], cred["secret"])
                raw = fetch_self_articles(token, args.count)
                print(f"  拉到 {len(raw)} 篇")
                for r in raw:
                    content = fetch_content(r["url"]) if r.get("url") else ""
                    ts = r.get("update_time", 0)
                    articles.append({
                        "title": r["title"], "url": r["url"],
                        "content": content, "digest": r.get("digest", ""),
                        "publish_date": datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else "",
                    })
            except AuthError as e:
                print(f"  ❌ access_token 失败: {e}")
                print("  降级到 token+cookie 路径...")
            except Exception as e:
                print(f"  ❌ material API 错误: {e}")

        if not articles:
            # 退而用 token/cookie + searchbiz 自己号
            if cred["token"] and cred["cookie"]:
                print("路径 A2: searchbiz + /cgi-bin/appmsg（token+cookie）")
                try:
                    sess = make_session(cred["cookie"])
                    articles = collect_competitor(sess, cred["token"], account, args.count, args.since)
                except (AuthError, FreqControlError, ApiError) as e:
                    print(f"  ❌ {e}")
                    sys.exit(2)
            else:
                print("  ❌ 自己号采集需要 AppID/Secret 或 token+cookie")
                print("     AppID/Secret: 公众平台后台 → 设置与开发")
                print("     token: mp.weixin.qq.com URL 末尾 token= 后的数字")
                print("     cookie: F12 → Application → Cookies → 复制整行")
                sys.exit(1)

        added = merge_into_kb(kb, "self", account, articles)
        save_kb(kb)
        print(f"✅ 自己号: 新增 {added}/{len(articles)} 篇 → KB 共 {len(kb['articles'])} 篇")

    else:
        # ── 竞品号：必须 token + cookie ──
        if not cred["token"] or not cred["cookie"]:
            print(f"  ❌ 竞品号「{account}」需要 token + cookie")
            sys.exit(1)
        sess = make_session(cred["cookie"])
        try:
            articles = collect_competitor(sess, cred["token"], account, args.count, args.since)
        except FreqControlError as e:
            print(f"  ❌ 频控: {e}")
            sys.exit(3)
        except AuthError as e:
            print(f"  ❌ 凭证失效: {e} — 重新登录 mp.weixin.qq.com")
            sys.exit(2)
        account_key = re.sub(r"[^\w]", "_", account)[:20]
        added = merge_into_kb(kb, account_key, account, articles)
        save_kb(kb)
        print(f"✅ 竞品号 {account}: 新增 {added}/{len(articles)} 篇 → KB 共 {len(kb['articles'])} 篇")


if __name__ == "__main__":
    main()
