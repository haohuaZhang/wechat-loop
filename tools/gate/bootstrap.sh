#!/usr/bin/env bash
# 幂等环境自举：把 Python 依赖 + Playwright chromium 装到「可复用」目录，
# 已就绪则秒退，不重复下载。
#
# 安装位置优先级：
#   1. $TRAE_TOOLCHAIN_DIR（显式指定）
#   2. /data/user/.trae-toolchain（用户级目录，跨项目/跨会话复用）
#   3. <repo>/.toolchain（兜底，跟随仓库）
#
# 用法：
#   bash tools/gate/bootstrap.sh          # 装好或直接复用
#   source tools/gate/activate.sh         # 让当前 shell 用上这套环境
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PYVER="$(python3 -c 'import sys; print("py%d%d" % sys.version_info[:2])')"
PKGS=(requests openpyxl trafilatura playwright beautifulsoup4 markdown cssutils
      Pygments pyyaml apscheduler pillow pydantic python-dotenv)
MODS=(requests openpyxl trafilatura playwright bs4 markdown cssutils pygments
      yaml apscheduler PIL pydantic dotenv)

pick_root() {
  if [[ -n "${TRAE_TOOLCHAIN_DIR:-}" ]]; then
    echo "$TRAE_TOOLCHAIN_DIR"
  elif [[ -d /data/user && -w /data/user ]]; then
    echo "/data/user/.trae-toolchain"
  else
    echo "$ROOT/.toolchain"
  fi
}

TC="$(pick_root)"
ENV_ROOT="$TC/$PYVER"
VENV="$ENV_ROOT/venv"
BROWSERS="$ENV_ROOT/ms-playwright"
mkdir -p "$ENV_ROOT"

missing_mods() {
  "$VENV/bin/python" - "$@" <<'PY'
import importlib.util, sys
missing = [m for m in sys.argv[1:] if importlib.util.find_spec(m) is None]
print(" ".join(missing))
PY
}

start=$(date +%s)

# ── 1. venv ──
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "→ 创建虚拟环境：$VENV"
  python3 -m venv "$VENV"
fi

# ── 2. Python 依赖 ──
missing="$(missing_mods "${MODS[@]}")"
if [[ -n "$missing" ]]; then
  echo "→ 安装缺失依赖：$missing"
  "$VENV/bin/pip" install --quiet --disable-pip-version-check --upgrade pip
  "$VENV/bin/pip" install --quiet --disable-pip-version-check "${PKGS[@]}"
else
  echo "✓ Python 依赖已就绪（$PYVER）"
fi

# ── 3. Playwright chromium ──
if ! compgen -G "$BROWSERS/chromium-*" >/dev/null; then
  echo "→ 下载 Playwright chromium 到：$BROWSERS"
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" "$VENV/bin/playwright" install chromium
else
  echo "✓ Chromium 已就绪"
fi

# ── 3b. Chromium 依赖的系统库 ──
# 浏览器二进制会持久化，但它依赖的 libatk/libnss 等系统库在 /usr，
# 容器重建后会消失，这里做一次健康检查，缺了就补（通常 30-60s）。
chromium_ok() {
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" "$VENV/bin/python" - <<'PY' >/dev/null 2>&1
from playwright.sync_api import sync_playwright
p = sync_playwright().start()
b = p.chromium.launch(headless=True)
b.close()
p.stop()
PY
}
if chromium_ok; then
  echo "✓ Chromium 运行依赖已就绪"
else
  echo "→ 补装 Chromium 系统依赖（容器重置后只需这一步）"
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" "$VENV/bin/playwright" install-deps chromium \
    >/dev/null 2>&1 || true
  apt-get install -y -qq fonts-noto-cjk >/dev/null 2>&1 || true
  if chromium_ok; then
    echo "✓ Chromium 运行依赖已就绪"
  else
    echo "⚠️  Chromium 仍无法启动，请手动运行：" >&2
    echo "    $VENV/bin/playwright install-deps chromium" >&2
  fi
fi

# ── 4. 生成 activate.sh（供本仓库与其他项目 source）──
cat > "$TC/activate.sh" <<EOF
# 由 tools/gate/bootstrap.sh 生成，勿手改
export TRAE_TOOLCHAIN="$ENV_ROOT"
export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS"
export PATH="$VENV/bin:\$PATH"
EOF

cat > "$ROOT/tools/gate/activate.sh" <<EOF
# 由 tools/gate/bootstrap.sh 生成，勿手改
source "$TC/activate.sh"
EOF

mkdir -p tools/gate
date -Iseconds > tools/gate/.bootstrap_stamp

echo "✓ 环境就绪（$(( $(date +%s) - start ))s）"
echo "  环境目录 : $ENV_ROOT"
echo "  所有项目 : source $TC/activate.sh"
echo "  本仓库   : source tools/gate/activate.sh"
