#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地拆解：给知识库里「已采集、未拆解」的文章补上五段式分析与标签。

  python3 scripts/local_analyze.py            # 只处理未拆解的
  python3 scripts/local_analyze.py --all      # 全部重新拆解
  python3 scripts/local_analyze.py --kb /path/to/knowledge_base.json

特点：纯本地、不联网、不调任何大模型 API。用规则 + 词频提取摘要、观点、
数据、标签和适用人群，并做简单的主题聚类。结果写回 kb.py 的数据结构，
工作台的「已拆解 / 高频标签 / 主题」会随之生效。
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "wechat-digest-skill")
DEFAULT_KB = os.path.join(SKILL_DIR, "output", "knowledge_base.json")

sys.path.insert(0, SKILL_DIR)
import kb  # noqa: E402  （复用上游的存储/合并/索引逻辑）

try:  # 有 jieba 就用它分词，没有就走 n-gram 兜底
    import logging

    import jieba
    import jieba.analyse

    jieba.setLogLevel(logging.ERROR)
except Exception:  # pragma: no cover - 环境缺依赖时的降级路径
    jieba = None

# 高频虚词/套话，提取标签时剔除
STOP_WORDS = set("""
的 了 是 在 我 有 和 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好
自己 这 那 他 她 它 我们 你们 他们 但是 因为 所以 如果 而且 以及 还有 可以 已经
对于 关于 通过 进行 这个 那个 什么 怎么 为什么 时候 现在 今天 昨天 明天 大家
可能 需要 应该 觉得 表示 认为 目前 之后 之前 同时 其中 以上 以下 方面 问题 情况
内容 文章 作者 编辑 来源 点击 关注 阅读 原文 图片 视频 记者 报道 消息 表示 显示
""".split())
STOP_CHARS = set("的了是在和有就不人都一上也都很到说要去你会着看好自己这那他她它")

VIEW_MARKERS = ("认为", "表示", "指出", "意味着", "关键", "原因", "因此", "所以",
                "将会", "必须", "需要", "值得", "核心", "本质", "结论", "趋势")
DATA_RE = re.compile(r"\d")
DATA_UNITS = ("万", "亿", "%", "元", "年", "个月", "天", "家", "个", "款", "次", "人", "小时", "分钟")


def clean_text(text):
    text = text or ""
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[\u200b\ufeff]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def split_sentences(text):
    parts = re.split(r"(?<=[。！？!?；;])\s*|\n+", text or "")
    out = []
    for p in parts:
        p = p.strip(" \u3000")
        if 8 <= len(p) <= 200:
            out.append(p)
    return out


def clip(s, n):
    s = (s or "").strip()
    return s if len(s) <= n else s[:n].rstrip() + "…"


def fallback_tags(text, topk):
    """无 jieba 时的兜底：英文按整词、中文按 2–4 字 n-gram 词频。"""
    clean = text or ""
    counter = Counter()
    for tok in re.findall(r"[A-Za-z][A-Za-z0-9_.-]{1,20}|[\u4e00-\u9fa5]+", clean):
        if tok.isascii():
            counter[tok] += 1
            continue
        for n in (2, 3, 4):
            for i in range(len(tok) - n + 1):
                w = tok[i:i + n]
                if w in STOP_WORDS or any(c in STOP_CHARS for c in w):
                    continue
                counter[w] += 1
    scored = []
    for w, c in counter.items():
        if w.isascii():
            if len(w) < 2:
                continue
            scored.append((w, c * 1.5))
        elif c >= 2:
            scored.append((w, c * (len(w) ** 1.2)))
    scored.sort(key=lambda x: (-x[1], x[0]))
    picked, used = [], set()
    for w, _ in scored:
        if any(w in u or u in w for u in used):
            continue
        picked.append(w)
        used.add(w)
        if len(picked) >= topk:
            break
    return picked


def extract_tags(text, topk=8):
    text = clean_text(text)
    tags = []
    if jieba is not None:
        try:
            tags = jieba.analyse.extract_tags(text, topK=topk * 2)
        except Exception:
            tags = []
    tags = [t.strip() for t in tags
            if 2 <= len(t.strip()) <= 8
            and t.strip() not in STOP_WORDS
            and re.search(r"[\u4e00-\u9fa5A-Za-z]", t)
            and not re.fullmatch(r"[\d%.]+", t)]
    deduped = []
    for t in tags:
        if t not in deduped:
            deduped.append(t)
    if len(deduped) < topk:
        for t in fallback_tags(text, topk * 2):
            if t not in deduped:
                deduped.append(t)
    return deduped[:topk]


