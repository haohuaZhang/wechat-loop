/**
 * API 客户端 —— 对接本机 wechat-mp-tools Flask 服务 + bridge.py 新增端点
 *
 * 切换方式：
 *   - USE_MOCK = false  → 走真实 fetch（Vite dev server 通过 proxy 代理 /api → 127.0.0.1:5200）
 *   - USE_MOCK = true   → 用内置 mock 数据（离线预览时的降级通道）
 *
 * 真实后端（bridge.py + wechat-mp-tools）端点：
 *   POST   /api/accounts/search                 搜索公众号（name → fakeid）
 *   POST   /api/articles/collect-latest        启动采集
 *   GET    /api/articles/download-status/<id>  轮询采集进度
 *   GET    /api/articles/history                下载历史（任务列表）
 *   GET    /api/articles/list/<fakeid>         文章列表
 *   GET    /api/auth/status                    扫码登录状态
 *   ── bridge.py 新增 ──
 *   GET    /api/kb                             知识库列表
 *   POST   /api/kb                             新增知识库
 *   POST   /api/kb/active                      切换活动知识库
 */

const USE_MOCK = false

/**
 * 统一 fetch 封装
 */
async function fetchJSON(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
  }
  return res.json()
}

/** Mock 数据 —— USE_MOCK=false 时全部不返回 */
const MOCK_KB_LIST = [
  { id: "default", name: "主知识库", path: "loop/knowledge_base.json", isActive: true, articleCount: 128 },
  { id: "game", name: "游戏赛道", path: "loop/kb/game.json", isActive: false, articleCount: 46 },
  { id: "temp", name: "临时导入", path: "loop/kb/temp.json", isActive: false, articleCount: 7 },
]
const MOCK_TASKS = [
  { id: "task-003", title: "游戏汇总 · 最近 50 篇", status: "done", at: "11-14 18:40" },
  { id: "task-002", title: "游戏研究社 · 最近 30 篇", status: "done", at: "11-12 09:15" },
  { id: "task-001", title: "手游那点事 · 按日期 10月", status: "error", at: "11-10 14:20" },
]
const MOCK_ARTICLES = [
  { id: "a1", title: "S15 世界赛复盘：两支 LPL 队伍的 BP 思路差异", account: "游戏汇总", publishAt: "2026-11-14T09:20:00Z", digest: "本届世界赛四强战中，两支 LPL 队伍在面对相同对手时拿出了截然不同的英雄选择。", url: "https://mp.weixin.qq.com/s/demo-s15" },
  { id: "a2", title: "11 月新游观察：三款独立作品在 Switch 上的表现", account: "游戏研究社", publishAt: "2026-11-12T15:42:00Z", digest: "十一月任天堂 eShop 迎来一波独立游戏小高峰。", url: "https://mp.weixin.qq.com/s/demo-indie" },
  { id: "a3", title: "小游戏长线运营的三条路径", account: "手游那点事", publishAt: "2026-11-10T07:30:00Z", digest: "从《羊了个羊》到今年的几款黑马，小游戏的生命周期正在被拉长。", url: "https://mp.weixin.qq.com/s/demo-mini" },
  { id: "a4", title: "合作派对游戏的设计原则", account: "独立游戏观察", publishAt: "2026-11-08T11:05:00Z", digest: "派对游戏看似门槛低，真正做好却需要在协作感和挫败感之间找到平衡。", url: "https://mp.weixin.qq.com/s/demo-party" },
  { id: "a5", title: "电竞赞助的 ROI 到底怎么算", account: "电竞产业评论", publishAt: "2026-11-05T18:00:00Z", digest: "品牌方在电竞领域的投入逐年上涨，但很少有人能清晰回答这笔钱换来了什么。", url: "https://mp.weixin.qq.com/s/demo-sponsor" },
  { id: "a6", title: "二次元内容产能的瓶颈在哪里", account: "游戏研究社", publishAt: "2026-11-03T10:15:00Z", digest: "过去两年二次元赛道内容量翻了三倍，但玩家体感上的精品感却没有同步增长。", url: "https://mp.weixin.qq.com/s/demo-anime" },
]

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

