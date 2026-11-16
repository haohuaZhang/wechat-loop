#!/usr/bin/env bash
# wechat-loop 安装脚本（零 chromium 依赖）。
# 一次性跑通，之后每次开发只需要 source config.env。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "═══ wechat-loop install ═══"

# 1. Python 版本检查
PYVER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_OK=$(python3 -c "import sys; print('yes' if sys.version_info >= (3, 10) else 'no')")
if [[ "$PY_OK" != "yes" ]]; then
    echo "ERROR: 需要 Python 3.10+，当前 $PYVER" >&2
    echo "  推荐用 pyenv install 3.13 && pyenv global 3.13"
    exit 1
fi
echo "✅ Python $PYVER OK"

# 2. 依赖（装到可复用工具链里，重复运行会秒退）
echo "安装 Python 依赖..."
bash tools/gate/bootstrap.sh
source tools/gate/activate.sh

# 3. 上游仓库检查
for repo in wechat-flow wechat-flow-film; do
    if [[ ! -d "$ROOT/../$repo" ]]; then
        echo "  ⚠️  未发现 ../$repo — 请手动 clone 到 /workspace/"
    fi
done
echo "✅ 依赖就绪"

# 4. 基础目录
mkdir -p loop/{covers,runs,kb} loop/exemplars

# 5. config.env（如果还没）
if [[ ! -f config.env ]]; then
    cat > config.env <<'ENV'
# 轨选择: playwright（推荐个人号） / api（企业号 + AppID/Secret）
DRAFT_ROUTE=playwright

# 采集凭证（Phase 1.2 后填）
# 轨 A: AppID + AppSecret
WECHAT_APPID=
WECHAT_APPSECRET=
# 轨 B: cookies.json 路径（auth.py login 后自动生成）
COOKIE_FILE=/workspace/wechat-flow-film/cookies.json

# 默认主题 & 人格（Agent 写作时可能覆盖）
DEFAULT_THEME=sspai
DEFAULT_PERSONA=industry-observer

# 每日日期关键词自动回复的内容（set_keyword.py 使用，留空则该脚本直接报错）
WECHAT_KEYWORD_REPLY=
ENV
    echo "✅ 已生成 config.env — 请按需填 DRAFT_ROUTE / AppID / Cookie"
else
    echo "config.env 已存在，跳过"
fi

echo ""
echo "═══ 安装完成 ═══"
echo "下一步（Phase 1）："
echo "  1. bash scripts/run_daily.sh --topic '你的选题关键词'"
echo "  2. 在 Trae 里说 '写一篇' 触发 Agent 写作"
echo "  3. 等 chromium 就绪后：python3 auth.py login && python3 scripts/convert_md.py ..."
echo "  4. python3 scripts/publish_draft.py article.html --route playwright"
