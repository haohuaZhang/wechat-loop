"""
bridge.py —— 在 wechat-mp-tools Flask app 上追加 wechat-loop 专属端点

不修改上游源码，通过 import app_mp.app 并追加路由实现。
启动：python3 backend/bridge.py → 127.0.0.1:5200（与 wechat-mp-tools 同端口）

新增端点：
  GET  /api/kb           列出所有知识库（loop/knowledge_base.json + loop/kb/*.json）
  POST /api/kb           新增知识库
  POST /api/kb/active    切换活动知识库

复用上游已有端点（前端 api/client.js 已适配）：
  GET  /api/articles/history                      下载历史（任务列表）
  GET  /api/articles/download-status/<task_id>    轮询采集进度
  POST /api/accounts/search                       搜索公众号
  POST /api/articles/collect-latest               启动采集
  GET  /api/articles/list/<fakeid>                文章列表
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# 把 wechat-mp-tools 加入 sys.path —— 不修改上游源码
WMT_DIR = Path(__file__).resolve().parent.parent / "wechat-mp-tools"
if str(WMT_DIR) not in sys.path:
    sys.path.insert(0, str(WMT_DIR))

from app_mp import app  # noqa: E402  —— 导入 Flask app（上游只读）

# ---- 知识库数据源 ----
LOOP_ROOT = Path(__file__).resolve().parent.parent.parent
KB_DIR = LOOP_ROOT / "loop"
MAIN_KB = KB_DIR / "knowledge_base.json"
ACTIVE_KB_FILE = KB_DIR / ".active_kb"  # 记录当前活动的 KB id


def _ensure_dirs() -> None:
    KB_DIR.mkdir(parents=True, exist_ok=True)
    (KB_DIR / "kb").mkdir(parents=True, exist_ok=True)


def _load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _discover_kbs() -> list[dict]:
    """扫描 loop/ 目录下所有知识库文件"""
    _ensure_dirs()
    active_id = ACTIVE_KB_FILE.read_text(encoding="utf-8").strip() if ACTIVE_KB_FILE.exists() else "default"
    kbs = []

    # 主知识库
    main_count = len(_load_json(MAIN_KB, [])) if MAIN_KB.exists() else 0
    kbs.append({
        "id": "default",
        "name": "主知识库",
        "path": "loop/knowledge_base.json",
        "isActive": active_id == "default",
        "articleCount": main_count,
    })

    # loop/kb/*.json —— 用户自建
    kb_sub_dir = KB_DIR / "kb"
    for f in sorted(kb_sub_dir.glob("*.json")):
        kb_id = f.stem
        count = len(_load_json(f, []))
        kbs.append({
            "id": kb_id,
            "name": kb_id,  # 用户自定义名称
            "path": f"loop/kb/{f.name}",
            "isActive": active_id == kb_id,
            "articleCount": count,
        })

    # 如果没有任何 active，把主知识库设为 active
    if not any(k["isActive"] for k in kbs):
        for k in kbs:
            if k["id"] == "default":
                k["isActive"] = True
                break
        ACTIVE_KB_FILE.write_text("default", encoding="utf-8")

    return kbs


# ---- 追加路由 ----

@app.route("/api/kb", methods=["GET"])
def list_knowledge_bases():
    """列出所有知识库"""
    from flask import jsonify
    try:
        return jsonify(_discover_kbs())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb/active", methods=["POST"])
def set_active_knowledge_base():
    """切换活动知识库"""
    from flask import jsonify, request
    try:
        body = request.get_json(silent=True) or {}
        kb_id = body.get("id")
        if not kb_id:
            return jsonify({"error": "缺少 id 参数"}), 400
        _ensure_dirs()
        ACTIVE_KB_FILE.write_text(kb_id, encoding="utf-8")
        return jsonify({"ok": True, "active": kb_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/kb", methods=["POST"])
def create_knowledge_base():
    """新增知识库"""
    from flask import jsonify, request
    try:
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        path_str = (body.get("path") or "").strip()
        if not name or not path_str:
            return jsonify({"error": "缺少 name 或 path 参数"}), 400

        # 安全校验：路径必须在 loop/ 下，且是 .json
        if not path_str.startswith("loop/") or not path_str.endswith(".json"):
            return jsonify({"error": "路径必须以 loop/ 开头且以 .json 结尾"}), 400

        full_path = LOOP_ROOT / path_str
        if full_path.exists():
            return jsonify({"error": f"知识库文件已存在：{path_str}"}), 409

        full_path.parent.mkdir(parents=True, exist_ok=True)
        _save_json(full_path, [])

        kb_id = full_path.stem
        return jsonify({
            "id": kb_id,
            "name": name,
            "path": path_str,
            "isActive": False,
            "articleCount": 0,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/article-html", methods=["GET"])
def article_html():
    """按 base64url 路径返回已下载文章的 HTML 正文。

    为什么不用上游的 /api/articles/serve-file：实测浏览器对 URL 路径里
    百分号编码的中文（%E6%B5%8B…）一律返回 400，而 curl 直连是 200。
    公众号下载目录基本都带中文名，所以这里把路径整体 base64url，URL 里
    只剩下 ASCII。
    """
    import base64
    from pathlib import Path
    from flask import Response, jsonify, request

    p = request.args.get("p", "")
    if not p:
        return jsonify({"error": "缺少 p 参数"}), 400
    try:
        raw = base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)).decode("utf-8")
    except Exception:
        return jsonify({"error": "p 不是合法的 base64url"}), 400

    from backend.config import OUTPUT_DIR, get_settings

    out_root = Path(OUTPUT_DIR).resolve()
    dl_root = Path(str(get_settings().get("download_dir") or OUTPUT_DIR)).resolve()

    target = Path(raw)
    try:
        target = target.resolve()
    except Exception:
        pass

    def _inside(path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    if not (_inside(target, out_root) or _inside(target, dl_root)):
        return jsonify({"error": "路径不在下载目录内"}), 403

    if target.is_dir():
        htmls = sorted(target.glob("*.html"))
        if not htmls:
            return jsonify({"error": "目录下没有 html 正文"}), 404
        target = htmls[0]

    if not target.is_file():
        return jsonify({"error": "文件不存在"}), 404

    return Response(
        target.read_text(encoding="utf-8", errors="ignore"),
        mimetype="text/html",
    )


if __name__ == "__main__":
    # 复用 wechat-mp-tools 的端口，5200
    import os
    port = int(os.environ.get("MP_PORT", "5200"))
    print(f"[bridge] 启动 wechat-loop bridge + wechat-mp-tools 于 127.0.0.1:{port}")
    print("[bridge] 新增端点：GET /api/kb, POST /api/kb, POST /api/kb/active")
    app.run(host="127.0.0.1", port=port, debug=False)
