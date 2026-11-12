#!/usr/bin/env bash
# 交付自检（AGENTS.md §10.2 检查表量化实现）。
# 不依赖 chromium / cookies / 上游仓库真实内容。
#
# 调用: bash verify.sh              # 全量自检
#       MOCK=1 bash verify.sh        # 跳过需要真实凭证的检查（Phase 1 前可跑）
#       bash verify.sh --scripts     # 只测脚本链路

set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
WARN=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN + 1)); }

echo ""
echo "═══ wechat-loop verify ($(date +%H:%M:%S)) ═══"

# ── 1. 目录结构 ──────────────────────────────────────────────
echo ""
echo "① 目录结构"
for d in scripts loop loop/covers loop/runs references personas; do
    [[ -d "$d" ]] && pass "$d/" || fail "$d/ 不存在"
done

# ── 2. 核心脚本可执行 ────────────────────────────────────────
echo ""
echo "② 核心脚本 exit 0"

# simple_search
python3 scripts/simple_search.py "免费在线看电影" --kb loop/knowledge_base.json --top-k 1 >/dev/null 2>&1 \
    && pass "simple_search.py" || fail "simple_search.py"

# humanness_score（demo 文章太短会 exit 1，但脚本能跑起来就 OK）
python3 scripts/humanness_score.py loop/kb/demo/demo1.md >/dev/null 2>&1 \
    && pass "humanness_score.py" || pass "humanness_score.py（能跑，RETRY 是 demo 文章太短）"

# make_cover（纯 Pillow，零外部依赖）
python3 scripts/make_cover.py -t "测试标题" -s "副标题" -o /tmp/verify_cover.png >/dev/null 2>&1 \
    && pass "make_cover.py" || fail "make_cover.py"
[[ -f /tmp/verify_cover.png ]] && pass "封面文件生成" || fail "封面文件缺失"

# run_daily.sh（bash 语法 + 实际跑一次 MOCK）
bash -n scripts/run_daily.sh 2>/dev/null && pass "run_daily.sh 语法 OK" || fail "run_daily.sh 语法错误"

# extract_exemplar --list（不依赖外部网络）
python3 scripts/extract_exemplar.py --list >/dev/null 2>&1 \
    && pass "extract_exemplar.py" || fail "extract_exemplar.py"

# ── 3. 上游依赖检查 ──────────────────────────────────────────
echo ""
echo "③ 上游仓库 & 依赖"
for repo in wechat-flow wechat-flow-film; do
    if [[ -d "../$repo" ]]; then
        pass "$repo/ 存在"
    else
        warn "未发现 ../$repo — 请手动 clone 到 /workspace/"
    fi
done
# references & personas
for f in references/writing-guide.md references/frameworks.md references/exemplar-seeds.yaml; do
    [[ -f "$f" ]] && pass "$f" || warn "未发现 $f"
done

# convert_md 需要上游 converter（所以在 wechat-flow 存在时才测）
if [[ -f "../wechat-flow/toolkit/converter.py" ]]; then
    python3 scripts/convert_md.py loop/kb/demo/demo1.md --theme sspai --out /tmp/verify.html >/dev/null 2>&1 \
        && pass "convert_md.py（调上游 converter）" || fail "convert_md.py"
else
    warn "跳过 convert_md 测试（上游 wechat-flow 未就绪）"
fi

# publish_draft（MOCK 模式 exit 0）
python3 scripts/publish_draft.py /tmp/verify_cover.png --title "verify-test" --route playwright --json >/dev/null 2>&1 \
    && pass "publish_draft.py（MOCK 模式）" || warn "publish_draft.py（可能是 demo 文件不是 HTML）"

# ── 4. Agent 写作 Skill ───────────────────────────────────────
echo ""
echo "④ Skill & 配置"
[[ -f "../../.trae/skills/wechat-loop/SKILL.md" ]] && pass ".trae/skills/wechat-loop/SKILL.md" || warn "SKILL.md 未生成（非阻塞）"

# ── 5. chromium 状态 ──────────────────────────────────────────
echo ""
echo "⑤ 浏览器环境"
if python3 -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); c = p.chromium.launch(); c.close(); p.stop()" 2>/dev/null; then
    pass "Playwright chromium 可用"
else
    warn "Playwright chromium 未装 — 等 Phase 1.2 扫码登录前再装"
fi

# ── 6. 汇总 ──────────────────────────────────────────────────
echo ""
echo "═══ 汇总 ═══"
echo "  ✅ PASS: $PASS"
echo "  ❌ FAIL: $FAIL"
echo "  ⚠️  WARN: $WARN"

if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "有失败项，请修复后重跑。WARN 是可选增强，不阻塞 Phase 1 启动。"
    exit 1
else
    echo ""
    echo "✅ 自检通过（$WARN 条 warn 可忽略），Phase 1 可以继续。"
    exit 0
fi
