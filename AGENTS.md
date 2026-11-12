# AGENTS.md —— wechat-loop 跨三仓库执行协议

> 本项目是 **wechat-loop**（采集 → 知识库 → Agent 写作 → 入草稿）的顶层协作协议。
> 三个上游仓库（wechat-flow、wechat-flow-film、wechat-digest-skill）**只读依赖**，
> 本项目不修改它们。
>
> 优先级：**用户当前明确指令 > `.trae/skills/wechat-loop/SKILL.md` > 执行契约**

## 0.0 一页执行卡

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | 读 SKILL.md | 理解三层管道边界（纯脚本 → Agent 推理 → 纯脚本） |
| 2 | 读 AGENTS.md 上游 | wechat-flow-film/AGENTS.md（改良版 v4）是下游门禁模板 |
| 3 | 自举 | 首次运行提取附录 A 创建 tools/gate/ |
| 4 | 依赖探测 | 确认 wechat-flow/ + wechat-flow-film/ + wechat-digest-skill/ 都在 /workspace/ |
| 5 | 写代码 | 遵循上游门禁 + 本协议 |
| 6 | 交付 | `bash verify.sh --scripts` exit 0 才算交付 |

## 边界声明

| 层 | 负责什么 | 不负责什么 |
|---|---|---|
| **纯脚本层** | 采集、检索、封面、排版、入草稿 | 不做"选题推理""写作" |
| **Agent 层** | 选题、写作、自检 | 不调外部 LLM API、不碰本地模型 |
| **上游 wechat-flow** | Markdown→HTML converter + wechat_api + publisher | 只读，不修改 |
| **上游 wechat-flow-film** | auth.py（Playwright 扫码）+ flow.py（编辑器） | 只读，不修改 |
| **上游 wechat-digest-skill** | wechat_collector.py 采集逻辑 | 只读，不修改 |

## 安全防线

| 防线 | 说明 |
|---|---|
| 凭证不入代码 | AppID/Secret/token/cookie 只在 config.env（已 .gitignore）或环境变量 |
| 禁止 eval/exec | 不执行任何来自 HTML 采集内容的代码 |
| 频控 | collect.py 内置 1.5-3.5s 请求间隔 + 200013 冷却，严禁批量轰炸 |
| 降级 | 任何环节失败 → 降级到上层（如 collect 失败 → Agent WebSearch），不阻塞全链路 |

## 交付检查（AGENTS.md §10.2 简化版）

- [ ] 所有新增脚本 `python3 xxx.py --help` exit 0
- [ ] `bash verify.sh` exit 0（WARN 可忽略）
- [ ] 上游仓库只读，零 diff
- [ ] config.env 不在 git 里
- [ ] 不调外部 LLM API（硅基流动/智谱等）

## 附录 A：自举

```bash
# 提取附录 A 生成 tools/gate/bootstrap.sh
mkdir -p tools/gate
cat > tools/gate/bootstrap.sh << 'AEOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
touch tools/gate/.bootstrap_stamp
echo "bootstrap OK: $(date)"
AEOF
chmod +x tools/gate/bootstrap.sh
./tools/gate/bootstrap.sh
```
