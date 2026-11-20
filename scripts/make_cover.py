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


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_w: int) -> list[str]:
    """按像素宽度换行（中文无空格，逐字累加），避免长标题被画布裁掉。"""
    lines: list[str] = []
    cur = ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        trial = cur + ch
        if cur and draw.textlength(trial, font=font) > max_w:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    # 禁则处理：行首不出现收尾标点，挂回上一行
    closing = "，。、；：？！）》」』”’%…"
    for i in range(1, len(lines)):
        while lines[i] and lines[i][0] in closing:
            lines[i - 1] += lines[i][0]
            lines[i] = lines[i][1:]
    return [ln for ln in lines if ln]


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

    # 标题：按像素宽度换行，并逐级缩字号直到整块放得下
    x_pad = 60
    max_w = w - 2 * x_pad
    font_sub = _find_font(min(40, h // 9))
    title_size = min(72, h // 5)
    lines: list[str] = []
    sub_lines: list[str] = []
    block_h = 0
    line_h = title_size + 12
    while True:
        font_title = _find_font(title_size)
        lines = _wrap_text(draw, title, font_title, max_w)
        if subtitle:
            wrapped = _wrap_text(draw, subtitle, font_sub, max_w)
            sub_lines = wrapped[:2]
            if len(wrapped) > 2:
                sub_lines[-1] = sub_lines[-1][:-1] + "…"
        else:
            sub_lines = []
        line_h = title_size + 12
        gap = 12 if sub_lines else 0
        block_h = len(lines) * line_h + gap + len(sub_lines) * (font_sub.size + 8)
        if block_h <= h - 48 or title_size <= 36:
            break
        title_size -= 4

    y = max(24, (h - block_h) // 2)
    for line in lines:
        draw.text((x_pad, y), line, font=font_title, fill=colors["text"])
        y += line_h
    if sub_lines:
        y += 12
        for line in sub_lines:
            draw.text((x_pad, y), line, font=font_sub, fill=colors["subtitle"])
            y += font_sub.size + 8

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
