#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Trae 拆解闭环：导出待拆解批次 → 交给 Trae → 自动检测返回文件 → 写回并刷新工作台。

用法：
  python3 scripts/trae_loop.py run                 # 导出并等待（默认 30 分钟）
  python3 scripts/trae_loop.py export              # 只导出
  python3 scripts/trae_loop.py apply analysis.json # 手动写回一个文件

能自动完成：导出、检测返回文件、校验、写回知识库、刷新工作台。
无法自动完成：「把文件发给 Trae 并拿到回复」这一步必须经过对话，脚本只能等。

目录约定：
  loop/trae/outbox/   导出的批次（发给我）
  loop/trae/return/   你也可以把 Trae 的回复放这里
  loop/trae/inbox/    写回前的存档
  loop/trae/applied/  已写回的文件
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "wechat-digest-skill")
KB_PATH = os.path.join(SKILL_DIR, "output", "knowledge_base.json")
EXPORT = os.path.join(ROOT, "scripts", "export_batch.py")
RENDER = os.path.join(ROOT, "scripts", "render_workbench.py")

TRAE_DIR = os.path.join(ROOT, "loop", "trae")
OUTBOX = os.path.join(TRAE_DIR, "outbox")
RETURN = os.path.join(TRAE_DIR, "return")
INBOX = os.path.join(TRAE_DIR, "inbox")
APPLIED = os.path.join(TRAE_DIR, "applied")

try:  # Windows 控制台可能是 GBK，避免打印中文直接崩
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def say(msg):
    print(msg, flush=True)


def stamp():
    return time.strftime("%Y%m%d_%H%M%S")


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ════════════════════════════════════════════════════════════════
#  1. 导出
# ════════════════════════════════════════════════════════════════

def export_batch(limit=20):
    os.makedirs(OUTBOX, exist_ok=True)
    out = os.path.join(OUTBOX, "wechat-batch.json")
    r = subprocess.run(
        [sys.executable, EXPORT, "--out", out, "--limit", str(limit)],
        cwd=ROOT, capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError((r.stderr or r.stdout or "导出失败").strip()[:400])
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"ok": True, "path": out, "count": 0}


# ════════════════════════════════════════════════════════════════
#  2. 校验返回文件
# ════════════════════════════════════════════════════════════════

def normalize(obj):
    """接受 {batch:{...}} 或直接 {articles:{...}}，返回合法 batch 或 None。"""
    if not isinstance(obj, dict):
        return None
    data = obj.get("batch") if isinstance(obj.get("batch"), dict) else obj
    articles = data.get("articles")
    if not isinstance(articles, dict) or not articles:
        return None
    good = {}
    for aid, rec in articles.items():
        if not isinstance(rec, dict):
            continue
        an = rec.get("analysis")
        if not isinstance(an, dict):
            continue
        if str(an.get("summary") or "").strip() or an.get("tags"):
            good[str(aid)] = rec
    if not good:
        return None
    out = {"articles": good}
    if isinstance(data.get("topics"), list):
        out["topics"] = data["topics"]
    return out


def pending_ids():
    try:
        data = read_json(KB_PATH)
    except (OSError, ValueError):
        return set()
    return {aid for aid, a in (data.get("articles") or {}).items()
            if a.get("analysisSource") != "agent"}


# ════════════════════════════════════════════════════════════════
#  3. 写回
# ════════════════════════════════════════════════════════════════

