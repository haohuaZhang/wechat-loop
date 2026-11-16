#!/usr/bin/env bash
# 每日采集 + 检索 + 选题去重 + 封面 + prompt 组装（纯脚本，零 AI，cron 可直接触发）。
# 调用: bash scripts/run_daily.sh [--date 20261111] [--topic "免费在线看电影"]
# 产出: loop/runs/YYYYMMDD/{evidence_pack.json, topic_candidates.json, .prompt, article.html, article.meta.json, covers/}
#
# Agent 写作环节不在此脚本内 —— 此脚本完成后，在 Trae 里说 "写一篇" 触发。
# Agent 写完后的 humanness_score + convert_md + publish_draft + history 也是独立手动触发。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# 复用 bootstrap.sh 装好的工具链（有就切，没有就继续用系统 Python）
[[ -f "$ROOT/tools/gate/activate.sh" ]] && source "$ROOT/tools/gate/activate.sh"

# ── 参数解析 ────────────────────────────────────────────────
DATE_TAG=""
TOPIC=""
PERSONA="industry-observer"
FRAMEWORK="清单型"
DIMENSIONS="叙事视角:问答体 + 类比域:电影 + 情绪基调:毒舌调侃"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --date)      DATE_TAG="$2"; shift 2 ;;
        --topic)     TOPIC="$2";    shift 2 ;;
        --persona)   PERSONA="$2";  shift 2 ;;
        --framework) FRAMEWORK="$2"; shift 2 ;;
        *) echo "未知参数: $1" >&2; exit 1 ;;
    esac
done
DATE_TAG="${DATE_TAG:-$(date +%Y%m%d)}"
RUN_DIR="loop/runs/$DATE_TAG"
mkdir -p "$RUN_DIR"

# ── 日志 ────────────────────────────────────────────────────
log() { echo "[$(date +%H:%M:%S)] $*"; }

log "═══ wechat-loop daily run — $DATE_TAG ═══"
log "run_dir = $RUN_DIR"

# ── 0. 检查 knowledge_base.json ─────────────────────────────
KB="loop/knowledge_base.json"
if [[ ! -f "$KB" ]] || [[ $(python3 -c "import json;print(len(json.load(open('$KB')).get('articles',{})))" 2>/dev/null || echo 0) -eq 0 ]]; then
    log "⚠️  knowledge_base.json 为空或不存在 — 采集脚本还没跑过"
    log "   跳采集环节，evidence_pack 留空，Agent 写作时将 WebSearch 兜底"
fi

# ── 1. 检索 ────────────────────────────────────────────────
if [[ -n "$TOPIC" ]]; then
    log "① 检索 topic=$TOPIC"
    python3 scripts/simple_search.py "$TOPIC" \
        --kb "$KB" --top-k 5 \
        --output "$RUN_DIR/evidence_pack.json" \
        2>&1 | tee -a "$RUN_DIR/run.log" || log "⚠️  检索失败，继续"
else
    log "① 跳过检索（未指定 --topic）"
    echo '{"query":"(manual)","top_chunks":[]}' > "$RUN_DIR/evidence_pack.json"
fi

# ── 2. 选题去重 ──────────────────────────────────────────────
if [[ -f "$KB" ]]; then
    log "② 选题去重（topic_selection.py）"
    python3 scripts/topic_selection.py --top-n 5 \
        --output "$RUN_DIR/topic_candidates.json" \
        2>&1 | tee -a "$RUN_DIR/run.log" || log "⚠️  选题失败，继续"

    # 自动选 top-1 作为今天的选题（如果没手动传 --topic）
    if [[ -z "$TOPIC" ]]; then
        AUTO_TOPIC=$(python3 -c "
import json
d = json.load(open('$RUN_DIR/topic_candidates.json'))
items = d.get('top_topics', [])
print(items[0]['title'] if items else '')
" 2>/dev/null || echo "")
        if [[ -n "$AUTO_TOPIC" ]]; then
            TOPIC="$AUTO_TOPIC"
            log "   ✅ 自动选题: $TOPIC"
        fi
    fi
else
    log "② 跳过选题（KB 不存在）"
fi

# ── 3. Prompt 组装 ──────────────────────────────────────────
log "③ 组装写作 prompt（build_prompt.py）"
python3 scripts/build_prompt.py \
    --date "$DATE_TAG" \
    --topic-title "${TOPIC:-（手动选题）}" \
    --persona "$PERSONA" \
    --framework "$FRAMEWORK" \
    --dimensions "$DIMENSIONS" \
    --evidence "$RUN_DIR/evidence_pack.json" \
    --out "$RUN_DIR/.prompt" \
    2>&1 | tee -a "$RUN_DIR/run.log" || log "⚠️  prompt 组装失败"

# ── 4. 封面占位（等 Agent 写好标题后再正式生成） ────────────
log "④ 封面占位（等 Agent 写好标题后调用 make_cover.py）"
echo "# 待生成 — 等 Agent 写好 article.md 后:" > "$RUN_DIR/cover_cmd.txt"
echo "python3 scripts/make_cover.py -t \"标题\" -s \"副标题\" -o $RUN_DIR/cover.png" >> "$RUN_DIR/cover_cmd.txt"

# ── 5. 收尾 ────────────────────────────────────────────────
log "═══ 脚本环节完成 ═══"
log ""
log "📋 产物清单:"
log "   evidence_pack.json   检索结果（给 Agent 当证据包）"
log "   topic_candidates.json 选题候选（去重后的 top-N）"
log "   .prompt              完整写作 prompt（cat 给 Agent 即可）"
log ""
log "📝 Agent 写作流程:"
log "   1) 打开 $RUN_DIR/.prompt 读完整 prompt"
log "   2) 写 $RUN_DIR/article.md"
log "   3) python3 scripts/humanness_score.py $RUN_DIR/article.md  → 不合格就改"
log "   4) python3 scripts/make_cover.py -t '标题' -s '副标题' -o $RUN_DIR/cover.png"
log "   5) python3 scripts/convert_md.py $RUN_DIR/article.md --theme sspai --out $RUN_DIR/article.html"
log "   6) python3 scripts/publish_draft.py $RUN_DIR/article.html --title '标题' --cover $RUN_DIR/cover.png --route playwright"
log "   7) python3 scripts/history.py add --article-id <slug> --title '标题' --persona $PERSONA --dimensions '$DIMENSIONS'"
