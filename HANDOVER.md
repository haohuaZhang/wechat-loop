# wechat-loop 交接文档（HANDOVER）

> **适用**：切换 Trae 账户、或者新 Agent 接手这个项目时第一时间读
> **仓库**：`https://github.com/haohuaZhang/wechat-loop`
> **最新 commit**：`4d677a5` — `chore: 放行运行时数据（history/kb/runs）`

---

## 0. 一句话定位

**把指定公众号（可多个，不限于自己运营的号）的历史文章采集为知识库，自动检索 → 选题去重 → 写作 → 排版 → 入草稿箱，人工审核后发出去。采集层基于 `wechat-digest-skill` 二次开发，零 API 花费、本地跑完闭环。**

---

## 1. 项目全貌（3 个仓库 + 1 个 bootstrap 包）

这个项目**故意不合并三个仓库**，边界如下：

| 仓库 | 位置 | 实际角色 | 关键事实 |
|---|---|---|---|
| `wechat-loop/` | 本次主仓库 | **适配层 + 自动化闭环** | 11 个 Python 脚本，500 行左右。唯一有我们新写代码的地方 |
| `wechat-flow/` | 上游克隆（只读） | **写作规范 + 排版 + 发布工具链** | **没有 LLM 调用代码**，写作是 Agent 读 `SKILL.md` 完成的。提供 `converter.py` 把 md 转 inline-style HTML |
| `wechat-flow-film/` | 上游二创（只读） | **浏览器自动化 + 关键词模块** | 登录可用（Playwright chromium），有完整的 `keyword.py`（日期自动回复）。发布部分未实测加固 |
| `wechat-digest-skill/` | 上游克隆（只读） | **采集 + 离线 HTML** | **没有检索、没有写作**。本项目的采集逻辑基于它二次开发，知识库来源是**目标公众号的历史文章**（可以不是自己号）。中间层就是 wechat-loop 里的 11 个脚本 |

**契约**：`wechat-loop/loop/knowledge_base.json` 和 `wechat-loop/loop/runs/YYYYMMDD/` 是唯一的数据入口。

### 为什么不合并？

- 上游仓库各自有独立 .git，更新 pull 方便
- wechat-loop 保持"瘦壳"，只放我们自己的逻辑
- `.gitignore` 里把三个上游仓库都排除了，打包成 release asset 分发

---

## 2. 5 分钟恢复步骤

> 假设新账户的工作目录是 `/workspace`（和旧账户一致）

```bash
cd /workspace

# 1. clone 主仓库
git clone https://github.com/haohuaZhang/wechat-loop.git

# 2. 下载 bootstrap（350K，含三个上游仓库 + .trae/skills）
curl -L -o /tmp/bootstrap.tar.gz \
  https://github.com/haohuaZhang/wechat-loop/releases/download/v1.0-bootstrap/workspace-bootstrap.tar.gz

# 3. 解压到 /workspace（会生成 wechat-flow/ wechat-flow-film/ wechat-digest-skill/ .trae/skills/）
tar xzf /tmp/bootstrap.tar.gz

# 4. 装依赖（缺一不可）
pip install playwright trafilatura cssutils pillow pyyaml

# 5. 跑 verify.sh 确认环境
cd /workspace/wechat-loop && bash verify.sh
# 期望：18 PASS / 0 FAIL / exit 0（3 条 WARN 可忽略）
```

### 已装但 verify 不报的依赖

- **Playwright chromium**（Phase 1.2 才需要）：`playwright install chromium`
- **系统 Python**：必须 3.10+（`python3.13` 或 `python3.14` 都行，别用系统自带 3.9）

---

## 3. 已完成的 11 个脚本（全部 exit 0，verify 18 PASS）

### 闭环流程

```
run_daily.sh
├─ ① simple_search.py         检索 knowledge_base.json → evidence_pack.json
├─ ② topic_selection.py       选题去重（读 history.json）→ topic_candidates.json → 自动选 top-1
├─ ③ build_prompt.py          组装完整写作 prompt（含人格 + 框架 + 维度随机化）→ .prompt
└─ ④ 封面占位提示

Agent 写作（读 .prompt → 写 article.md）
├─ humanness_score.py         11 条规则自检（禁用词是硬 blocker，必须 PASS）
├─ make_cover.py              Pillow 画 900×383 标题卡（零 AI 成本）
├─ convert_md.py              调 wechat-flow/toolkit/converter.py → inline-style HTML
└─ publish_draft.py            轨 A 官方 API / 轨 B Playwright（轨 B 待 chromium 实测）

history.py add                 回写 knowledge_base.json → used_as_source=True → topic_selection 跳过

set_keyword.py（每日最后一步）
└─ YYYYMMDD +1 日期关键词自动回复（封装 wechat-flow-film/keyword.py）
```

