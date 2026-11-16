#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通过 MCP 调用 wechatDownload 5.0（第三方免费闭源工具）。

它本地会起一个 MCP 服务，默认地址 http://127.0.0.1:4545/mcp，提供：
  single_article_download   下载单篇文章
  get_public_account_id     获取公众号凭证（需在微信里打开生成的链接）
  batch_download_articles   批量下载该号全部文章（按软件里设置的日期/筛选）
  export_article_data       导出文章元数据 CSV

前提：
  1. 在 Windows 上安装并运行 wechatDownload 5.0；
  2. 软件设置里勾选「启动MCP」，日志出现 4545 端口监听；
  3. Mac 版不支持 get_public_account_id，批量下载只能在 Windows 上完成。

用法：
  python3 scripts/wechatdownload_mcp.py probe
  python3 scripts/wechatdownload_mcp.py account --url https://mp.weixin.qq.com/s/xxxx
  python3 scripts/wechatdownload_mcp.py batch
  python3 scripts/wechatdownload_mcp.py export
  python3 scripts/wechatdownload_mcp.py single --url https://mp.weixin.qq.com/s/xxxx
  python3 scripts/wechatdownload_mcp.py call <tool> --args-json '{}'

说明：batch 只是「触发」下载，进度和筛选条件都在 wechatDownload 界面里；
文件落在它自己的下载目录（按公众号名分文件夹），导出的 md/html 可再用导入器入库。
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

DEFAULT_ENDPOINT = "http://127.0.0.1:4545/mcp"
REMOTE_ENDPOINT = "https://changfengbox.top/api/mcp"

SECRET_KEY_RE = re.compile(r"(token|key|cookie|secret|pass|ticket)", re.I)
URL_RE = re.compile(r"https?://[^\s\"'<>]+")


class McpError(RuntimeError):
    pass


class McpClient(object):
    """极简 MCP over HTTP 客户端，只用标准库。"""

    def __init__(self, endpoint=DEFAULT_ENDPOINT, timeout=30):
        self.endpoint = endpoint
        self.timeout = timeout
        self.session_id = None
        self._id = 0

    def _next_id(self):
        self._id += 1
        return self._id

    def _post(self, payload):
        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(
            self.endpoint, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                sid = resp.headers.get("Mcp-Session-Id")
                if sid:
                    self.session_id = sid
                ctype = resp.headers.get("Content-Type", "") or ""
                raw = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:400]
            raise McpError("HTTP %s：%s" % (e.code, body))
        except urllib.error.URLError as e:
            raise McpError(
                "连不上 %s（%s）。\n"
                "请确认：1) wechatDownload 已启动；2) 设置里勾选了「启动MCP」；"
                "3) 端口是 4545。" % (self.endpoint, e.reason))
        if not raw.strip():
            return None
        if "text/event-stream" in ctype:
            return self._parse_sse(raw)
        return json.loads(raw)

    @staticmethod
    def _parse_sse(raw):
        last = None
        for line in raw.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if not chunk or chunk == "[DONE]":
                continue
            try:
                last = json.loads(chunk)
            except ValueError:
                continue
        if last is None:
            raise McpError("服务返回了 SSE，但没有可解析的 JSON 数据。")
        return last

    def request(self, method, params=None):
        payload = {"jsonrpc": "2.0", "id": self._next_id(), "method": method}
        if params is not None:
            payload["params"] = params
        resp = self._post(payload)
        if not isinstance(resp, dict):
            raise McpError("返回内容不是 JSON 对象：%r" % (resp,))
        err = resp.get("error")
        if err:
            raise McpError("服务返回错误 %s：%s" % (
                err.get("code"), err.get("message")))
        return resp.get("result")

    def initialize(self):
        result = self.request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "wechat-loop", "version": "1.0"},
        })
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except McpError:
            pass
        return result

    def list_tools(self):
        result = self.request("tools/list", {}) or {}
        return result.get("tools") or []

    def call_tool(self, name, arguments):
        return self.request("tools/call", {"name": name, "arguments": arguments})


def result_text(result):
    """从 tools/call 结果里取出文本。"""
    if result is None:
        return ""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        parts = []
        for item in result.get("content") or []:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        if parts:
            return "\n".join(parts)
    return json.dumps(result, ensure_ascii=False, indent=2)


def mask(value):
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if isinstance(v, str) and SECRET_KEY_RE.search(str(k)) and len(v) > 12:
                out[k] = v[:4] + "***" + v[-4:]
            else:
                out[k] = mask(v)
        return out
    if isinstance(value, list):
        return [mask(v) for v in value]
    if isinstance(value, str) and len(value) > 200:
        return value[:200] + "…"
    return value


def show(result, as_json=False):
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return ""
    return result_text(result)


