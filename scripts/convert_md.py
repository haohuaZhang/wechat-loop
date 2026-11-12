"""subprocess 包装上游 wechat-flow/toolkit/converter.py。

用法:
    python3 convert_md.py loop/runs/20261111/article.md
    python3 convert_md.py article.md --theme sspai --out article.html
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 上游路径（只读，不修改）
UPSTREAM_TOOLKIT = Path(__file__).resolve().parent.parent.parent / "wechat-flow" / "toolkit"


def convert(md_path: Path, theme_name: str = "professional-clean") -> dict:
    """调上游 WeChatConverter，返回 ConvertResult 字段的 dict。"""
    if not UPSTREAM_TOOLKIT.exists():
        raise FileNotFoundError(f"上游 wechat-flow/toolkit 不存在: {UPSTREAM_TOOLKIT}")

    sys.path.insert(0, str(UPSTREAM_TOOLKIT))
    from converter import WeChatConverter  # type: ignore

    conv = WeChatConverter(theme_name=theme_name)
    result = conv.convert_file(str(md_path))
    return {
        "html": result.html,
        "title": result.title,
        "digest": result.digest,
        "images": result.images,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("md_path", help="Markdown 文件路径")
    p.add_argument("--theme", default="professional-clean",
                   help="主题名: professional-clean / sspai / minimal / dark-teal-gold / ...")
    p.add_argument("--out", help="输出 HTML 路径（不写则自动和 md 同目录）")
    p.add_argument("--write-json", action="store_true", help="同时写一份 meta.json")
    args = p.parse_args()

    md = Path(args.md_path)
    if not md.exists():
        print(f"ERROR: {md} 不存在", file=sys.stderr)
        sys.exit(1)

    result = convert(md, args.theme)
    out_path = Path(args.out) if args.out else md.with_suffix(".html")
    out_path.write_text(result["html"], encoding="utf-8")

    meta = md.with_suffix(".meta.json")
    if args.write_json:
        meta.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"HTML 已写入: {out_path}")
    print(f"标题: {result['title']}")
    print(f"摘要: {result['digest'][:80]}...")
    if result["images"]:
        print(f"发现图片: {len(result['images'])} 张")


if __name__ == "__main__":
    main()
