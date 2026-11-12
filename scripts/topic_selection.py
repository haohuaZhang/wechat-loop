"""选题决策：读 knowledge_base.json + history.yaml 去重 + 按新鲜度/价值打分。

Agent 写作前先跑这个，拿到推荐选题清单。

打分逻辑：
  score = 新鲜度分（0-10）× 0.4 + 价值分（0-10）× 0.4 + 去重豁免（0/1）× 2

新鲜度分 = 2026-发布日期天数差 → 归一化（越近越高）
价值分   = TF-IDF 关键词密度 + 是否被引用（crossRefs）
去重     = 对比 history.yaml 最近 5 篇主题，相似度 > 0.7 直接踢

用法:
    python3 scripts/topic_selection.py --output loop/topic_candidates.json
    python3 scripts/topic_selection.py --min-score 4.0 --top-n 5
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, date, timezone
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
KB_PATH = ROOT / "loop" / "knowledge_base.json"
HISTORY_PATH = ROOT / "loop" / "history.json"


def load_kb() -> dict:
    if not KB_PATH.exists():
        return {"articles": {}}
    return json.loads(KB_PATH.read_text(encoding="utf-8"))


def load_history() -> dict:
    """读 history.py 写的 flat JSON 格式。"""
    entries: list[dict] = []
    if HISTORY_PATH.exists():
        try:
            entries = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        except Exception:
            entries = []
    # 每个 entry 是 flat dict，topics/keywords 是 list
    normalized = []
    for e in entries:
        n = {
            "title": e.get("title", ""),
            "topics": " ".join(e.get("topics", [])) if isinstance(e.get("topics"), list) else str(e.get("topics", "")),
            "keywords": " ".join(e.get("keywords", [])) if isinstance(e.get("keywords"), list) else str(e.get("keywords", "")),
        }
        normalized.append(n)
    return {"entries": normalized}


def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r"[\s，。！？、；：""''（）《》…/\n]+", text.lower()) if t]


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def freshness_score(publish_date: str) -> float:
    """发布日期 → 0-10 分。30 天内 10 分，90 天外 2 分封顶。"""
    if not publish_date:
        return 3.0
    try:
        days = (date.today() - datetime.strptime(publish_date, "%Y-%m-%d").date()).days
    except ValueError:
        return 3.0
    if days <= 30:
        return 10.0
    if days <= 90:
        return 7.0
    if days <= 180:
        return 4.0
    return 2.0


def value_score(meta: dict) -> float:
    """基于 crossRefs / keywords 密度 / word_count 粗估价值。"""
    score = 5.0  # base
    refs = len(meta.get("crossRefs", []))
    score += min(refs * 0.5, 2.0)  # 被引用加分
    words = meta.get("word_count", 0)
    if words >= 2000:
        score += 1.0
    elif words >= 1000:
        score += 0.5
    if meta.get("used_as_source"):
        score += 1.0  # 已经作为素材用过 → 说明之前就好用
    return min(score, 10.0)


def dedupe(article_tokens: set, history_entries: list[dict]) -> bool:
    """和最近 5 篇历史选题对比相似度。> 0.7 踢掉。"""
    if not history_entries:
        return True  # 无历史 → 全部放行
    recent = history_entries[-5:]
    for h in reversed(recent):
        h_title = h.get("title", "")
        h_topics = h.get("topics", "")
        h_tokens = set(tokenize(f"{h_title} {h_topics}"))
        sim = jaccard(article_tokens, h_tokens)
        if sim > 0.65:
            return False
    return True


def select_topics(top_n: int = 5, min_score: float = 3.0) -> list[dict]:
    kb = load_kb()
    history = load_history()
    articles = kb.get("articles", {})

    scored = []
    for aid, meta in articles.items():
        if meta.get("used_as_source"):
            continue  # 已经用过的先跳过（除非后面没料）
        tokens = set(tokenize(meta.get("title", "") + " ".join(meta.get("keywords", []))))
        f = freshness_score(meta.get("publish_date", ""))
        v = value_score(meta)
        if not dedupe(tokens, history["entries"]):
            continue
        total = f * 0.4 + v * 0.4 + 2.0  # 去重豁免固定 +2
        if total >= min_score:
            scored.append({
                "article_id": aid,
                "title": meta.get("title", ""),
                "publish_date": meta.get("publish_date", ""),
                "source_account": meta.get("source_account", ""),
                "url": meta.get("url", ""),
                "freshness": round(f, 1),
                "value": round(v, 1),
                "score": round(total, 2),
                "topics": meta.get("topics", []),
                "keywords": meta.get("keywords", []),
            })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_n]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--top-n", type=int, default=5)
    p.add_argument("--min-score", type=float, default=3.0)
    p.add_argument("--output", help="输出 JSON 文件（不写则 stdout）")
    args = p.parse_args()

    topics = select_topics(args.top_n, args.min_score)
    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "top_topics": topics,
        "count": len(topics),
    }

    if args.output:
        Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"选题已写入 {args.output}，共 {len(topics)} 个候选")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
