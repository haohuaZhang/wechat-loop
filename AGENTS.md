# AGENTS.md —— wechat-loop 跨三仓库执行协议

> 本项目是 **wechat-loop**（采集 → 知识库 → Agent 写作 → 入草稿）的顶层协作协议。
> 三个上游仓库（wechat-flow、wechat-flow-film、wechat-digest-skill）**只读依赖**，
> 本项目不修改它们。
>
> 优先级：**用户当前明确指令 > `.trae/skills/wechat-loop/SKILL.md` > 执行契约**
>
> 本文件是项目覆盖层。下列 5 条通用机制提炼自 wechat-flow-film/AGENTS.md v4，
> 但按本地工具规模裁剪：不引入 Cursor 专用路径、TASKS.md 仪式和全量 E2E 门禁。

## 0.0 一页执行卡

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | 读 SKILL.md | 理解三层管道边界（纯脚本 → Agent 推理 → 纯脚本） |
| 2 | 读 AGENTS.md 上游 | wechat-flow-film/AGENTS.md（改良版 v4）是下游门禁模板 |
| 3 | 自举 | 首次运行提取附录 A 创建 tools/gate/ |
| 4 | 依赖探测 | 确认 wechat-flow/ + wechat-flow-film/ + wechat-digest-skill/ 都在 /workspace/ |
| 5 | 写代码 | 遵循上游门禁 + 本协议 |
| 6 | 自检 | `bash verify.sh` exit 0（含失败循环、防作弊扫描） |
| 7 | 交付 | 有证据（命令 + 输出），才允许说"已完成" |

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
| 降级 | 任何环节失败 → 降级到下层通道（见降级矩阵），不阻塞全链路 |

## 机制 1：失败循环上限

同一环节连续失败必须计数，禁止无限重试。计数落在 `loop/loop-counter.json`：

```json
{ "inner_fix": { "count": 0, "last_fail": null } }
```

| 失败次数 | 允许动作 |
|---|---|
| 1–2 | 自主修复，但必须记录假设 |
| 3 | **必须换假设**，禁止重复上一次命令或改法 |
| ≥5 | **停机**：改为换方案 / 降级通道 / 向用户说明并请求决策 |

- 计数单位是"同一问题"，不是单次命令。网络抖动（超时、连接重置）不计入。
- ≥5 后仍在原路径重试视为违规，即使最后碰巧成功也不算交付。
- 典型适用：200013 频控、扫码失败、依赖安装失败、上游接口变更。

## 机制 2：外部平台降级矩阵

| 级别 | 形态 | 本项目对应 |
|---|---|---|
| L1 | 稳定官方接口 / 受控通道 | 微信读书通道、自己公众号 material API、官方发布 API |
| L1.5 | 官方接口 + 人工确认 | 发布前人工确认草稿 |
| L2 | 半自动：导出文件再导入 | 手动文章链接、RSS/Atom、OPML |
| L3 | 只读采集（公开页） | 公开文章页抓正文 |
| L4 | 需绕过验证码 / 风控 | **禁止实现，直接 BLOCKED** |

- 任一层不可用时，降一级并明确告知用户当前处在哪一级。
- 不得把 L4 包装成 L1，也不得用 mock 结果冒充高层级成功。

## 机制 3：L4 停机清单（必须人工）

遇到以下操作，AI 只给步骤和命令，**不代为执行**：

- 扫码登录、验证码、滑块、人机校验
- 真实发布、群发、删除已发布文章
- 修改或提交上游三个仓库
- 批量删除 / 覆盖知识库数据
- 填写任何凭证、密钥、AppID
- 同一问题连续失败 ≥5 次

## 机制 4：证据完成

- 说"已完成 / 已修复 / 可用"必须附：执行的命令、退出码、关键输出。
- 采集类任务不能只看任务状态：必须证明正文文件真实存在且非空。
- 禁止"应该可以""理论上支持"这类无证据结论。
- 无法验证时必须写"未验证 + 原因 + 下一步验证方法"。

## 机制 5：防作弊

- 禁止 skip / xfail / only、删除或跳过测试、放宽断言来变绿。
- 禁止 `|| true`、`2>/dev/null` 掩盖真实失败，禁止在脚本里硬编码 `exit 0`。
- 禁止把失败分支改成 WARN 来通过门禁。
- `verify.sh` 内置扫描；CLEAN 之外的人工改动同样受约束。

## 交付检查

- [ ] 所有新增脚本 `python3 xxx.py --help` exit 0
- [ ] `bash verify.sh` exit 0（WARN 可忽略，FAIL 必须修）
- [ ] 上游仓库只读，零 diff
- [ ] config.env 不在 git 里
- [ ] 不调外部 LLM API（硅基流动/智谱等）
- [ ] `loop/loop-counter.json` 无 ≥5 的计数项
- [ ] 交付结论附命令与输出证据

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
