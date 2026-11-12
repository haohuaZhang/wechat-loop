"""Pillow 画公众号标题卡（封面图 900×383，或 1280×720）。

零 AI、零版权风险、无 AI 味。纯颜色块 + 文字排版。

用法:
    python3 make_cover.py --title "免费在线看电影" --subtitle "又发现几个免登录免广告的影视站"
    python3 make_cover.py -t "标题" -s "副标题" -o loop/covers/20261111.png

默认尺寸 900×383（公众号官方封面比例），也可以 --size 1280x720。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


# ── 预设配色 ──────────────────────────────────────────────────

PALETTES = {
    "dark-teal-gold": {
        "bg": (10, 30, 40),
        "accent": (255, 200, 80),
        "text": (255, 255, 255),
        "subtitle": (180, 200, 210),
    },
    "navy-gold": {
        "bg": (20, 30, 80),
        "accent": (255, 215, 0),
        "text": (255, 255, 255),
        "subtitle": (200, 210, 240),
    },
    "crimson-cream": {
        "bg": (120, 20, 30),
        "accent": (255, 220, 180),
        "text": (255, 255, 255),
        "subtitle": (255, 200, 200),
    },
    "forest-sun": {
        "bg": (25, 70, 40),
        "accent": (255, 180, 60),
        "text": (255, 255, 255),
        "subtitle": (200, 220, 200),
    },
    "midnight-neon": {
        "bg": (15, 15, 35),
        "accent": (80, 200, 255),
        "text": (255, 255, 255),
        "subtitle": (180, 180, 220),
    },
}


def _find_font(size: int) -> ImageFont.FreeTypeFont:
    """找一个能用的中文字体，都找不到就返回默认（会有乱码但不崩）。"""
    candidates = [
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
        "/root/.fonts/SourceHanSans-Bold.otf",
        "/Library/Fonts/Arial Unicode.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make_cover(
    title: str,
    subtitle: str = "",
    out_path: Path = Path("cover.png"),
    size: tuple[int, int] = (900, 383),
    palette: str = "dark-teal-gold",
    accent_bar: bool = True,
) -> Path:
    w, h = size
    colors = PALETTES.get(palette, PALETTES["dark-teal-gold"])

    # 背景
    img = Image.new("RGB", size, colors["bg"])
    draw = ImageDraw.Draw(img)

    # 装饰色条（左上 + 右下两个色块）
    if accent_bar:
        draw.rectangle([0, 0, w, 8], fill=colors["accent"])
        draw.rectangle([w - 120, h - 60, w - 20, h - 20], fill=colors["accent"])

    # 标题
    font_title = _find_font(min(72, h // 5))
    font_sub = _find_font(min(40, h // 9))
    font_footer = _find_font(max(16, h // 20))

    # 标题换行（每 12 字一行，公众号封面标题最佳长度）
    lines = []
    cur = ""
    for ch in title:
        cur += ch
        if len(cur) >= 12:
            lines.append(cur)
            cur = ""
    if cur:
        lines.append(cur)

    line_h = font_title.size + 12
    total_h = len(lines) * line_h
    y = (h - total_h) // 2 - (30 if subtitle else 0)
    x_pad = 60
    for line in lines:
        draw.text((x_pad, y), line, font=font_title, fill=colors["text"])
        y += line_h

    # 副标题（可选）
    if subtitle:
        sub_y = y + 20
        draw.text((x_pad, sub_y), subtitle, font=font_sub, fill=colors["subtitle"])

    # 右下角水印位（不写文字，留装饰色块就行）
    # 文件名 = 标题前 10 字 + .png
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(out_path), "PNG", optimize=True)
    return out_path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-t", "--title", required=True, help="主标题")
    p.add_argument("-s", "--subtitle", default="", help="副标题（可选）")
    p.add_argument("-o", "--output", default="cover.png", help="输出路径")
    p.add_argument("--size", default="900x383", help="尺寸 WxH，默认 900x383")
    p.add_argument("--palette", default="dark-teal-gold", choices=list(PALETTES.keys()))
    args = p.parse_args()

    w, h = map(int, args.size.split("x"))
    out = make_cover(
        title=args.title,
        subtitle=args.subtitle,
        out_path=Path(args.output),
        size=(w, h),
        palette=args.palette,
    )
    print(f"封面已生成: {out}")


if __name__ == "__main__":
    main()