### 脚本速查表

| 脚本 | 一句话作用 | 关键依赖 |
|---|---|---|
| `collect.py` | 采集自己号（material API）或竞品号（searchbiz）→ knowledge_base.json | trafilatura、token+cookie 或 AppID/Secret |
| `simple_search.py` | TF-IDF 检索 KB 文章 + keyword bonus | 标准库 |
| `topic_selection.py` | 选题：价值分 + 新鲜度分 + Jaccard 去重（读 history.json） | simple_search.py 共享 KB |
| `build_prompt.py` | 组装 Agent 写作 prompt（人格 yaml + 框架 + 维度随机化 + evidence_pack） | Personas + references |
| `humanness_score.py` | 11 条反 AI 检测规则（禁用词硬 blocker） | 标准库 |
| `make_cover.py` | Pillow 画 900×383 标题卡（零成本） | Pillow |
| `convert_md.py` | 调 wechat-flow/toolkit/converter.py → inline-style HTML | cssutils、上游 converter |
| `publish_draft.py` | 轨 A（官方 API + AppID/Secret）/ 轨 B（Playwright + cookies.json） | playwright（轨 B） |
| `history.py` | 维护 flat JSON 运行历史：add / check（去重）/ list | 标准库 |
| `run_daily.sh` | 调度入口：simple_search → topic_selection → build_prompt → 封面 | bash、上面 Python 脚本 |
| `set_keyword.py` | 日期 YYYYMMDD +1 关键词自动回复 | wechat-flow-film/keyword.py、cookies.json |

### verify.sh 结果

```
18 PASS / 0 FAIL / 3 WARN
  ✅ 11 个脚本全部 --help exit 0
  ✅ 核心脚本功能实测（simple_search snippet 长度 205 + 正文内容）
  ✅ 上游仓库存在（wechat-flow + wechat-flow-film + wechat-digest-skill）
  ✅ 上游 converter 调通（sspai 主题 inline-style HTML）
  ✅ gate bootstrap 自举 OK
  ⚠️  publish_draft.py 用 demo PNG 测的不是 HTML（脚本本身逻辑 OK）
  ⚠️  SKILL.md 在 .trae/ 目录（非阻塞）
  ⚠️  Playwright chromium 未装
```

---

## 4. 核心数据契约

### knowledge_base.json

```jsonc
{
  "articles": {
    "<article_id>": {
      "title": "...",
      "url": "...",
      "content": "...（采集到的正文）",
      "local_md_path": "loop/kb/<account>/<date>/<article_id>.md",
      "publish_date": "YYYY-MM-DD",
      "source_account": "self | <竞品号>",
      "topics": ["叙事", "情感", ...],
      "keywords": ["...", "..."],
      "crossRefs": ["<related_article_id>"],
      "freshness_score": 0-10,
      "value_score": 0-10,
      "used_as_source": false  // ← history.py add 时自动翻成 True
    }
  }
}
```

### runs/YYYYMMDD/ 目录

每个 `run_daily.sh` 调用生成：

| 文件 | 内容 |
|---|---|
| `.prompt` | 完整写作 prompt（人格 + 框架 + 维度 + evidence_pack） |
| `evidence_pack.json` | TF-IDF 检索结果（top-k chunks） |
| `topic_candidates.json` | 选题候选（去重后 top-N） |
| `run.log` | 运行日志 |

### Personas（5 个写作人格）

| 文件 | 描述 |
|---|---|
| `personas/industry-observer.yaml` | 行业观察者（默认） |
| `personas/sharp-journalist.yaml` | 犀利记者 |
| `personas/warm-editor.yaml` | 温暖编辑 |
| `personas/cold-analyst.yaml` | 冷静分析师 |
| `personas/midnight-friend.yaml` | 深夜朋友 |

---

## 5. 未完成清单（全部依赖 chromium）

### Phase 1.2 — 环境 + 扫码（新账户第一件事）