def build_analysis(article):
    title = article.get("title") or ""
    content = clean_text(article.get("content") or "")
    digest = clean_text(article.get("digest") or "")
    if len(content) < 20 and len(digest) < 20:
        return None

    body = content or digest
    sentences = split_sentences(body)

    summary = digest if 20 <= len(digest) <= 160 else clip("".join(sentences[:2]) or body, 120)

    tags = extract_tags(" ".join([title, digest, body[:3000]]), 8)

    viewpoints = []
    for s in sentences:
        if any(m in s for m in VIEW_MARKERS):
            v = clip(s, 140)
            if v not in viewpoints:
                viewpoints.append(v)
        if len(viewpoints) >= 3:
            break
    if not viewpoints:
        viewpoints = [clip(s, 140) for s in sentences[:2]]

    data = []
    for s in sentences:
        if DATA_RE.search(s) and any(u in s for u in DATA_UNITS):
            d = clip(s, 140)
            if d not in data:
                data.append(d)
        if len(data) >= 3:
            break

    if len(tags) >= 2:
        audience = f"关注{tags[0]}、{tags[1]}等话题的读者"
    elif tags:
        audience = f"关注{tags[0]}话题的读者"
    else:
        audience = "对该公众号内容感兴趣的读者"

    return {
        "summary": summary,
        "viewpoints": viewpoints,
        "data": data,
        "tags": tags,
        "audience": audience,
    }


def topic_id_for(tag):
    return "auto-" + hashlib.md5(tag.encode("utf-8")).hexdigest()[:10]


def build_topics(kb_data, analyzed_ids):
    """按标签共现做轻量聚类：同一标签下 >=1 篇即成一个主题。"""
    tag_to_ids = {}
    for aid in analyzed_ids:
        art = kb_data["articles"].get(aid) or {}
        for t in (art.get("analysis") or {}).get("tags") or []:
            tag_to_ids.setdefault(t, []).append(aid)

    # 多篇时只保留跨文章共现的标签；单篇时取前 3 个标签当主题
    ranked = sorted(tag_to_ids.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    if len(analyzed_ids) <= 1:
        kept = ranked[:3]
    else:
        shared = [(t, ids) for t, ids in ranked if len(ids) >= 2]
        kept = (shared or ranked)[:8]
    for tag, ids in kept:
        tid = topic_id_for(tag)
        kb.upsert_topic(kb_data, tid, name=tag, keywords=[tag])
        for aid in ids:
            art = kb_data["articles"].get(aid) or {}
            if not art.get("topicIds"):
                art["topicIds"] = [tid]


def main():
    parser = argparse.ArgumentParser(prog="local_analyze.py",
                                     description="离线拆解：补五段式分析、标签与主题")
    parser.add_argument("--kb", default=DEFAULT_KB, help="知识库 JSON 路径")
    parser.add_argument("--all", action="store_true", help="已拆解的也重新拆")
    parser.add_argument("--limit", type=int, default=0, help="本次最多处理几篇（0=不限）")
    parser.add_argument("--quiet", action="store_true", help="只输出一行结果")
    args = parser.parse_args()

    if not os.path.exists(args.kb):
        print("✗ 知识库不存在，先采集文章", file=sys.stderr)
        return 2

    data = kb.load_kb(args.kb)
    articles = data.get("articles") or {}
    if not articles:
        print("✗ 知识库里还没有文章", file=sys.stderr)
        return 2

    done, skipped = [], 0
    for aid, art in articles.items():
        if art.get("analyzedAt") and not args.all:
            continue
        if args.limit and len(done) >= args.limit:
            break
        analysis = build_analysis(art)
        if analysis is None:
            skipped += 1
            continue
        kb.set_analysis(data, aid, analysis)
        art["analysisSource"] = "local"
        done.append(aid)

    build_topics(data, done)
    kb.rebuild_tags(data)
    kb.rebuild_topic_members(data)
    kb.save_kb(data, args.kb)

    result = {
        "analyzed": len(done),
        "skipped": skipped,
        "total": len(articles),
        "analyzedTotal": sum(1 for a in articles.values() if a.get("analyzedAt")),
        "tags": len(data.get("tags") or {}),
        "topics": len(data.get("topics") or []),
    }
    if args.quiet:
        print(f"拆解完成：{result['analyzed']} 篇")
    else:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
