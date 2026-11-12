#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地向导服务器：把「扫码登录 → 输入公众号 → 采集 → 打开工作台」
做成一个零依赖的网页，给不会命令行的用户用。

  source tools/gate/activate.sh
  python3 scripts/wizard_server.py          # 默认 http://127.0.0.1:8787

实现约定：
  · 纯标准库（http.server），不引 Flask；
  · 只监听 127.0.0.1，凭证 / cookie 不出本机；
  · 所有子进程用参数列表启动（不经 shell），公众号名不会被当成命令执行；
  · 采集复用 wechat-digest-skill/wechat_collector.py：
      成功后自动入库（collector 自带），再跑 render_html.py 生成工作台。
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "wechat-digest-skill")
COLLECTOR = os.path.join(SKILL_DIR, "wechat_collector.py")
RENDER = os.path.join(SKILL_DIR, "render_html.py")
KB_PATH = os.path.join(SKILL_DIR, "output", "knowledge_base.json")
DIGEST_PATH = os.path.join(SKILL_DIR, "output", "digest.html")
PREVIEW_PATH = os.path.join(ROOT, "loop", "preview", "digest.html")

LOGIN_SCRIPT = os.path.join(ROOT, "scripts", "wx_login.py")
LOGIN_DIR = os.path.join(ROOT, "loop", ".login")
LOGIN_STATUS = os.path.join(LOGIN_DIR, "status.json")
LOGIN_QR = os.path.join(LOGIN_DIR, "qrcode.png")

STATE_LOCK = threading.Lock()


def now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ════════════════════════════════════════════════════════════════
#  子进程管理（登录 / 采集各一个，日志留尾部）
# ════════════════════════════════════════════════════════════════

class Job:
    def __init__(self, name):
        self.name = name
        self.proc = None
        self.lines = deque(maxlen=400)
        self.started_at = None
        self.finished_at = None
        self.exit_code = None
        self.phase = "idle"      # idle / running / rendering / done / freq / error
        self.error = ""

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def snapshot(self):
        return {
            "name": self.name,
            "running": self.running(),
            "phase": self.phase,
            "exitCode": self.exit_code,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "error": self.error,
            "log": list(self.lines)[-120:],
        }


LOGIN_JOB = Job("login")
COLLECT_JOB = Job("collect")


def _pump(stream, job):
    """后台读子进程输出，逐行进环形缓冲（同时用于频控/成功判定）。"""
    try:
        for raw in iter(stream.readline, ""):
            line = raw.rstrip("\n")
            with STATE_LOCK:
                job.lines.append(line)
                low = line.lower()
                if job.phase in ("running", "rendering"):
                    if "200013" in low or "命中频控" in line or "多次重试仍被频控" in line:
                        job.phase = "freq"
                    elif "完成：共" in line or "✓ 登录成功" in line:
                        job.phase = "rendering" if job.name == "collect" else "done"
    except (ValueError, OSError):
        pass
    finally:
        try:
            stream.close()
        except OSError:
            pass


