"""纯 Python TF-IDF + 关键词匹配检索器。

万篇以内够用，零 embedding 零 LLM 依赖。
直接读 knowledge_base.json 里每篇文章的 local_md_path 做内容索引。

用法:
    python3 simple_search.py "免费在线看电影" --top-k 5
    python3 simple_search.py "新影视站" --kb path/to/kb.json --output evidence_pack.json
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from collections import Counter
from dataclasses import dataclass, field, asdict

ROOT = Path(__file__).resolve().parent.parent


# ── 中文分词（极简版，按标点 + 空格切，够 TF-IDF 用） ──────────────
_PUNCT = re.compile(r"[\s，。！？、；：""''（）《》…—/\n\t-]+")


def _tokenize(text: str) -> list[str]:
    tokens = [t for t in _PUNCT.split(text.lower()) if t]
    return tokens


# ── TF-IDF 核心 ──────────────────────────────────────────────

@dataclass
class ArticleIndex:
    article_id: str
    tokens: list[str]


def build_index(articles: dict) -> list[ArticleIndex]:
    idx = []
    for aid, meta in articles.items():
        md_path = Path(meta.get("local_md_path", ""))
        # collect.py 存相对路径，拼 ROOT 确保不管 cwd 在哪都能读到
        if not md_path.is_absolute():
            md_path = ROOT / md_path
        text = ""
        if md_path.exists():
            text = md_path.read_text(encoding="utf-8", errors="ignore")
        # 没有正文就只用 metadata
        blob = f"{meta.get('title', '')} {meta.get('topics', [])} {' '.join(meta.get('keywords', []))} {text[:2000]}"
        idx.append(ArticleIndex(article_id=aid, tokens=_tokenize(blob)))
    return idx


def compute_tfidf(query: str, index: list[ArticleIndex]) -> list[tuple[str, float]]:
    q_tokens = _tokenize(query)
    if not q_tokens or not index:
        return []

    # IDF：每个 token 在多少篇出现
    doc_count = len(index)
    df: Counter[str] = Counter()
    for a in index:
        df.update(set(a.tokens))
    idf = {t: math.log((doc_count + 1) / (df.get(t, 0) + 1)) + 1 for t in df}

    scores: list[tuple[str, float]] = []
    for a in index:
        tf = Counter(a.tokens)
        score = 0.0
        for t in q_tokens:
            score += tf.get(t, 0) * idf.get(t, 0)
        # 归一化（token 数多的文章吃亏）
        if a.tokens:
            score /= math.sqrt(len(a.tokens))
        scores.append((a.article_id, score))

    scores.sort(key=lambda x: x[1], reverse=True)
    return scores


# ── 关键词命中（bonus） ─────────────────────────────────────────

def keyword_bonus(query: str, articles: dict) -> dict[str, float]:
    """query 关键词直接命中 title/keywords/topics 加权重。"""
    q_tokens = set(_tokenize(query))
    bonuses: dict[str, float] = {}
    for aid, meta in articles.items():
        hits = 0
        title_tokens = set(_tokenize(meta.get("title", "")))
        kw_tokens = set(_tokenize(" ".join(meta.get("keywords", []))))
        topic_tokens = set(_tokenize(" ".join(meta.get("topics", []))))
        hits += len(q_tokens & title_tokens) * 3.0    # title 权重最高
        hits += len(q_tokens & kw_tokens) * 2.0
        hits += len(q_tokens & topic_tokens) * 1.5
        if hits:
            bonuses[aid] = hits
    return bonuses


# ── 主入口 ──────────────────────────────────────────────────

@dataclass
class EvidenceChunk:
    article_id: str
    score: float
    snippet: str
    url: str


@dataclass
class EvidencePack:
    query: str
    top_chunks: list[EvidenceChunk] = field(default_factory=list)
    total_candidates: int = 0


def search(query: str, kb_path: Path, top_k: int = 5, min_score: float = 0.1) -> EvidencePack:
    kb = json.loads(kb_path.read_text(encoding="utf-8"))
    articles = kb.get("articles", {})
    index = build_index(articles)

    tfidf_scores = dict(compute_tfidf(query, index))
    bonuses = keyword_bonus(query, articles)

    # 合并分数
    merged: list[tuple[str, float]] = []
    for aid, score in tfidf_scores.items():
        merged.append((aid, score + bonuses.get(aid, 0)))
    merged.sort(key=lambda x: x[1], reverse=True)

    # 过滤 + 截断
    merged = [(aid, s) for aid, s in merged if s >= min_score][:top_k]

    # 构建 EvidencePack
    chunks: list[EvidenceChunk] = []
    for aid, score in merged:
        meta = articles[aid]
        snippet = meta.get("title", "")
        md_path = Path(meta.get("local_md_path", ""))
        if not md_path.is_absolute():
            md_path = ROOT / md_path
        if md_path.exists() and md_path.stat().st_size > 0:
            text = md_path.read_text(encoding="utf-8", errors="ignore")
            # 取包含 query token 的前 300 字
            q = re.compile("|".join(re.escape(t) for t in _tokenize(query)) or ".", re.I)
            m = q.search(text)
            if m:
                start = max(0, m.start() - 50)
                snippet = text[start:start + 300].replace("\n", " ").strip()
        chunks.append(EvidenceChunk(
            article_id=aid,
            score=round(score, 3),
            snippet=snippet,
            url=meta.get("url", ""),
        ))

    return EvidencePack(query=query, top_chunks=chunks, total_candidates=len(articles))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("query", help="搜索关键词，如 '免费在线看电影'")
    p.add_argument("--kb", default="loop/knowledge_base.json", help="knowledge_base.json 路径")
    p.add_argument("--top-k", type=int, default=5)
    p.add_argument("--min-score", type=float, default=0.1)
    p.add_argument("--output", help="输出 JSON 文件路径（不写则 stdout）")
    args = p.parse_args()

    pack = search(args.query, Path(args.kb), args.top_k, args.min_score)
    payload = {
        "query": pack.query,
        "total_candidates": pack.total_candidates,
        "top_chunks": [asdict(c) for c in pack.top_chunks],
    }

    if args.output:
        Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"证据包已写入 {args.output}，共 {len(pack.top_chunks)} 条")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