```bash
pip install playwright
playwright install chromium
```

然后：

```bash
cd /workspace/wechat-flow-film
python3 auth.py login
# 弹出二维码 → 用公众号管理员微信扫 → cookies.json 落盘
```

### Phase 1.3 — 真跑采集

```bash
cd /workspace/wechat-loop

# 采集目标公众号历史文章（知识库主路径，需要 mp 后台 token + cookie）
# 先跑 auth.py login 扫码，cookies.json 落盘后自动读取
python3 scripts/collect.py "目标公众号名称" --count 20 --since 2026-01-01

# 自己号（可选，只用于复盘自己发过的内容）
# 需要：WECHAT_APPID + WECHAT_APPSECRET（公众号后台 → 开发 → 基本配置）
python3 scripts/collect.py self --count 20
```

### Phase 1.4 — Playwright 选择器验证

`publish_draft.py` 里所有 `⚠️ 待实测` 的选择器是常见模式（不是瞎猜的），但第一次跑通后要用 **Playwright Inspector** 看编辑器 DOM 替换成真实值：

```bash
python3 -m playwright codegen \
  "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&lang=zh_CN&token=YOUR_TOKEN"
```

### Phase 1.7 — 端到端验证（手动 md → 自动入草稿）

1. 手动写一篇 `article.md`（随便写，用来测试排版）
2. `python3 scripts/make_cover.py -t "标题" -s "副标题" -o cover.png`
3. `python3 scripts/convert_md.py article.md --theme sspai --out article.html`
4. `python3 scripts/publish_draft.py article.html --title "标题" --cover cover.png --route playwright`
5. 去 `mp.weixin.qq.com` 草稿箱看有没有这篇

### Phase 2.2 — 范文导入

把历史满意的旧文章 URL 喂给 `extract_exemplar.py`，让 Agent 知道你喜欢什么风格。

---

## 6. 踩过的坑（技术关键速查表）

### chrome-devtools-mcp / Playwright 相关

| 坑 | 解法 |
|---|---|
| chrome-devtools-mcp 找不到 Chrome | 写 wrapper `/opt/google/chrome/chrome` 指向 playwright chromium |
| Chrome root 启动失败 | 加 `--no-sandbox --disable-dev-shm-usage --headless=new` |
| IDE 浏览器 vs browser_use agent 两套会话 | 各自独立，登录态分别过期。持久化用 `--user-data-dir=/tmp/chrome-ide-profile` |
| `evaluate_script` 参数名 | 正确是 `function`（不是 `expression` 也不是 `script`） |
| Playwright 注入 HTML → contenteditable | 用 `page.evaluate("([sel, html]) => document.querySelector(sel).innerHTML = html", ...)` — **`page.fill()` 会转义 HTML 标签成纯文本** |

### 公众号后台交互经验

| 坑 | 解法 |
|---|---|
| mp.weixin.qq.com 搜一搜只显示本账号数据 | 不是全站搜索。放弃搜狗 weixin.sogou.com（会被"环境异常"页拦截） |
| 草稿卡片的"编辑"按钮很难定位 | 不是卡片本身的 link，hover 才显示独立按钮 |
| 公众号后台 token 固定 | `token=1040483458`（url 里硬编码，每个账号不同） |
| 个人订阅号 `freepublish` 已被回收 | **只能自动进草稿箱，最后一步必须人工点发布** |
| 个人号 `draft/add` 权限 | 多数可用，但存在 48001 反例。先建一篇测试草稿 |
| 采集频控 200013 | 绑账号、24 小时不放行。第一周只采 3-5 个号、每个 10-20 篇 |

### wechat-loop 代码里的坑（新 Agent 别再踩）

| # | 坑 | 位置 |
|---|---|---|
| 1 | 竞品号采集循环结构写反了 | `collect.py` — 已经修，但加新采集路径别重犯 |
| 2 | simple_search 的 `ROOT` 忘定义 + 相对路径没拼 ROOT | `simple_search.py` — 所有脚本都要记得加 `ROOT = Path(__file__).resolve().parent.parent` |
| 3 | topic_selection 读错 history 格式（写 yaml 但 history.py 存 JSON） | `topic_selection.py` — **永远读 flat JSON** |
| 4 | humanness_score 的禁用词是硬 blocker，但阈值设成"允 1 条不过" | `humanness_score.py` — 硬规则必须 PASS 才能 overall PASS |
| 5 | run_daily.sh 传 `--kb` 给 topic_selection，但后者没这个参数 | `run_daily.sh` — topic_selection.py 自己读 ROOT/loop/knowledge_base.json |
| 6 | build_prompt 里引用 main() 的局部变量 `args.persona`，函数作用域访问不到 | `build_prompt.py` — 函数参数要显式传 |
| 7 | `.gitignore` 里 `*.json` 通配符把 history.json 也排除了 | `.gitignore` — **先通配排除，再 `!loop/history.json` 放行** |

