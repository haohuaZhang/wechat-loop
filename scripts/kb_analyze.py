#!/usr/bin/env python3
"""kb_analyze.py —— 知识库分析（纯标准库，零外部模型 / 零网络）

四件事：
  1. 相似 / 重复检测：64 位 simhash + 词频余弦双阈值
  2. 主题聚类 + 覆盖度：标题/关键词的共现词簇（不依赖 LLM）
  3. hash-ngram 向量：字符 n-gram 哈希到 256 维，L2 归一化
  4. RRF 融合：把 FTS（BM25）与向量两路结果合并

只读知识库与正文，不写知识库本身。

用法：
  python3 scripts/kb_analyze.py --kb loop/kb/real-corpus.json --duplicates
  python3 scripts/kb_analyze.py --kb loop/kb/real-corpus.json --clusters
  python3 scripts/kb_analyze.py --kb loop/kb/real-corpus.json --search "小米 折叠屏"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import struct
import sys
from collections import Counter
from pathlib import Path

DIM = 256
_BOUNDARY = re.compile(r"[\s，。！？、；：“”‘’（）《》…—\-/\\|~`@#$%^&*+=<>\[\]{}:;,.!?'\"·]+")
_LATIN = re.compile(r"[a-z0-9]{2,}")
_CJK = re.compile(r"[\u4e00-\u9fff]+")

# 泛化词：作聚类标签没有区分度，向量里也基本是噪声
_STOP = {
    "拥有", "我们", "他们", "你们", "可以", "一个", "这个", "那个", "没有", "已经",
    "不是", "就是", "以及", "但是", "因为", "所以", "如果", "目前", "进行", "相关",
    "表示", "记者", "报道", "通过", "其中", "对于", "以上", "以下", "这种", "这些",
    "一些", "什么", "怎么", "如何", "需要", "可能", "方面", "问题", "时间", "现在",
    "今日", "消息", "发布", "官方", "支持", "用户", "产品", "功能", "系列", "版本",
    "采用", "搭载", "全新", "同时", "此外", "而且", "并且", "或者", "还是", "已经",
    "将在", "将于", "公司", "市场", "行业", "内容", "情况", "方式", "部分", "最新",
    # 采集正文/关键词里的固定水印与套话，做主题标签没有区分度
    "it", "之家", "家注", "家注意", "之家注", "注意", "意到", "注意到", "此次",
    "介绍", "元起", "起售", "美元", "全球", "正式", "首次", "中国", "本次",
}


def _repo_root(kb_path: Path) -> Path:
    kb = Path(kb_path).resolve()
    for p in (kb.parent, *kb.parent.parents):
        if p.name == "loop":
            return p.parent
    return kb.parent


def tokenize(text: str) -> list[str]:
    """中文按 2/3 字 n-gram，英文数字按词；过滤泛化词。"""
    text = str(text or "").lower()
    out: list[str] = []
    for chunk in _BOUNDARY.split(text):
        if not chunk:
            continue
        for w in _LATIN.findall(chunk):
            if w not in _STOP:
                out.append(w)
        for run in _CJK.findall(chunk):
            for gram in (2, 3):
                if len(run) < gram:
                    continue
                for i in range(len(run) - gram + 1):
                    tok = run[i:i + gram]
                    if tok not in _STOP:
                        out.append(tok)
    return out


def _hash64(token: str) -> int:
    return int(hashlib.md5(token.encode("utf-8")).hexdigest()[:16], 16)


def simhash64(text: str) -> int:
    """64 位 simhash：近重复文本的汉明距离很小。"""
    vec = [0] * 64
    for tok, count in Counter(tokenize(text)).items():
        h = _hash64(tok)
        weight = 1 + min(count, 3)
        for i in range(64):
            vec[i] += weight if (h >> i) & 1 else -weight
    out = 0
    for i, v in enumerate(vec):
        if v > 0:
            out |= 1 << i
    return out


def hamming(a: int, b: int) -> int:
    return int((a ^ b).bit_count())


def cosine_counter(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    common = set(a) & set(b)
    if not common:
        return 0.0
    dot = sum(a[t] * b[t] for t in common)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


# ── 文档装载（复用 kb_index 的正文读取，保证口径一致） ────────────────

def _kb_index():
    import importlib

    here = str(Path(__file__).resolve().parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    return importlib.import_module("kb_index")


def load_docs(kb_path: Path) -> list[dict]:
    arts = _kb_index()._load_articles(Path(kb_path))
    raw = json.loads(Path(kb_path).read_text(encoding="utf-8"))
    meta = {}
    if isinstance(raw, dict) and isinstance(raw.get("articles"), dict):
        meta = raw["articles"]
    elif isinstance(raw, list):
        meta = {f"article_{i}": x for i, x in enumerate(raw)}
    out = []
    for a in arts:
        m = meta.get(a["id"]) if isinstance(meta.get(a["id"]), dict) else {}
        body = a.get("body") or ""
        out.append({
            "id": a["id"],
            "title": a.get("title") or "",
            "keywords": a.get("keywords") or "",
            "account": a.get("account") or "",
            "url": str(m.get("url") or ""),
            "date": str(m.get("publish_date") or ""),
            "tags": [str(x) for x in (m.get("tags") or [])],
            "topics": [str(x) for x in (m.get("topics") or [])],
            "body": body,
            "text": " ".join([
                a.get("title") or "", a.get("keywords") or "",
                " ".join(str(x) for x in (m.get("tags") or [])),
                " ".join(str(x) for x in (m.get("topics") or [])),
                body[:6000],
            ]),
        })
    return out


def _brief(doc: dict, similarity: float | None = None) -> dict:
    item = {
        "id": doc["id"],
        "title": doc["title"] or "(无标题)",
        "account": doc["account"] or "未知",
        "publishDate": doc["date"],
        "url": doc["url"],
    }
    if similarity is not None:
        item["similarity"] = round(float(similarity), 3)
    return item


# ── 1. 相似 / 重复 ────────────────────────────────────────────────

def find_duplicates(kb_path: Path, cosine_threshold: float = 0.82,
                    hamming_threshold: int = 8, limit: int = 30) -> dict:
    docs = load_docs(kb_path)
    n = len(docs)
    if n < 2:
        return {"total": n, "pairs": 0, "groups": [], "method": "simhash+cosine"}

    prepared = []
    for d in docs:
        toks = Counter(tokenize(d["text"]))
        prepared.append((d, toks, simhash64(d["text"])))

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    sim: dict[tuple[int, int], float] = {}
    pairs = 0
    for i in range(n):
        di, ti, hi = prepared[i]
        for j in range(i + 1, n):
            dj, tj, hj = prepared[j]
            ham = hamming(hi, hj)
            cos = cosine_counter(ti, tj)
            if cos >= cosine_threshold or (ham <= hamming_threshold and cos >= 0.5):
                union(i, j)
                sim[(i, j)] = max(cos, 1.0 - ham / 64.0)
                pairs += 1

    buckets: dict[int, list[int]] = {}
    for i in range(n):
        buckets.setdefault(find(i), []).append(i)

    groups = []
    for members in buckets.values():
        if len(members) < 2:
            continue
        best = max(
            ((sim.get((min(a, b), max(a, b)), 0.0), a, b)
             for x, a in enumerate(members) for b in members[x + 1:]),
            default=(0.0, members[0], members[1]),
        )
        center = best[1]
        arts = []
        for idx in members:
            score = 1.0 if idx == center else best[0]
            arts.append(_brief(prepared[idx][0], score))
        arts.sort(key=lambda x: -x["similarity"])
        groups.append({
            "id": f"dup-{prepared[center][0]['id']}",
            "similarity": round(best[0], 3),
            "articles": arts,
        })

    groups.sort(key=lambda g: (-len(g["articles"]), -g["similarity"]))
    return {
        "total": n,
        "pairs": pairs,
        "groups": groups[:limit],
        "method": "simhash64 + cosine(2/3-gram)",
        "thresholds": {"cosine": cosine_threshold, "hamming": hamming_threshold},
    }


# ── 2. 主题聚类 + 覆盖度 ──────────────────────────────────────────

def _cluster_terms(docs: list[dict]) -> list[tuple[str, set[int]]]:
    df: Counter = Counter()
    term_docs: dict[str, set[int]] = {}
    for i, d in enumerate(docs):
        terms = set(tokenize(" ".join([
            d["title"], d["keywords"], " ".join(d["tags"]), " ".join(d["topics"]),
        ])))
        for t in terms:
            if len(t) < 2 or t.isdigit() or re.fullmatch(r"[0-9a-z]{1,3}", t):
                continue
            df[t] += 1
            term_docs.setdefault(t, set()).add(i)
    total = len(docs)
    cand = []
    for t, c in df.items():
        if c < 2 or c > max(2, total * 0.6):
            continue
        cand.append((t, c))
    # 频次优先，其次更长的词更具体
    cand.sort(key=lambda x: (-x[1], -len(x[0]), x[0]))
    return [(t, term_docs[t]) for t, _ in cand]


def build_clusters(kb_path: Path, limit: int = 8) -> dict:
    docs = load_docs(kb_path)
    total = len(docs)
    if total == 0:
        return {"total": 0, "clusters": [], "coverageRate": 0, "uncovered": 0}

    chosen: list[dict] = []
    for term, members in _cluster_terms(docs):
        if len(members) < 2:
            continue
        merged = False
        for c in chosen:
            inter = len(members & c["ids"])
            if inter and inter / min(len(members), len(c["ids"])) >= 0.75:
                if term not in c["terms"]:
                    c["terms"].append(term)
                merged = True
                break
        if merged:
            continue
        chosen.append({"label": term, "terms": [term], "ids": set(members)})
        if len(chosen) >= limit:
            break

    covered: set[int] = set()
    out = []
    for idx, c in enumerate(chosen):
        ids = c["ids"]
        covered |= ids
        # 簇内共现词：在成员标题/关键词里出现次数最多、且不是标签本身
        inner: Counter = Counter()
        for i in ids:
            for t in set(tokenize(" ".join([
                docs[i]["title"], docs[i]["keywords"],
                " ".join(docs[i]["tags"]), " ".join(docs[i]["topics"]),
            ]))):
                if t not in c["terms"] and len(t) >= 2 and not t.isdigit():
                    inner[t] += 1
        keywords = [t for t, n in inner.most_common(8) if n >= 2][:5]
        arts = sorted((docs[i] for i in ids), key=lambda d: d["date"], reverse=True)
        out.append({
            "id": f"topic-{idx + 1}",
            "label": c["label"],
            "terms": c["terms"][:4],
            "keywords": keywords,
            "count": len(ids),
            "coverage": round(len(ids) / total, 4),
            "articles": [_brief(d) for d in arts[:8]],
        })

    out.sort(key=lambda c: (-c["count"], c["label"]))
    # 覆盖度：被任一簇覆盖的文章占比
    uncovered_ids = [i for i in range(total) if i not in covered]
    return {
        "total": total,
        "clusters": out,
        "covered": len(covered),
        "uncovered": len(uncovered_ids),
        "coverageRate": round(len(covered) / total, 4) if total else 0,
        "uncoveredArticles": [_brief(docs[i]) for i in uncovered_ids[:12]],
        "method": "term co-occurrence (2/3-gram, no LLM)",
    }


# ── 3. hash-ngram 向量 ───────────────────────────────────────────

def ngram_vec(text: str, dim: int = DIM) -> list[float]:
    vec = [0.0] * dim
    for tok, count in Counter(tokenize(text)).items():
        h = _hash64(tok)
        idx = h % dim
        sign = 1.0 if (h >> 63) & 1 else -1.0
        vec[idx] += sign * (1.0 + math.log(count))
    norm = math.sqrt(sum(v * v for v in vec))
    if norm:
        vec = [v / norm for v in vec]
    return vec


def _vec_db(kb_path: Path) -> Path:
    return _kb_index().index_db_path(Path(kb_path))


def _load_vecs(kb_path: Path, docs: list[dict]) -> dict[str, list[float]]:
    db = _vec_db(kb_path)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS vecs ("
            "id TEXT PRIMARY KEY, hash TEXT, dim INTEGER, vec BLOB)"
        )
        existing = {}
        for doc_id, h, dim, blob in conn.execute("SELECT id, hash, dim, vec FROM vecs"):
            if doc_id in {d["id"] for d in docs} and dim == DIM and blob:
                existing[doc_id] = (h, list(struct.unpack(f"{DIM}f", blob)))
        out: dict[str, list[float]] = {}
        dirty = []
        for d in docs:
            key = d["id"]
            h = hashlib.md5(d["text"].encode("utf-8")).hexdigest()[:12]
            hit = existing.get(key)
            if hit and hit[0] == h:
                out[key] = hit[1]
                continue
            v = ngram_vec(d["text"])
            out[key] = v
            dirty.append((key, h, struct.pack(f"{DIM}f", *v)))
            conn.execute("DELETE FROM vecs WHERE id=?", (key,))
        if dirty:
            conn.executemany(
                "INSERT INTO vecs(id, hash, dim, vec) VALUES(?,?,?,?)",
                [(i, h, DIM, b) for i, h, b in dirty],
            )
            conn.commit()
        known = {d["id"] for d in docs}
        for (doc_id,) in conn.execute("SELECT id FROM vecs").fetchall():
            if doc_id not in known:
                conn.execute("DELETE FROM vecs WHERE id=?", (doc_id,))
        conn.commit()
        return out
    finally:
        conn.close()


def _vec_snippet(doc: dict, q: str, size: int = 110) -> str:
    text = doc["body"] or doc["title"]
    plain = " ".join(x.strip() for x in text.splitlines() if x.strip())
    plain = re.sub(r"[#>*`|]+", "", plain)
    toks = [t for t in tokenize(q) if len(t) >= 2]
    idx = -1
    for t in toks:
        idx = plain.find(t)
        if idx >= 0:
            break
    if idx < 0:
        return plain[:size] + ("…" if len(plain) > size else "")
    start = max(0, idx - size // 3)
    snip = plain[start:start + size]
    tok = next((t for t in toks if t in snip), "")
    if tok:
        snip = snip.replace(tok, f"<mark>{tok}</mark>", 1)
    if start > 0:
        snip = "…" + snip
    if start + size < len(plain):
        snip += "…"
    return snip


def search_vec(kb_path: Path, query: str, limit: int = 50) -> list[dict]:
    """hash-ngram 向量检索（余弦）。装不上真向量时的可解释降级通道。"""
    q = (query or "").strip()
    if len(q) < 2:
        return []
    docs = load_docs(kb_path)
    if not docs:
        return []
    vecs = _load_vecs(kb_path, docs)
    qv = ngram_vec(q)
    scored = []
    for d in docs:
        v = vecs.get(d["id"]) or []
        if not v:
            continue
        score = sum(a * b for a, b in zip(qv, v))
        if score > 0.02:
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    return [{
        "id": d["id"],
        "score": round(float(s), 6),
        "snippet": _vec_snippet(d, q),
    } for s, d in scored[:limit]]


# ── 4. RRF 融合 ──────────────────────────────────────────────────

def rrf_fuse(lists: list[tuple[str, list[dict]]], k: int = 60) -> list[dict]:
    """Reciprocal Rank Fusion：score = Σ 1/(k + rank)。"""
    merged: dict[str, dict] = {}
    for engine, items in lists:
        for rank, item in enumerate(items):
            doc_id = str(item.get("id"))
            if not doc_id:
                continue
            entry = merged.setdefault(doc_id, {
                "id": doc_id, "score": 0.0, "snippet": "",
                "engines": {}, "raw": {},
            })
            entry["score"] += 1.0 / (k + rank + 1)
            entry["engines"][engine] = rank + 1
            entry["raw"][engine] = item.get("score")
            if item.get("snippet") and not entry["snippet"]:
                entry["snippet"] = item["snippet"]
    out = sorted(merged.values(), key=lambda x: -x["score"])
    for e in out:
        e["score"] = round(e["score"], 6)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="知识库分析：去重 / 聚类 / 向量检索")
    ap.add_argument("--kb", default="loop/knowledge_base.json", help="知识库 JSON 路径")
    ap.add_argument("--duplicates", action="store_true", help="输出疑似重复分组")
    ap.add_argument("--clusters", action="store_true", help="输出主题聚类与覆盖度")
    ap.add_argument("--search", metavar="Q", help="语义检索（hash-ngram 向量）")
    ap.add_argument("--mode", choices=["kw", "vec", "hybrid"], default="hybrid",
                    help="--search 时的检索模式（默认 hybrid）")
    ap.add_argument("--limit", type=int, default=20, help="最多返回条数（默认 20）")
    args = ap.parse_args(argv)

    kb_path = Path(args.kb)
    if not kb_path.is_file():
        print(f"知识库不存在：{kb_path}", file=sys.stderr)
        return 1

    try:
        if args.duplicates:
            payload = find_duplicates(kb_path, limit=args.limit)
        elif args.clusters:
            payload = build_clusters(kb_path, limit=args.limit)
        elif args.search:
            if args.mode == "kw":
                payload = {"items": _kb_index().search(kb_path, args.search, limit=args.limit),
                           "mode": "kw"}
            elif args.mode == "vec":
                payload = {"items": search_vec(kb_path, args.search, limit=args.limit),
                           "mode": "vec"}
            else:
                kw = _kb_index().search(kb_path, args.search, limit=args.limit)
                vec = search_vec(kb_path, args.search, limit=args.limit)
                payload = {"items": rrf_fuse([("fts", kw), ("vec", vec)])[:args.limit],
                           "mode": "hybrid"}
        else:
            ap.print_help()
            return 0
    except Exception as exc:  # noqa: BLE001 —— CLI 需要人话错误
        print(f"kb_analyze 失败：{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
