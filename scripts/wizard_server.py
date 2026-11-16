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
import re
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "wechat-digest-skill")
COLLECTOR = os.path.join(SKILL_DIR, "wechat_collector.py")
ANALYZE = os.path.join(ROOT, "scripts", "local_analyze.py")
EXPORT = os.path.join(ROOT, "scripts", "export_batch.py")
TRAE_LOOP = os.path.join(ROOT, "scripts", "trae_loop.py")
RENDER = os.path.join(ROOT, "scripts", "render_workbench.py")
KB_PATH = os.path.join(SKILL_DIR, "output", "knowledge_base.json")
DIGEST_PATH = os.path.join(SKILL_DIR, "output", "digest.html")
PREVIEW_PATH = os.path.join(ROOT, "loop", "preview", "digest.html")
FREQ_GUARD_PATH = os.path.join(ROOT, "loop", ".freq_guard.json")
FREQ_LOCK_SECONDS = 30 * 60
URLS_DIR = os.path.join(ROOT, "loop", ".urls")
IMPORT_DIR = os.path.join(ROOT, "loop", "import")
MP_LINK_RE = re.compile(r"https?://mp\.weixin\.qq\.com/s[0-9A-Za-z_\-./?=&%#~+]*")

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


# ── 频控冷却锁：撞到 200013 后 30 分钟内不再真正发请求 ──
# 微信每次被撞都会重新计时，连续点「重试」只会让封得更久。
def set_freq_guard(seconds=FREQ_LOCK_SECONDS):
    try:
        os.makedirs(os.path.dirname(FREQ_GUARD_PATH), exist_ok=True)
        with open(FREQ_GUARD_PATH, "w", encoding="utf-8") as f:
            json.dump({"until": time.time() + seconds}, f)
    except OSError:
        pass


def freq_remaining():
    data = read_json(FREQ_GUARD_PATH, {}) or {}
    try:
        return max(0, int(float(data.get("until", 0)) - time.time()))
    except (TypeError, ValueError):
        return 0


def parse_url_sources(text):
    """把用户粘贴的内容拆成 (文章链接, RSS/Atom 地址, XML 原文)。

    - 每行一个 mp 文章链接；
    - 每行一个 RSS/Atom 订阅地址（非 mp 的 http(s) 链接）；
    - 或者整段 OPML/RSS XML（直接写成文件交给 collector 解析）。
    """
    text = (text or "").strip()
    if re.search(r"<opml[\s>]|<rss[\s>]", text, re.I):
        return [], [], text
    mp_links, rss, seen = [], [], set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for u in MP_LINK_RE.findall(line):
            if u not in seen:
                seen.add(u)
                mp_links.append(u)
        if not re.match(r"^https?://mp\.weixin\.qq\.com/s", line):
            if re.match(r"^https?://", line) and line not in seen:
                seen.add(line)
                rss.append(line)
    return mp_links, rss, ""


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
TRAE_JOB = Job("trae")


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
                        set_freq_guard()
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
        elif job.name == "trae":
            if code == 0:
                job.phase = "done"
            else:
                job.phase = "error"
                job.error = job.error or f"拆解闭环退出码 {code}（可能等待超时）"
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
        # 先本地拆解（补摘要/标签/主题），再生成工作台
        try:
            an = subprocess.run(
                [sys.executable, ANALYZE, "--quiet"], cwd=ROOT,
                capture_output=True, text=True, timeout=180)
            if an.returncode == 0:
                with STATE_LOCK:
                    COLLECT_JOB.lines.append("✓ " + (an.stdout.strip() or "本地拆解完成"))
        except (OSError, subprocess.TimeoutExpired) as e:
            with STATE_LOCK:
                COLLECT_JOB.lines.append(f"拆解跳过：{e}")
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
  textarea { font:inherit; padding:13px 14px; border:1px solid var(--line);
             border-radius:12px; width:100%; resize:vertical; }
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

  <section class="card" id="card-urls">
    <h2><span class="step">备</span>限流了？用文章链接也能采</h2>
    <div class="note">手机微信打开文章 → 右上角「…」→「复制链接」，一行一个粘贴到下面；也可以直接贴 RSS/Atom 订阅地址或 OPML 内容。这条路直接打开文章页抓正文，不经过被限流的列表接口。</div>
    <textarea id="urls" rows="4" placeholder="https://mp.weixin.qq.com/s/xxxxxxxx&#10;https://example.com/wechat-feed.xml（RSS 订阅源也行）"></textarea>
    <div class="row" style="margin-top:12px">
      <button id="btn-urls" disabled>用链接采集</button>
      <span class="note" id="urls-note" style="margin-top:0">已识别 0 篇文章</span>
    </div>
  </section>

  <section class="card hide" id="card-progress">
    <h2><span class="step">3</span>采集进度</h2>
    <div id="collect-msg" class="banner hide"></div>
    <pre class="log" id="log">等待开始…</pre>
    <div class="row" style="margin-top:14px">
      <button id="btn-retry" class="ghost hide">重试采集</button>
      <button id="btn-rebuild" class="ghost hide">重新拆解</button>
      <button id="btn-export" class="ghost hide">导出待拆解（发给 Trae）</button>
      <button id="btn-trae" class="ghost hide">一键闭环：导出 → 我拆 → 自动写回</button>
      <a id="open-workbench" class="open hide" href="/digest.html" target="_blank">
        <button>打开工作台</button>
      </a>
    </div>
    <div id="dropzone" class="hide" style="margin-top:12px;border:1.5px dashed #c9c9d2;border-radius:12px;padding:16px;text-align:center;color:#6b6b76;cursor:pointer">
      把 Trae 返回的 analysis.json 拖到这里，或点此选择文件
    </div>
    <input type="file" id="file-batch" accept="application/json,.json" style="display:none">
  </section>
