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
import time
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
        raw = base64.b64decode(
            p + "=" * (-len(p) % 4), altchars=b"-_", validate=True
        ).decode("utf-8")
    except Exception:
        return jsonify({"error": "p 不是合法的 base64url"}), 400
    if not raw.strip():
        return jsonify({"error": "p 解码后为空"}), 400

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
        _rewrite_media_urls(target.read_text(encoding="utf-8", errors="ignore")),
        mimetype="text/html",
    )


# ---- 图片代理 ----
# 公众号图片（mmbiz.qpic.cn）有防盗链：Referer 不是 mp.weixin.qq.com 时，
# 微信会返回「此图片来自微信公众平台 未经允许不可引用」的占位图。
# 正文里的图片还普遍是 <img data-src="..."> 懒加载，没有 JS 就永远不加载。
# 这里统一改写成走本机代理，由后端带上 Referer 去取。
IMG_CACHE_DIR = LOOP_ROOT / "loop" / ".imgcache"
# 只代理「图片 CDN」，不要把 weixin.qq.com 这类 HTML 页面也算进来：
# 正文里嵌的视频/名片是 <iframe src="https://mp.weixin.qq.com/...">，
# 之前一改写就会拉回一整页 HTML 甚至 JSON 错误，直接显示在正文中间。
IMG_ALLOW_HOSTS = (
    ".qpic.cn",
    ".qlogo.cn",
    ".gtimg.com",
)


def _b64url(raw: str) -> str:
    import base64

    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def _proxy_url(url: str) -> str:
    return "/api/image-proxy?u=" + _b64url(url)


def _host_allowed(host: str) -> bool:
    host = (host or "").lower()
    return any(host == h.lstrip(".") or host.endswith(h) for h in IMG_ALLOW_HOSTS)


def _rewrite_media_urls(html: str) -> str:
    """把正文里的微信图片地址改写成 /api/image-proxy，并补上 src 让懒加载图显形

    要覆盖公众号正文里真实出现的几种写法：
      - src / data-src，单双引号都可能
      - 协议相对地址 //mmbiz.qpic.cn/...（正文里非常常见）
      - style="background-image:url(...)"，引号可能被转义成 &quot;
    """
    import re

    def proxy_if_allowed(url: str) -> str | None:
        from urllib.parse import urlparse

        raw = (url or "").strip().replace("&amp;", "&")
        if raw.startswith("//"):
            raw = "https:" + raw
        try:
            parsed = urlparse(raw)
        except Exception:
            return None
        if parsed.scheme not in ("http", "https") or not _host_allowed(parsed.hostname or ""):
            return None
        return _proxy_url(raw)

    def set_attr(tag: str, name: str, value: str) -> str:
        # (?<![-\w]) 防止匹配到 data-src 里头的 src
        return re.sub(
            r"((?<![-\w])" + name + r"\s*=\s*)([\"']).*?\2",
            lambda m: f"{m.group(1)}{m.group(2)}{value}{m.group(2)}",
            tag,
            count=1,
            flags=re.IGNORECASE | re.DOTALL,
        )

    def fix_img(match: "re.Match") -> str:
        tag = match.group(0)
        lazy = re.search(r'data-src\s*=\s*(["\'])(.*?)\1', tag, re.IGNORECASE | re.DOTALL)
        src = re.search(r'\ssrc\s*=\s*(["\'])(.*?)\1', tag, re.IGNORECASE | re.DOTALL)
        source = (lazy.group(2) if lazy else "") or (src.group(2) if src else "")
        proxied = proxy_if_allowed(source)
        if not proxied:
            return tag
        if lazy:
            tag = set_attr(tag, "data-src", proxied)
        if src:
            tag = set_attr(tag, "src", proxied)
        elif tag.endswith("/>"):
            tag = tag[:-2].rstrip() + f' src="{proxied}"/>'
        elif tag.endswith(">"):
            tag = tag[:-1].rstrip() + f' src="{proxied}">'
        # 懒加载图常见 class 是 opacity:0，直接抹掉让图可见
        tag = re.sub(
            r'\s*style\s*=\s*["\'][^"\']*(?:opacity\s*:\s*0|visibility\s*:\s*hidden)[^"\']*["\']',
            "",
            tag,
            flags=re.IGNORECASE,
        )
        return tag

    html = re.sub(r"<img\b[^>]*>", fix_img, html, flags=re.IGNORECASE)

    # 其余 src / data-src / poster / media 一律走代理（含单引号与协议相对写法）
    def repl_attr(m: "re.Match") -> str:
        attr, quote, url = m.group(1), m.group(2), m.group(3)
        proxied = proxy_if_allowed(url)
        if not proxied:
            return m.group(0)
        return f"{attr}={quote}{proxied}{quote}"

    html = re.sub(
        r"\b(src|data-src|poster|media)\s*=\s*([\"'])((?:https?:)?//[^\"']+)\2",
        repl_attr,
        html,
        flags=re.IGNORECASE,
    )

    # 背景图：兼容 url('...') / url("...") / url(&quot;...&quot;) / url(//...)
    def repl_bg(m: "re.Match") -> str:
        proxied = proxy_if_allowed(m.group(2))
        if not proxied:
            return m.group(0)
        return f"{m.group(1)}url('{proxied}')"

    html = re.sub(
        r"(background-image\s*:\s*)"
        r"url\(\s*(?:&quot;|&#39;|&apos;|[\"'])?\s*"
        r"((?:https?:)?//[^)\"'&\s]+)"
        r"\s*(?:&quot;|&#39;|&apos;|[\"'])?\s*\)",
        repl_bg,
        html,
        flags=re.IGNORECASE,
    )
    return html