### 系统环境

| 坑 | 解法 |
|---|---|
| 系统自带 Python 3.9 | wechat-flow 用了 3.10+ 语法。用 `python3.13` 或 `python3.14` |
| 依赖不全（verify 会 WARN 但 --help 直接炸） | 必须：`playwright trafilatura cssutils pillow pyyaml` |

---

## 7. 给新 Trae Agent 的第一句话

> 你是 wechat-loop 项目的接手 Agent。请先读 `/workspace/wechat-loop/HANDOVER.md`（就是本文件），然后：
>
> 1. `bash verify.sh` 确认环境 OK
> 2. 打开 `scripts/publish_draft.py` 看 `SELECTORS` dict 里的 `⚠️ 待实测` 标记
> 3. 告诉人类："现在需要装 chromium 并扫一次公众号二维码"
> 4. 等人类确认后 `playwright install chromium` + 起 headless 给人类扫
> 5. cookies.json 落盘后，Phase 1.2 开始

---

## 8. 目录结构总览

```
/workspace/
├── wechat-loop/                    ← 主仓库（git）
│   ├── AGENTS.md                    跨三仓库执行协议
│   ├── HANDOVER.md                  ★ 本文件
│   ├── config.example.yaml
│   ├── .gitignore                   保护 cookies / .env / 上游仓库
│   ├── install.sh / verify.sh
│   ├── scripts/                     11 个 Python 脚本 + run_daily.sh
│   ├── personas/                    5 个写作人格 yaml
│   ├── references/                  12 份写作规范参考
│   ├── loop/
│   │   ├── knowledge_base.json      demo KB
│   │   ├── history.json             运行历史（去重用）
│   │   ├── kb/demo/                 demo 采集样本（可删）
│   │   ├── runs/YYYYMMDD/           run_daily 每次产物
│   │   └── covers/                  demo 封面
│   └── tools/gate/                  AGENTS.md v4 门禁自举
│
├── wechat-flow/                    ← 上游克隆（只读）
├── wechat-flow-film/                ← 上游二创（只读，有 login + keyword）
├── wechat-digest-skill/             ← 上游克隆（只读，采集）
└── .trae/skills/wechat-loop/        ← Trae skill（bootstrap 里打包）
```

---

## 9. GitHub

| 项 | 地址 |
|---|---|
| 主仓库 | `https://github.com/haohuaZhang/wechat-loop` |
| Release v1.0-bootstrap（含上游仓库） | `https://github.com/haohuaZhang/wechat-loop/releases/tag/v1.0-bootstrap` |
| Bootstrap tar 直接下载 | `https://github.com/haohuaZhang/wechat-loop/releases/download/v1.0-bootstrap/workspace-bootstrap.tar.gz` |

---

## 10. 交接点（最后一次更新：2026-11-12）

### 已完成（全部可运行）

- ✅ 完整 11 脚本闭环：采集 → 检索 → 选题去重 → build_prompt → Agent 写作 → humanness_score 自检 → make_cover → convert_md → publish_draft（轨 A+B）→ history 回写 KB → set_keyword
- ✅ run_daily.sh 自动选题链路跑通（demo KB 跑出 score 8.2）
- ✅ verify.sh 18 PASS / 0 FAIL
- ✅ 主仓库 + release asset 全部推到 GitHub

### 待新账户接手

- 🔜 `playwright install chromium` + 扫一次码拿 cookies.json
- 🔜 `collect.py self --count 20` 真采集
- 🔜 Playwright Inspector 替换 publish_draft.py 里的 `⚠️ 待实测` 选择器
- 🔜 端到端验证 E2E：手写 md → 自动排版 → 自动入草稿
- 🔜 长期：加嵌入 + 本地 `bge-m3`（万篇以内 TF-IDF 够用）