def cmd_probe(client, args):
    client.initialize()
    tools = client.list_tools()
    if args.json:
        print(json.dumps(tools, ensure_ascii=False, indent=2))
        return 0
    print("本地 MCP 可用：%s" % args.endpoint)
    if not tools:
        print("但 tools/list 返回为空。")
        return 0
    print("共 %d 个工具：" % len(tools))
    for t in tools:
        name = t.get("name") or "?"
        desc = (t.get("description") or "").strip().splitlines()
        schema = (t.get("inputSchema") or {}).get("properties") or {}
        required = (t.get("inputSchema") or {}).get("required") or []
        print("\n- %s" % name)
        if desc:
            print("  %s" % desc[0][:120])
        if schema:
            keys = ", ".join(schema.keys())
            print("  参数：%s%s" % (keys, "（必填：%s）" % ", ".join(required) if required else ""))
    return 0


def cmd_account(client, args):
    arguments = {}
    if args.url:
        arguments["url"] = args.url
    try:
        result = client.call_tool("get_public_account_id", arguments)
    except McpError:
        if not arguments:
            raise
        # 文档示例是空参数，部分版本不接受 url
        result = client.call_tool("get_public_account_id", {})
    text = show(result, args.json)
    if args.json:
        return 0
    print(text)
    links = [u for u in URL_RE.findall(text) if "mp.weixin.qq.com" in u]
    print("\n下一步：")
    if links:
        print("1. 复制上面的链接（或在软件日志窗口复制它生成的链接）")
    else:
        print("1. 在 wechatDownload 的日志窗口找到它生成的链接")
    print("2. 粘贴到「文件传输助手」，用微信电脑版打开（不要用浏览器）")
    print("3. 等软件提示「获取密钥成功」，再运行：batch")
    return 0


def cmd_batch(client, args):
    print("正在触发批量下载…（筛选条件、日期范围以 wechatDownload 界面设置为准）")
    result = client.call_tool("batch_download_articles", {})
    print(show(result, args.json))
    if not args.json:
        print("\n下载在 wechatDownload 里异步进行，进度看它的日志窗口。")
    return 0


def cmd_export(client, args):
    result = client.call_tool("export_article_data", {})
    print(show(result, args.json))
    if not args.json:
        print("\nCSV 在 wechatDownload 的下载目录里。")
    return 0


def cmd_single(client, args):
    try:
        result = client.call_tool("single_article_download", {"url": args.url})
    except McpError:
        if not args.remote:
            raise
        remote = McpClient(REMOTE_ENDPOINT, timeout=args.timeout)
        remote.initialize()
        config = {"保存离线网页": True, "HTML": True, "MD": True,
                  "PDF": False, "WORD": False, "TXT": False,
                  "MHTML": False, "文件开头添加日期": True}
        print("本地不可用，改用远程接口（链接会经过第三方服务器）…")
        result = remote.call_tool("wechat", {"url": args.url, "config": config})
    print(show(result, args.json))
    return 0


def cmd_call(client, args):
    arguments = {}
    if args.args_json:
        try:
            arguments = json.loads(args.args_json)
        except ValueError as e:
            raise SystemExit("--args-json 不是合法 JSON：%s" % e)
    result = client.call_tool(args.tool, arguments)
    print(show(result, args.json))
    return 0


def build_parser():
    p = argparse.ArgumentParser(
        prog="wechatdownload_mcp.py",
        description="通过本地 MCP 调用 wechatDownload 5.0（需它正在运行并勾选「启动MCP」）")
    p.add_argument("--endpoint", default=DEFAULT_ENDPOINT,
                   help="MCP 地址，默认 %s" % DEFAULT_ENDPOINT)
    p.add_argument("--timeout", type=int, default=60, help="单次请求超时秒数（默认 60）")
    p.add_argument("--json", action="store_true", help="输出原始 JSON")
    sub = p.add_subparsers(dest="command")

    sp = sub.add_parser("probe", help="检查 MCP 是否可用，并列出工具")
    sp.set_defaults(func=cmd_probe)

    sp = sub.add_parser("account", help="获取公众号凭证（需要微信里打开生成的链接）")
    sp.add_argument("--url", help="该号任意一篇文章的链接")
    sp.set_defaults(func=cmd_account)

    sp = sub.add_parser("batch", help="触发批量下载（用软件里已设好的筛选）")
    sp.set_defaults(func=cmd_batch)

    sp = sub.add_parser("export", help="导出文章元数据 CSV")
    sp.set_defaults(func=cmd_export)

    sp = sub.add_parser("single", help="下载单篇文章")
    sp.add_argument("--url", required=True, help="文章链接")
    sp.add_argument("--remote", action="store_true",
                    help="本地不可用时改用远程接口（链接会经过第三方）")
    sp.set_defaults(func=cmd_single)

    sp = sub.add_parser("call", help="直接调用任意工具")
    sp.add_argument("tool", help="工具名，例如 batch_download_articles")
    sp.add_argument("--args-json", default="{}", help="参数 JSON，默认 {}")
    sp.set_defaults(func=cmd_call)

    return p


def main():
    parser = build_parser()
    args = parser.parse_args()
    if not getattr(args, "command", None):
        parser.print_help()
        return 0
    client = McpClient(args.endpoint, timeout=args.timeout)
    try:
        client.initialize()
        return args.func(client, args)
    except McpError as e:
        print("✗ %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