def start_process(job, argv, cwd):
    """启动子进程并接管输出。返回 (ok, message)。"""
    with STATE_LOCK:
        if job.running():
            return False, f"{job.name} 正在运行，请等待结束"
        job.lines.clear()
        job.exit_code = None
        job.error = ""
        job.phase = "running"
        job.started_at = now()
        job.finished_at = None
        try:
            proc = subprocess.Popen(
                argv, cwd=cwd, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
        except OSError as e:
            job.phase = "error"
            job.error = f"启动失败：{e}"
            return False, job.error
        job.proc = proc

    threading.Thread(target=_pump, args=(proc.stdout, job), daemon=True).start()
    threading.Thread(target=_watch, args=(job, proc), daemon=True).start()
    return True, f"{job.name} 已启动（pid={proc.pid}）"


def _watch(job, proc):
    code = proc.wait()
    with STATE_LOCK:
        job.exit_code = code
        job.finished_at = now()
        if job.phase == "freq":
            pass
        elif job.name == "collect":
            if code == 0 and any("完成：共" in l for l in job.lines):
                job.phase = "rendering"
            elif code == 0:
                job.phase = "error"
                job.error = "采集进程结束，但没解析到成功标记（可能没采到文章）"
            else:
                job.phase = "error"
                job.error = job.error or f"采集进程退出码 {code}"

    if job.name == "collect" and job.phase == "rendering":
        # 单独跑渲染（不再交给 COLLECT_JOB 跑，避免覆盖采集日志）
        try:
            out = subprocess.run(
                [sys.executable, RENDER], cwd=SKILL_DIR,
                capture_output=True, text=True, timeout=120)
            success = out.returncode == 0 and os.path.exists(DIGEST_PATH)
        except (OSError, subprocess.TimeoutExpired) as e:
            success = False
            out = None
            with STATE_LOCK:
                COLLECT_JOB.lines.append(f"渲染失败：{e}")
        with STATE_LOCK:
            if success:
                COLLECT_JOB.phase = "done"
                COLLECT_JOB.lines.append(f"✓ 工作台已生成：{DIGEST_PATH}")
            else:
                COLLECT_JOB.phase = "error"
                COLLECT_JOB.error = "采集成功但生成工作台失败"
                if out is not None and out.stderr:
                    COLLECT_JOB.lines.append(out.stderr.strip()[-500:])


# ════════════════════════════════════════════════════════════════
#  页面
# ════════════════════════════════════════════════════════════════

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>公众号采集助手</title>
<style>
  :root { --ink:#1b1b1f; --muted:#6b6b76; --line:#e6e6ec; --brand:#07c160; --bg:#f6f7f9; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:24px; margin:0 0 4px; }
  .sub { color:var(--muted); margin-bottom:24px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:16px;
          padding:22px; margin-bottom:18px; }
  .card h2 { font-size:18px; margin:0 0 14px; display:flex; align-items:center; gap:10px; }
  .step { display:inline-flex; width:26px; height:26px; border-radius:50%;
          background:var(--brand); color:#fff; align-items:center; justify-content:center;
          font-size:14px; flex:none; }
  .card.done .step { background:#9aa0a6; }
  button { font:inherit; border:0; border-radius:12px; padding:14px 22px;
           background:var(--brand); color:#fff; cursor:pointer; font-weight:600; }
  button:disabled { background:#c9cdd2; cursor:not-allowed; }
  button.ghost { background:#eef0f2; color:var(--ink); }
  input[type=text] { font:inherit; padding:13px 14px; border:1px solid var(--line);
                     border-radius:12px; width:100%; }
  select { font:inherit; padding:13px 14px; border:1px solid var(--line); border-radius:12px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  .note { color:var(--muted); font-size:14px; margin-top:10px; }
  .banner { border-radius:12px; padding:12px 14px; margin-top:12px; font-size:14px; }
  .banner.ok { background:#e8f8ee; color:#0b6b3a; }
  .banner.warn { background:#fff4e5; color:#8a4b00; }
  .banner.err { background:#fdecea; color:#8c1d18; }
  #qr { max-width:260px; width:100%; border:1px solid var(--line); border-radius:12px;
        display:none; margin-top:14px; }
  pre.log { background:#14161a; color:#d5d9df; border-radius:12px; padding:14px;
            max-height:300px; overflow:auto; font-size:12.5px; line-height:1.5;
            white-space:pre-wrap; word-break:break-all; margin:14px 0 0; }
  .hide { display:none !important; }
  a.open { display:inline-block; margin-top:4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>公众号采集助手</h1>
  <div class="sub">三步：扫码登录 → 输入公众号 → 采集并浏览。数据只保存在本机。</div>

  <section class="card" id="card-login">
    <h2><span class="step">1</span>扫码登录</h2>
    <div class="row">
      <button id="btn-login">开始扫码登录</button>
      <span class="note" id="login-state">尚未登录</span>
    </div>
    <img id="qr" alt="微信二维码">
    <div id="login-msg" class="banner hide"></div>
    <div class="note">用手机微信「扫一扫」登录公众平台。凭证只写入本机的 credentials.json，不会上传。</div>
  </section>

  <section class="card" id="card-account">
    <h2><span class="step">2</span>输入要采集的公众号</h2>
    <div class="row">
      <input type="text" id="account" placeholder="例如：游戏汇总" maxlength="50">
      <select id="count">
        <option value="3">3 篇</option>
        <option value="5" selected>5 篇</option>
        <option value="10">10 篇</option>
      </select>
      <button id="btn-collect" disabled>开始采集</button>
    </div>
    <div class="note">先小批量试（3 篇）最稳。微信对列表接口有频控，命中后需等 30–60 分钟。</div>
  </section>

  <section class="card hide" id="card-progress">
    <h2><span class="step">3</span>采集进度</h2>
    <div id="collect-msg" class="banner hide"></div>
    <pre class="log" id="log">等待开始…</pre>
    <div class="row" style="margin-top:14px">
      <button id="btn-retry" class="ghost hide">重试采集</button>
      <a id="open-workbench" class="open hide" href="/digest.html" target="_blank">
        <button>打开工作台</button>
      </a>
    </div>
  </section>
</div>

<script>
const $ = (id) => document.getElementById(id);
let loginTimer = null, collectTimer = null;

function showBanner(el, kind, text) {
  el.className = 'banner ' + kind;
  el.textContent = text;
  el.classList.remove('hide');
}

async function api(path, opts) {
  const r = await fetch(path, opts || {});
  return r.json();
}

// ── 登录 ────────────────────────────────────────────────
$('btn-login').onclick = async () => {
  $('btn-login').disabled = true;
  const r = await api('/api/login/start', { method: 'POST' });
  if (!r.ok) { showBanner($('login-msg'), 'err', r.message); $('btn-login').disabled = false; return; }
  pollLogin();
};

async function pollLogin() {
  clearTimeout(loginTimer);
  const s = await api('/api/login/status');
  const setState = (t) => { $('login-state').textContent = t; };

  if (s.status === 'waiting') {
    setState('等待扫码…');
    $('qr').src = '/api/login/qr?t=' + Date.now();
    $('qr').style.display = 'block';
    showBanner($('login-msg'), 'warn', '请用手机微信扫码。二维码约 1 分钟自动刷新。');
    loginTimer = setTimeout(pollLogin, 2000);
  } else if (s.status === 'success') {
    setState('已登录 ✓');
    $('qr').style.display = 'none';
    showBanner($('login-msg'), 'ok', '登录成功，可以进入下一步。');
    $('card-login').classList.add('done');
    $('btn-collect').disabled = false;
    $('account').focus();
  } else if (s.status === 'expired') {
    setState('二维码已失效');
    $('qr').style.display = 'none';
    showBanner($('login-msg'), 'err', '二维码已失效，请重新点「开始扫码登录」。');
    $('btn-login').disabled = false;
  } else if (s.status === 'error') {
    setState('登录出错');
    showBanner($('login-msg'), 'err', '登录出错：' + (s.detail || '请重试'));
    $('btn-login').disabled = false;
  } else if (s.running) {
    setState('正在打开登录页…');
    loginTimer = setTimeout(pollLogin, 1500);
  } else {
    setState('尚未登录');
    $('btn-login').disabled = false;
  }
}

// ── 采集 ────────────────────────────────────────────────
async function startCollect() {
  const account = $('account').value.trim();
  if (!account) { alert('请先输入公众号名称'); return; }
  $('btn-collect').disabled = true;
  $('card-progress').classList.remove('hide');
  $('log').textContent = '正在启动…';
  const r = await api('/api/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, count: parseInt($('count').value, 10) })
  });
  if (!r.ok) {
    showBanner($('collect-msg'), 'err', r.message);
    $('btn-collect').disabled = false;
    return;
  }
  pollCollect();
}

$('btn-collect').onclick = startCollect;
$('btn-retry').onclick = () => {
  $('btn-retry').classList.add('hide');
  $('collect-msg').classList.add('hide');
  $('open-workbench').classList.add('hide');
  startCollect();
};
$('account').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !$('btn-collect').disabled) startCollect();
});

async function pollCollect() {
  clearTimeout(collectTimer);
  const s = await api('/api/collect/status');
  $('log').textContent = (s.log && s.log.length) ? s.log.join('\\n') : '等待输出…';
  $('log').scrollTop = $('log').scrollHeight;
  const msg = $('collect-msg');

  if (s.phase === 'freq') {
    showBanner(msg, 'warn', '被微信频控（200013）。这是正常的保护机制，请等 30–60 分钟后再点「重试采集」。');
    $('btn-retry').classList.remove('hide');
    $('btn-collect').disabled = false;
    $('card-progress').classList.remove('hide');
    return;
  }
  if (s.phase === 'done') {
    showBanner(msg, 'ok', '采集完成，工作台已生成。');
    $('open-workbench').classList.remove('hide');
    $('btn-collect').disabled = false;
    return;
  }
  if (s.phase === 'error') {
    showBanner(msg, 'err', '出错了：' + (s.error || '请点重试'));
    $('btn-retry').classList.remove('hide');
    $('btn-collect').disabled = false;
    return;
  }
  if (s.running || s.phase === 'rendering') {
    showBanner(msg, 'warn', s.phase === 'rendering' ? '正在生成工作台…' : '正在采集，请勿关闭本页…');
    collectTimer = setTimeout(pollCollect, 1500);
  }
}

// 首次进入：恢复已有状态
(async () => {
  const s = await api('/api/login/status');
  if (s.status === 'success') {
    $('login-state').textContent = '已登录 ✓（凭证有效）';
    $('card-login').classList.add('done');
    $('btn-collect').disabled = false;
  } else if (s.status === 'waiting' && s.running) {
    $('btn-login').disabled = true;
    pollLogin();
  } else {
    $('login-state').textContent = '尚未登录';
  }
  const c = await api('/api/collect/status');
  if (c.phase !== 'idle') {
    $('card-progress').classList.remove('hide');
    pollCollect();
  }
})();
</script>
</body>
</html>
"""


# ════════════════════════════════════════════════════════════════
#  HTTP 路由
# ════════════════════════════════════════════════════════════════

class Handler(BaseHTTPRequestHandler):
    server_version = "WechatLoopWizard/1.0"

    def log_message(self, fmt, *args):  # 安静一点，别刷屏
        pass

    def _send(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            return json.loads(raw or b"{}")
        except (ValueError, OSError):
            return {}

    def _serve_file(self, path, ctype):
        if not os.path.isfile(path):
            self._send(404, {"ok": False, "message": f"文件不存在：{os.path.basename(path)}"})
            return
        with open(path, "rb") as f:
            data = f.read()
        self._send(200, data, ctype)

    def do_GET(self):
        url = urlparse(self.path)
        p = url.path

        if p in ("/", "/index.html"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif p == "/api/login/status":
            self._send(200, self._login_status())
        elif p == "/api/login/qr":
            self._serve_file(LOGIN_QR, "image/png")
        elif p == "/api/collect/status":
            self._send(200, COLLECT_JOB.snapshot())
        elif p == "/api/kb/stats":
            self._send(200, self._kb_stats())
        elif p == "/api/open":
            self._send(200, {
                "ok": os.path.exists(DIGEST_PATH),
                "path": DIGEST_PATH,
                "url": "/digest.html",
            })
        elif p == "/digest.html":
            self._serve_file(DIGEST_PATH, "text/html; charset=utf-8")
        elif p == "/preview/digest.html":
            self._serve_file(PREVIEW_PATH, "text/html; charset=utf-8")
        elif p == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
        else:
            self._send(404, {"ok": False, "message": "not found"})

    def do_POST(self):
        p = urlparse(self.path).path
        if p == "/api/login/start":
            ok, msg = start_process(
                LOGIN_JOB, [sys.executable, LOGIN_SCRIPT], ROOT)
            self._send(200 if ok else 409, {"ok": ok, "message": msg})
        elif p == "/api/collect":
            body = self._json_body()
            account = str(body.get("account") or "").strip()
            try:
                count = int(body.get("count") or 3)
            except (TypeError, ValueError):
                count = 3
            count = max(1, min(30, count))
            if not account:
                self._send(400, {"ok": False, "message": "请输入公众号名称"})
                return
            if len(account) > 50:
                self._send(400, {"ok": False, "message": "公众号名称过长"})
                return
            if not os.path.exists(COLLECTOR):
                self._send(500, {"ok": False, "message": "缺少 wechat_collector.py"})
                return
            ok, msg = start_process(COLLECT_JOB, [
                sys.executable, COLLECTOR, "collect", account,
                "--count", str(count), "--resume",
                "--freq-cooldown", "60", "--freq-retries", "1",
            ], SKILL_DIR)
            self._send(200 if ok else 409, {"ok": ok, "message": msg})
        else:
            self._send(404, {"ok": False, "message": "not found"})

    # ── 状态组装 ────────────────────────────────────────────
    def _login_status(self):
        st = read_json(LOGIN_STATUS, {"status": "none"}) or {"status": "none"}
        st["running"] = LOGIN_JOB.running()
        st["credentials"] = os.path.exists(
            os.path.join(SKILL_DIR, "credentials.json"))
        return st

    def _kb_stats(self):
        kb = read_json(KB_PATH, {}) or {}
        arts = kb.get("articles") or {}
        accounts = {}
        for a in arts.values():
            name = (a.get("account") or "").strip()
            if name:
                accounts[name] = accounts.get(name, 0) + 1
        return {
            "articles": len(arts),
            "accounts": accounts,
            "updatedAt": kb.get("updatedAt"),
            "digestReady": os.path.exists(DIGEST_PATH),
        }


def main():
    ap = argparse.ArgumentParser(
        prog="wizard_server.py", description="公众号采集本地向导（网页版）")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    ap.add_argument("--port", type=int, default=8787, help="端口（默认 8787）")
    ap.add_argument("--open", action="store_true", help="启动后自动用浏览器打开向导页")
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"向导已启动： {url}")
    print("按 Ctrl+C 退出。")
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
