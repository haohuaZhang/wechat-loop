"""把用户满意的旧公众号文章导入范文库。

读文章 URL 或本地 HTML → trafilatura 提取正文 → 按 H2 切段 → 写进
loop/exemplars/ 下，Agent 写作时从这里随机选段落作为结构种子。

用法:
    python3 extract_exemplar.py https://mp.weixin.qq.com/s/xxxxx --name "我的第一篇影视推荐"
    python3 extract_exemplar.py /path/to/local.html --name "某篇旧文"
    python3 extract_exemplar.py --list          # 列出已有范文
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import trafilatura

EXEMPLAR_DIR = Path(__file__).resolve().parent.parent / "loop" / "exemplars"


def extract(url_or_path: str) -> dict:
    """从 URL 或本地文件提取正文。返回 {title, text, source}。"""
    source = url_or_path
    if url_or_path.startswith(("http://", "https://")):
        downloaded = trafilatura.fetch_url(url_or_path)
        if downloaded is None:
            raise RuntimeError(f"无法抓取 {url_or_path}（可能需要 cookie）")
        text = trafilatura.extract(downloaded, include_comments=False, include_tables=False) or ""
        # 尝试提取 title
        title_match = re.search(r"<title[^>]*>([^<]+)</title>", downloaded, re.I)
        title = title_match.group(1).strip() if title_match else ""
    else:
        p = Path(url_or_path)
        if not p.exists():
            raise FileNotFoundError(url_or_path)
        raw = p.read_text(encoding="utf-8", errors="ignore")
        if p.suffix == ".md":
            text = raw
            title_match = re.search(r"^#\s+(.+)$", raw, re.M)
            title = title_match.group(1).strip() if title_match else ""
        else:
            text = trafilatura.extract(raw, include_comments=False, include_tables=False) or raw
            title_match = re.search(r"<title[^>]*>([^<]+)</title>", raw, re.I)
            title = title_match.group(1).strip() if title_match else ""

    return {"title": title, "text": text, "source": source}


def segment(text: str) -> list[dict]:
    """按 H2（## 或 ## 或 markdown 风格）切段。"""
    # 先按 markdown H2
    parts = re.split(r"(?m)^##\s+", text)
    if len(parts) > 1:
        segments = []
        for i, part in enumerate(parts):
            lines = part.strip().split("\n", 1)
            heading = lines[0].strip() if lines else ""
            body = lines[1].strip() if len(lines) > 1 else part.strip()
            segments.append({"heading": heading, "body": body[:500]})
        return segments[1:]  # 第一段是 H1 之前的内容
    # 退而求其次：按句号段落切
    sentences = re.split(r"(?<=[。！？])", text)
    return [{"heading": f"段{i+1}", "body": s.strip()} for i, s in enumerate(sentences) if len(s.strip()) > 20]


def save(exemplar: dict, segments: list[dict], name: str) -> Path:
    EXEMPLAR_DIR.mkdir(parents=True, exist_ok=True)
    out = EXEMPLAR_DIR / f"{name}.json"
    payload = {
        "name": name,
        "title": exemplar["title"],
        "source": exemplar["source"],
        "segment_count": len(segments),
        "segments": segments,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url_or_path", nargs="?", help="文章 URL 或本地文件路径")
    p.add_argument("--name", required=False, help="范文名称（如 '影视推荐-茶杯狐'）")
    p.add_argument("--list", action="store_true", help="列出已有范文")
    args = p.parse_args()

    if args.list:
        EXEMPLAR_DIR.mkdir(parents=True, exist_ok=True)
        files = sorted(EXEMPLAR_DIR.glob("*.json"))
        if not files:
            print("loop/exemplars/ 下还没有范文")
        else:
            for f in files:
                d = json.loads(f.read_text())
                print(f"  {f.name}: {d.get('title', '(无标题)')} — {d.get('segment_count', 0)} 段")
        return

    if not args.url_or_path:
        p.print_help()
        sys.exit(1)

    name = args.name or re.sub(r"[^\w\u4e00-\u9fff]+", "-", args.url_or_path.split("/")[-1])[:40]
    name = name.strip("-") or "exemplar"

    print(f"提取中: {args.url_or_path}")
    exemplar = extract(args.url_or_path)
    print(f"标题: {exemplar['title']}")

    segments = segment(exemplar["text"])
    out = save(exemplar, segments, name)
    print(f"✅ 已保存到 {out}（{len(segments)} 段）")


if __name__ == "__main__":
    main()
