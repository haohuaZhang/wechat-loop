"""Agent 写作 prompt 模板 — 可直接读进 SKILL.md 或 run_daily.sh。

run_daily.sh 完成后会生成 evidence_pack.json 和 topic_candidates.json，
Agent 写作时就按这个模板组装 prompt。不用调任何外部 API — Agent 本身的
能力 + SKILL.md 里的规范 + 上游 references/ + personas/ 就能出稿。

用法: 直接 cat 进 run_daily.sh 输出的 .prompt 文件
      bash scripts/run_daily.sh --topic "免费影视"
      cat loop/runs/20261111/.prompt
"""

PROMPT_TEMPLATE = """# ═══ wechat-loop 写作 prompt ═══
# (由 run_daily.sh 自动生成，Agent 直接读这个写文章)

## 1. 选题

{{SELECTED_TOPIC}}

## 2. 证据包（来自 knowledge_base.json 检索）

{{EVIDENCE_PACK_JSON}}

## 3. 人格（SKILL.md 已选型：{{PERSONA_NAME}}）

{{PERSONA_YAML}}

## 4. 写作规范（writing-guide.md 摘要，Agent 必须全部遵守）

### 硬性规则
- 禁用词: 首先/其次/总之/让我们/值得注意/综上所述/显而易见... 命中 0 个
- 句长方差: 10 句最短 vs 最长差 ≥ 30 字
- 每 500 字破句/不完整句 ≥ 3 处
- 负面情绪表达 ≥ 2 处
- 连续两句不能都以副词开头
- 全文 1500-2500 字，不足补案例，过长砍最弱论点

### 内容层（最高优先级）
- 每个 H2 锚定证据包里至少 1 条真实素材（具名来源 + URL）
- 绝对禁止编造数据/案例/引述
- 至少 2 处跑题再拉回，不能每段首句都承接上段
- 编辑锚点插入 2-3 处: <!-- ✏️ 编辑建议:... -->

### 维度随机化（全文贯穿）
从 6 维度池随机选 2-3 个：
- 叙事视角（亲历者/旁观分析/对话体/自问自答）
- 时间线（顺叙/倒叙/插叙）
- 主类比域（体育/烹饪/电影/游戏/旅行/建筑/医学）
- 情感基调（冷静克制/热血兴奋/毒舌调侃/温暖治愈/焦虑预警）
- 节奏型（急促短句流/舒缓长叙述/快慢剧烈交替）
- 论证偏好（案例堆叠/逻辑推演/反面假设/类比说理）

本次激活维度: {{DIMENSIONS}}

## 5. 框架（从 frameworks.md 7 套里选）

建议用 {{FRAMEWORK}} — 结构: {{FRAMEWORK_DESC}}

## 6. 输出格式（Markdown 纯文本）

```markdown
# H1 标题（20-28 字）

## H2 论点 1
...正文...

## H2 论点 2
...正文...（含编辑锚点 <!-- ✏️ 编辑建议: ... -->）

## H2 论点 3
...正文...

<!-- ✏️ 编辑建议: 最后一次自我修正 -->
```

## 7. 自检验证（写完后跑这个脚本）

```bash
python3 scripts/humanness_score.py loop/runs/{{DATE_TAG}}/article.md
```

结论 RETRY → 定向修复不达标的段落（只改有问题的段落，不动已过的）。
最多修 3 轮，还不过就标注 DONE_WITH_CONCERNS 继续。

---
# Agent 现在开始写。直接输出 article.md 全文，不要说"好的我来帮你写"这类前置话术。
"""


def build_prompt(date_tag: str, topic: dict, persona_name: str, persona_yaml: str,
                 framework_name: str, framework_desc: str,
                 dimensions: str, evidence_pack_path: str,
                 out_path: str) -> None:
    """组装并写 .prompt 文件。"""
    import json
    evidence = ""
    try:
        data = json.loads(open(evidence_pack_path, encoding="utf-8").read())
        evidence = json.dumps(data, ensure_ascii=False, indent=2)
    except Exception as e:
        evidence = f"(evidence_pack 读取失败: {e})"

    prompt = PROMPT_TEMPLATE
    prompt = prompt.replace("{{DATE_TAG}}", date_tag)
    prompt = prompt.replace("{{SELECTED_TOPIC}}", topic.get("title", ""))
    prompt = prompt.replace("{{EVIDENCE_PACK_JSON}}", evidence[:3000])
    prompt = prompt.replace("{{PERSONA_NAME}}", persona_name)  # ✅ 函数参数，不是 main 的 args
    prompt = prompt.replace("{{PERSONA_YAML}}", persona_yaml[:1500])
    prompt = prompt.replace("{{FRAMEWORK}}", framework_name)
    prompt = prompt.replace("{{FRAMEWORK_DESC}}", framework_desc)
    prompt = prompt.replace("{{DIMENSIONS}}", dimensions)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(prompt, encoding="utf-8")
    print(f"prompt 已写入 {out_path}")


if __name__ == "__main__":
    import argparse
    from pathlib import Path
    ROOT = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    p.add_argument("--topic-title", default="")
    p.add_argument("--persona", default="industry-observer")
    p.add_argument("--framework", default="清单型")
    p.add_argument("--evidence", default="")
    p.add_argument("--out", default="")
    p.add_argument("--dimensions", default="叙事视角:问答体 + 类比域:电影 + 情绪基调:毒舌调侃")
    args = p.parse_args()

    # 读 persona yaml
    persona_path = ROOT / "personas" / f"{args.persona}.yaml"
    persona_yaml = persona_path.read_text(encoding="utf-8") if persona_path.exists() else f"(persona {args.persona} not found)"

    # 框架简易描述
    framework_descs = {
        "清单型": "开头抛痛点 → 列 N 条推荐/对比/技巧 → 每条带真实案例/数据 → 最后总结",
        "痛点型": "开头场景化痛点 → 为什么会这样 → 解决方案 1-N → 哪种最适合你",
        "故事型": "一个完整案例/事件/产品的起承转合 → 为什么值得关注 → 对读者的启示",
        "对比型": "A vs B vs C 三选一 → 5 维度对比 → 每种的优劣和适用场景",
        "热点解读": "热点事件切入 → 背景/原理 → 影响分析 → 后续判断",
        "纯观点": "亮明反主流观点 → 3 个论点反驳主流 → 读者该做什么",
        "复盘型": "一件事的时间线 → 做得好的/做得差的 → 下次怎么做",
    }
    desc = framework_descs.get(args.framework, "自定义框架")

    out = args.out or str(ROOT / "loop" / "runs" / args.date / ".prompt")
    topic = {"title": args.topic_title}
    build_prompt(args.date, topic, args.persona, persona_yaml, args.framework, desc,
                 args.dimensions, args.evidence, out)
