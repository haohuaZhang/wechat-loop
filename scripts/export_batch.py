#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出「待拆解」批次，交给 Trae / 本地 agent 做五段式拆解。

  python3 scripts/export_batch.py --out loop/export/batch.json
  python3 scripts/export_batch.py --limit 20 --max-chars 6000

导出的 JSON 里每篇带 id + 标题 + 正文（截断），agent 按其中 instructions
填写 analysis 后，把结果文件拖回向导页即可导入。已由 agent 拆解过的不再导出。
"""

import argparse
import json
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "wechat-digest-skill")
DEFAULT_KB = os.path.join(SKILL_DIR, "output", "knowledge_base.json")

sys.path.insert(0, SKILL_DIR)
import kb  # noqa: E402

INSTRUCTIONS = {
    "analysis": {
        "summary": "一句话总结，40–80 字，不复读原文",
        "viewpoints": ["核心观点，2–4 条，每条不超过 60 字"],
        "data": ["关键数据/事实，带具体数字，最多 4 条"],
        "tags": ["3–6 个中文标签，名词优先，便于聚类"],
        "audience": "这篇适合谁看，20–40 字",
    },
    "topicIds": "可选：复用已有主题 id，或留空由导入方自动归类",
    "output": "把每篇结果放进 {articles: {<id>: {analysis: {...}}}, topics: []}，"
              "保存为 analysis.json，拖回向导页「导入拆解结果」。",
}


def main():
    parser = argparse.ArgumentParser(prog="export_batch.py",
                                     description="导出待拆解批次（给 Trae/agent）")
    parser.add_argument("--kb", default=DEFAULT_KB)
    parser.add_argument("--out", default=os.path.join(ROOT, "loop", "export", "batch.json"))
    parser.add_argument("--limit", type=int, default=20, help="最多导出几篇（默认 20）")
    parser.add_argument("--max-chars", type=int, default=6000, help="每篇正文最多保留多少字")
    args = parser.parse_args()

    data = kb.load_kb(args.kb)
    articles = list((data.get("articles") or {}).values())
    # 已由 agent 拆解的排到最后，优先导出本地规则拆解 / 未拆解的
    articles.sort(key=lambda a: (a.get("analysisSource") == "agent",
                                 a.get("publishDate") or ""))
    pending = [a for a in articles if a.get("analysisSource") != "agent"][:args.limit]

    batch = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "total": len(articles),
        "count": len(pending),
        "instructions": INSTRUCTIONS,
        "articles": [],
    }
    for a in pending:
        batch["articles"].append({
            "id": a.get("id"),
            "title": a.get("title"),
            "account": a.get("account"),
            "publishDate": a.get("publishDate"),
            "link": a.get("link"),
            "digest": a.get("digest"),
            "content": (a.get("content") or "")[:args.max_chars],
        })

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(batch, f, ensure_ascii=False, indent=2)
    print(json.dumps({"ok": True, "path": args.out, "count": len(pending),
                      "total": len(articles)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