def apply_file(path):
    """写回一个拆解结果文件。返回 (ok, message)。"""
    try:
        batch = normalize(read_json(path))
    except (OSError, ValueError) as e:
        return False, "不是有效的 JSON：%s" % e
    if not batch:
        return False, "格式不符：需要 {\"articles\": {\"<id>\": {analysis:{...}}}}"

    try:
        kb_data = read_json(KB_PATH)
    except (OSError, ValueError):
        return False, "读不到知识库，请先采一篇文章"
    known = set((kb_data.get("articles") or {}).keys())
    hit = {k: v for k, v in batch["articles"].items() if k in known}
    if not hit:
        return False, "文件里的文章 id 都不在知识库里（可能来自另一次采集）"
    batch["articles"] = hit

    os.makedirs(INBOX, exist_ok=True)
    inbox = os.path.join(INBOX, "analysis_%s.json" % stamp())
    write_json(inbox, batch)

    r = subprocess.run(
        [sys.executable, os.path.join(SKILL_DIR, "kb.py"), "--kb", KB_PATH,
         "apply", "--file", inbox],
        cwd=SKILL_DIR, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        return False, (r.stderr or r.stdout or "写入知识库失败").strip()[:300]

    # 标记为 agent 拆解，避免下次重复导出
    data = read_json(KB_PATH)
    for aid in hit:
        if aid in (data.get("articles") or {}):
            data["articles"][aid]["analysisSource"] = "agent"
    write_json(KB_PATH, data)

    rd = subprocess.run([sys.executable, RENDER], cwd=SKILL_DIR,
                        capture_output=True, text=True, timeout=180)
    if rd.returncode != 0:
        return False, "已写入，但刷新工作台失败：" + (rd.stderr or "").strip()[:200]

    os.makedirs(APPLIED, exist_ok=True)
    shutil.move(path, os.path.join(APPLIED, "%s_%s" % (stamp(), os.path.basename(path))))
    return True, "写回 %d 篇，工作台已刷新" % len(hit)


# ════════════════════════════════════════════════════════════════
#  4. 等待
# ════════════════════════════════════════════════════════════════

def candidates(dirs, since, seen):
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for name in names:
            if not name.lower().endswith(".json") or name.startswith("."):
                continue
            p = os.path.join(d, name)
            try:
                if os.path.getmtime(p) < since - 2:
                    continue
                with open(p, "rb") as f:
                    raw = f.read()
            except OSError:
                continue
            h = hashlib.sha1(raw).hexdigest()
            if h in seen:
                continue
            seen.add(h)
            yield p


def wait_and_apply(dirs, timeout, interval):
    start = time.time()
    deadline = start + timeout
    seen = set()
    pending = pending_ids()
    say("等待拆解结果…（%d 篇待写回，最多等 %d 分钟）" % (len(pending), timeout // 60))
    say("把 Trae 返回的 analysis.json 存到「下载」文件夹，或放进：%s" % RETURN)
    last_tick = time.time()
    while time.time() < deadline:
        for path in candidates(dirs, start, seen):
            say("发现文件：%s" % path)
            ok, msg = apply_file(path)
            say(("✓ " if ok else "✗ ") + msg)
            if ok:
                pending = pending_ids()
                if not pending:
                    say("全部拆解完成。")
                    return 0
        if time.time() - last_tick >= 30:
            last_tick = time.time()
            say("…仍在等待（剩余 %d 分钟）" % max(0, int((deadline - time.time()) // 60)))
        time.sleep(interval)
    say("等待超时。已导出的批次仍在：%s" % os.path.join(OUTBOX, "wechat-batch.json"))
    return 4


def downloads_dir():
    p = os.path.expanduser("~/Downloads")
    return p if os.path.isdir(p) else ""


def main():
    ap = argparse.ArgumentParser(prog="trae_loop.py",
                                 description="导出→交给 Trae→自动写回的闭环脚本")
    ap.add_argument("cmd", nargs="?", default="run",
                    choices=["run", "export", "apply"])
    ap.add_argument("file", nargs="?", help="apply 时的 JSON 文件")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--timeout", type=int, default=1800, help="等待秒数（默认 1800）")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--no-downloads", action="store_true", help="不扫描「下载」文件夹")
    args = ap.parse_args()

    os.makedirs(RETURN, exist_ok=True)

    if args.cmd == "apply":
        if not args.file:
            sys.exit("用法：trae_loop.py apply analysis.json")
        ok, msg = apply_file(os.path.abspath(args.file))
        say(("✓ " if ok else "✗ ") + msg)
        return 0 if ok else 1

    info = export_batch(args.limit)
    say("✓ 已导出 %d 篇：%s" % (info.get("count", 0), info.get("path", "")))
    if args.cmd == "export":
        return 0
    if not info.get("count"):
        say("没有待拆解的文章。")
        return 0

    say("下一步：把这个文件发到 Trae 对话，让我按里面的 instructions 拆解；")
    say("拿到 analysis.json 后保存到「下载」文件夹即可，我会自动写回。")
    dirs = [RETURN] + ([] if args.no_downloads else [downloads_dir()])
    return wait_and_apply(dirs, args.timeout, args.interval)


if __name__ == "__main__":
    sys.exit(main())
