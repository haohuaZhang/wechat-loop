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
import threading
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

# 上游 wechat-mp-tools 的采集结果目录（只读，用于「导入采集结果」）
WMT_DATA_DIR = WMT_DIR / "data"
WMT_ARTICLES_DIR = WMT_DATA_DIR / "articles_full"


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


def _atomic_write_text(path: Path, text: str) -> None:
    """tmp → fsync → os.replace 原子写，避免半截文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _save_json(path: Path, data) -> None:
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


# ---- 知识库 schema v2：幂等迁移 ----

_KB_LOCK = threading.RLock()
DEFAULT_COLLECTIONS = {"favorites": "收藏夹", "ideas": "选题池"}


def _article_hash(item: dict) -> str:
    """文章指纹：md5(url)[:12]，无 url 用标题 slug。"""
    import hashlib

    url = str(item.get("url") or "").strip()
    if url:
        return hashlib.md5(url.encode("utf-8")).hexdigest()[:12]
    return _kb_slug(str(item.get("title") or ""))


def _quality_of(item: dict) -> dict:
    """简易质量分（0-100）+ 标记位，不依赖外部模型。"""
    try:
        wc = int(item.get("word_count") or 0)
    except (TypeError, ValueError):
        wc = 0
    title = str(item.get("title") or "")
    keywords = item.get("keywords")
    score = 60 + min(wc / 100, 25) + (10 if len(title) >= 10 else 0) + (5 if keywords else 0)
    flags: list[str] = []
    if wc < 300:
        flags.append("thin")
    if wc < 50:
        flags.append("no_body")
    if not keywords:
        flags.append("no_keywords")
    return {"score": int(round(min(100, score))), "flags": flags}


def _migrate_kb(data: dict) -> dict:
    """把任意版本的 KB 补齐到 schema v2；重复调用结果不变（幂等）。"""
    data["schema"] = 2
    cols = data.get("collections")
    if not isinstance(cols, dict) or not cols:
        data["collections"] = dict(DEFAULT_COLLECTIONS)
    if not isinstance(data.get("views"), list):
        data["views"] = []

    articles = data.get("articles")
    if isinstance(articles, list):
        items = articles
    elif isinstance(articles, dict):
        items = list(articles.values())
    else:
        items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if not isinstance(item.get("tags"), list):
            item["tags"] = []
        if not isinstance(item.get("collections"), list):
            item["collections"] = []
        if item.get("stage") not in ("unused", "cited", "drafted"):
            item["stage"] = "cited" if item.get("used_as_source") else "unused"
        if "used_at" not in item:
            item["used_at"] = None
        quality = item.get("quality")
        if not isinstance(quality, dict):
            item["quality"] = _quality_of(item)
        else:
            quality.setdefault("flags", [])
            quality.setdefault("score", _quality_of(item)["score"])
        item.setdefault("hash", _article_hash(item))
    return data


def _load_kb(path: Path | None = None) -> dict:
    """读取并迁移 KB 到 schema v2；只有内容真正变化才原子写回。

    首次迁移前把原文件备份为 <kb>.v1.bak；重复调用零 diff。
    """
    p = Path(path) if path is not None else _active_kb_path()
    with _KB_LOCK:
        raw = _load_json(p, None)
        if raw is None and p.exists():
            # 文件存在但解析失败：不覆盖原文件，返回空结构（只读降级）
            return _migrate_kb({"version": "1.0", "name": p.stem,
                                "accounts": {}, "articles": {}})
        if isinstance(raw, list):
            raw = {"version": "1.0", "accounts": {}, "articles": raw}
        elif not isinstance(raw, dict):
            raw = {"version": "1.0", "name": p.stem, "accounts": {}, "articles": {}}
        before = json.dumps(raw, ensure_ascii=False, sort_keys=True, default=str)
        data = _migrate_kb(raw)
        after = json.dumps(data, ensure_ascii=False, sort_keys=True, default=str)
        if p.exists() and before != after:
            import shutil

            bak = p.with_name(p.name + ".v1.bak")
            if not bak.exists():
                try:
                    shutil.copy2(p, bak)
                except OSError:
                    pass
            _save_json(p, data)
        return data


def _save_kb(path: Path, data: dict) -> None:
    """保存 KB（先迁移，再原子写）。"""
    with _KB_LOCK:
        _save_json(path, _migrate_kb(data))


def _kb_count(path: Path) -> int:
    """统计知识库文章数：兼容 list 与 {articles: ...} 两种结构"""
    try:
        data = _load_kb(path)
    except Exception:
        return 0
    articles = data.get("articles")
    if isinstance(articles, (list, dict)):
        return len(articles)
    return 0


def _discover_kbs() -> list[dict]:
    """扫描 loop/ 目录下所有知识库文件"""
    _ensure_dirs()
    active_id = ACTIVE_KB_FILE.read_text(encoding="utf-8").strip() if ACTIVE_KB_FILE.exists() else "default"
    kbs = []

    # 主知识库
    main_count = _kb_count(MAIN_KB)
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
        count = _kb_count(f)
        raw = _load_kb(f)
        display = raw.get("name") if isinstance(raw, dict) else None
        kbs.append({
            "id": kb_id,
            "name": display or kb_id,
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
        _save_kb(full_path, {"version": 1, "name": name, "articles": {}})

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


# ---- 知识库：导入上游采集结果 ----

def _kb_slug(title: str) -> str:
    import re
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "-", title or "")
    s = s.strip("-")[:60]
    return s or "untitled"


def _scan_collected_sources() -> list[dict]:
    """扫描 wechat-mp-tools/data/articles_full，返回可导入的文章清单（只读）。

    每条：{account_key, account_name, title, url, publish_date, content}
    与上游 _sync_history_from_disk 的目录约定保持一致：
      articles_full/<公众号>/<文章目录>/{metadata.json, *.md, *.html}
    """
    import re
    from datetime import datetime

    if not WMT_ARTICLES_DIR.is_dir():
        return []

    try:
        from bs4 import BeautifulSoup
    except Exception:
        BeautifulSoup = None

    skip_dirs = {"channels", "douyin_downloads", "xhs_downloads", "temp_uploads"}
    out: list[dict] = []
    try:
        acc_dirs = sorted(d for d in WMT_ARTICLES_DIR.iterdir() if d.is_dir() and d.name not in skip_dirs)
    except OSError:
        return []

    for acc_dir in acc_dirs:
        account_name = acc_dir.name
        account_key = re.sub(r"[^\w]", "_", account_name)[:20] or "unknown"
        try:
            art_dirs = sorted(d for d in acc_dir.iterdir() if d.is_dir())
        except OSError:
            continue
        for art_dir in art_dirs:
            try:
                html_files = [f for f in art_dir.glob("*.html") if not f.name.endswith("_raw.html")]
                md_files = sorted(art_dir.glob("*.md"))
            except OSError:
                continue
            if not html_files and not md_files:
                continue

            meta = {}
            meta_file = art_dir / "metadata.json"
            if meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                except Exception:
                    meta = {}
            title = (meta.get("title") or art_dir.name or "").strip()
            url = (meta.get("url") or meta.get("link") or "").strip()

            # 正文：优先 .md，其次 html → 纯文本
            content = ""
            if md_files:
                try:
                    content = md_files[0].read_text(encoding="utf-8", errors="replace")
                except Exception:
                    content = ""
            if not content and html_files:
                try:
                    raw = html_files[0].read_text(encoding="utf-8", errors="replace")
                    if BeautifulSoup is not None:
                        content = BeautifulSoup(raw, "html.parser").get_text("\n")
                    else:
                        content = re.sub(r"<[^>]+>", "", raw)
                except Exception:
                    content = ""

            # 发布日期：publish_time（秒/毫秒）或 time（ISO 字符串）
            publish_date = ""
            for key in ("publish_time", "time"):
                v = meta.get(key)
                if not v:
                    continue
                try:
                    ts = float(v)
                    if ts > 1e12:
                        ts /= 1000.0
                    publish_date = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
                    break
                except Exception:
                    try:
                        publish_date = datetime.fromisoformat(str(v)).strftime("%Y-%m-%d")
                        break
                    except Exception:
                        pass

            out.append({
                "account_key": account_key,
                "account_name": account_name,
                "title": title,
                "url": url,
                "publish_date": publish_date,
                "content": content,
            })
    return out


def _import_sources_into_kb(articles: list[dict], kb_path: Path) -> dict:
    """把采集结果合并进指定 KB。去重与 collect.py 一致：md5(url)[:12]，已存在则跳过。"""
    import hashlib
    import re
    from datetime import datetime, timezone

    kb = _load_kb(kb_path)
    kb.setdefault("accounts", {})
    kb.setdefault("articles", {})

    md_root = KB_DIR / "kb"
    md_root.mkdir(parents=True, exist_ok=True)
    seen = set(kb["articles"].keys())
    added = 0
    skipped = 0

    for art in articles:
        title = (art.get("title") or "").strip()
        if not title:
            skipped += 1
            continue
        url = (art.get("url") or "").strip()
        aid = hashlib.md5(url.encode("utf-8")).hexdigest()[:12] if url else _kb_slug(title)
        if aid in seen:
            skipped += 1
            continue

        content = art.get("content") or ""
        account_key = art.get("account_key") or "unknown"
        account_name = art.get("account_name") or account_key
        publish_date = art.get("publish_date") or ""

        acc_dir = md_root / account_key
        acc_dir.mkdir(parents=True, exist_ok=True)
        md_path = acc_dir / f"{publish_date}_{_kb_slug(title)}.md"
        local_md = ""
        if not md_path.name.startswith("_") and not md_path.name.startswith("None"):
            try:
                md_path.write_text(f"# {title}\n\n{content}\n", encoding="utf-8")
                local_md = str(md_path.relative_to(LOOP_ROOT))
            except OSError:
                local_md = ""

        body = f"{title} {content[:500]}"
        kw = list({t for t in re.split(r"[\s，。！？、]+", body) if 2 <= len(t) <= 10})[:8]

        kb["articles"][aid] = {
            "source_account": account_key,
            "title": title,
            "publish_date": publish_date,
            "url": url,
            "local_md_path": local_md,
            "word_count": len(content),
            "topics": [],
            "keywords": kw[:6],
            "crossRefs": [],
            "used_as_source": False,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        kb["accounts"].setdefault(account_key, {"name": account_name, "biz": "", "last_collected": ""})
        kb["accounts"][account_key]["last_collected"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        seen.add(aid)
        added += 1

    if added:
        _save_kb(kb_path, kb)
    return {
        "added": added,
        "skipped": skipped,
        "total": len(articles),
        "kb": str(kb_path.relative_to(LOOP_ROOT)),
    }


@app.route("/api/kb/import/sources", methods=["GET"])
def kb_import_sources():
    """预览：上游采集结果里有多少篇可导入当前活动 KB（去重前 / 去重后）"""
    import hashlib
    from flask import jsonify

    try:
        sources = _scan_collected_sources()
        kb_path = _active_kb_path()
        kb = _load_kb(kb_path)
        existing = set((kb.get("articles") or {}).keys()) if isinstance(kb, dict) else set()
        to_import = 0
        for s in sources:
            url = (s.get("url") or "").strip()
            aid = hashlib.md5(url.encode("utf-8")).hexdigest()[:12] if url else _kb_slug(s.get("title", ""))
            if aid not in existing:
                to_import += 1
        accounts = sorted({s["account_name"] for s in sources if s.get("account_name")})
        return jsonify({
            "available": len(sources),
            "toImport": to_import,
            "alreadyInKb": len(sources) - to_import,
            "accounts": accounts,
            "kb": str(kb_path.relative_to(LOOP_ROOT)),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/import", methods=["POST"])
def kb_import():
    """把上游采集结果导入当前活动 KB（按 md5(url) 去重，已存在的跳过）"""
    from flask import jsonify

    try:
        sources = _scan_collected_sources()
        kb_path = _active_kb_path()
        if not sources:
            return jsonify({
                "ok": True, "added": 0, "skipped": 0, "total": 0,
                "kb": str(kb_path.relative_to(LOOP_ROOT)),
                "message": "没有可导入的采集结果（wechat-mp-tools/data/articles_full 为空）",
            }), 200
        res = _import_sources_into_kb(sources, kb_path)
        res["ok"] = True
        return jsonify(res)
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
    data = _load_kb(_active_kb_path())
    out: list[dict] = []
    if isinstance(data, dict):
        for aid, meta in (data.get("articles") or {}).items():
            if isinstance(meta, dict):
                item = dict(meta)
                item.setdefault("id", aid)
                out.append(item)
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


def _term_set(value) -> set[str]:
    """把 tags/keywords 统一成小写字符串集合（用于相关推荐/去重）。"""
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return set()
    return {str(x).strip().lower() for x in value if str(x).strip()}


def _kb_item_brief(item: dict) -> dict:
    content = _article_content(item)
    stage = item.get("stage")
    if stage not in ("unused", "cited", "drafted"):
        stage = "cited" if item.get("used_as_source") else "unused"
    quality = item.get("quality")
    if not isinstance(quality, dict):
        quality = _quality_of(item)
    return {
        "id": item.get("id"),
        "title": item.get("title") or "(无标题)",
        "account": item.get("source_account") or item.get("account") or "未知",
        "publishDate": item.get("publish_date") or "",
        "url": item.get("url") or "",
        "topics": item.get("topics") or [],
        "keywords": item.get("keywords") or [],
        "tags": item.get("tags") or [],
        "status": stage,
        "collections": item.get("collections") or [],
        "quality": quality,
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
    """检索知识库：?q/qb、account/ab、tag/tb、status、collection、sort、limit、offset"""
    from flask import jsonify, request

    try:
        q = _kb_arg("q", "qb").strip().lower()
        account = _kb_arg("account", "ab").strip()
        tag = _kb_arg("tag", "tb").strip()
        status = (request.args.get("status") or "").strip()
        quality = (request.args.get("quality") or "").strip()
        collection = _kb_arg("collection", "cb").strip()
        sort = (request.args.get("sort") or "date_desc").strip()
        try:
            limit = max(1, min(500, int(request.args.get("limit") or 50)))
            offset = max(0, int(request.args.get("offset") or 0))
        except ValueError:
            return jsonify({"error": "limit/offset 必须是整数"}), 400
        if status and status not in ("unused", "cited", "drafted"):
            return jsonify({"error": "status 只能是 unused/cited/drafted"}), 400

        items = _kb_articles()
        briefs = [_kb_item_brief(x) for x in items]

        if account and account != "all":
            briefs = [b for b in briefs if b["account"] == account]
        if tag:
            briefs = [b for b in briefs
                      if tag in b["tags"] or tag in b["topics"] or tag in b["keywords"]]
        if status:
            briefs = [b for b in briefs if b["status"] == status]
        if quality in ("thin", "no_body", "no_keywords"):
            briefs = [b for b in briefs if quality in ((b.get("quality") or {}).get("flags") or [])]
        if collection == "__none__":
            briefs = [b for b in briefs if not b["collections"]]
        elif collection:
            # 集合在条目里存 id；前端展示与筛选用名称，这里两种都认
            cid = _resolve_collection(_load_kb(), collection)
            briefs = [b for b in briefs if cid in b["collections"]]
        if q:
            def hit(b: dict) -> bool:
                haystack = " ".join([
                    b["title"], b["snippet"], " ".join(b["topics"]),
                    " ".join(b["keywords"]), " ".join(b["tags"]),
                ]).lower()
                return q in haystack
            briefs = [b for b in briefs if hit(b)]

        if sort in ("words", "words_desc"):
            briefs.sort(key=lambda b: b["wordCount"], reverse=True)
        elif sort == "words_asc":
            briefs.sort(key=lambda b: b["wordCount"])
        elif sort == "date_asc":
            briefs.sort(key=lambda b: b["publishDate"])
        elif sort == "title":
            briefs.sort(key=lambda b: b["title"])
        else:  # date_desc（默认）
            briefs.sort(key=lambda b: b["publishDate"], reverse=True)

        total = len(briefs)
        page = briefs[offset:offset + limit]

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
    """单篇详情（含正文、相关推荐、重复检测）"""
    from flask import jsonify

    try:
        items = _kb_articles()
        target = next((x for x in items if str(x.get("id")) == article_id), None)
        if target is None:
            return jsonify({"error": f"知识库里没有这篇文章：{article_id}"}), 404

        brief = _kb_item_brief(target)
        brief["content"] = _article_content(target)

        t_tags = _term_set(target.get("tags"))
        t_kws = _term_set(target.get("keywords"))
        t_hash = target.get("hash") or _article_hash(target)
        analyze = _kb_analyze_module()
        from collections import Counter

        target_text = " ".join([
            str(target.get("title") or ""), " ".join(sorted(t_kws)),
            " ".join(sorted(t_tags)), brief["content"][:2000],
        ])
        t_vec = Counter(analyze.tokenize(target_text))
        t_simhash = analyze.simhash64(target_text)

        related: list[dict] = []
        dup: dict | None = None
        for other in items:
            if str(other.get("id")) == article_id:
                continue
            shared_tags = _term_set(other.get("tags")) & t_tags
            shared_kws = _term_set(other.get("keywords")) & t_kws
            o_text = " ".join([
                str(other.get("title") or ""),
                " ".join(sorted(_term_set(other.get("keywords")))),
                " ".join(sorted(_term_set(other.get("tags")))),
                _snippet(_article_content(other), 300),
            ])
            o_vec = Counter(analyze.tokenize(o_text))
            cos = analyze.cosine_counter(t_vec, o_vec)

            parts = []
            if shared_tags:
                parts.append("共同标签：" + "、".join(sorted(shared_tags)[:3]))
            if shared_kws:
                parts.append("共同关键词：" + "、".join(sorted(shared_kws)[:3]))
            if cos >= 0.12:
                parts.append(f"语义相近 {round(cos * 100)}%")
            if parts:
                related.append({
                    "id": other.get("id"),
                    "title": other.get("title") or "(无标题)",
                    "reason": "；".join(parts),
                    "_score": len(shared_tags) * 2 + len(shared_kws) + cos * 5,
                })

            o_hash = other.get("hash") or _article_hash(other)
            o_simhash = analyze.simhash64(o_text)
            ham = analyze.hamming(t_simhash, o_simhash)
            sim = 1.0 if (t_hash and o_hash == t_hash) else max(cos, 1.0 - ham / 64.0)
            if (t_hash and o_hash == t_hash) or cos >= 0.82 or (ham <= 8 and cos >= 0.5):
                if dup is None or sim > dup.get("similarity", 0):
                    dup = {"id": other.get("id"),
                           "title": other.get("title") or "(无标题)",
                           "similarity": round(sim, 3)}

        related.sort(key=lambda r: -r["_score"])
        brief["related"] = [{k: r[k] for k in ("id", "title", "reason")} for r in related[:5]]
        brief["duplicateOf"] = dup
        return jsonify(brief)
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
        collection = _kb_arg("collection", "cb").strip()
        status = (request.args.get("status") or "").strip()
        since = (request.args.get("since") or "").strip()  # YYYY-MM-DD，增量导出
        ids_arg = (request.args.get("ids") or "").strip()

        items = _kb_articles()
        briefs = [_kb_item_brief(x) for x in items]
        if account and account != "all":
            briefs = [b for b in briefs if b["account"] == account]
        if tag:
            briefs = [b for b in briefs if tag in b["topics"] or tag in b["keywords"]]
        if q:
            briefs = [b for b in briefs
                      if q in " ".join([b["title"], b["snippet"], " ".join(b["topics"])]).lower()]
        if status in ("unused", "cited", "drafted"):
            briefs = [b for b in briefs if b["status"] == status]
        if collection == "__none__":
            briefs = [b for b in briefs if not b["collections"]]
        elif collection:
            cid = _resolve_collection(_load_kb(), collection)
            briefs = [b for b in briefs if cid in b["collections"]]
        if since:
            briefs = [b for b in briefs if str(b["publishDate"] or "") >= since]
        if ids_arg:
            wanted = {x.strip() for x in ids_arg.split(",") if x.strip()}
            briefs = [b for b in briefs if str(b["id"]) in wanted]
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
                manifest = {
                    "exportedAt": _now_iso(),
                    "since": since or None,
                    "filters": {"q": q, "account": account, "tag": tag,
                                "collection": collection, "status": status},
                    "count": len(briefs),
                    "items": [{"id": b["id"], "title": b["title"],
                               "publishDate": b["publishDate"], "url": b["url"]} for b in briefs],
                }
                zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
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


# ---- 知识库工作台：统计 / 批量 / 集合 / 视图 / 检索 ----

def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value):
    from datetime import datetime, timezone

    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _collection_items(kb: dict) -> list[dict]:
    """collections 既可能是 {id: name} 也可能是 {id: {name,parent}}，统一成列表。"""
    cols = kb.get("collections") or {}
    out: list[dict] = []
    if isinstance(cols, dict):
        for cid, meta in cols.items():
            if isinstance(meta, dict):
                name = meta.get("name") or cid
                parent = str(meta.get("parent") or "")
            else:
                name = meta or cid
                parent = ""
            out.append({"id": str(cid), "name": str(name or cid), "parent": parent})
    elif isinstance(cols, list):
        for c in cols:
            if isinstance(c, dict) and c.get("id"):
                out.append({"id": str(c["id"]), "name": str(c.get("name") or c["id"]),
                            "parent": str(c.get("parent") or "")})
    return out


def _collection_set(cols: dict, cid: str, name: str, parent: str = "") -> None:
    """写回集合，统一存成 {name,parent}；parent 为空时保持紧凑写法。"""
    cols[cid] = {"name": name, "parent": parent} if parent else name


def _resolve_collection(kb: dict, value) -> str:
    """把集合 id 或显示名统一解析成 id；未知值原样返回（由调用方决定是否报错）。"""
    v = str(value or "").strip()
    for c in _collection_items(kb):
        if v == c["id"] or v == c["name"]:
            return c["id"]
    return v


def _unlink_kb_md(rel: str) -> bool:
    """只删 loop/kb/ 下的正文文件，防止误删外部路径。"""
    if not rel:
        return False
    p = (LOOP_ROOT / rel).resolve()
    base = (KB_DIR / "kb").resolve()
    try:
        p.relative_to(base)
    except ValueError:
        return False
    try:
        if p.is_file():
            p.unlink()
            return True
    except OSError:
        return False
    return False


@app.route("/api/kb/stats", methods=["GET"])
def kb_stats():
    """知识库工作台统计"""
    from datetime import datetime, timedelta, timezone

    from flask import jsonify

    try:
        kb = _load_kb()
        articles = kb.get("articles") or {}
        items = list(articles.values()) if isinstance(articles, dict) else list(articles)

        counts = {"unused": 0, "cited": 0, "drafted": 0}
        by_account: dict[str, int] = {}
        by_tag: dict[str, int] = {}
        col_counts: dict[str, int] = {}
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        week_added = 0
        thin = 0
        no_body = 0
        no_keywords = 0
        score_sum = 0
        cite_days: list[float] = []

        for item in items:
            if not isinstance(item, dict):
                continue
            stage = item.get("stage")
            if stage not in counts:
                stage = "cited" if item.get("used_as_source") else "unused"
            counts[stage] += 1

            quality = item.get("quality")
            if not isinstance(quality, dict):
                quality = _quality_of(item)
            flags = quality.get("flags") or []
            if "thin" in flags:
                thin += 1
            if "no_body" in flags:
                no_body += 1
            if "no_keywords" in flags:
                no_keywords += 1
            try:
                score_sum += int(quality.get("score") or 0)
            except (TypeError, ValueError):
                pass

            key = str(item.get("source_account") or item.get("account") or "未知")
            by_account[key] = by_account.get(key, 0) + 1
            for t in item.get("tags") or []:
                t = str(t)
                if t:
                    by_tag[t] = by_tag.get(t, 0) + 1
            for c in item.get("collections") or []:
                col_counts[str(c)] = col_counts.get(str(c), 0) + 1
            ts = _parse_iso(item.get("created_at"))
            if ts and ts >= cutoff:
                week_added += 1
            if item.get("used_as_source") or stage in ("cited", "drafted"):
                created = _parse_iso(item.get("created_at"))
                used = _parse_iso(item.get("used_at"))
                if created and used:
                    cite_days.append(max(0.0, (used - created).total_seconds() / 86400))

        cite_days.sort()
        if cite_days:
            mid = len(cite_days) // 2
            median_cite = (cite_days[mid] if len(cite_days) % 2
                           else (cite_days[mid - 1] + cite_days[mid]) / 2)
            median_cite = round(median_cite, 1)
        else:
            median_cite = None

        total = sum(counts.values())
        accounts_meta = kb.get("accounts") if isinstance(kb.get("accounts"), dict) else {}
        by_account_out = []
        for key, count in sorted(by_account.items(), key=lambda kv: (-kv[1], kv[0])):
            meta = accounts_meta.get(key) or {}
            name = meta.get("name") if isinstance(meta, dict) else None
            by_account_out.append({"key": key, "name": name or key, "count": count})

        collections = [
            {"id": c["id"], "name": c["name"], "parent": c.get("parent") or "",
             "count": col_counts.get(c["id"], 0)}
            for c in _collection_items(kb)
        ]
        return jsonify({
            "total": total,
            "unused": counts["unused"],
            "cited": counts["cited"],
            "drafted": counts["drafted"],
            "weekAdded": week_added,
            "thin": thin,
            "noBody": no_body,
            "noKeywords": no_keywords,
            "avgQuality": round(score_sum / total, 1) if total else 0,
            "medianDaysToCite": median_cite,
            "citeTargetDays": 7,
            "citedRate": round((counts["cited"] + counts["drafted"]) / total, 4) if total else 0,
            "byAccount": by_account_out,
            "byTag": [{"tag": k, "count": v}
                      for k, v in sorted(by_tag.items(), key=lambda kv: (-kv[1], kv[0]))],
            "collections": collections,
            "views": kb.get("views") or [],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/batch", methods=["POST"])
def kb_batch():
    """批量操作：tag / untag / move / remove / stage"""
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        ids = body.get("ids")
        op = (body.get("op") or "").strip()
        value = body.get("value")
        if not isinstance(ids, list) or not ids:
            return jsonify({"error": "ids 必须是非空数组"}), 400
        if op not in ("tag", "untag", "move", "remove", "stage"):
            return jsonify({"error": "op 只能是 tag/untag/move/remove/stage"}), 400
        if op == "stage" and value not in ("unused", "cited", "drafted"):
            return jsonify({"error": "stage 的 value 只能是 unused/cited/drafted"}), 400

        kb_path = _active_kb_path()
        kb = _load_kb(kb_path)
        articles = kb.get("articles")
        if not isinstance(articles, dict):
            return jsonify({"error": "知识库结构不支持批量操作"}), 400

        if op == "move" and value not in (None, ""):
            if str(value) == "__none__":
                value = ""
            else:
                cid = _resolve_collection(kb, value)
                if cid not in {c["id"] for c in _collection_items(kb)}:
                    return jsonify({"error": f"集合不存在：{value}"}), 400
                value = cid

        values = value if isinstance(value, list) else [value]
        values = [str(v) for v in values if v is not None and str(v) != ""]
        if op in ("tag", "untag") and not values:
            return jsonify({"error": "tag/untag 需要非空 value"}), 400

        updated = 0
        removed = 0
        now = _now_iso()
        for raw_id in ids:
            aid = str(raw_id)
            item = articles.get(aid)
            if not isinstance(item, dict):
                continue
            if op == "tag":
                tags = item.get("tags") if isinstance(item.get("tags"), list) else []
                for v in values:
                    if v not in tags:
                        tags.append(v)
                item["tags"] = tags
            elif op == "untag":
                item["tags"] = [t for t in (item.get("tags") or []) if str(t) not in values]
            elif op == "move":
                cols = item.get("collections") if isinstance(item.get("collections"), list) else []
                target = "" if value in (None, "") else str(value)
                if target:
                    if target not in cols:
                        cols.append(target)
                else:
                    cols = []
                item["collections"] = cols
            elif op == "stage":
                item["stage"] = value
                item["used_as_source"] = value != "unused"
                if value == "drafted":
                    item["used_at"] = now
            elif op == "remove":
                rel = str(item.get("local_md_path") or "").strip()
                del articles[aid]
                removed += 1
                _unlink_kb_md(rel)
                continue
            updated += 1

        if updated or removed:
            _save_kb(kb_path, kb)
        return jsonify({"updated": updated, "removed": removed, "total": len(articles)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/collections", methods=["GET"])
def kb_collections():
    from flask import jsonify

    try:
        kb = _load_kb()
        articles = kb.get("articles") or {}
        items = list(articles.values()) if isinstance(articles, dict) else list(articles)
        counts: dict[str, int] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            for c in item.get("collections") or []:
                counts[str(c)] = counts.get(str(c), 0) + 1
        out = _collection_items(kb)
        for c in out:
            c["count"] = counts.get(c["id"], 0)
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/collections", methods=["POST"])
def kb_collection_create():
    """集合树：create / rename / move / delete（默认 create，兼容旧调用）。"""
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        action = (body.get("action") or "create").strip()
        name = (body.get("name") or "").strip()
        kb_path = _active_kb_path()
        kb = _load_kb(kb_path)
        cols = kb.get("collections")
        if not isinstance(cols, dict):
            cols = {}
        items = _collection_items(kb)
        by_id = {c["id"]: c for c in items}

        if action == "create":
            if not name:
                return jsonify({"error": "缺少 name"}), 400
            parent = _resolve_collection(kb, body.get("parent") or "")
            if parent and parent not in by_id:
                return jsonify({"error": f"父集合不存在：{parent}"}), 400
            base = _kb_slug(name)
            cid = base
            n = 2
            while cid in cols:
                cid = f"{base}-{n}"
                n += 1
            _collection_set(cols, cid, name, parent)
            kb["collections"] = cols
            _save_kb(kb_path, kb)
            return jsonify({"id": cid, "name": name, "parent": parent,
                            "items": _collection_items(kb)})

        cid = _resolve_collection(kb, body.get("id") or "")
        if cid not in by_id:
            return jsonify({"error": f"集合不存在：{body.get('id')}"}), 404

        if action == "rename":
            if not name:
                return jsonify({"error": "缺少 name"}), 400
            meta = by_id[cid]
            _collection_set(cols, cid, name, meta.get("parent") or "")
            kb["collections"] = cols
            _save_kb(kb_path, kb)
            return jsonify({"id": cid, "name": name, "items": _collection_items(kb)})

        if action == "move":
            parent = _resolve_collection(kb, body.get("parent") or "")
            if parent and parent not in by_id:
                return jsonify({"error": f"父集合不存在：{parent}"}), 400
            # 防止把父节点挂到自己的子孙下面
            cur = parent
            seen = set()
            while cur:
                if cur == cid:
                    return jsonify({"error": "不能把集合移动到它自己的子集合下"}), 400
                if cur in seen:
                    break
                seen.add(cur)
                cur = by_id.get(cur, {}).get("parent") or ""
            meta = by_id[cid]
            _collection_set(cols, cid, meta["name"], parent)
            kb["collections"] = cols
            _save_kb(kb_path, kb)
            return jsonify({"id": cid, "parent": parent, "items": _collection_items(kb)})

        if action == "delete":
            parent = by_id[cid].get("parent") or ""
            cols.pop(cid, None)
            for c in _collection_items({"collections": cols}):
                if c.get("parent") == cid:
                    _collection_set(cols, c["id"], c["name"], parent)
            articles = kb.get("articles")
            if isinstance(articles, dict):
                for item in articles.values():
                    if isinstance(item, dict) and isinstance(item.get("collections"), list):
                        item["collections"] = [x for x in item["collections"] if str(x) != cid]
            kb["collections"] = cols
            _save_kb(kb_path, kb)
            return jsonify({"deleted": cid, "items": _collection_items(kb)})

        return jsonify({"error": "action 只能是 create/rename/move/delete"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/views", methods=["GET"])
def kb_views():
    from flask import jsonify

    try:
        return jsonify(_load_kb().get("views") or [])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/views", methods=["POST"])
def kb_view_create():
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "缺少 name"}), 400
        kb_path = _active_kb_path()
        kb = _load_kb(kb_path)
        views = kb.get("views") if isinstance(kb.get("views"), list) else []
        base = _kb_slug(name)
        vid = base
        n = 2
        existing = {str(v.get("id")) for v in views if isinstance(v, dict)}
        while vid in existing:
            vid = f"{base}-{n}"
            n += 1
        views.append({"id": vid, "name": name,
                      "filter": body["filter"] if "filter" in body else {}})
        kb["views"] = views
        _save_kb(kb_path, kb)
        return jsonify(views)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _kb_index_module():
    import importlib

    scripts = str(LOOP_ROOT / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    return importlib.import_module("kb_index")


def _kb_analyze_module():
    import importlib

    scripts = str(LOOP_ROOT / "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    return importlib.import_module("kb_analyze")


_ANALYSIS_CACHE: dict = {}


def _cached_analysis(kind: str, params: dict, fn):
    """按「KB 路径 + mtime + 参数」缓存分析结果，KB 一改写自动失效。"""
    kb_path = _active_kb_path()
    try:
        mtime = kb_path.stat().st_mtime_ns
    except OSError:
        mtime = 0
    key = (str(kb_path), mtime, kind, tuple(sorted(params.items())))
    if key in _ANALYSIS_CACHE:
        return _ANALYSIS_CACHE[key]
    value = fn()
    if len(_ANALYSIS_CACHE) > 32:
        _ANALYSIS_CACHE.clear()
    _ANALYSIS_CACHE[key] = value
    return value


def _excerpts_path(kb_path: Path | None = None) -> Path:
    stem = Path(kb_path or _active_kb_path()).stem
    return KB_DIR / "kb" / ".excerpts" / f"{stem}.json"


def _load_excerpts(kb_path: Path | None = None) -> dict:
    data = _load_json(_excerpts_path(kb_path), {"schema": 1, "items": []})
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return {"schema": 1, "items": []}
    return data


def _save_excerpts(data: dict, kb_path: Path | None = None) -> None:
    _save_json(_excerpts_path(kb_path), data)


def _mark_articles_used(article_ids, stage: str = "cited") -> list[str]:
    """把文章标记为已引用/已成稿（used_as_source=true）。"""
    kb_path = _active_kb_path()
    kb = _load_kb(kb_path)
    articles = kb.get("articles")
    if not isinstance(articles, dict):
        return []
    now = _now_iso()
    marked = []
    for aid in article_ids:
        item = articles.get(str(aid))
        if not isinstance(item, dict):
            continue
        item["used_as_source"] = True
        item["stage"] = stage
        item["used_at"] = item.get("used_at") or now
        marked.append(str(aid))
    if marked:
        _save_kb(kb_path, kb)
    return marked


def _mark_run_evidence_used(run_dir: Path, stage: str = "drafted") -> list[str]:
    """发布回流：把该 run 证据包里的来源文章标记为已成稿。"""
    evidence = _load_json(run_dir / "evidence_pack.json", {})
    chunks = evidence.get("top_chunks") if isinstance(evidence, dict) else None
    ids = []
    for chunk in chunks or []:
        if isinstance(chunk, dict) and chunk.get("article_id"):
            ids.append(str(chunk["article_id"]))
    return _mark_articles_used(list(dict.fromkeys(ids)), stage=stage)


def _highlight(text: str, q: str, size: int = 110) -> str:
    import re

    plain = _snippet(text, 10000)
    idx = plain.lower().find(q.lower())
    if idx < 0:
        return plain[:size] + ("…" if len(plain) > size else "")
    start = max(0, idx - size // 3)
    end = min(len(plain), idx + len(q) + size)
    snip = plain[start:end]
    snip = re.sub(re.escape(q), lambda m: f"<mark>{m.group(0)}</mark>",
                  snip, count=1, flags=re.IGNORECASE)
    if start > 0:
        snip = "…" + snip
    if end < len(plain):
        snip = snip + "…"
    return snip


def _kb_fallback_search(q: str, briefs: list[dict], limit: int,
                        content_by_id: dict[str, str] | None = None) -> list[dict]:
    """FTS5 不可用时的降级检索：标题/标签/正文子串打分。"""
    ql = q.lower()
    content_by_id = content_by_id or {}
    out: list[dict] = []
    for b in briefs:
        content = content_by_id.get(str(b["id"])) or b["snippet"]
        title = b["title"].lower()
        tags = " ".join(b["tags"]).lower()
        kws = " ".join(b["keywords"]).lower()
        body = content.lower()
        if ql not in title and ql not in tags and ql not in kws and ql not in body:
            continue
        score = (title.count(ql) * 5 + tags.count(ql) * 3
                 + kws.count(ql) * 2 + body.count(ql))
        if score <= 0:
            continue
        out.append({
            "id": b["id"],
            "title": b["title"],
            "account": b["account"],
            "publishDate": b["publishDate"],
            "tags": b["tags"],
            "score": float(score),
            "snippet": _highlight(content, q),
        })
    out.sort(key=lambda x: -x["score"])
    return out[:limit]


@app.route("/api/kb/search", methods=["GET"])
def kb_search():
    """检索：FTS5(BM25) / hash-ngram 向量 / 两路 RRF 融合（默认 hybrid）。"""
    from flask import jsonify, request

    try:
        q = _kb_arg("q", "qb").strip()
        mode = (request.args.get("mode") or "hybrid").strip().lower()
        if mode not in ("kw", "vec", "hybrid"):
            return jsonify({"error": "mode 只能是 kw/vec/hybrid"}), 400
        try:
            limit = max(1, min(200, int(request.args.get("limit") or 50)))
        except ValueError:
            return jsonify({"error": "limit 必须是整数"}), 400
        if len(q) < 2:
            return jsonify({"items": [], "total": 0, "mode": mode})

        raw_items = _kb_articles()
        briefs = [_kb_item_brief(x) for x in raw_items]
        by_id = {str(b["id"]): b for b in briefs}
        content_by_id = {str(x.get("id")): _article_content(x) for x in raw_items}

        def _shape(h: dict, extra: dict | None = None) -> dict | None:
            b = by_id.get(str(h.get("id")))
            if not b:
                return None
            item = {
                "id": b["id"],
                "title": b["title"],
                "account": b["account"],
                "publishDate": b["publishDate"],
                "tags": b["tags"],
                "score": h.get("score"),
                "snippet": h.get("snippet") or b["snippet"],
            }
            if extra:
                item.update(extra)
            return item

        kw_hits: list[dict] = []
        vec_hits: list[dict] = []
        kw_ok = vec_ok = False
        if mode in ("kw", "hybrid"):
            try:
                kw_hits = _kb_index_module().search(_active_kb_path(), q, limit=limit)
                kw_ok = True
            except Exception:
                kw_ok = False
        if mode in ("vec", "hybrid"):
            try:
                vec_hits = _kb_analyze_module().search_vec(_active_kb_path(), q, limit=limit)
                vec_ok = True
            except Exception:
                vec_ok = False

        if mode == "hybrid" and kw_ok and vec_ok:
            fused = _kb_analyze_module().rrf_fuse([("fts", kw_hits), ("vec", vec_hits)])
            items = []
            for h in fused:
                shaped = _shape(h, {"engines": h.get("engines") or {}})
                if shaped:
                    items.append(shaped)
            return jsonify({
                "items": items[:limit], "total": len(items),
                "mode": "hybrid",
                "engines": {"fts": len(kw_hits), "vec": len(vec_hits), "rrfK": 60},
            })

        if mode == "vec" and vec_ok:
            items = [x for x in (_shape(h) for h in vec_hits) if x]
            return jsonify({"items": items, "total": len(items), "mode": "vec",
                            "engines": {"vec": len(vec_hits)}})

        if kw_ok:
            items = [x for x in (_shape(h) for h in kw_hits) if x]
            return jsonify({"items": items, "total": len(items), "mode": "fts"})

        if vec_ok:
            items = [x for x in (_shape(h) for h in vec_hits) if x]
            return jsonify({"items": items, "total": len(items), "mode": "vec"})

        items = _kb_fallback_search(q, briefs, limit, content_by_id)
        return jsonify({"items": items, "total": len(items), "mode": "fallback"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/topics", methods=["GET"])
def kb_topics():
    """主题聚类 + 覆盖度（词共现，无 LLM）。"""
    from flask import jsonify, request

    try:
        limit = max(3, min(20, int(request.args.get("limit") or 8)))
    except ValueError:
        limit = 8
    try:
        data = _cached_analysis(
            "topics", {"limit": limit},
            lambda: _kb_analyze_module().build_clusters(_active_kb_path(), limit=limit),
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": f"主题聚类失败：{e}"}), 500


@app.route("/api/kb/duplicates", methods=["GET"])
def kb_duplicates():
    """疑似重复分组（simhash64 + 余弦双阈值）。"""
    from flask import jsonify, request

    try:
        limit = max(1, min(100, int(request.args.get("limit") or 30)))
    except ValueError:
        limit = 30
    try:
        data = _cached_analysis(
            "duplicates", {"limit": limit},
            lambda: _kb_analyze_module().find_duplicates(_active_kb_path(), limit=limit),
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": f"重复检测失败：{e}"}), 500


@app.route("/api/kb/excerpts", methods=["GET", "POST"])
def kb_excerpts():
    """划线摘录：GET 列表 / POST 新增（同一文章同一段文本幂等）。"""
    from flask import jsonify, request
    import hashlib

    try:
        if request.method == "GET":
            data = _load_excerpts()
            raw = _kb_articles()
            by_id = {str(x.get("id")): x for x in raw}
            items = []
            for e in data.get("items") or []:
                aid = str(e.get("articleId") or "")
                a = by_id.get(aid) or {}
                items.append({
                    **e,
                    "articleTitle": a.get("title") or "",
                    "account": a.get("source_account") or a.get("account") or "",
                    "url": a.get("url") or "",
                })
            items.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
            return jsonify({"items": items, "count": len(items)})

        body = request.get_json(silent=True) or {}
        article_id = str(body.get("articleId") or "").strip()
        text = str(body.get("text") or "").strip()
        note = str(body.get("note") or "").strip()[:200]
        if not article_id or not text:
            return jsonify({"error": "缺少 articleId 或 text"}), 400
        if len(text) > 2000:
            text = text[:2000]
        raw = _kb_articles()
        article = next((x for x in raw if str(x.get("id")) == article_id), None)
        if article is None:
            return jsonify({"error": f"文章不存在：{article_id}"}), 404

        data = _load_excerpts()
        items = data.setdefault("items", [])
        for e in items:
            if str(e.get("articleId")) == article_id and e.get("text") == text:
                return jsonify({**e, "duplicate": True})
        item = {
            "id": "ex-" + hashlib.md5(f"{article_id}|{text}|{time.time()}".encode()).hexdigest()[:10],
            "articleId": article_id,
            "text": text,
            "note": note,
            "created_at": _now_iso(),
        }
        items.append(item)
        data["items"] = items[-500:]
        _save_excerpts(data)
        return jsonify({**item, "articleTitle": article.get("title") or "",
                        "account": article.get("source_account") or "",
                        "url": article.get("url") or ""})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/excerpts/<excerpt_id>", methods=["DELETE"])
def kb_excerpt_delete(excerpt_id: str):
    from flask import jsonify

    try:
        data = _load_excerpts()
        before = len(data.get("items") or [])
        data["items"] = [e for e in (data.get("items") or [])
                         if str(e.get("id")) != excerpt_id]
        if len(data["items"]) == before:
            return jsonify({"error": f"摘录不存在：{excerpt_id}"}), 404
        _save_excerpts(data)
        return jsonify({"ok": True, "deleted": excerpt_id, "count": len(data["items"])})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/evidence", methods=["POST"])
def kb_evidence():
    """素材篮 → 证据包：落 loop/runs/<date>/evidence_pack.json，并回写引用状态。"""
    from flask import jsonify, request

    try:
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()
        excerpt_ids = [str(x) for x in (body.get("excerptIds") or []) if str(x).strip()]
        article_ids = [str(x) for x in (body.get("articleIds") or []) if str(x).strip()]
        date_tag = body.get("date") or _today()
        if not excerpt_ids and not article_ids:
            return jsonify({"error": "素材篮是空的，先摘录或勾选文章"}), 400

        raw = _kb_articles()
        by_id = {str(x.get("id")): x for x in raw}
        ex_data = _load_excerpts()
        ex_by_id = {str(e.get("id")): e for e in (ex_data.get("items") or [])}

        merged: dict[str, list[str]] = {}
        order: list[str] = []

        def _push(aid: str, text: str) -> None:
            if not aid or aid not in by_id:
                return
            if aid not in merged:
                merged[aid] = []
                order.append(aid)
            if text:
                merged[aid].append(text)

        for eid in excerpt_ids:
            ex = ex_by_id.get(eid)
            if not ex:
                continue
            _push(str(ex.get("articleId") or ""), str(ex.get("text") or ""))
        for aid in article_ids:
            item = by_id.get(aid)
            if item:
                _push(aid, "")
                merged[aid] = merged[aid] or []

        if not order:
            return jsonify({"error": "素材篮里的内容已不在当前知识库中"}), 400

        top_chunks = []
        missing_url = 0
        for idx, aid in enumerate(order):
            item = by_id[aid]
            texts = merged.get(aid) or []
            snippet = " / ".join(x for x in texts if x).strip()
            if not snippet:
                snippet = _snippet(_article_content(item), 300)
            url = str(item.get("url") or "")
            if not url:
                missing_url += 1
            top_chunks.append({
                "article_id": aid,
                "score": round(max(0.1, 1.0 - idx * 0.05), 3),
                "snippet": snippet[:600],
                "url": url,
                "title": item.get("title") or "",
                "account": item.get("source_account") or item.get("account") or "",
            })

        run_dir = _safe_run_dir(date_tag)
        evidence_path = run_dir / "evidence_pack.json"
        _save_json(evidence_path, {
            "query": title or "素材篮证据包",
            "generated_at": _now_iso(),
            "total_candidates": len(top_chunks),
            "top_chunks": top_chunks,
        })

        # 引用状态只在「发布回流」时标记（_mark_run_evidence_used），
        # 组证据包属于写作准备，不算已引用，避免虚高被引用率。
        warnings = []
        if len(top_chunks) < 5:
            warnings.append(f"证据包仅 {len(top_chunks)} 条，验收建议至少 5 条")
        if missing_url:
            warnings.append(f"{missing_url} 条来源缺少原文链接")

        prompt = ""
        prompt_path = None
        if title:
            prompt_path = run_dir / ".prompt"
            built = _run_script(
                "build_prompt.py",
                [
                    "--date", date_tag,
                    "--topic-title", title,
                    "--persona", body.get("persona") or "industry-observer",
                    "--framework", body.get("framework") or "清单型",
                    "--dimensions", body.get("dimensions") or "叙事视角:问答体 + 类比域:电影 + 情绪基调:毒舌调侃",
                    "--evidence", str(evidence_path.relative_to(LOOP_ROOT)),
                    "--out", str(prompt_path.relative_to(LOOP_ROOT)),
                ],
                timeout=60,
            )
            if built["ok"] and prompt_path.exists():
                prompt = prompt_path.read_text(encoding="utf-8")

        return jsonify({
            "ok": True,
            "date": date_tag,
            "runDir": str(run_dir.relative_to(LOOP_ROOT)),
            "evidencePath": str(evidence_path.relative_to(LOOP_ROOT)),
            "promptPath": str(prompt_path.relative_to(LOOP_ROOT)) if prompt else "",
            "prompt": prompt,
            "evidenceCount": len(top_chunks),
            "missingUrl": missing_url,
            "warnings": warnings,
            "marked": [],
        })
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
BRIDGE_FEATURES = ("kb", "article-html", "image-proxy", "proxy-fetch-free", "collect-jobs")


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
        "collect-jobs": "/api/collect/jobs",
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
        kb_rel = str(_active_kb_path().relative_to(LOOP_ROOT))
        res = _run_script("topic_selection.py", ["--top-n", top_n, "--min-score", min_score, "--kb", kb_rel], timeout=60)
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
        kb_rel = str(_active_kb_path().relative_to(LOOP_ROOT))
        search = _run_script(
            "simple_search.py",
            [query, "--top-k", "5", "--output", str(evidence_path.relative_to(LOOP_ROOT)), "--kb", kb_rel],
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

        # 明确拿到引用文章 id 时才标记 cited，拿不到就跳过（不臆造）
        raw_ids = body.get("sourceIds") or body.get("source_ids") or body.get("articleIds") or []
        source_ids = [str(x) for x in raw_ids] if isinstance(raw_ids, list) else []
        cited: list[str] = []
        cite_note = "未提供引用文章 id，跳过知识库状态更新"
        if source_ids:
            kb_path = _active_kb_path()
            kb = _load_kb(kb_path)
            articles = kb.get("articles") if isinstance(kb.get("articles"), dict) else {}
            now = _now_iso()
            for aid in source_ids:
                item = articles.get(aid)
                if not isinstance(item, dict):
                    continue
                item["stage"] = "cited"
                item["used_as_source"] = True
                item["used_at"] = now
                cited.append(aid)
            if cited:
                _save_kb(kb_path, kb)
                cite_note = f"已把 {len(cited)} 篇引用文章置为 cited"
            else:
                cite_note = "提供的引用 id 在知识库中都不存在，未更新"

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
            "cited": cited,
            "citeNote": cite_note,
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
        # 发布回流：本次证据包里的来源文章自动标记 used_as_source
        try:
            marked = _mark_run_evidence_used(run_dir, stage="drafted")
        except Exception:
            marked = []
        return jsonify({"ok": True, "result": payload, "marked": marked,
                        "raw": res["stdout"][-1200:]})
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


# ─────────────────────────────────────────────────────────────
# 采集稳定性：任务化批量采集（断点续采 / 自动重试 / 去重）
# ─────────────────────────────────────────────────────────────
#
# 上游 wechat-mp-tools 的采集本身是异步任务，但任务表只存在进程内存里，
# 一次只能跑一个账号，重启即丢。这里在外面再包一层可以落盘的「作业」：
#   - 串行驱动多个公众号，一个跑完再跑下一个（不并发轰炸风控）
#   - 单个账号失败自动重试（默认 2 次，指数退避）
#   - 每个账号的状态写进 loop/collect_jobs.json，中断后可只补没采完的号
#   - 去重交给上游 skip_existing=true（已下载的文章不发网络请求直接跳过）
#
# 上游契约（本机同端口的 Flask）：
#   POST /api/articles/collect-latest {fakeid, account_name, limit, skip_existing} -> {task_id}
#   GET  /api/articles/download-status/<task_id> -> {status,total,completed,failed,current,...}
#   POST /api/articles/download-cancel/<task_id>

COLLECT_JOBS_FILE = KB_DIR / "collect_jobs.json"
_collect_jobs_lock = threading.Lock()

# 单账号最长等待（秒），防止上游线程卡死把作业永久占住
_COLLECT_ACCOUNT_TIMEOUT = 60 * 30


def _upstream_base() -> str:
    """本机上游服务地址（bridge 与 wechat-mp-tools 同进程同端口）"""
    port = os.environ.get("MP_PORT", "5200")
    return f"http://127.0.0.1:{port}"


def _upstream_error(resp) -> str:
    try:
        payload = resp.json() or {}
    except Exception:
        payload = {}
    return payload.get("error") or payload.get("message") or f"HTTP {resp.status_code}"


def _jobs_state() -> dict:
    data = _load_json(COLLECT_JOBS_FILE, {"jobs": []})
    if isinstance(data, list):  # 兼容早期直接存数组
        data = {"jobs": data}
    if not isinstance(data.get("jobs"), list):
        data["jobs"] = []
    return data


def _save_jobs_state(state: dict) -> None:
    # 只保留最近 20 个作业，避免文件无限增长
    state["jobs"] = state.get("jobs", [])[:20]
    _save_json(COLLECT_JOBS_FILE, state)


def _find_job(state: dict, job_id: str) -> dict | None:
    for job in state.get("jobs", []):
        if job.get("id") == job_id:
            return job
    return None


def _job_update(job_id: str, mutate) -> dict | None:
    """在锁内读-改-写作业状态，返回快照（深拷贝，避免调用方改到缓存）"""
    with _collect_jobs_lock:
        state = _jobs_state()
        job = _find_job(state, job_id)
        if job is None:
            return None
        mutate(job)
        job["updated_at"] = time.time()
        _save_jobs_state(state)
        return json.loads(json.dumps(job))


def _job_snapshot(job_id: str) -> dict | None:
    with _collect_jobs_lock:
        state = _jobs_state()
        job = _find_job(state, job_id)
        return json.loads(json.dumps(job)) if job else None


def _job_cancelled(job_id: str) -> bool:
    job = _job_snapshot(job_id)
    return bool(job and job.get("cancel_requested"))


def _acc(job: dict, idx: int) -> dict:
    accs = job.setdefault("accounts", [])
    while len(accs) <= idx:
        accs.append({})
    return accs[idx]


def _recount_job(job: dict) -> None:
    accs = job.get("accounts", [])
    job["completed_accounts"] = sum(1 for a in accs if a.get("status") == "completed")
    job["failed_accounts"] = sum(1 for a in accs if a.get("status") == "failed")


def _acc_start(job: dict, idx: int, attempts: int) -> None:
    acc = _acc(job, idx)
    acc["status"] = "running"
    acc["attempts"] = attempts
    acc.setdefault("started_at", time.time())
    acc["stop_reason"] = ""
    job["current_account"] = acc.get("name", "")


def _acc_set_task(job: dict, idx: int, task_id: str) -> None:
    acc = _acc(job, idx)
    acc["task_id"] = task_id
    job["current_task_id"] = task_id


def _acc_progress(job: dict, idx: int, task: dict) -> None:
    acc = _acc(job, idx)
    acc["completed"] = int(task.get("completed") or 0)
    acc["failed"] = int(task.get("failed") or 0)
    acc["total"] = int(task.get("total") or 0)
    acc["scanned"] = int(task.get("scanned") or 0)
    job["current"] = task.get("current") or ""
    job["current_account"] = acc.get("name", "")


def _acc_finish(job: dict, idx: int, ok: bool, error: str) -> None:
    acc = _acc(job, idx)
    acc["status"] = "completed" if ok else "failed"
    acc["ended_at"] = time.time()
    if not ok:
        acc["stop_reason"] = error or "采集失败"
    job["current_account"] = ""
    job["current"] = ""
    job["current_task_id"] = ""
    _recount_job(job)


def _mark_job_cancelled(job: dict) -> None:
    job["status"] = "cancelled"
    job["cancel_requested"] = True
    job["current"] = ""
    job["current_account"] = ""
    job["current_task_id"] = ""
    job["stop_reason"] = job.get("stop_reason") or "用户取消"
    job["ended_at"] = time.time()
    for acc in job.get("accounts", []):
        if acc.get("status") == "running":
            acc["status"] = "cancelled"
    _recount_job(job)


def _mark_job_finished(job: dict) -> None:
    _recount_job(job)
    if job.get("cancel_requested"):
        job["status"] = "cancelled"
    elif job.get("failed_accounts"):
        job["status"] = "partial"
    else:
        job["status"] = "completed"
    job["current"] = ""
    job["current_account"] = ""
    job["current_task_id"] = ""
    job["ended_at"] = time.time()


def _upstream_collect(account: dict, limit: int) -> str:
    import requests

    resp = requests.post(
        _upstream_base() + "/api/articles/collect-latest",
        json={
            "fakeid": account.get("fakeid", ""),
            "account_name": account.get("name", ""),
            "limit": limit,
            "skip_existing": True,
        },
        timeout=20,
    )
    if resp.status_code != 200:
        raise RuntimeError(_upstream_error(resp))
    task_id = (resp.json() or {}).get("task_id", "")
    if not task_id:
        raise RuntimeError("上游未返回 task_id")
    return task_id


def _upstream_status(task_id: str) -> dict:
    import requests

    resp = requests.get(_upstream_base() + f"/api/articles/download-status/{task_id}", timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(_upstream_error(resp))
    return resp.json() or {}


def _wait_upstream_task(job_id: str, idx: int, task_id: str) -> dict:
    """轮询单个账号的采集任务，同时把进度写回作业；返回 {ok, cancelled, error}"""
    deadline = time.time() + _COLLECT_ACCOUNT_TIMEOUT
    while time.time() < deadline:
        if _job_cancelled(job_id):
            try:
                import requests

                requests.post(_upstream_base() + f"/api/articles/download-cancel/{task_id}", timeout=5)
            except Exception:
                pass
            return {"ok": False, "cancelled": True, "error": "用户取消"}

        try:
            task = _upstream_status(task_id)
        except Exception as exc:
            return {"ok": False, "cancelled": False, "error": f"查询进度失败：{exc}"}

        _job_update(job_id, lambda j, t=task: _acc_progress(j, idx, t))

        status = task.get("status")
        if status == "completed":
            # 上游把「列表都没拉到」也当成功结束（total=0），这里必须自己判一次：
            # 已下载的文章会被计入 total（只是被跳过），所以 total=0 只可能是
            # 凭证失效 / 公众号不可访问 / 列表请求失败，按失败处理才不会被误报成采集成功。
            if int(task.get("total") or 0) == 0:
                return {
                    "ok": False,
                    "cancelled": False,
                    "error": "没有取到任何文章（可能凭证失效、公众号不可访问或列表请求失败）",
                }
            return {"ok": True, "cancelled": False, "error": ""}
        if status == "failed":
            return {"ok": False, "cancelled": False, "error": task.get("stop_reason") or "上游采集失败"}
        if status == "cancelled":
            return {"ok": False, "cancelled": True, "error": task.get("stop_reason") or "上游已取消"}

        time.sleep(2.0)

    return {"ok": False, "cancelled": False, "error": "单个账号采集超时（30 分钟）"}


def _collect_job_worker(job_id: str) -> None:
    job = _job_update(job_id, lambda j: j.update(status="running", current="准备采集..."))
    if not job:
        return
    limit = int(job.get("limit") or 50)
    retries = max(0, int(job.get("retries") or 0))
    accounts = job.get("accounts", [])

    try:
        for idx, acc in enumerate(accounts):
            if acc.get("status") == "completed":
                continue
            if _job_cancelled(job_id):
                _job_update(job_id, _mark_job_cancelled)
                return

            attempts = 0
            ok = False
            last_error = ""
            while attempts <= retries:
                if _job_cancelled(job_id):
                    _job_update(job_id, _mark_job_cancelled)
                    return
                attempts += 1
                _job_update(job_id, lambda j, i=idx, a=attempts: _acc_start(j, i, a))
                try:
                    task_id = _upstream_collect(acc, limit)
                    _job_update(job_id, lambda j, i=idx, t=task_id: _acc_set_task(j, i, t))
                    result = _wait_upstream_task(job_id, idx, task_id)
                    if result["ok"]:
                        ok = True
                        break
                    last_error = result["error"]
                    if result["cancelled"]:
                        _job_update(job_id, _mark_job_cancelled)
                        return
                except Exception as exc:
                    last_error = f"{type(exc).__name__}: {exc}"

                if attempts <= retries:
                    # 指数退避，最多 8 秒，给上游 / 风控一点冷却
                    time.sleep(min(3.0 * attempts, 8.0))

            _job_update(job_id, lambda j, i=idx, o=ok, e=last_error: _acc_finish(j, i, o, e))

        _job_update(job_id, _mark_job_finished)
    except Exception as exc:
        _job_update(job_id, lambda j: j.update(
            status="failed", current="", stop_reason=str(exc), ended_at=time.time()
        ))


@app.route("/api/collect/jobs", methods=["GET"])
def collect_jobs_list():
    """采集作业列表（含每个账号的进度，供前端轮询）"""
    from flask import jsonify

    with _collect_jobs_lock:
        state = _jobs_state()
        return jsonify({"jobs": state.get("jobs", [])})


@app.route("/api/collect/jobs/<job_id>", methods=["GET"])
def collect_job_detail(job_id: str):
    from flask import jsonify

    job = _job_snapshot(job_id)
    if not job:
        return jsonify({"error": "作业不存在"}), 404
    return jsonify({"job": job})


@app.route("/api/collect/jobs", methods=["POST"])
def collect_jobs_create():
    """创建采集作业：按账号串行采集，失败重试，状态落盘可续采"""
    from flask import jsonify, request

    data = request.get_json(silent=True) or {}

    raw_accounts = data.get("accounts") or []
    accounts = []
    seen = set()
    for item in raw_accounts:
        if not isinstance(item, dict):
            continue
        fakeid = str(item.get("fakeid") or "").strip()
        if not fakeid or fakeid in seen:
            continue
        seen.add(fakeid)
        accounts.append({
            "fakeid": fakeid,
            "name": str(item.get("name") or "").strip() or fakeid,
            "status": "pending",
            "task_id": "",
            "attempts": 0,
            "completed": 0,
            "failed": 0,
            "total": 0,
            "scanned": 0,
            "stop_reason": "",
        })
    if not accounts:
        return jsonify({"error": "请先选择要采集的公众号"}), 400

    try:
        limit = max(1, min(200, int(data.get("limit") or 50)))
    except (TypeError, ValueError):
        limit = 50
    try:
        retries = data.get("retries")
        retries = 2 if retries is None else max(0, min(5, int(retries)))
    except (TypeError, ValueError):
        retries = 2

    with _collect_jobs_lock:
        state = _jobs_state()
        running = [j for j in state.get("jobs", []) if j.get("status") == "running"]
        if running:
            return jsonify({"error": "已有采集作业在运行，请等它结束或先取消"}), 409

        job = {
            "id": f"job_{time.strftime('%Y%m%d_%H%M%S')}_{os.urandom(2).hex()}",
            "created_at": time.time(),
            "updated_at": time.time(),
            "status": "pending",
            "limit": limit,
            "retries": retries,
            "total_accounts": len(accounts),
            "completed_accounts": 0,
            "failed_accounts": 0,
            "current": "",
            "current_account": "",
            "current_task_id": "",
            "cancel_requested": False,
            "stop_reason": "",
            "accounts": accounts,
        }
        state.setdefault("jobs", []).insert(0, job)
        _save_jobs_state(state)

    threading.Thread(target=_collect_job_worker, args=(job["id"],), daemon=True).start()
    return jsonify({"job": job})


@app.route("/api/collect/jobs/<job_id>/cancel", methods=["POST"])
def collect_job_cancel(job_id: str):
    """请求取消作业：置标志位，后台线程会停掉上游任务并收尾"""
    from flask import jsonify

    def set_cancel(job):
        if job.get("status") in ("completed", "partial", "failed", "cancelled"):
            return
        job["cancel_requested"] = True
        job["status"] = "cancelling"
        job["stop_reason"] = "用户请求停止"

    job = _job_update(job_id, set_cancel)
    if not job:
        return jsonify({"error": "作业不存在"}), 404
    return jsonify({"job": job})


@app.route("/api/collect/jobs/<job_id>/resume", methods=["POST"])
def collect_job_resume(job_id: str):
    """断点续采：把未完成的账号重置为等待，重新起线程（已完成的号直接跳过）"""
    from flask import jsonify

    with _collect_jobs_lock:
        state = _jobs_state()
        job = _find_job(state, job_id)
        if not job:
            return jsonify({"error": "作业不存在"}), 404
        if job.get("status") == "running":
            return jsonify({"error": "作业正在运行中"}), 409
        if any(j.get("status") == "running" and j.get("id") != job_id for j in state.get("jobs", [])):
            return jsonify({"error": "已有其它采集作业在运行"}), 409

        pending = 0
        for acc in job.get("accounts", []):
            if acc.get("status") != "completed":
                acc["status"] = "pending"
                acc["stop_reason"] = ""
                pending += 1
        if not pending:
            return jsonify({"error": "该作业的公众号都已采集完成，无需续采"}), 400

        job["status"] = "pending"
        job["cancel_requested"] = False
        job["stop_reason"] = ""
        job["ended_at"] = None
        job["current"] = ""
        job["current_account"] = ""
        job["current_task_id"] = ""
        job["updated_at"] = time.time()
        _save_jobs_state(state)
        snapshot = json.loads(json.dumps(job))

    threading.Thread(target=_collect_job_worker, args=(job_id,), daemon=True).start()
    return jsonify({"job": snapshot})


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
