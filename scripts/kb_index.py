#!/usr/bin/env python3
"""kb_index.py —— 知识库全文索引（SQLite FTS5，仅标准库）

索引文件：loop/kb/.index/<kb-stem>.db
表：
  docs(id TEXT PRIMARY KEY, title, keywords, account, hash)
  fts(title, keywords, body, tokenize='unicode61')   # rowid 与 docs.rowid 对齐
  meta(k TEXT PRIMARY KEY, v TEXT)                    # count / mtime / built_at

用法：
  python3 scripts/kb_index.py --kb loop/knowledge_base.json [--rebuild]
  python3 scripts/kb_index.py --kb loop/knowledge_base.json --search "关键词"

注意：unicode61 对中文按连续汉字切词，词中片段（如「在线看」之于
「免费在线看电影」）MATCH 不到，所以 search() 在 MATCH 无结果时退化为
LIKE 子串匹配，保证中文可用。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY,
    title TEXT,
    keywords TEXT,
    account TEXT,
    hash TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
    title, keywords, body, tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
"""


def _loop_root(kb_path: Path) -> Path:
    """找到最近的名为 loop 的祖先目录；找不到就返回 KB 所在目录。"""
    for p in (kb_path.parent, *kb_path.parent.parents):
        if p.name == "loop":
            return p
    return kb_path.parent


def index_db_path(kb_path: Path) -> Path:
    kb = Path(kb_path).resolve()
    root = _loop_root(kb)
    if root.name == "loop":
        return root / "kb" / ".index" / f"{kb.stem}.db"
    return kb.parent / ".index" / f"{kb.stem}.db"


def _repo_root(kb_path: Path) -> Path:
    """local_md_path 相对仓库根（loop/ 的父级）；找不到就退回 KB 目录。"""
    kb = kb_path.resolve()
    for p in (kb.parent, *kb.parent.parents):
        if p.name == "loop":
            return p.parent
    return kb.parent


def _article_hash(item: dict) -> str:
    url = str(item.get("url") or "").strip()
    if url:
        return hashlib.md5(url.encode("utf-8")).hexdigest()[:12]
    title = str(item.get("title") or "")
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", title).strip("-")[:60] or "untitled"
    return slug


def _keywords_text(value) -> str:
    if isinstance(value, list):
        return " ".join(str(v) for v in value if str(v).strip())
    return str(value or "")


def _read_body(item: dict, root: Path) -> str:
    content = item.get("content")
    if isinstance(content, str) and content.strip():
        return content
    rel = str(item.get("local_md_path") or "").strip()
    if not rel:
        return ""
    p = (root / rel).resolve()
    try:
        p.relative_to(root.resolve())
    except ValueError:
        return ""
    if p.is_file():
        try:
            return p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
    return ""


