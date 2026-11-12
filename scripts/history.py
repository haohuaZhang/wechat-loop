"""history 维护器 — 追加已写文章、去重查询、人格/dimensions 记录。

用 flat JSON 格式（比嵌套 YAML 好维护）。Agent 写完一篇后调 add，
topic_selection.py 去重时调 check，写 prompt 时调 list。

用法:
    python3 scripts/history.py add --article-id xxx --title "..." --persona industry-observer
    python3 scripts/history.py check --title "某选题" --keywords "k1,k2"
    python3 scripts/history.py list --last 10
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HISTORY_PATH = ROOT / "loop" / "history.json"
KB_PATH = ROOT / "loop" / "knowledge_base.json"


def load() -> list[dict]:
    if not HISTORY_PATH.exists():
        return []
    try:
        return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def save(entries: list[dict]) -> None:
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r"[\s，。！？、；：""''（）《》…/\n]+", text.lower()) if t]


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def add_entry(args) -> None:
    entries = load()
    entry = {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "article_id": args.article_id,
        "title": args.title,
    }
    if args.persona:
        entry["persona"] = args.persona
    if args.dimensions:
        entry["dimensions"] = [d.strip() for d in args.dimensions.split(",") if d.strip()]
    if args.topics:
        entry["topics"] = [t.strip() for t in args.topics.split(",") if t.strip()]
    if args.keywords:
        entry["keywords"] = [k.strip() for k in args.keywords.split(",") if k.strip()]
    if args.score:
        try:
            entry["score"] = float(args.score)
        except ValueError:
            pass
    entries.append(entry)
    save(entries)
    print(f"✅ history: +1 (累计 {len(entries)} 条)")

    # 🔄 同步回写 KB：标记这篇已用过 → topic_selection 自动跳过
    mark_kb_used(args.article_id)


def mark_kb_used(article_id: str) -> None:
    """把 knowledge_base.json 里对应文章的 used_as_source 翻成 True。"""
    if not KB_PATH.exists():
        return
    try:
        kb = json.loads(KB_PATH.read_text(encoding="utf-8"))
    except Exception:
        return
    articles = kb.get("articles", {})
    if article_id in articles:
        articles[article_id]["used_as_source"] = True
        KB_PATH.write_text(json.dumps(kb, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"   🔄 KB 已标记 used_as_source=true: {article_id}")


def check_dupe(args) -> None:
    entries = load()
    article_tokens = set(tokenize(f"{args.title} {args.keywords or ''}"))
    matches = []
    for e in reversed(entries[-20:]):  # 只看最近 20 条就够
        h_tokens = set(tokenize(
            f"{e.get('title', '')} {' '.join(e.get('keywords', []))} "
            f"{' '.join(e.get('topics', []))}"))
        sim = jaccard(article_tokens, h_tokens)
        if sim > 0.5:
            matches.append({
                "date": e.get("date", ""),
                "title": e.get("title", ""),
                "similarity": round(sim, 3),
            })
    result = {
        "is_duplicate": len(matches) > 0,
        "top_matches": matches[:3],
        "total_history": len(entries),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


def list_recent(args) -> None:
    entries = load()
    recent = entries[-args.last:]
    print(f"最近 {len(recent)} 条（历史共 {len(entries)} 条）\n")
    for e in reversed(recent):
        per = e.get("persona", "")[:16] or "-"
        print(f"  {e.get('date', '?')}  [{per:16s}] {e.get('title', '(无标题)')[:56]}")
        if "dimensions" in e:
            dim = ", ".join(e["dimensions"][:3])
            print(f"      dim: {dim}")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="action")

    ap = sub.add_parser("add")
    ap.add_argument("--article-id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--persona", default="")
    ap.add_argument("--dimensions", default="")
    ap.add_argument("--topics", default="")
    ap.add_argument("--keywords", default="")
    ap.add_argument("--score", default="")

    cp = sub.add_parser("check")
    cp.add_argument("--title", required=True)
    cp.add_argument("--keywords", default="")

    lp = sub.add_parser("list")
    lp.add_argument("--last", type=int, default=10)

    args = p.parse_args()
    if args.action == "add":
        add_entry(args)
    elif args.action == "check":
        check_dupe(args)
    elif args.action == "list":
        list_recent(args)
    else:
        p.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
