#!/usr/bin/env bash
# ── wechat-loop 一键启动脚本（Mac 本地）──
# 用法：在项目根目录执行  ./start.sh
# 自动完成：拉 submodule → 装 Python 依赖 → 装前端依赖 → 起后端 + 起前端

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "🔧 wechat-loop 启动脚本"
echo "项目目录：$ROOT"

# ── 0. 子模块 ──
if [ ! -f "wechat-mp-tools/app_mp.py" ]; then
  echo "📦 拉取 wechat-mp-tools 子模块..."
  git submodule update --init --recursive
else
  echo "📦 wechat-mp-tools 已就绪"
fi

# ── 1. Python 依赖 ──
if ! python3 -c "import flask" 2>/dev/null; then
  echo "🐍 安装 Python 依赖..."
  pip3 install flask flask-cors requests beautifulsoup4 certifi
else
  echo "🐍 Python 依赖已就绪"
fi

# ── 2. 前端依赖 ──
if [ ! -d "wechat-loop-wizard-react/node_modules" ]; then
  echo "📦 安装前端依赖（首次需要，约 20-60 秒）..."
  cd wechat-loop-wizard-react
  npm install --no-audit --no-fund
  cd "$ROOT"
else
  echo "📦 前端依赖已就绪"
fi

# ── 3. 端口冲突检测 ──
if lsof -ti:5200 >/dev/null 2>&1; then
  echo "⚠️  端口 5200 已被占用，先释放..."
  lsof -ti:5200 | xargs kill -9 2>/dev/null || true
  sleep 1
fi
if lsof -ti:5173 >/dev/null 2>&1; then
  echo "⚠️  端口 5173 已被占用，先释放..."
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── 4. 启动后端 ──
echo "🚀 启动后端（127.0.0.1:5200）..."
cd "$ROOT"
nohup python3 backend/bridge.py > /tmp/wechat-loop-backend.log 2>&1 &
BACKEND_PID=$!

# ── 5. 启动前端 ──
echo "🚀 启动前端（localhost:5173）..."
cd wechat-loop-wizard-react
nohup npx vite --host 127.0.0.1 --port 5173 > /tmp/wechat-loop-frontend.log 2>&1 &
FRONTEND_PID=$!
cd "$ROOT"

# ── 6. 等待 + 探活 ──
echo "⏳ 等待服务就绪..."
for i in $(seq 1 15); do
  sleep 1
  backend_ok=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5200/api/auth/status 2>/dev/null || echo "000")
  frontend_ok=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/ 2>/dev/null || echo "000")
  if [ "$backend_ok" = "200" ] && [ "$frontend_ok" = "200" ]; then
    break
  fi
done

echo ""
echo "✅ 启动完成！"
echo "   后端：http://127.0.0.1:5200"
echo "   前端：http://localhost:5173/#/collect"
echo ""
echo "   后端日志：tail -f /tmp/wechat-loop-backend.log"
echo "   前端日志：tail -f /tmp/wechat-loop-frontend.log"
echo ""
echo "   停止服务：kill $BACKEND_PID $FRONTEND_PID"
echo ""
echo "⚠️  注意：微信读书扫码采集需要真实出网，沙盒环境不可用，必须在你本机运行。"