@app.route("/api/image-proxy", methods=["GET"])
def image_proxy():
    """带 Referer 拉取微信图片，并在本地落盘缓存"""
    import base64
    import hashlib
    import mimetypes
    import urllib.request
    from urllib.parse import urlparse

    from flask import Response, jsonify, request

    u = request.args.get("u", "")
    if not u:
        return jsonify({"error": "缺少 u 参数"}), 400
    try:
        url = base64.b64decode(u + "=" * (-len(u) % 4), altchars=b"-_", validate=True).decode("utf-8")
    except Exception:
        return jsonify({"error": "u 不是合法的 base64url"}), 400

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not _host_allowed(parsed.hostname or ""):
        return jsonify({"error": "只代理微信图片域名"}), 403

    key = hashlib.sha1(url.encode("utf-8")).hexdigest()
    IMG_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ext = ".img"

    # 命中缓存直接回
    for cached in IMG_CACHE_DIR.glob(f"{key}.*"):
        ext = cached.suffix
        return Response(
            cached.read_bytes(),
            mimetype=mimetypes.guess_type(f"x{ext}")[0] or "image/jpeg",
            headers={"Cache-Control": "public, max-age=604800"},
        )

    req_headers = {
        "Referer": "https://mp.weixin.qq.com/",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    data, ctype = _download_image(url, req_headers)
    if data is None:
        # 失败时回 1x1 透明图：正文里只会留一块空白，不会把 JSON 错误糊在页面上
        return Response(
            BLANK_GIF,
            mimetype="image/gif",
            headers={"Cache-Control": "no-store"},
        )

    if not ctype.startswith("image/"):
        ctype = mimetypes.guess_type(parsed.path)[0] or "image/jpeg"
    ext = mimetypes.guess_extension(ctype.split("/")[-1]) or ".jpg"
    try:
        (IMG_CACHE_DIR / f"{key}{ext}").write_bytes(data)
    except Exception:
        pass  # 缓存失败不影响返回

    return Response(data, mimetype=ctype, headers={"Cache-Control": "public, max-age=604800"})


# 1x1 透明 gif，用于图片拉取失败时的占位
BLANK_GIF = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!"
    b"\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00"
    b"\x00\x02\x02D\x01\x00;"
)


def _download_image(url: str, headers: dict) -> tuple[bytes | None, str]:
    """取图片字节。

    macOS 上 python.org 安装的 Python 经常没有根证书，走 https 会直接
    CERTIFICATE_VERIFY_FAILED。这里先试校验证书，失败再降级成不校验
    （只用于取公众号图片，不涉及敏感数据），两种都失败才算真的失败。
    """
    try:
        import requests

        for verify in (True, False):
            try:
                resp = requests.get(url, headers=headers, timeout=20, verify=verify)
                if resp.status_code >= 400:
                    continue
                return resp.content, (resp.headers.get("Content-Type") or "").split(";")[0].strip()
            except requests.exceptions.SSLError:
                continue  # 证书问题，换不校验再试
            except Exception:
                break  # 网络问题，别死循环
    except ImportError:
        pass

    # requests 不可用时退回 urllib，同样带一次不校验的重试
    import ssl
    import urllib.request

    for context in (None, ssl._create_unverified_context()):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20, context=context) as resp:
                return resp.read(), (resp.headers.get("Content-Type") or "").split(";")[0].strip()
        except ssl.SSLError:
            continue
        except Exception:
            break
    return None, ""


# ---- 后端自检 ----
BRIDGE_FEATURES = ("kb", "article-html", "image-proxy", "proxy-fetch-free")