def _load_articles(kb_path: Path) -> list[dict]:
    data = json.loads(kb_path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        articles = data.get("articles") or {}
        pairs = list(articles.items()) if isinstance(articles, dict) else \
            [(f"article_{i}", x) for i, x in enumerate(articles)]
    elif isinstance(data, list):
        pairs = [(f"article_{i}", x) for i, x in enumerate(data)]
    else:
        pairs = []

    root = _repo_root(kb_path)
    out: list[dict] = []
    for aid, item in pairs:
        if not isinstance(item, dict):
            continue
        out.append({
            "id": str(aid),
            "title": str(item.get("title") or ""),
            "keywords": _keywords_text(item.get("keywords")),
            "account": str(item.get("source_account") or item.get("account") or ""),
            "hash": str(item.get("hash") or _article_hash(item)),
            "body": _read_body(item, root),
        })
    return out


def _read_meta(conn: sqlite3.Connection) -> dict:
    try:
        return dict(conn.execute("SELECT k, v FROM meta").fetchall())
    except sqlite3.Error:
        return {}


def _set_meta(conn: sqlite3.Connection, **kv) -> None:
    for k, v in kv.items():
        conn.execute("INSERT INTO meta(k, v) VALUES(?, ?) "
                     "ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))


def _upsert(conn: sqlite3.Connection, art: dict) -> None:
    row = conn.execute("SELECT rowid FROM docs WHERE id=?", (art["id"],)).fetchone()
    if row is not None:
        conn.execute("DELETE FROM fts WHERE rowid=?", (row[0],))
        conn.execute("DELETE FROM docs WHERE id=?", (art["id"],))
    cur = conn.execute(
        "INSERT INTO docs(id, title, keywords, account, hash) VALUES(?,?,?,?,?)",
        (art["id"], art["title"], art["keywords"], art["account"], art["hash"]),
    )
    rowid = cur.lastrowid
    conn.execute(
        "INSERT INTO fts(rowid, title, keywords, body) VALUES(?,?,?,?)",
        (rowid, art["title"], art["keywords"], art["body"]),
    )


def _delete(conn: sqlite3.Connection, doc_id: str) -> None:
    row = conn.execute("SELECT rowid FROM docs WHERE id=?", (doc_id,)).fetchone()
    if row is None:
        return
    conn.execute("DELETE FROM fts WHERE rowid=?", (row[0],))
    conn.execute("DELETE FROM docs WHERE id=?", (doc_id,))


def build_index(kb_path: Path, rebuild: bool = False) -> dict:
    """建立/增量更新索引。sqlite 异常向上抛，由调用方降级。"""
    kb_path = Path(kb_path)
    if not kb_path.is_file():
        raise FileNotFoundError(f"知识库不存在：{kb_path}")

    articles = _load_articles(kb_path)
    count = len(articles)
    mtime = int(kb_path.stat().st_mtime)
    db_path = index_db_path(kb_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(SCHEMA)
        meta = _read_meta(conn)
        need_rebuild = (
            rebuild
            or meta.get("count") != str(count)
            or meta.get("mtime") != str(mtime)
        )
        by_id = {a["id"]: a for a in articles}
        if need_rebuild:
            conn.execute("DELETE FROM fts")
            conn.execute("DELETE FROM docs")
            for art in articles:
                _upsert(conn, art)
            mode = "rebuild"
        else:
            existing = {r[0]: (r[1] or "") for r in
                        conn.execute("SELECT id, hash FROM docs").fetchall()}
            for art in articles:
                if existing.get(art["id"]) != art["hash"]:
                    _upsert(conn, art)
            for doc_id in existing:
                if doc_id not in by_id:
                    _delete(conn, doc_id)
            mode = "incremental"

        _set_meta(conn, count=count, mtime=mtime, built_at=int(time.time()))
        conn.commit()
    finally:
        conn.close()

    return {"db": str(db_path), "count": count, "mtime": mtime, "mode": mode}


def _fts_match_query(q: str) -> str:
    toks = [t for t in re.findall(r"[\w\u4e00-\u9fff]+", q or "") if t]
    return " ".join(f'"{t}"*' for t in toks)


def _like_fallback(conn: sqlite3.Connection, q: str, limit: int) -> list[tuple]:
    pattern = f"%{q}%"
    rows = conn.execute(
        "SELECT docs.id, fts.title, fts.keywords, fts.body FROM fts "
        "JOIN docs ON docs.rowid = fts.rowid "
        "WHERE fts.title LIKE ? OR fts.keywords LIKE ? OR fts.body LIKE ? "
        "LIMIT ?",
        (pattern, pattern, pattern, int(limit)),
    ).fetchall()
    out = []
    for doc_id, title, keywords, body in rows:
        score = 0.0
        if q in (title or ""):
            score += 5.0
        if q in (keywords or ""):
            score += 3.0
        if q in (body or ""):
            score += 1.0
        text = body or title or ""
        idx = text.find(q)
        if idx < 0:
            snip = (text or "")[:90]
        else:
            start = max(0, idx - 30)
            snip = text[start:start + 90]
            snip = snip.replace(q, f"<mark>{q}</mark>", 1)
            if start > 0:
                snip = "…" + snip
            if start + 90 < len(text):
                snip = snip + "…"
        out.append((doc_id, score, snip))
    out.sort(key=lambda r: r[1], reverse=True)
    return out


def search(kb_path: Path, q: str, limit: int = 50) -> list[dict]:
    """返回 [{id, score, snippet}]，score 越大越相关。"""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    build_index(kb_path)
    db_path = index_db_path(kb_path)
    conn = sqlite3.connect(str(db_path))
    try:
        match = _fts_match_query(q)
        merged: dict[str, dict] = {}
        if match:
            rows = conn.execute(
                "SELECT docs.id, bm25(fts, 5.0, 3.0, 1.0) AS rank, "
                "snippet(fts, 2, '<mark>', '</mark>', '…', 24) AS snip "
                "FROM fts JOIN docs ON docs.rowid = fts.rowid "
                "WHERE fts MATCH ? ORDER BY rank LIMIT ?",
                (match, int(limit)),
            ).fetchall()
            for doc_id, rank, snip in rows:
                merged[doc_id] = {"id": doc_id, "score": -float(rank), "snippet": snip}

        # unicode61 按连续汉字切词，MATCH 会漏掉词中片段；
        # 始终叠加一层 LIKE 子串召回，按 id 去重取较高分。
        for doc_id, score, snip in _like_fallback(conn, q, max(int(limit), 50) * 4):
            prev = merged.get(doc_id)
            if prev is None:
                merged[doc_id] = {"id": doc_id, "score": float(score), "snippet": snip}
            else:
                prev["score"] = max(prev["score"], float(score))
                if not prev["snippet"]:
                    prev["snippet"] = snip

        out = sorted(merged.values(), key=lambda x: -x["score"])[:int(limit)]
        return [{"id": x["id"], "score": round(x["score"], 6), "snippet": x["snippet"]}
                for x in out]
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="知识库全文索引（SQLite FTS5）")
    ap.add_argument("--kb", default="loop/knowledge_base.json", help="知识库 JSON 路径")
    ap.add_argument("--rebuild", action="store_true", help="强制重建索引")
    ap.add_argument("--search", metavar="Q", help="检索关键词")
    ap.add_argument("--limit", type=int, default=50, help="最多返回条数（默认 50）")
    args = ap.parse_args(argv)

    kb_path = Path(args.kb)
    try:
        if args.search:
            payload = search(kb_path, args.search, args.limit)
        else:
            payload = build_index(kb_path, rebuild=args.rebuild)
    except Exception as exc:  # noqa: BLE001 —— CLI 需要人话错误
        print(f"kb_index 失败：{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
