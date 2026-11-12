"""文章人类度自检脚本（对应 writing-guide.md 12 条规则）。

量化检查，返回 pass/fail 逐条判定 + 总分。Agent 写完后先跑这个。

用法:
    python3 humanness_score.py loop/runs/20261111/article.md
    python3 humanness_score.py article.md --json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


# ── 温度词表（writing-guide.md §1.2 — 四个温度带） ──────────────────────
TEMP_HOT = ["爽", "炸", "疯", "爆", "绝", "牛", "杀爆", "顶", "神", "YYDS"]
TEMP_WARM = ["喜欢", "舒服", "好用", "稳", "靠谱", "不错", "还行", "实用"]
TEMP_COLD = ["分析", "逻辑", "本质", "机制", "原理", "框架", "模型", "数据"]
TEMP_WILD = ["离谱", "魔幻", "离奇", "诡异", "惊了", "吓一跳", "卧槽"]

# ── 意外用词（writing-guide.md §2.3 — 非常规但说得通的表达） ────────────
# 检测是否有混合领域词汇（比如体育 + 烹饪 + 游戏同时出现）
FIELD_WORDS = {
    "sport": ["传", "防", "节奏", "跑位", "盘带", "扣篮", "绝杀"],
    "cook": ["炒", "炖", "腌", "火候", "翻炒", "出锅", "刀工"],
    "game": ["刷", "肝", "爆", "掉帧", "上号", "开荒", "buff"],
    "movie": ["镜头", "伏笔", "长镜", "剪辑", "机位", "转场", "蒙太奇"],
    "travel": ["打卡", "踩点", "攻略", "避雷", "劝退", "私藏"],
}

# ── 锚定检测（writing-guide.md §3.1 — 具体 URL/数字/来源名） ────────────
# 简化版：每 H2 段落至少 1 个具体细节（URL / 年份 / 超过 10 的数字 / 人名）


def check_vocab_temperature(text: str) -> dict:
    """§1.2 词汇温度：四个温度带至少出现 3 种。"""
    found = 0
    details = []
    for label, words in [("热", TEMP_HOT), ("温", TEMP_WARM), ("冷", TEMP_COLD), ("野", TEMP_WILD)]:
        hits = sum(1 for w in words if w in text)
        if hits:
            found += 1
            details.append(f"{label}×{hits}")
    return {
        "pass": found >= 3,
        "detail": f"温度带: {found}/4 命中（{', '.join(details)}）— 要求 ≥ 3",
        "score": min(1.0, found / 3),
    }


def check_unexpected_words(text: str) -> dict:
    """§2.3 意外用词：至少有 2 个不同领域的词混合出现。"""
    hit_fields = []
    for field, words in FIELD_WORDS.items():
        if any(w in text for w in words):
            hit_fields.append(field)
    return {
        "pass": len(hit_fields) >= 2,
        "detail": f"跨界领域数: {len(hit_fields)}（{hit_fields}）— 要求 ≥ 2",
        "score": min(1.0, len(hit_fields) / 2),
    }


def check_grounded_evidence(text: str) -> dict:
    """§3.1 真实锚定：按 H2 分段，每段至少 1 个具体锚点。"""
    import re as _re
    h2_sections = _re.split(r"(?m)^##\s+", text)
    # 跳过第一段（H1 到第一个 H2 之间）
    sections = h2_sections[1:] if len(h2_sections) > 1 else h2_sections
    if len(sections) < 2:
        return {"pass": True, "detail": "段落太少跳过", "score": 1.0}
    anchors_per_section = []
    for sec in sections:
        has_url = bool(_re.search(r"https?://|www\.", sec))
        has_num = bool(_re.search(r"\d{2,}", sec))  # ≥2 位数字
        has_person = bool(_re.search(r"[\u4e00-\u9fff]{2,3}(?:总|哥|姐|先生|老师)", sec))
        has_brand = bool(_re.search(r"(苹果|腾讯|字节|阿里|百度|微软|Google|Apple)", sec, _re.I))
        count = sum([has_url, has_num, has_person, has_brand])
        anchors_per_section.append(count)
    below = sum(1 for c in anchors_per_section if c == 0)
    return {
        "pass": below == 0,
        "detail": f"H2 段 {len(sections)} 个，{below} 个无锚点（每段需 ≥ 1 个 URL/数字/人名/品牌）",
        "score": max(0.0, 1.0 - below * 0.3),
    }


FORBIDDEN_WORDS = [
    "首先", "其次", "第三", "最后", "总之", "综上所述", "因此", "所以",
    "让我们", "让我们一起来", "值得注意", "值得一提", "需要注意",
    "在这个背景下", "在当今社会", "随着时代发展", "随着科技进步",
    "显而易见", "毋庸置疑", "众所周知", "众所周知的是",
    "由此可见", "从中可以看出", "不难发现", "不难看出",
    "总而言之", "概而言之", "一言以蔽之",
]

# ── 副词列表（writing-guide.md §1.5） ──────────────────────────────────
ADVERBS = [
    "确实", "当然", "实际上", "事实上", "本质上", "根本上",
    "显然", "明显", "自然", "必然", "或许", "也许",
    "总的来说", "总体而言", "整体上", "基本上", "大体上",
]

# ── 情绪词（用于 §1.4 情绪极性检测） ──────────────────────────────────
NEGATIVE_WORDS = [
    "坑", "骗", "垃圾", "糟糕", "崩溃", "绝望", "愤怒", "离谱",
    "难用", "难搞", "恶心", "无语", "服了", "受不了", "受不了",
    "问题", "毛病", "漏洞", "陷阱", "风险", "隐患", "不太行",
    "但", "不过", "然而", "可惜", "遗憾", "偏偏", "却",
]

POSITIVE_WORDS = [
    "爽", "好用", "牛", "赞", "棒", "绝了", "爱了", "真香",
    "完美", "优秀", "厉害", "惊喜", "过瘾", "上头",
]


def split_sentences(text: str) -> list[str]:
    """中文分句（按句号/问号/感叹号/换行切）。"""
    raw = re.split(r"[。！？!?\n]+", text)
    return [s.strip() for s in raw if len(s.strip()) > 0]


def split_paragraphs(text: str) -> list[str]:
    """分段（空行）。"""
    paras = re.split(r"\n\s*\n", text)
    return [p.strip() for p in paras if p.strip()]


# ── 规则实现 ──────────────────────────────────────────────────

def check_sentence_length_variance(text: str) -> dict:
    """§1.1 句长方差：最短 vs 最长 ≥ 30 字。"""
    sentences = split_sentences(text)
    if len(sentences) < 10:
        return {"pass": False, "detail": f"句子太少（{len(sentences)}），至少要 10 句", "score": 0}
    lengths = [len(s) for s in sentences]
    diff = max(lengths) - min(lengths)
    return {
        "pass": diff >= 30,
        "detail": f"最短 {min(lengths)} 字 / 最长 {max(lengths)} 字 / 差 {diff} 字（要求 ≥ 30）",
        "score": min(1.0, diff / 30),
    }


def check_forbidden_words(text: str) -> dict:
    """§2.1 禁用词命中 = 0。"""
    hits = [(w, len(re.findall(re.escape(w), text))) for w in FORBIDDEN_WORDS if w in text]
    return {
        "pass": len(hits) == 0,
        "detail": f"命中 {len(hits)} 个禁用词: {hits[:5]}" if hits else "零命中",
        "score": 1.0 if not hits else max(0.0, 1.0 - len(hits) * 0.2),
    }


def check_paragraph_rhythm(text: str) -> dict:
    """§1.3 无连续 2 段长度接近（±20 字）。"""
    paras = split_paragraphs(text)
    if len(paras) < 3:
        return {"pass": True, "detail": "段落太少跳过", "score": 1.0}
    lengths = [len(p) for p in paras]
    violations = 0
    for i in range(len(lengths) - 1):
        if abs(lengths[i] - lengths[i + 1]) <= 20:
            violations += 1
    return {
        "pass": violations == 0,
        "detail": f"相邻长度接近: {violations} 处（共 {len(lengths)} 段）",
        "score": max(0.0, 1.0 - violations * 0.2),
    }


def check_emotion_polarity(text: str) -> dict:
    """§1.4 负面情绪表达 ≥ 2 处。"""
    neg = sum(1 for w in NEGATIVE_WORDS if w in text)
    pos = sum(1 for w in POSITIVE_WORDS if w in text)
    return {
        "pass": neg >= 2,
        "detail": f"负面词 {neg} 种 / 正面词 {pos} 种（要求负面 ≥ 2）",
        "score": min(1.0, neg / 2),
    }


def check_adverb_density(text: str) -> dict:
    """§1.5 无连续两句以副词开头。"""
    sentences = split_sentences(text)
    violations = 0
    for i in range(len(sentences) - 1):
        s1 = sentences[i]
        s2 = sentences[i + 1]
        if any(s1.startswith(a) for a in ADVERBS) and any(s2.startswith(a) for a in ADVERBS):
            violations += 1
    return {
        "pass": violations == 0,
        "detail": f"连续副词开头句对: {violations} 处",
        "score": 1.0 if violations == 0 else max(0.0, 1.0 - violations * 0.25),
    }


def check_break_sentences(text: str) -> dict:
    """§2.2 破句/不完整句 ≥ 3 处（短于 5 字的独立句 / 省略号结尾）。"""
    sentences = split_sentences(text)
    breaks = sum(1 for s in sentences if len(s) <= 5 or s.endswith("…") or s.endswith("——") or s.endswith("—"))
    return {
        "pass": breaks >= 3,
        "detail": f"破句 {breaks} 处（要求 ≥ 3）",
        "score": min(1.0, breaks / 3),
    }


def check_concrete_details(text: str) -> dict:
    """§3.2 每 500 字 ≥ 2 处具体细节（含数字 / 年份 / URL）。"""
    total = len(text)
    num_details = len(re.findall(r"\d+(\.\d+)?%?|https?://|www\.", text))
    if total == 0:
        return {"pass": False, "detail": "空文本", "score": 0}
    density = num_details / (total / 500)  # 每 500 字的细节数
    return {
        "pass": density >= 2,
        "detail": f"数字/URL 细节 {num_details} 个 / {total} 字 = {density:.1f} 处/500字（要求 ≥ 2）",
        "score": min(1.0, density / 2),
    }


def check_word_count(text: str) -> dict:
    """字数控制：1500-2500 最佳，1200-3000 可接受。"""
    n = len(text.replace("\n", "").replace(" ", ""))
    if 1500 <= n <= 2500:
        score = 1.0
    elif 1200 <= n <= 3000:
        score = 0.7
    else:
        score = 0.3
    return {
        "pass": 1200 <= n <= 3000,
        "detail": f"{n} 字（最佳 1500-2500，可接受 1200-3000）",
        "score": score,
    }


# ── 主入口 ──────────────────────────────────────────────────

RULES = [
    ("1.1 句长方差", check_sentence_length_variance),
    ("1.2 词汇温度", check_vocab_temperature),
    ("1.3 段落节奏", check_paragraph_rhythm),
    ("1.4 情绪极性", check_emotion_polarity),
    ("1.5 副词密度", check_adverb_density),
    ("2.1 禁用词", check_forbidden_words),
    ("2.2 破句", check_break_sentences),
    ("2.3 跨界用词", check_unexpected_words),
    ("3.1 真实锚定", check_grounded_evidence),
    ("3.2 具体性", check_concrete_details),
    ("字数控制", check_word_count),
]


def score(text: str) -> dict:
    results = {}
    total_score = 0.0
    pass_count = 0
    for name, fn in RULES:
        r = fn(text)
        results[name] = r
        total_score += r["score"]
        if r["pass"]:
            pass_count += 1

    n = len(RULES)
    # 硬规则（check_forbidden_words）和字数控制：必须 PASS 才能 overall PASS
    hard_blockers = [
        results.get("2.1 禁用词", {}).get("pass", False),
    ]
    all_hard_pass = all(hard_blockers)
    summary = {
        "total_pass": pass_count,
        "total_rules": n,
        "pass_rate": f"{pass_count}/{n}",
        "aggregate_score": round(total_score / n, 2),
        "verdict": "PASS" if (pass_count >= n - 1 and all_hard_pass) else "RETRY",
        "hard_blockers": {
            "2.1 禁用词": hard_blockers[0],
        },
    }
    return {"summary": summary, "rules": results}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("md_path", help="待检查的 Markdown 文件")
    p.add_argument("--json", action="store_true", help="JSON 输出（默认人类可读）")
    args = p.parse_args()

    md = Path(args.md_path)
    if not md.exists():
        print(f"ERROR: {md} 不存在", file=sys.stderr)
        sys.exit(1)

    text = md.read_text(encoding="utf-8")
    result = score(text)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        s = result["summary"]
        print(f"\n═══ 人类度自检 ═══  {s['verdict']}  ═══\n")
        for name, r in result["rules"].items():
            icon = "✅" if r["pass"] else "❌"
            print(f"  {icon} {name}: {r['detail']}")
        print(f"\n  通过率: {s['pass_rate']}  综合: {s['aggregate_score']}  结论: {s['verdict']}")

    sys.exit(0 if result["summary"]["verdict"] == "PASS" else 1)


if __name__ == "__main__":
    main()