/** 把 wechat-mp-tools 的 history 条目归一化为前端需要的形状 */
function normalizeHistory(historyItems = []) {
  const STATUS_MAP = {
    "completed": "done",
    "failed": "error",
    "cancelled": "cancelled",
    "running": "running",
  }
  return historyItems.map((h) => ({
    id: h.id || h.task_id || String(h._index ?? Math.random()).slice(-6),
    title: `${h.account || h.account_name || "未知"} · ${h.type === "collect_latest" ? "最近采集" : h.type === "batch" ? "批量下载" : h.type || "下载"}`,
    status: STATUS_MAP[h.status] || h.status || "running",
    at: h.time ? new Date(h.time * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : "",
    count: h.count || h.success_count || 0,
  }))
}

/** 把 download-status 的内存字典归一化为前端任务卡需要的形状 */
function normalizeTaskStatus(task, taskId) {
  if (!task) return null
  const STATUS_MAP = {
    "running": "running",
    "completed": "done",
    "failed": "error",
    "cancelled": "cancelled",
    "success": "done",
  }
  const progress = task.progress || 0
  const errorHint = task.error || (task.status === "failed" ? "采集失败" : "")
  return {
    id: taskId,
    title: `${task.account_name || task.account || "未知"} · 正在采集`,
    status: STATUS_MAP[task.status] || task.status || "running",
    progress,
    total: task.total || task.target_count || 50,
    successCount: task.success_count || 0,
    failedCount: task.failed_count || 0,
    errorHint,
  }
}

export const api = {
  /**
   * 开始采集 —— 真实流程：搜索公众号拿 fakeid → collect-latest
   */
  async startCollect({ account, count }) {
    if (USE_MOCK) { await delay(400); return { taskId: "task_demo", total: count, account } }
    const searchRes = await fetchJSON("/api/accounts/search", {
      method: "POST",
      body: JSON.stringify({ keyword: account }),
    }).catch(() => null)
    const fakeid = searchRes?.accounts?.[0]?.fakeid
    if (!fakeid) {
      throw new Error(`未找到公众号「${account}」，请确认名称或先扫码登录。`)
    }
    const collectRes = await fetchJSON("/api/articles/collect-latest", {
      method: "POST",
      body: JSON.stringify({ fakeid, account_name: account, limit: count, skip_existing: true }),
    })
    return { taskId: collectRes.task_id, total: count, account }
  },

  /**
   * 轮询采集进度 —— 真实端点 GET /api/articles/download-status/<task_id>
   */
  async pollTaskStatus(taskId) {
    if (USE_MOCK) return null
    try {
      const status = await fetchJSON(`/api/articles/download-status/${taskId}`)
      return normalizeTaskStatus(status, taskId)
    } catch (err) {
      if (err?.message?.includes("404")) return null
      throw err
    }
  },

  /**
   * 任务历史 —— 真实端点 GET /api/articles/history
   */
  async listTasks() {
    if (USE_MOCK) { await delay(300); return MOCK_TASKS }
    try {
      const res = await fetchJSON("/api/articles/history")
      return normalizeHistory(res.history || [])
    } catch (err) {
      console.warn("[api] listTasks 失败:", err.message)
      return []
    }
  },

  /**
   * 文章列表 —— 真实端点：搜索 fakeid → GET /api/articles/list/<fakeid>
   */
  async listArticles(params = {}) {
    if (USE_MOCK) {
      await delay(500)
      let list = [...MOCK_ARTICLES]
      if (params.query) {
        const q = params.query.toLowerCase()
        list = list.filter((a) => a.title.toLowerCase().includes(q) || (a.digest || "").toLowerCase().includes(q))
      }
      if (params.account && params.account !== "all") list = list.filter((a) => a.account === params.account)
      return list
    }
    try {
      let list = []
      if (params.account && params.account !== "all") {
        const searchRes = await fetchJSON("/api/accounts/search", {
          method: "POST",
          body: JSON.stringify({ keyword: params.account }),
        })
        const fakeid = searchRes?.accounts?.[0]?.fakeid
        if (fakeid) {
          const res = await fetchJSON(`/api/articles/list/${fakeid}`)
          list = (res.articles || []).map((a) => ({
            id: a.id || a.article_id || String(Math.random()),
            title: a.title,
            account: params.account,
            publishAt: a.update_time ? new Date(a.update_time * 1000).toISOString() : "",
            digest: a.digest || "",
            url: a.link || "",
          }))
        }
      }
      if (params.query) {
        const q = params.query.toLowerCase()
        list = list.filter((a) => a.title.toLowerCase().includes(q) || (a.digest || "").toLowerCase().includes(q))
      }
      return list
    } catch (err) {
      console.warn("[api] listArticles 失败:", err.message)
      return []
    }
  },

  /** 知识库列表 —— bridge.py 新增端点 */
  async listKnowledgeBases() {
    if (USE_MOCK) { await delay(200); return MOCK_KB_LIST }
    try {
      return await fetchJSON("/api/kb")
    } catch (err) {
      console.warn("[api] listKnowledgeBases 失败:", err.message)
      return []
    }
  },

  /** 切换活动知识库 —— bridge.py 新增端点 */
  async setActiveKB(id) {
    if (USE_MOCK) { await delay(200); return { ok: true, active: id } }
    return fetchJSON("/api/kb/active", {
      method: "POST",
      body: JSON.stringify({ id }),
    })
  },

  /** 新增知识库 —— bridge.py 新增端点 */
  async createKB({ name, path }) {
    if (USE_MOCK) { await delay(300); return { id: `kb_${Date.now()}`, name, path, isActive: false, articleCount: 0 } }
    return fetchJSON("/api/kb", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    })
  },

  /** 健康检查 */
  async healthCheck() {
    if (USE_MOCK) return { ok: true, mock: true }
    try {
      const res = await fetchJSON("/api/auth/status")
      return { ok: true, auth: res, loggedIn: res.logged_in }
    } catch (err) {
      return { ok: false, message: err.message }
    }
  },
}