</div>

<script>
const $ = (id) => document.getElementById(id);
let loginTimer = null, collectTimer = null, lastMode = 'account';

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
    $('btn-urls').disabled = false;
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
  lastMode = 'account';
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

// ── 备用：粘贴文章链接采集（不走列表接口）───────────────
$('urls').addEventListener('input', () => {
  const lines = $('urls').value.split('\\n').map(s => s.trim()).filter(Boolean);
  const arts = lines.filter(u => u.indexOf('mp.weixin.qq.com/s') >= 0).length;
  const feeds = lines.filter(u =>
    (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) &&
    u.indexOf('mp.weixin.qq.com/s') < 0).length;
  $('urls-note').textContent = '已识别 ' + arts + ' 篇文章' +
    (feeds ? '、' + feeds + ' 个订阅源' : '');
});
async function startUrls() {
  lastMode = 'urls';
  const text = $('urls').value.trim();
  if (!text) { alert('请先粘贴文章链接或 RSS 地址'); return; }
  $('btn-urls').disabled = true;
  $('card-progress').classList.remove('hide');
  $('log').textContent = '正在启动…';
  const r = await api('/api/collect-urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!r.ok) {
    showBanner($('collect-msg'), 'err', r.message);
    $('btn-urls').disabled = false;
    return;
  }
  pollCollect();
}
$('btn-urls').onclick = startUrls;
$('btn-retry').onclick = () => {
  $('btn-retry').classList.add('hide');
  $('collect-msg').classList.add('hide');
  $('open-workbench').classList.add('hide');
  if (lastMode === 'urls') startUrls(); else startCollect();
};
$('btn-rebuild').onclick = async () => {
  const btn = $('btn-rebuild');
  btn.disabled = true; btn.textContent = '拆解中…';
  showBanner($('collect-msg'), 'warn', '正在本地拆解并刷新工作台，请稍候…');
  try {
    const r = await api('/api/rebuild', { method: 'POST' });
    if (r.ok) {
      showBanner($('collect-msg'), 'ok', '拆解完成，工作台已刷新。');
      $('open-workbench').classList.remove('hide');
    } else {
      showBanner($('collect-msg'), 'err', '拆解失败：' + (r.message || '未知错误'));
    }
  } catch (e) {
    showBanner($('collect-msg'), 'err', '拆解失败：' + e);
  }
  btn.disabled = false; btn.textContent = '重新拆解';
};
$('btn-export').onclick = () => { window.location = '/export/pending.json'; };
let traeTimer = null;
$('btn-trae').onclick = async () => {
  const btn = $('btn-trae');
  btn.disabled = true; btn.textContent = '闭环进行中…';
  showBanner($('collect-msg'), 'warn', '正在导出批次…');
  try {
    const r = await api('/api/trae/start', { method: 'POST' });
    if (!r.ok) {
      showBanner($('collect-msg'), 'err', r.message || '启动失败');
      btn.disabled = false; btn.textContent = '一键闭环：导出 → 我拆 → 自动写回';
      return;
    }
    pollTrae();
  } catch (e) {
    showBanner($('collect-msg'), 'err', '启动失败：' + e);
    btn.disabled = false; btn.textContent = '一键闭环：导出 → 我拆 → 自动写回';
  }
};
async function pollTrae() {
  clearTimeout(traeTimer);
  const s = await api('/api/trae/status');
  $('log').textContent = (s.log && s.log.length) ? s.log.join('\\n') : '等待输出…';
  $('log').scrollTop = $('log').scrollHeight;
  const msg = $('collect-msg');
  if (s.phase === 'done') {
    showBanner(msg, 'ok', '拆解结果已写回，工作台已刷新。');
    $('open-workbench').classList.remove('hide');
    $('btn-trae').disabled = false;
    $('btn-trae').textContent = '一键闭环：导出 → 我拆 → 自动写回';
    return;
  }
  if (s.phase === 'error') {
    showBanner(msg, 'err', '闭环中断：' + (s.error || '等待超时，可重新点击'));
    $('btn-trae').disabled = false;
    $('btn-trae').textContent = '一键闭环：导出 → 我拆 → 自动写回';
    return;
  }
  showBanner(msg, 'warn',
    '① 把 loop/trae/outbox/wechat-batch.json 发到 Trae 对话；② 拿到 analysis.json 后保存到「下载」文件夹，我会自动写回。');
  traeTimer = setTimeout(pollTrae, 3000);
}
const dz = $('dropzone'), fileBatch = $('file-batch');
async function uploadBatch(file) {
  showBanner($('collect-msg'), 'warn', '正在导入拆解结果…');
  try {
    const batch = JSON.parse(await file.text());
    const r = await api('/api/apply-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch })
    });
    if (r.ok) {
      showBanner($('collect-msg'), 'ok', r.message || '已导入拆解结果，工作台已刷新。');
      $('open-workbench').classList.remove('hide');
    } else {
      showBanner($('collect-msg'), 'err', '导入失败：' + (r.message || '未知错误'));
    }
  } catch (e) {
    showBanner($('collect-msg'), 'err', '导入失败：文件不是有效的 JSON');
  }
}
dz.onclick = () => fileBatch.click();
fileBatch.onchange = () => { if (fileBatch.files[0]) uploadBatch(fileBatch.files[0]); };
dz.ondragover = (e) => e.preventDefault();
dz.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) uploadBatch(e.dataTransfer.files[0]); };
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
    const wait = s.freqRemaining || 0;
    if (wait > 0) {
      const mins = Math.max(1, Math.ceil(wait / 60));
      showBanner(msg, 'warn', '被微信频控（200013）。已自动锁定 ' + mins + ' 分钟，请勿反复点击；也可以现在用下方「链接采集」。');
      $('btn-retry').classList.add('hide');
      $('btn-collect').disabled = true;
      collectTimer = setTimeout(pollCollect, 30000);
    } else {
      showBanner(msg, 'warn', '冷却已结束，可以点「重试采集」再试一次（若仍失败就继续等）。');
      $('btn-retry').classList.remove('hide');
      $('btn-collect').disabled = false;
    }
    $('card-progress').classList.remove('hide');
    return;
  }
  if (s.phase === 'done') {
    showBanner(msg, 'ok', '采集完成，工作台已生成。');
    $('open-workbench').classList.remove('hide');
    $('btn-rebuild').classList.remove('hide');
    $('btn-export').classList.remove('hide');
    $('btn-trae').classList.remove('hide');
    $('dropzone').classList.remove('hide');
    $('btn-collect').disabled = false;
    $('btn-urls').disabled = false;
    return;
  }
  if (s.phase === 'error') {
    showBanner(msg, 'err', '出错了：' + (s.error || '请点重试'));
    $('btn-retry').classList.remove('hide');
    $('btn-collect').disabled = false;
    $('btn-urls').disabled = false;
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
    $('btn-urls').disabled = false;
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
  } else {
    const o = await api('/api/open');
    if (o.ok) {
      $('card-progress').classList.remove('hide');
      $('open-workbench').classList.remove('hide');
      $('btn-rebuild').classList.remove('hide');
      $('btn-export').classList.remove('hide');
      $('btn-trae').classList.remove('hide');
      $('dropzone').classList.remove('hide');
      if (!$('log').textContent.trim() || $('log').textContent === '等待开始…') {
        $('log').textContent = '已有历史知识库，可直接打开工作台，或点「重新拆解」刷新。';
      }
    }
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
        elif p == "/api/health":
            self._send(200, {"app": "wechat-loop", "ok": True})
        elif p == "/api/login/status":
            self._send(200, self._login_status())
        elif p == "/api/login/qr":
            self._serve_file(LOGIN_QR, "image/png")
        elif p == "/api/collect/status":
            snap = COLLECT_JOB.snapshot()
            snap["freqRemaining"] = freq_remaining()
            self._send(200, snap)
        elif p == "/api/trae/status":
            self._send(200, TRAE_JOB.snapshot())
        elif p == "/api/kb/stats":
            self._send(200, self._kb_stats())
        elif p == "/api/open":
            self._send(200, {
                "ok": os.path.exists(DIGEST_PATH),
                "path": DIGEST_PATH,
                "url": "/digest.html",
            })
        elif p == "/export/pending.json":
            out = os.path.join(ROOT, "loop", "export", "batch.json")
            try:
                r = subprocess.run(
                    [sys.executable, EXPORT, "--out", out], cwd=ROOT,
                    capture_output=True, text=True, timeout=60)
            except (OSError, subprocess.TimeoutExpired) as e:
                self._send(500, {"ok": False, "message": str(e)})
                return
            if r.returncode != 0 or not os.path.exists(out):
                self._send(500, {"ok": False,
                                 "message": (r.stderr or "导出失败").strip()[:300]})
                return
            with open(out, "rb") as f:
                data = f.read()
            self._send(200, data, "application/json; charset=utf-8", {
                "Content-Disposition": 'attachment; filename="wechat-batch.json"'})
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
        elif p == "/api/apply-batch":
            body = self._json_body()
            batch = body.get("batch")
            if not isinstance(batch, dict) or not isinstance(batch.get("articles"), dict):
                self._send(400, {"ok": False,
                                 "message": '文件格式不对：应包含 "articles": {"<id>": {...}}'})
                return
            os.makedirs(IMPORT_DIR, exist_ok=True)
            path = os.path.join(IMPORT_DIR,
                                "analysis_%s.json" % time.strftime("%Y%m%d_%H%M%S"))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(batch, f, ensure_ascii=False, indent=2)
            try:
                r = subprocess.run(
                    [sys.executable, os.path.join(SKILL_DIR, "kb.py"),
                     "--kb", KB_PATH, "apply", "--file", path],
                    cwd=SKILL_DIR, capture_output=True, text=True, timeout=120)
            except (OSError, subprocess.TimeoutExpired) as e:
                self._send(500, {"ok": False, "message": str(e)})
                return
            if r.returncode != 0:
                self._send(500, {"ok": False,
                                 "message": (r.stderr or r.stdout or "写回失败").strip()[:300]})
                return
            # 标记来源，导出时不再重复派给 agent
            data = read_json(KB_PATH, {}) or {}
            arts = data.get("articles") or {}
            for aid in batch["articles"]:
                if aid in arts:
                    arts[aid]["analysisSource"] = "agent"
            with open(KB_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            try:
                rd = subprocess.run([sys.executable, RENDER], cwd=SKILL_DIR,
                                    capture_output=True, text=True, timeout=120)
                if rd.returncode != 0:
                    self._send(500, {"ok": False,
                                     "message": "写回成功但刷新工作台失败：" +
                                                (rd.stderr or "").strip()[:200]})
                    return
            except (OSError, subprocess.TimeoutExpired) as e:
                self._send(500, {"ok": False, "message": "刷新工作台失败：%s" % e})
                return
            self._send(200, {"ok": True,
                             "message": (r.stdout or "").strip() or "已导入拆解结果"})
        elif p == "/api/trae/start":
            ok, msg = start_process(
                TRAE_JOB, [sys.executable, TRAE_LOOP, "run"], ROOT)
            self._send(200 if ok else 409, {"ok": ok, "message": msg})
        elif p == "/api/rebuild":
            ok, msgs = True, []
            try:
                an = subprocess.run(
                    [sys.executable, ANALYZE, "--all", "--quiet"], cwd=ROOT,
                    capture_output=True, text=True, timeout=180)
                if an.returncode != 0:
                    ok = False
                    msgs.append((an.stderr or "").strip()[:300])
                elif (an.stdout or "").strip():
                    msgs.append(an.stdout.strip())
                rd = subprocess.run(
                    [sys.executable, RENDER], cwd=SKILL_DIR,
                    capture_output=True, text=True, timeout=120)
                if rd.returncode != 0:
                    ok = False
                    msgs.append((rd.stderr or "").strip()[:300])
            except (OSError, subprocess.TimeoutExpired) as e:
                ok = False
                msgs.append(str(e))
            self._send(200 if ok else 500, {
                "ok": ok, "message": " / ".join(m for m in msgs if m)})
        elif p == "/api/collect-urls":
            body = self._json_body()
            text = str(body.get("text") or "")
            mp_links, rss, xml = parse_url_sources(text)
            if not (mp_links or rss or xml):
                self._send(400, {"ok": False,
                                 "message": "没识别到内容。请粘贴文章链接、RSS/Atom 订阅地址，或 OPML 文件内容。"})
                return
            if not os.path.exists(COLLECTOR):
                self._send(500, {"ok": False, "message": "缺少 wechat_collector.py"})
                return
            os.makedirs(URLS_DIR, exist_ok=True)
            stamp = time.strftime("%Y%m%d_%H%M%S")
            sources = []
            if mp_links:
                urls_file = os.path.join(URLS_DIR, "urls_%s.txt" % stamp)
                with open(urls_file, "w", encoding="utf-8") as f:
                    f.write("\n".join(mp_links[:50]) + "\n")
                sources.append(urls_file)
            if xml:
                opml_file = os.path.join(URLS_DIR, "feed_%s.opml" % stamp)
                with open(opml_file, "w", encoding="utf-8") as f:
                    f.write(xml)
                sources.append(opml_file)
            sources.extend(rss[:10])
            ok, msg = start_process(
                COLLECT_JOB,
                [sys.executable, COLLECTOR, "collect-urls", *sources],
                SKILL_DIR)
            self._send(200 if ok else 409, {
                "ok": ok, "message": msg,
                "count": len(mp_links), "feeds": len(rss)})
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
            wait = freq_remaining()
            if wait > 0:
                self._send(429, {
                    "ok": False,
                    "message": f"微信限流冷却中，还需约 {max(1, wait // 60)} 分钟，请稍后再试。",
                    "freqRemaining": wait,
                })
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


def _startup_backfill():
    """启动时给历史文章补拆解：有未拆解的条目就自动跑一次并刷新工作台。"""
    if not os.path.exists(KB_PATH):
        return
    data = read_json(KB_PATH, {}) or {}
    arts = data.get("articles") or {}
    if not any(not a.get("analyzedAt") for a in arts.values()):
        return
    try:
        an = subprocess.run([sys.executable, ANALYZE, "--quiet"], cwd=ROOT,
                            capture_output=True, text=True, timeout=180)
        if an.returncode != 0:
            print(f"启动补拆解失败：{(an.stderr or '').strip()[:200]}")
            return
        subprocess.run([sys.executable, RENDER], cwd=SKILL_DIR,
                       capture_output=True, text=True, timeout=120)
        print("✓ 已为历史文章补做本地拆解，并刷新工作台")
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"启动补拆解跳过：{e}")


def _wizard_running(url):
    """端口是否已经跑着本向导（而不是别的程序）。"""
    try:
        with urllib.request.urlopen(url + "api/health", timeout=1.5) as resp:
            if getattr(resp, "status", 200) != 200:
                return False
            data = json.loads(resp.read().decode("utf-8", "replace"))
            return data.get("app") == "wechat-loop"
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser(
        prog="wizard_server.py", description="公众号采集本地向导（网页版）")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    ap.add_argument("--port", type=int, default=8787, help="端口（默认 8787）")
    ap.add_argument("--open", action="store_true", help="启动后自动用浏览器打开向导页")
    args = ap.parse_args()

    # 端口被占时：先看是不是“上一次没关掉的向导”，是就直接复用，避免用户一脸懵。
    httpd = None
    last_err = None
    for port in range(args.port, args.port + 10):
        try:
            httpd = ThreadingHTTPServer((args.host, port), Handler)
            break
        except OSError as e:
            last_err = e
            existing = f"http://{args.host}:{port}/"
            if _wizard_running(existing):
                print(f"向导已经在运行：{existing}")
                print("已为你打开页面；要重启的话，先关掉旧的那个终端窗口。")
                webbrowser.open(existing)
                return
    if httpd is None:
        sys.exit(f"端口 {args.port}-{args.port + 9} 都被占用：{last_err}")

    url = f"http://{args.host}:{httpd.server_address[1]}/"
    print(f"向导已启动： {url}")
    if port != args.port:
        print(f"（{args.port} 被占用，自动改用 {port}）")
    print("按 Ctrl+C 退出。")
    threading.Thread(target=_startup_backfill, daemon=True).start()
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
