"""上游仓库定位：同时兼容两种布局。

布局 A（仓库同级）：          布局 B（仓库内）：          布局 C（环境变量指定）：
  ~/code/wechat-loop/           /workspace/                WECHAT_LOOP_UPSTREAM_DIR=/opt/up
  ~/code/wechat-flow/           /workspace/wechat-flow/
  ~/code/wechat-flow-film/      /workspace/wechat-flow-film/

优先级：环境变量 > 仓库内 > 仓库同级 > 再上一级。
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def upstream_dir(name: str) -> Path:
    """返回上游仓库目录；找不到时返回第一个候选路径，便于报错信息可读。"""
    candidates: list[Path] = []
    env_root = os.environ.get("WECHAT_LOOP_UPSTREAM_DIR")
    if env_root:
        candidates.append(Path(env_root).expanduser() / name)
    candidates.extend([
        ROOT / name,
        ROOT.parent / name,
        ROOT.parent.parent / name,
    ])
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return candidates[0]
