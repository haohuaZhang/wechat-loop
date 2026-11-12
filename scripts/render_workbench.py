#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
工作台渲染入口（产品定制版）。

上游 render_html.py 只认它自己目录下的 assets/digest_template.html；
这里复用上游全部渲染逻辑，仅把模板换成 scripts/assets/ 下的定制副本
（文案更面向非技术用户），因此上游仓库保持零改动。

  python3 scripts/render_workbench.py [--kb ...] [--out ...]
"""

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "wechat-digest-skill")
TEMPLATE = os.path.join(ROOT, "scripts", "assets", "digest_template.html")

sys.path.insert(0, SKILL_DIR)
import render_html as rh  # noqa: E402

rh.TEMPLATE_PATH = TEMPLATE
rh.DEFAULT_OUT = os.path.join(SKILL_DIR, "output", "digest.html")


def main():
    parser = argparse.ArgumentParser(prog="render_workbench.py",
                                     description="生成离线 HTML 工作台（定制模板）")
    parser.add_argument("--kb", default=os.path.join(SKILL_DIR, "output", "knowledge_base.json"))
    parser.add_argument("--out", default=rh.DEFAULT_OUT)
    args = parser.parse_args()
    if not os.path.exists(TEMPLATE):
        raise SystemExit(f"未找到模板 {TEMPLATE}")
    rh.render(args.kb, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
