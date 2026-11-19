"""
bridge.py —— 在 wechat-mp-tools Flask app 上追加 wechat-loop 专属端点

不修改上游源码，通过 import app_mp.app 并追加路由实现。
启动：python3 backend/bridge.py → 127.0.0.1:5200（与 wechat-mp-tools 同端口）

新增端点：
  GET  /api/kb           列出所有知识库（loop/knowledge_base.json + loop/kb/*.json）
  POST /api/kb           新增知识库
  POST /api/kb/active    切换活动知识库

复用上游已有端点（前端 api/client.js 已适配）：
  GET  /api/articles/history                      下载历史（任务列表）
  GET  /api/articles/download-status/<task_id>    轮询采集进度
  POST /api/accounts/search                       搜索公众号
  POST /api/articles/collect-latest               启动采集
  GET  /api/articles/list/<fakeid>                文章列表
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from pathlib import Path

# 把 wechat-mp-tools 加入 sys.path —— 不修改上游源码
WMT_DIR = Path(__file__).resolve().parent.parent / "wechat-mp-tools"
if str(WMT_DIR) not in sys.path:
    sys.path.insert(0, str(WMT_DIR))

from app_mp import app  # noqa: E402  —— 导入 Flask app（上游只读）

# ---- 知识库数据源 ----
# LOOP_ROOT 必须是「仓库根目录」（loop/ 的父级）。这里做一次探测而不是
# 直接写死 parent.parent：历史上这里写成 parent.parent.parent，导致
# KB_DIR 指到仓库外，知识库永远读成 0 篇。
def _pick_loop_root() -> Path:
    here = Path(__file__).resolve().parent
    for cand in (here.parent, here.parent.parent):
        if (cand / "loop").is_dir():
            return cand
    return here.parent


LOOP_ROOT = _pick_loop_root()
KB_DIR = LOOP_ROOT / "loop"
MAIN_KB = KB_DIR / "knowledge_base.json"
ACTIVE_KB_FILE = KB_DIR / ".active_kb"  # 记录当前活动的 KB id


def _ensure_dirs() -> None:
    KB_DIR.mkdir(parents=True, exist_ok=True)
    (KB_DIR / "kb").mkdir(parents=True, exist_ok=True)


def _load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _discover_kbs() -> list[dict]:
    """扫描 loop/ 目录下所有知识库文件"""
    _ensure_dirs()
    active_id = ACTIVE_KB_FILE.read_text(encoding="utf-8").strip() if ACTIVE_KB_FILE.exists() else "default"
    kbs = []

    # 主知识库
    main_count = len(_load_json(MAIN_KB, [])) if MAIN_KB.exists() else 0
    kbs.append({
        "id": "default",
        "name": "主知识库",
        "path": "loop/knowledge_base.json",
        "isActive": active_id == "default",
        "articleCount": main_count,
    })

    # loop/kb/*.json —— 用户自建
    kb_sub_dir = KB_DIR / "kb"
    for f in sorted(kb_sub_dir.glob("*.json")):
        kb_id = f.stem
        count = len(_load_json(f, []))
        kbs.append({
            "id": kb_id,
            "name": kb_id,  # 用户自定义名称
            "path": f"loop/kb/{f.name}",
            "isActive": active_id == kb_id,
            "articleCount": count,
        })

    # 如果没有任何 active，把主知识库设为 active
    if not any(k["isActive"] for k in kbs):
        for k in kbs:
            if k["id"] == "default":
                k["isActive"] = True
                break
        ACTIVE_KB_FILE.write_text("default", encoding="utf-8")

    return kbs


# ---- 追加路由 ----

@app.route("/api/kb", methods=["GET"])
def list_knowledge_bases():
    """列出所有知识库"""
    from flask import jsonify
    try:
        return jsonify(_discover_kbs())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/active", methods=["POST"])
def set_active_knowledge_base():
    """切换活动知识库"""
    from flask import jsonify, request
    try:
        body = request.get_json(silent=True) or {}
        kb_id = body.get("id")
        if not kb_id:
            return jsonify({"error": "缺少 id 参数"}), 400
        _ensure_dirs()
        ACTIVE_KB_FILE.write_text(kb_id, encoding="utf-8")
        return jsonify({"ok": True, "active": kb_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb", methods=["POST"])
def create_knowledge_base():
    """新增知识库"""
    from flask import jsonify, request
    try:
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        path_str = (body.get("path") or "").strip()
        if not name or not path_str:
            return jsonify({"error": "缺少 name 或 path 参数"}), 400

        # 安全校验：路径必须在 loop/ 下，且是 .json
        if not path_str.startswith("loop/") or not path_str.endswith(".json"):
            return jsonify({"error": "路径必须以 loop/ 开头且以 .json 结尾"}), 400

        full_path = LOOP_ROOT / path_str
        if full_path.exists():
            return jsonify({"error": f"知识库文件已存在：{path_str}"}), 409

        full_path.parent.mkdir(parents=True, exist_ok=True)
        _save_json(full_path, [])

        kb_id = full_path.stem
        return jsonify({
            "id": kb_id,
            "name": name,
            "path": path_str,
            "isActive": False,
            "articleCount": 0,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---- 知识库：检索 / 详情 / 标签 / 导出 ----

def _active_kb_path() -> Path:
    """当前活动知识库文件路径（回退到主知识库）"""
    _ensure_dirs()
    kb_id = ACTIVE_KB_FILE.read_text(encoding="utf-8").strip() if ACTIVE_KB_FILE.exists() else "default"
    if kb_id and kb_id != "default":
        cand = KB_DIR / "kb" / f"{kb_id}.json"
        if cand.exists():
            return cand
    return MAIN_KB


def _kb_articles() -> list[dict]:
    """把两种 KB 结构（dict.articles / list）统一成文章列表"""
    data = _load_json(_active_kb_path(), {})
    out: list[dict] = []
    if isinstance(data, dict):
        for aid, meta in (data.get("articles") or {}).items():
            if isinstance(meta, dict):
                item = dict(meta)
                item.setdefault("id", aid)
                out.append(item)
    elif isinstance(data, list):
        out = [dict(x) for x in data if isinstance(x, dict)]
    for i, item in enumerate(out):
        item.setdefault("id", f"article_{i}")
    return out


def _article_content(item: dict) -> str:
    """正文优先取 content 字段，没有就读 local_md_path"""
    content = item.get("content")
    if isinstance(content, str) and content.strip():
        return content
    rel = item.get("local_md_path") or ""
    if rel:
        p = (LOOP_ROOT / rel).resolve()
        try:
            p.relative_to(LOOP_ROOT.resolve())
        except ValueError:
            return ""
        if p.is_file():
            return p.read_text(encoding="utf-8", errors="replace")
    return ""


def _snippet(text: str, size: int = 110) -> str:
    plain = " ".join(
        line.strip() for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith(("#", "!", "|", ">", "---"))
    )
    plain = plain.replace("**", "").replace("`", "")
    return plain[:size] + ("…" if len(plain) > size else "")


def _kb_item_brief(item: dict) -> dict:
    content = _article_content(item)
    return {
        "id": item.get("id"),
        "title": item.get("title") or "(无标题)",
        "account": item.get("source_account") or item.get("account") or "未知",
        "publishDate": item.get("publish_date") or "",
        "url": item.get("url") or "",
        "topics": item.get("topics") or [],
        "keywords": item.get("keywords") or [],
        "wordCount": item.get("word_count") or (len(content) if content else 0),
        "usedAsSource": bool(item.get("used_as_source")),
        "hasContent": bool(content),
        "snippet": _snippet(content) if content else "",
    }


def _kb_arg(name: str, encoded_name: str, default: str = "") -> str:
    """读取查询参数，优先用 base64url 版本（中文参数必须走这个）"""
    from flask import request

    raw = request.args.get(encoded_name) or ""
    if raw:
        try:
            return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8")
        except Exception:
            return ""
    return request.args.get(name) or default


@app.route("/api/kb/articles", methods=["GET"])
def kb_articles():
    """检索知识库：?qb=(base64) 或 ?q= 关键词 / ab、tb / sort / limit / offset"""
    from flask import jsonify, request

    try:
        q = _kb_arg("q", "qb").strip().lower()
        account = _kb_arg("account", "ab").strip()
        tag = _kb_arg("tag", "tb").strip()
        sort = request.args.get("sort") or "date"
        try:
            limit = max(1, min(200, int(request.args.get("limit") or 50)))
            offset = max(0, int(request.args.get("offset") or 0))
        except ValueError:
            return jsonify({"error": "limit/offset 必须是整数"}), 400

        items = _kb_articles()
        briefs = [_kb_item_brief(x) for x in items]

        if account and account != "all":
            briefs = [b for b in briefs if b["account"] == account]
        if tag:
            briefs = [b for b in briefs if tag in b["topics"] or tag in b["keywords"]]
        if q:
            def hit(b: dict) -> bool:
                haystack = " ".join([
                    b["title"], b["snippet"], " ".join(b["topics"]), " ".join(b["keywords"]),
                ]).lower()
                return q in haystack
            briefs = [b for b in briefs if hit(b)]

        if sort == "words":
            briefs.sort(key=lambda b: b["wordCount"], reverse=True)
            date_source = briefs
        elif sort == "title":
            briefs.sort(key=lambda b: b["title"])
            date_source = briefs
        else:
            date_source = sorted(briefs, key=lambda b: b["publishDate"], reverse=True)

        total = len(date_source)
        page = date_source[offset:offset + limit]

        accounts = {}
        topics = {}
        for b in briefs:
            accounts[b["account"]] = accounts.get(b["account"], 0) + 1
            for t in b["topics"]:
                topics[t] = topics.get(t, 0) + 1

        return jsonify({
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": page,
            "accounts": [{"name": k, "count": v} for k, v in sorted(accounts.items())],
            "topics": [{"name": k, "count": v} for k, v in sorted(topics.items(), key=lambda kv: -kv[1])],
            "kb": str(_active_kb_path().relative_to(LOOP_ROOT)),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/article/<article_id>", methods=["GET"])
def kb_article_detail(article_id: str):
    """单篇详情（含正文）"""
    from flask import jsonify

    try:
        for item in _kb_articles():
            if str(item.get("id")) == article_id:
                brief = _kb_item_brief(item)
                brief["content"] = _article_content(item)
                return jsonify(brief)
        return jsonify({"error": f"知识库里没有这篇文章：{article_id}"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/export", methods=["GET"])
def kb_export():
    """导出：?format=md|json&q=&account=&tag=（沿用列表的筛选条件）"""
    import io
    import zipfile

    from flask import Response, jsonify, request

    try:
        fmt = (request.args.get("format") or "md").lower()
        q = _kb_arg("q", "qb").strip().lower()
        account = _kb_arg("account", "ab").strip()
        tag = _kb_arg("tag", "tb").strip()

        items = _kb_articles()
        briefs = [_kb_item_brief(x) for x in items]
        if account and account != "all":
            briefs = [b for b in briefs if b["account"] == account]
        if tag:
            briefs = [b for b in briefs if tag in b["topics"] or tag in b["keywords"]]
        if q:
            briefs = [b for b in briefs
                      if q in " ".join([b["title"], b["snippet"], " ".join(b["topics"])]).lower()]
        if not briefs:
            return jsonify({"error": "没有符合条件的文章可导出"}), 404

        by_id = {str(x.get("id")): x for x in items}
        stamp = time.strftime("%Y%m%d-%H%M")

        if fmt == "json":
            payload = json.dumps(
                [{**_kb_item_brief(by_id[b["id"]]), "content": _article_content(by_id[b["id"]])} for b in briefs],
                ensure_ascii=False, indent=2,
            )
            return Response(payload, mimetype="application/json",
                            headers={"Content-Disposition": f'attachment; filename="kb-{stamp}.json"'})

        if fmt == "zip":
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for b in briefs:
                    raw = by_id[b["id"]]
                    body = _article_content(raw)
                    safe = "".join(c for c in b["title"] if c not in '\\/:*?"<>|')[:60] or b["id"]
                    zf.writestr(f"{b['publishDate'] or 'unknown'}-{safe}.md",
                                f"# {b['title']}\n\n> 来源：{b['account']}　{b['publishDate']}\n> 原文：{b['url']}\n\n{body}\n")
                zf.writestr("manifest.json", json.dumps(briefs, ensure_ascii=False, indent=2))
            buf.seek(0)
            return Response(buf.read(), mimetype="application/zip",
                            headers={"Content-Disposition": f'attachment; filename="kb-{stamp}.zip"'})

        chunks = []
        for b in briefs:
            body = _article_content(by_id[b["id"]])
            chunks.append(f"# {b['title']}\n\n> 来源：{b['account']}　{b['publishDate']}\n> 原文：{b['url']}\n\n{body}\n")
        md = "\n\n---\n\n".join(chunks)
        return Response(md, mimetype="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="kb-{stamp}.md"'})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/article-html", methods=["GET"])
def article_html():
    """按 base64url 路径返回已下载文章的 HTML 正文。

    为什么不用上游的 /api/articles/serve-file：实测浏览器对 URL 路径里
    百分号编码的中文（%E6%B5%8B…）一律返回 400，而 curl 直连是 200。
    公众号下载目录基本都带中文名，所以这里把路径整体 base64url，URL 里
    只剩下 ASCII。
    """
    import base64
    from pathlib import Path
    from flask import Response, jsonify, request

    p = request.args.get("p", "")
    if not p:
        return jsonify({"error": "缺少 p 参数"}), 400
    try:
        raw = base64.b64decode(
            p + "=" * (-len(p) % 4), altchars=b"-_", validate=True
        ).decode("utf-8")
    except Exception:
        return jsonify({"error": "p 不是合法的 base64url"}), 400
    if not raw.strip():
        return jsonify({"error": "p 解码后为空"}), 400

    from backend.config import OUTPUT_DIR, get_settings

    out_root = Path(OUTPUT_DIR).resolve()
    dl_root = Path(str(get_settings().get("download_dir") or OUTPUT_DIR)).resolve()

    target = Path(raw)
    try:
        target = target.resolve()
    except Exception:
        pass

    def _inside(path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    if not (_inside(target, out_root) or _inside(target, dl_root)):
        return jsonify({"error": "路径不在下载目录内"}), 403

    if target.is_dir():
        htmls = sorted(target.glob("*.html"))
        if not htmls:
            return jsonify({"error": "目录下没有 html 正文"}), 404
        target = htmls[0]

    if not target.is_file():
        return jsonify({"error": "文件不存在"}), 404

    text = target.read_text(encoding="utf-8", errors="ignore")

    # ?inspect=1 —— 排查用：正文文件里到底有没有图/视频，一眼看清
    if request.args.get("inspect"):
        import re
        from collections import Counter
        from urllib.parse import urlparse

        imgs = re.findall(r"<img\b[^>]*>", text, flags=re.IGNORECASE)
        srcs = re.findall(r'\b(?:data-src|src)\s*=\s*["\']([^"\']+)["\']', " ".join(imgs), flags=re.I)
        hosts = Counter()
        placeholder_only = 0
        no_url = 0
        for tag in imgs:
            urls = re.findall(r'\b(?:data-src|src)\s*=\s*["\']([^"\']+)["\']', tag, flags=re.I)
            real = [u for u in urls if not u.startswith("data:")]
            if not urls:
                no_url += 1
            elif not real:
                placeholder_only += 1
        for s in srcs:
            if s.startswith(("http", "//")):
                hosts[urlparse(s if s.startswith("http") else "https:" + s).hostname or "?"] += 1
            elif not s.startswith("data:"):
                hosts["<相对路径>"] += 1
        return jsonify(
            {
                "file": str(target),
                "bytes": len(text.encode("utf-8")),
                "img_tags": len(imgs),
                "img_urls_sample": srcs[:5],
                "img_urls_remote": sum(1 for s in srcs if s.startswith(("http", "//"))),
                "img_urls_relative": sum(1 for s in srcs if not s.startswith(("http", "//", "data:"))),
                "img_placeholder_only": placeholder_only,
                "img_without_url": no_url,
                "img_hosts": dict(hosts.most_common(8)),
                "iframe_count": len(re.findall(r"<iframe\b", text, flags=re.I)),
                "video_tag_count": len(re.findall(r"<video\b", text, flags=re.I)),
                "has_js_content": 'id="js_content"' in text or "id='js_content'" in text,
                "hidden_visibility": "visibility: hidden" in text.replace(" ", " ")
                or "visibility:hidden" in text,
            }
        )

    return Response(
        _rewrite_media_urls(_rewrite_local_assets(text, target.parent)),
        mimetype="text/html",
    )


# ---- 正文里的本地图片 ----
# 有些下载器会把图片存到正文同级目录，HTML 里写成 ./images/x.png。
# 预览时 base 是站点根，这类相对路径必然 404，所以改成本机静态接口。
ASSET_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg")


def _rewrite_local_assets(html: str, base_dir) -> str:
    import re
    from urllib.parse import quote

    p_b64 = _b64url(str(base_dir))

    def to_asset(url: str) -> str | None:
        rel = url.strip()
        if not rel or rel.startswith(("http", "//", "/", "#", "data:", "mailto:", "javascript:")):
            return None
        if not rel.lower().split("?")[0].endswith(ASSET_EXTS):
            return None
        return f"/api/article-asset?p={p_b64}&f={quote(rel, safe='')}"

    def repl(m: "re.Match") -> str:
        asset = to_asset(m.group(3))
        if not asset:
            return m.group(0)
        q = m.group(2)
        return f"{m.group(1)}{q}{asset}{q}"

    return re.sub(
        r"((?<![-\w])(?:src|data-src|poster)\s*=\s*)([\"'])([^\"']+)\2",
        repl,
        html,
        flags=re.IGNORECASE,
    )


@app.route("/api/article-asset", methods=["GET"])
def article_asset():
    """返回正文目录下的本地图片（相对路径图片用）"""
    import base64
    import mimetypes
    from pathlib import Path

    from flask import Response, jsonify, request

    p = request.args.get("p", "")
    rel = request.args.get("f", "")
    if not p or not rel:
        return jsonify({"error": "缺少 p 或 f 参数"}), 400
    try:
        base = Path(
            base64.b64decode(p + "=" * (-len(p) % 4), altchars=b"-_", validate=True).decode("utf-8")
        ).resolve()
        target = (base / rel).resolve()
    except Exception:
        return jsonify({"error": "参数不合法"}), 400

    if not target.is_relative_to(base):
        return jsonify({"error": "越界路径"}), 403
    if not target.is_file():
        return jsonify({"error": "文件不存在"}), 404
    if target.suffix.lower() not in ASSET_EXTS:
        return jsonify({"error": "只提供图片文件"}), 403

    return Response(
        target.read_bytes(),
        mimetype=mimetypes.guess_type(str(target))[0] or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=604800"},
    )


# ---- 图片代理 ----
# 公众号图片（mmbiz.qpic.cn）有防盗链：Referer 不是 mp.weixin.qq.com 时，
# 微信会返回「此图片来自微信公众平台 未经允许不可引用」的占位图。
# 正文里的图片还普遍是 <img data-src="..."> 懒加载，没有 JS 就永远不加载。
# 这里统一改写成走本机代理，由后端带上 Referer 去取。
IMG_CACHE_DIR = LOOP_ROOT / "loop" / ".imgcache"
# 只代理「图片 CDN」，不要把 weixin.qq.com 这类 HTML 页面也算进来：
# 正文里嵌的视频/名片是 <iframe src="https://mp.weixin.qq.com/...">，
# 之前一改写就会拉回一整页 HTML 甚至 JSON 错误，直接显示在正文中间。
IMG_ALLOW_HOSTS = (
    ".qpic.cn",
    ".qlogo.cn",
    ".gtimg.com",
)


def _b64url(raw: str) -> str:
    import base64

    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def _proxy_url(url: str) -> str:
    return "/api/image-proxy?u=" + _b64url(url)


def _host_allowed(host: str) -> bool:
    host = (host or "").lower()
    return any(host == h.lstrip(".") or host.endswith(h) for h in IMG_ALLOW_HOSTS)


def _rewrite_media_urls(html: str) -> str:
    """把正文里的微信图片地址改写成 /api/image-proxy，并补上 src 让懒加载图显形

    要覆盖公众号正文里真实出现的几种写法：
      - src / data-src，单双引号都可能
      - 协议相对地址 //mmbiz.qpic.cn/...（正文里非常常见）
      - style="background-image:url(...)"，引号可能被转义成 &quot;
    """
    import re

    def proxy_if_allowed(url: str) -> str | None:
        from urllib.parse import urlparse

        raw = (url or "").strip().replace("&amp;", "&")
        if raw.startswith("//"):
            raw = "https:" + raw
        try:
            parsed = urlparse(raw)
        except Exception:
            return None
        if parsed.scheme not in ("http", "https") or not _host_allowed(parsed.hostname or ""):
            return None
        return _proxy_url(raw)

    def set_attr(tag: str, name: str, value: str) -> str:
        # (?<![-\w]) 防止匹配到 data-src 里头的 src
        return re.sub(
            r"((?<![-\w])" + name + r"\s*=\s*)([\"']).*?\2",
            lambda m: f"{m.group(1)}{m.group(2)}{value}{m.group(2)}",
            tag,
            count=1,
            flags=re.IGNORECASE | re.DOTALL,
        )

    def fix_img(match: "re.Match") -> str:
        tag = match.group(0)
        lazy = re.search(r'data-src\s*=\s*(["\'])(.*?)\1', tag, re.IGNORECASE | re.DOTALL)
        src = re.search(r'\ssrc\s*=\s*(["\'])(.*?)\1', tag, re.IGNORECASE | re.DOTALL)
        source = (lazy.group(2) if lazy else "") or (src.group(2) if src else "")
        proxied = proxy_if_allowed(source)
        if not proxied:
            return tag
        if lazy:
            tag = set_attr(tag, "data-src", proxied)
        if src:
            tag = set_attr(tag, "src", proxied)
        elif tag.endswith("/>"):
            tag = tag[:-2].rstrip() + f' src="{proxied}"/>'
        elif tag.endswith(">"):
            tag = tag[:-1].rstrip() + f' src="{proxied}">'
        # 懒加载图常见 class 是 opacity:0，直接抹掉让图可见
        tag = re.sub(
            r'\s*style\s*=\s*["\'][^"\']*(?:opacity\s*:\s*0|visibility\s*:\s*hidden)[^"\']*["\']',
            "",
            tag,
            flags=re.IGNORECASE,
        )
        return tag

    html = re.sub(r"<img\b[^>]*>", fix_img, html, flags=re.IGNORECASE)

    # 其余 src / data-src / poster / media 一律走代理（含单引号与协议相对写法）
    def repl_attr(m: "re.Match") -> str:
        attr, quote, url = m.group(1), m.group(2), m.group(3)
        proxied = proxy_if_allowed(url)
        if not proxied:
            return m.group(0)
        return f"{attr}={quote}{proxied}{quote}"

    html = re.sub(
        r"\b(src|data-src|poster|media)\s*=\s*([\"'])((?:https?:)?//[^\"']+)\2",
        repl_attr,
        html,
        flags=re.IGNORECASE,
    )

    # 背景图：兼容 url('...') / url("...") / url(&quot;...&quot;) / url(//...)
    def repl_bg(m: "re.Match") -> str:
        proxied = proxy_if_allowed(m.group(2))
        if not proxied:
            return m.group(0)
        return f"{m.group(1)}url('{proxied}')"

    html = re.sub(
        r"(background-image\s*:\s*)"
        r"url\(\s*(?:&quot;|&#39;|&apos;|[\"'])?\s*"
        r"((?:https?:)?//[^)\"'&\s]+)"
        r"\s*(?:&quot;|&#39;|&apos;|[\"'])?\s*\)",
        repl_bg,
        html,
        flags=re.IGNORECASE,
    )

    # 视频：微信视频是 <iframe class="video_iframe" data-src="https://mp.weixin.qq.com/mp/videoplayer?...">
    # 这个播放器依赖登录态与 referer，嵌在本地页面里必然是空白。
    # 换成可点击的提示块，点开去原文放。
    def repl_video_iframe(m: "re.Match") -> str:
        tag = m.group(0)
        url = ""
        for attr in ("data-src", "src"):
            found = re.search(r"\b" + attr + r'\s*=\s*(["\'])(.*?)\1', tag, re.IGNORECASE | re.DOTALL)
            if found and found.group(2).startswith("http"):
                url = found.group(2)
                break
        if url:
            return (
                '<div class="loop-video-fallback">🎬 视频无法在预览里播放，'
                f'<a href="{url}" target="_blank" rel="noreferrer">点此打开播放页</a></div>'
            )
        return '<div class="loop-video-fallback">🎬 该视频需在原文中播放</div>'

    html = re.sub(
        r"<iframe\b[^>]*(?:video_iframe|video-player)[^>]*>(?:\s*</iframe>)?",
        repl_video_iframe,
        html,
        flags=re.IGNORECASE,
    )

    if "</body>" in html.lower():
        idx = html.lower().rfind("</body>")
        return html[:idx] + LOOP_MEDIA_FIX_CSS + html[idx:]
    return html + LOOP_MEDIA_FIX_CSS


# 公众号正文保存下来时带 rich_media_content 的 visibility:hidden，
# 靠页面自己的 JS 才显示。预览里没有那套 JS，内容会整片空白，所以强制可见。
LOOP_MEDIA_FIX_CSS = """
<style id="loop-media-fix">
  #js_content, .rich_media_content, .rich_media_area_primary,
  .rich_media_inner, .rich_media_wrp {
    visibility: visible !important;
    opacity: 1 !important;
  }
  img { visibility: visible !important; opacity: 1 !important; max-width: 100% !important; height: auto !important; }
  .loop-video-fallback {
    margin: 16px 0; padding: 14px 16px; border: 1px dashed #d4d4d8;
    border-radius: 6px; background: #fafafa; text-align: center;
    font-size: 14px; color: #52525b;
  }
  .loop-video-fallback a { color: #1677ff; text-decoration: none; }
</style>
"""


@app.route("/api/image-proxy", methods=["GET"])
def image_proxy():
    """带 Referer 拉取微信图片，并在本地落盘缓存"""
    import base64
    import hashlib
    import mimetypes
    import urllib.request
    from urllib.parse import urlparse

    from flask import Response, jsonify, request

    u = request.args.get("u", "")
    if not u:
        return jsonify({"error": "缺少 u 参数"}), 400
    try:
        url = base64.b64decode(u + "=" * (-len(u) % 4), altchars=b"-_", validate=True).decode("utf-8")
    except Exception:
        return jsonify({"error": "u 不是合法的 base64url"}), 400

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not _host_allowed(parsed.hostname or ""):
        return jsonify({"error": "只代理微信图片域名"}), 403

    key = hashlib.sha1(url.encode("utf-8")).hexdigest()
    IMG_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ext = ".img"

    # 命中缓存直接回
    for cached in IMG_CACHE_DIR.glob(f"{key}.*"):
        ext = cached.suffix
        return Response(
            cached.read_bytes(),
            mimetype=mimetypes.guess_type(f"x{ext}")[0] or "image/jpeg",
            headers={"Cache-Control": "public, max-age=604800"},
        )

    req_headers = {
        "Referer": "https://mp.weixin.qq.com/",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    data, ctype = _download_image(url, req_headers)
    if data is None:
        # 失败时回一块可见的占位图：透明 1px 会让人以为「这文章本来就没图」，
        # 放一块灰底提示反而能一眼看出是取图失败还是正文缺图。
        return Response(
            PLACEHOLDER_SVG,
            mimetype="image/svg+xml",
            headers={"Cache-Control": "no-store"},
        )

    if not ctype.startswith("image/"):
        ctype = mimetypes.guess_type(parsed.path)[0] or "image/jpeg"
    ext = mimetypes.guess_extension(ctype.split("/")[-1]) or ".jpg"
    try:
        (IMG_CACHE_DIR / f"{key}{ext}").write_bytes(data)
    except Exception:
        pass  # 缓存失败不影响返回

    return Response(data, mimetype=ctype, headers={"Cache-Control": "public, max-age=604800"})


# 取图失败时的可见占位（透明 1px 会让人误判成「文章本来没图」）
PLACEHOLDER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="90" viewBox="0 0 480 90">'
    '<rect width="480" height="90" fill="#f4f4f5" stroke="#d4d4d8" stroke-dasharray="4 4"/>'
    '<text x="240" y="50" font-size="14" fill="#71717a" text-anchor="middle" '
    'font-family="-apple-system, sans-serif">图片未能加载（原图失效或代理不通）</text>'
    "</svg>"
).encode("utf-8")


def _download_image(url: str, headers: dict) -> tuple[bytes | None, str]:
    """取图片字节。

    macOS 上 python.org 安装的 Python 经常没有根证书，走 https 会直接
    CERTIFICATE_VERIFY_FAILED。这里先试校验证书，失败再降级成不校验
    （只用于取公众号图片，不涉及敏感数据），两种都失败才算真的失败。
    """
    try:
        import requests

        for verify in (True, False):
            try:
                resp = requests.get(url, headers=headers, timeout=20, verify=verify)
                if resp.status_code >= 400:
                    continue
                return resp.content, (resp.headers.get("Content-Type") or "").split(";")[0].strip()
            except requests.exceptions.SSLError:
                continue  # 证书问题，换不校验再试
            except Exception:
                break  # 网络问题，别死循环
    except ImportError:
        pass

    # requests 不可用时退回 urllib，同样带一次不校验的重试
    import ssl
    import urllib.request

    for context in (None, ssl._create_unverified_context()):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20, context=context) as resp:
                return resp.read(), (resp.headers.get("Content-Type") or "").split(";")[0].strip()
        except ssl.SSLError:
            continue
        except Exception:
            break
    return None, ""


# ---- 后端自检 ----
BRIDGE_FEATURES = ("kb", "article-html", "image-proxy", "proxy-fetch-free")


@app.route("/api/bridge/health", methods=["GET"])
def bridge_health():
    """判断后端是否已经重启到最新代码：前端据此提示「需重启后端」"""
    import subprocess

    from flask import jsonify

    rev = ""
    try:
        rev = (
            subprocess.run(
                ["git", "-C", str(Path(__file__).resolve().parent.parent), "rev-parse", "--short", "HEAD"],
                capture_output=True,
                text=True,
                timeout=3,
            ).stdout.strip()
        )
    except Exception:
        rev = ""

    rules = {str(r) for r in app.url_map.iter_rules()}
    expected = {
        "kb": "/api/kb",
        "article-html": "/api/article-html",
        "image-proxy": "/api/image-proxy",
        "proxy-fetch-free": "/api/proxy/fetch-free",
    }
    missing = [name for name, rule in expected.items() if rule not in rules]
    return jsonify(
        {
            "ok": not missing,
            "revision": rev,
            "features": list(BRIDGE_FEATURES),
            "missing": missing,
            "tls": _probe_image_tls(),
        }
    )


# ---- 免费代理抓取 ----
FREE_PROXY_SOURCES = (
    # 都是公开维护的免费代理清单，格式为 host:port 纯文本
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=yes&anonymity=all",
)


@app.route("/api/proxy/fetch-free", methods=["POST"])
def proxy_fetch_free():
    """从公开清单抓一批免费代理，逐个测活后只返回可用的

    免费代理生命周期通常只有几小时到几天，失效是常态，
    所以这里做成「现抓现测」，而不是提前存一份死的清单。
    """
    import concurrent.futures

    import requests
    from flask import jsonify, request

    limit = int((request.get_json(silent=True) or {}).get("limit") or 40)
    candidates: list[dict] = []
    errors: list[str] = []

    for src in FREE_PROXY_SOURCES:
        try:
            resp = requests.get(src, timeout=12, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            for line in resp.text.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                host, _, port = line.rpartition(":")
                if not host or not port.isdigit():
                    continue
                candidates.append({"type": "http", "host": host.strip(), "port": port})
        except Exception as exc:
            errors.append(f"{src.split('/')[2]}: {exc}")

    # 去重后只测前 limit 个，避免一次开几百个连接
    seen, picked = set(), []
    for item in candidates:
        key = f"{item['host']}:{item['port']}"
        if key in seen:
            continue
        seen.add(key)
        picked.append(item)
        if len(picked) >= limit:
            break

    def probe(item: dict) -> dict | None:
        url = f"http://{item['host']}:{item['port']}"
        try:
            start = time.time()
            resp = requests.get(
                "https://api.ipify.org?format=json",
                proxies={"http": url, "https": url},
                timeout=6,
            )
            resp.raise_for_status()
            ip = (resp.json() or {}).get("ip", "")
            return {**item, "latency": round((time.time() - start) * 1000), "exit_ip": ip}
        except Exception:
            return None

    alive: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for result in pool.map(probe, picked):
            if result:
                alive.append(result)

    alive.sort(key=lambda x: x["latency"])
    return jsonify(
        {
            "total_scanned": len(picked),
            "alive": alive,
            "message": f"抓取 {len(picked)} 个，可用 {len(alive)} 个",
            "errors": errors,
        }
    )


# ---- 闭环：检索 / 选题 / 写作 prompt / 排版 / 封面 / 发布草稿 ----
#
# 这些能力上游都是「CLI 脚本」，放在仓库 scripts/ 下，依赖 CWD=仓库根、
# 且脚本之间用 sys.path 互相 import。直接在 Flask 里 import 会污染
# sys.path 和全局状态（converter、playwright 都很重），所以统一用
# subprocess 调 CLI，参数走命令行、结果走 stdout 或落盘。

SCRIPTS_DIR = LOOP_ROOT / "scripts"
RUNS_DIR = KB_DIR / "runs"


def _run_script(name: str, args: list[str], timeout: int = 120) -> dict:
    """跑 scripts/ 下的脚本，返回 {ok, code, stdout, stderr}"""
    import subprocess

    script = SCRIPTS_DIR / name
    if not script.is_file():
        raise FileNotFoundError(f"脚本不存在：{script}")

    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join([str(SCRIPTS_DIR), env.get("PYTHONPATH", "")]).strip(os.pathsep)
    env["PYTHONIOENCODING"] = "utf-8"

    proc = subprocess.run(
        [sys.executable, str(script), *args],
        cwd=str(LOOP_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env=env,
    )
    return {
        "ok": proc.returncode == 0,
        "code": proc.returncode,
        "stdout": proc.stdout or "",
        "stderr": proc.stderr or "",
    }


def _safe_run_dir(date_tag: str) -> Path:
    """只允许 YYYYMMDD，防止路径穿越"""
    import re

    if not re.fullmatch(r"\d{8}", date_tag or ""):
        raise ValueError("date 必须是 8 位日期，如 20261119")
    d = RUNS_DIR / date_tag
    d.mkdir(parents=True, exist_ok=True)
    return d


def _today() -> str:
    return time.strftime("%Y%m%d")


@app.route("/api/loop/topics", methods=["GET"])
def loop_topics():
    """选题候选：读知识库 + 运行历史，按新鲜度/价值/去重打分"""
    from flask import jsonify, request

    try:
        top_n = str(max(1, min(50, int(request.args.get("top_n") or 5))))
        min_score = str(float(request.args.get("min_score") or 3.0))
        res = _run_script("topic_selection.py", ["--top-n", top_n, "--min-score", min_score], timeout=60)
        if not res["ok"]:
            # 脚本报错信息通常就是「知识库空了」这类人话，直接透出
            return jsonify({"error": (res["stderr"] or res["stdout"]).strip()[-400:] or "选题失败"}), 500
        payload = json.loads(res["stdout"] or "{}")
        return jsonify(payload)
    except json.JSONDecodeError:
        return jsonify({"error": "选题脚本输出不是合法 JSON"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/loop/prompt", methods=["POST"])
def loop_prompt():
    """为一个选题生成写作 prompt（检索证据 → 组装模板）"""
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()
        if not title:
            return jsonify({"error": "缺少 title（选题标题）"}), 400

        date_tag = body.get("date") or _today()
        run_dir = _safe_run_dir(date_tag)
        keywords = [str(k) for k in (body.get("keywords") or []) if str(k).strip()]
        persona = body.get("persona") or "industry-observer"
        framework = body.get("framework") or "清单型"
        dimensions = body.get("dimensions") or "叙事视角:问答体 + 类比域:电影 + 情绪基调:毒舌调侃"

        query = " ".join([title, *keywords]).strip()
        evidence_path = run_dir / "evidence_pack.json"
        search = _run_script(
            "simple_search.py",
            [query, "--top-k", "5", "--output", str(evidence_path.relative_to(LOOP_ROOT))],
            timeout=90,
        )
        if not search["ok"]:
            return jsonify({"error": f"检索失败：{(search['stderr'] or search['stdout']).strip()[-300:]}"}), 500

        prompt_path = run_dir / ".prompt"
        built = _run_script(
            "build_prompt.py",
            [
                "--date", date_tag,
                "--topic-title", title,
                "--persona", persona,
                "--framework", framework,
                "--dimensions", dimensions,
                "--evidence", str(evidence_path.relative_to(LOOP_ROOT)),
                "--out", str(prompt_path.relative_to(LOOP_ROOT)),
            ],
            timeout=60,
        )
        if not built["ok"]:
            return jsonify({"error": f"生成 prompt 失败：{(built['stderr'] or built['stdout']).strip()[-300:]}"}), 500

        evidence = _load_json(evidence_path, {})
        return jsonify({
            "ok": True,
            "date": date_tag,
            "runDir": str(run_dir.relative_to(LOOP_ROOT)),
            "promptPath": str(prompt_path.relative_to(LOOP_ROOT)),
            "prompt": prompt_path.read_text(encoding="utf-8") if prompt_path.exists() else "",
            "evidenceCount": len(evidence.get("top_chunks") or []),
            "topic": {"title": title, "keywords": keywords, "persona": persona,
                      "framework": framework, "dimensions": dimensions},
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _fallback_md_to_html(markdown: str) -> str:
    """上游 wechat-flow 缺失时的极简排版（标题/段落/列表/引用/图片/加粗）

    只求能在预览里看清结构、能塞进公众号编辑器，不追求上游那套主题样式。
    """
    import html as htmllib
    import re

    def inline(text: str) -> str:
        out = htmllib.escape(text)
        out = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img src="\2" alt="\1" style="max-width:100%;"/>', out)
        out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', out)
        out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
        out = re.sub(r"`([^`]+)`", r'<code style="background:#f5f5f5;padding:1px 4px;border-radius:3px;">\1</code>', out)
        return out

    blocks: list[str] = []
    list_buf: list[str] = []
    quote_buf: list[str] = []

    def flush_list() -> None:
        if list_buf:
            blocks.append(
                '<ul style="margin:16px 0;padding-left:22px;line-height:1.9;">'
                + "".join(f"<li>{inline(x)}</li>" for x in list_buf)
                + "</ul>"
            )
            list_buf.clear()

    def flush_quote() -> None:
        if quote_buf:
            blocks.append(
                '<blockquote style="margin:16px 0;padding:10px 14px;border-left:3px solid #d0d0d0;'
                'background:#fafafa;color:#666;line-height:1.9;">'
                + "<br/>".join(inline(x) for x in quote_buf)
                + "</blockquote>"
            )
            quote_buf.clear()

    for raw in markdown.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            flush_list(); flush_quote()
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            flush_list(); flush_quote()
            level = len(m.group(1))
            size = {1: 22, 2: 19, 3: 17, 4: 16}[level]
            blocks.append(
                f'<h{level} style="margin:26px 0 14px;font-size:{size}px;line-height:1.5;'
                f'font-weight:600;">{inline(m.group(2))}</h{level}>'
            )
            continue
        if re.match(r"^[-*+]\s+", stripped):
            list_buf.append(re.sub(r"^[-*+]\s+", "", stripped))
            continue
        if re.match(r"^\d+[.)]\s+", stripped):
            list_buf.append(re.sub(r"^\d+[.)]\s+", "", stripped))
            continue
        if stripped.startswith(">"):
            quote_buf.append(stripped.lstrip("> ").strip())
            continue
        if stripped in ("---", "***", "___"):
            flush_list(); flush_quote()
            blocks.append('<hr style="margin:24px 0;border:none;border-top:1px solid #eee;"/>')
            continue
        flush_list(); flush_quote()
        blocks.append(f'<p style="margin:16px 0;line-height:1.9;font-size:16px;">{inline(stripped)}</p>')
    flush_list(); flush_quote()

    body = "\n".join(blocks)
    return (
        '<section style="font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;'
        'font-size:16px;color:#333;letter-spacing:0.4px;">' + body + "</section>"
    )


@app.route("/api/loop/draft", methods=["POST"])
def loop_draft():
    """把 Markdown 存成文章并排版成公众号 HTML"""
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        markdown = body.get("markdown") or ""
        if not markdown.strip():
            return jsonify({"error": "正文为空，先写入 Markdown 再排版"}), 400

        date_tag = body.get("date") or _today()
        theme = body.get("theme") or "professional-clean"
        run_dir = _safe_run_dir(date_tag)

        md_path = run_dir / "article.md"
        md_path.write_text(markdown, encoding="utf-8")

        html_path = run_dir / "article.html"
        conv = _run_script(
            "convert_md.py",
            [str(md_path.relative_to(LOOP_ROOT)), "--theme", theme,
             "--out", str(html_path.relative_to(LOOP_ROOT))],
            timeout=120,
        )
        fallback = False
        if not conv["ok"] or not html_path.exists():
            # 上游 wechat-flow/toolkit 没装时退化成内置极简排版，
            # 保证「写完能看、能进草稿箱」，而不是直接报错卡住
            fallback = True
            html_path.write_text(_fallback_md_to_html(markdown), encoding="utf-8")

        html = html_path.read_text(encoding="utf-8") if html_path.exists() else ""
        return jsonify({
            "ok": True,
            "date": date_tag,
            "theme": theme if not fallback else "builtin-fallback",
            "fallback": fallback,
            "note": "上游 wechat-flow/toolkit 未安装，已用内置极简排版" if fallback else "",
            "mdPath": str(md_path.relative_to(LOOP_ROOT)),
            "htmlPath": str(html_path.relative_to(LOOP_ROOT)),
            "html": html,
            "bytes": len(html),
            "previewUrl": _loop_file_url(html_path),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/loop/cover", methods=["POST"])
def loop_cover():
    """本地生成 900x383 封面图（Pillow，零 AI 成本）"""
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()
        if not title:
            return jsonify({"error": "缺少 title"}), 400

        date_tag = body.get("date") or _today()
        run_dir = _safe_run_dir(date_tag)
        out = run_dir / "cover.png"
        res = _run_script(
            "make_cover.py",
            ["-t", title, "-s", body.get("subtitle") or "", "-o", str(out.relative_to(LOOP_ROOT))],
            timeout=60,
        )
        if not res["ok"] or not out.exists():
            return jsonify({"error": f"生成封面失败：{(res['stderr'] or res['stdout']).strip()[-300:]}"}), 500
        return jsonify({"ok": True, "path": str(out.relative_to(LOOP_ROOT)), "url": _loop_file_url(out)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/loop/publish", methods=["POST"])
def loop_publish():
    """把排版好的 HTML 发到公众号草稿箱"""
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()
        if not title:
            return jsonify({"error": "缺少 title"}), 400

        date_tag = body.get("date") or _today()
        run_dir = _safe_run_dir(date_tag)
        html_path = run_dir / "article.html"
        if not html_path.exists():
            return jsonify({"error": "还没有排版结果，请先点「排版预览」"}), 409

        args = [str(html_path.relative_to(LOOP_ROOT)), "--title", title, "--json"]
        if body.get("digest"):
            args += ["--digest", str(body["digest"])]
        cover = run_dir / "cover.png"
        if cover.exists():
            args += ["--cover", str(cover.relative_to(LOOP_ROOT))]
        if body.get("route") in ("api", "playwright"):
            args += ["--route", body["route"]]
        if body.get("noHeadless"):
            args += ["--no-headless"]

        res = _run_script("publish_draft.py", args, timeout=int(body.get("timeout") or 240))
        if not res["ok"]:
            tail = (res["stderr"] or res["stdout"]).strip()[-600:]
            return jsonify({"error": f"发布失败：{tail or '未知错误'}", "raw": res["stdout"][-1200:]}), 500

        # publish_draft.py --json 会在 stdout 里打印一段 JSON
        payload = {}
        for line in reversed(res["stdout"].splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                try:
                    payload = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
        return jsonify({"ok": True, "result": payload, "raw": res["stdout"][-1200:]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/loop/runs", methods=["GET"])
def loop_runs():
    """最近的工作目录（有 .prompt / article.md / article.html / cover.png 的）"""
    from flask import jsonify

    try:
        items = []
        if RUNS_DIR.is_dir():
            for d in sorted((p for p in RUNS_DIR.iterdir() if p.is_dir()), reverse=True)[:30]:
                files = {f.name: f.stat().st_size for f in d.iterdir() if f.is_file()}
                items.append({
                    "date": d.name,
                    "prompt": ".prompt" in files,
                    "markdown": "article.md" in files,
                    "html": "article.html" in files,
                    "cover": "cover.png" in files,
                    "coverUrl": _loop_file_url(d / "cover.png") if (d / "cover.png").exists() else "",
                    "htmlUrl": _loop_file_url(d / "article.html") if (d / "article.html").exists() else "",
                    "bytes": sum(files.values()),
                })
        return jsonify({"items": items, "root": str(RUNS_DIR.relative_to(LOOP_ROOT))})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _loop_file_url(path: Path) -> str:
    """把 loop/ 下的文件转成可访问 URL（base64url，避免中文路径 400）"""
    import base64

    rel = str(path.resolve().relative_to(LOOP_ROOT.resolve()))
    return "/api/loop/file?p=" + base64.urlsafe_b64encode(rel.encode()).decode().rstrip("=")


@app.route("/api/loop/file", methods=["GET"])
def loop_file():
    """读取 loop/ 目录内的文件（封面图 / 排版 HTML），防越界"""
    import base64

    from flask import Response, jsonify, request

    try:
        raw = request.args.get("p") or ""
        if not raw:
            return jsonify({"error": "缺少 p 参数"}), 400
        rel = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8")
        target = (LOOP_ROOT / rel).resolve()
        try:
            target.relative_to((KB_DIR).resolve())
        except ValueError:
            return jsonify({"error": "只能读取 loop/ 目录内的文件"}), 403
        if not target.is_file():
            return jsonify({"error": "文件不存在"}), 404

        suffix = target.suffix.lower()
        mime = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".html": "text/html; charset=utf-8", ".md": "text/markdown; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }.get(suffix, "application/octet-stream")
        return Response(target.read_bytes(), mimetype=mime)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


_TLS_PROBE: dict = {"ok": None, "detail": "", "checked_at": 0, "fallback_ok": None}


def _probe_image_tls(force: bool = False) -> dict:
    """探测微信图片 CDN 的 HTTPS 是否可用，结果缓存给 /api/bridge/health 复用

    分三种情况说清楚：
      ok=True  —— 校验证书就能取图，最健康
      ok=False + fallback_ok=True —— 根证书缺失，但不校验能取到（图片仍显示）
      ok=False + fallback_ok=False —— 真的连不上（网络 / 被墙 / 代理不通）
    """
    if not force and _TLS_PROBE["checked_at"]:
        return {k: _TLS_PROBE[k] for k in ("ok", "detail", "fallback_ok", "checked_at")}

    try:
        import requests
    except Exception:
        _TLS_PROBE.update(ok=None, detail="未安装 requests，跳过探测", checked_at=time.time())
        return dict(_TLS_PROBE)

    url = "https://mmbiz.qpic.cn/"
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://mp.weixin.qq.com/"}

    def try_get(verify: bool) -> tuple[bool, str]:
        try:
            requests.get(url, timeout=8, headers=headers, verify=verify)
            return True, ""
        except Exception as exc:
            return False, f"{type(exc).__name__}: {str(exc)[:160]}"

    ok, detail = try_get(True)
    fallback_ok = None
    if not ok:
        fallback_ok, _ = try_get(False)

    _TLS_PROBE.update(ok=ok, detail=detail, fallback_ok=fallback_ok, checked_at=time.time())
    return dict(_TLS_PROBE)


def _print_tls_report() -> None:
    res = _probe_image_tls(force=True)
    ok, fallback_ok = res.get("ok"), res.get("fallback_ok")
    if ok:
        print("[bridge] 证书自检：OK —— HTTPS 取图正常（证书校验通过）")
    elif fallback_ok:
        print("[bridge] 证书自检：WARN —— 根证书缺失，取图会走「不校验证书」的降级通道")
        print("[bridge]   图片仍能显示，但建议修一次：Finder 打开 /Applications/Python 3.12/")
        print("[bridge]   双击 Install Certificates.command，之后重启后端即可")
        print(f"[bridge]   详情：{res.get('detail', '')}")
    else:
        print("[bridge] 证书自检：FAIL —— 连不上 mmbiz.qpic.cn，正文图片会全部显示占位块")
        print("[bridge]   排查：本机网络 / 代理设置 / 是否需要梯子")
        print(f"[bridge]   详情：{res.get('detail', '')}")


if __name__ == "__main__":
    # 复用 wechat-mp-tools 的端口，5200
    port = int(os.environ.get("MP_PORT", "5200"))
    print(f"[bridge] 启动 wechat-loop bridge + wechat-mp-tools 于 127.0.0.1:{port}")
    print("[bridge] 新增端点：GET /api/kb, POST /api/kb, POST /api/kb/active")
    _print_tls_report()
    app.run(host="127.0.0.1", port=port, debug=False)