@app.route("/api/bridge/health", methods=["GET"])
def bridge_health():
    """判断后端是否已经重启到最新代码：前端据此提示「需重启后端」"""
    import subprocess

    from flask import jsonify

    rev = ""
    try:
        rev = (
            subprocess.run(
                ["git", "-C", str(Path(__file__).resolve().parent.parent), "rev-parse", "--short", "HEAD"],
                capture_output=True,
                text=True,
                timeout=3,
            ).stdout.strip()
        )
    except Exception:
        rev = ""

    rules = {str(r) for r in app.url_map.iter_rules()}
    expected = {
        "kb": "/api/kb",
        "article-html": "/api/article-html",
        "image-proxy": "/api/image-proxy",
        "proxy-fetch-free": "/api/proxy/fetch-free",
    }
    missing = [name for name, rule in expected.items() if rule not in rules]
    return jsonify({"ok": not missing, "revision": rev, "features": list(BRIDGE_FEATURES), "missing": missing})


# ---- 免费代理抓取 ----
FREE_PROXY_SOURCES = (
    # 都是公开维护的免费代理清单，格式为 host:port 纯文本
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=yes&anonymity=all",
)


@app.route("/api/proxy/fetch-free", methods=["POST"])
def proxy_fetch_free():
    """从公开清单抓一批免费代理，逐个测活后只返回可用的

    免费代理生命周期通常只有几小时到几天，失效是常态，
    所以这里做成「现抓现测」，而不是提前存一份死的清单。
    """
    import concurrent.futures

    import requests
    from flask import jsonify, request

    limit = int((request.get_json(silent=True) or {}).get("limit") or 40)
    candidates: list[dict] = []
    errors: list[str] = []

    for src in FREE_PROXY_SOURCES:
        try:
            resp = requests.get(src, timeout=12, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            for line in resp.text.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                host, _, port = line.rpartition(":")
                if not host or not port.isdigit():
                    continue
                candidates.append({"type": "http", "host": host.strip(), "port": port})
        except Exception as exc:
            errors.append(f"{src.split('/')[2]}: {exc}")

    # 去重后只测前 limit 个，避免一次开几百个连接
    seen, picked = set(), []
    for item in candidates:
        key = f"{item['host']}:{item['port']}"
        if key in seen:
            continue
        seen.add(key)
        picked.append(item)
        if len(picked) >= limit:
            break

    def probe(item: dict) -> dict | None:
        url = f"http://{item['host']}:{item['port']}"
        try:
            start = time.time()
            resp = requests.get(
                "https://api.ipify.org?format=json",
                proxies={"http": url, "https": url},
                timeout=6,
            )
            resp.raise_for_status()
            ip = (resp.json() or {}).get("ip", "")
            return {**item, "latency": round((time.time() - start) * 1000), "exit_ip": ip}
        except Exception:
            return None

    alive: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for result in pool.map(probe, picked):
            if result:
                alive.append(result)

    alive.sort(key=lambda x: x["latency"])
    return jsonify(
        {
            "total_scanned": len(picked),
            "alive": alive,
            "message": f"抓取 {len(picked)} 个，可用 {len(alive)} 个",
            "errors": errors,
        }
    )


def _selfcheck_image_tls() -> None:
    """启动时探测微信图片 CDN，证书链有问题就当场提示，别等到看文章才发现全是空白"""
    try:
        import requests
    except Exception:
        return
    try:
        requests.get(
            "https://mmbiz.qpic.cn/",
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://mp.weixin.qq.com/"},
        )
        print("[bridge] 自检：微信图片 CDN 连接正常")
    except Exception as exc:
        name = type(exc).__name__
        if "SSL" in name or "SSL" in str(exc) or "Certificate" in str(exc):
            print("[bridge] ⚠ 自检失败：HTTPS 根证书缺失，正文图片会全部取不到")
            print("[bridge]   修复：在 Finder 里打开 /Applications/Python 3.12/ 双击 Install Certificates.command")
            print("[bridge]   （运行时已自动降级为不校验证书，图片通常仍能显示，此提示可忽略）")
        else:
            print(f"[bridge] 自检：微信图片 CDN 暂时连不上（{name}），不影响其它功能")


if __name__ == "__main__":
    # 复用 wechat-mp-tools 的端口，5200
    port = int(os.environ.get("MP_PORT", "5200"))
    print(f"[bridge] 启动 wechat-loop bridge + wechat-mp-tools 于 127.0.0.1:{port}")
    print("[bridge] 新增端点：GET /api/kb, POST /api/kb, POST /api/kb/active")
    _selfcheck_image_tls()
    app.run(host="127.0.0.1", port=port, debug=False)
