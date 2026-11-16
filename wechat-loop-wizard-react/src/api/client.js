/**
 * API 客户端 —— 对接本机 wechat-mp-tools Flask 服务
 *
 * 切换方式：
 *   - USE_MOCK = false  → 走真实 fetch（Vite dev server 已配 /api 代理到 127.0.0.1:5200）
 *   - USE_MOCK = true   → 用内置 mock 数据（离线预览时的降级通道）
 *
 * 真实后端（wechat-mp-tools）可用端点参考：
 *   POST   /api/articles/collect-latest   启动采集（需先 fakeid 搜索）
 *   POST   /api/articles/download          单篇下载
 *   POST   /api/articles/download-url      下载公开文章链接
 *   GET    /api/articles/download-status/<task_id>   轮询进度
 *   GET    /api/articles/list/<fakeid>     文章列表
 *   POST   /api/accounts/search             搜索公众号（name → fakeid）
 *   GET    /api/auth/status                 扫码登录状态
 *   POST   /api/auth/login                  扫码登录
 */

/** 真实后端地址（Vite dev server 通过 proxy 已处理 CORS，这里用相对路径） */
const USE_MOCK = false

/**
 * 统一 fetch 封装
 * @param {string} path
 * @param {object} [options]
 */
async function fetchJSON(path, options = {}) {
  const url = path.startsWith("http") ? path : path
  const res = await fetch(url, {
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
  {
    id: "a1", title: "S15 世界赛复盘：两支 LPL 队伍的 BP 思路差异", account: "游戏汇总",
    publishAt: "2026-11-14T09:20:00Z",
    digest: "本届世界赛四强战中，两支 LPL 队伍在面对相同对手时拿出了截然不同的英雄选择。",
    url: "https://mp.weixin.qq.com/s/demo-s15",
  },
  {
    id: "a2", title: "11 月新游观察：三款独立作品在 Switch 上的表现", account: "游戏研究社",
    publishAt: "2026-11-12T15:42:00Z",
    digest: "十一月任天堂 eShop 迎来一波独立游戏小高峰。",
    url: "https://mp.weixin.qq.com/s/demo-indie",
  },
  {
    id: "a3", title: "小游戏长线运营的三条路径", account: "手游那点事",
    publishAt: "2026-11-10T07:30:00Z",
    digest: "从《羊了个羊》到今年的几款黑马，小游戏的生命周期正在被拉长。",
    url: "https://mp.weixin.qq.com/s/demo-mini",
  },
  {
    id: "a4", title: "合作派对游戏的设计原则", account: "独立游戏观察",
    publishAt: "2026-11-08T11:05:00Z",
    digest: "派对游戏看似门槛低，真正做好却需要在协作感和挫败感之间找到平衡。",
    url: "https://mp.weixin.qq.com/s/demo-party",
  },
  {
    id: "a5", title: "电竞赞助的 ROI 到底怎么算", account: "电竞产业评论",
    publishAt: "2026-11-05T18:00:00Z",
    digest: "品牌方在电竞领域的投入逐年上涨，但很少有人能清晰回答这笔钱换来了什么。",
    url: "https://mp.weixin.qq.com/s/demo-sponsor",
  },
  {
    id: "a6", title: "二次元内容产能的瓶颈在哪里", account: "游戏研究社",
    publishAt: "2026-11-03T10:15:00Z",
    digest: "过去两年二次元赛道内容量翻了三倍，但玩家体感上的精品感却没有同步增长。",
    url: "https://mp.weixin.qq.com/s/demo-anime",
  },
]

/** 模拟延迟 */
function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

export const api = {
  /**
   * 开始采集 —— 真实流程：先搜索公众号拿 fakeid → 再 collect-latest
   * @param {{account: string, count: number}} params
   */
  async startCollect({ account, count }) {
    if (USE_MOCK) { await delay(400); return { taskId: "task_demo", total: count, account } }
    // Step 1: 搜索公众号拿 fakeid
    const searchRes = await fetchJSON("/api/accounts/search", {
      method: "POST",
      body: JSON.stringify({ keyword: account }),
    }).catch(() => null)
    const fakeid = searchRes?.accounts?.[0]?.fakeid
    if (!fakeid) {
      throw new Error(`未找到公众号「${account}」，请确认名称或先搜索。`)
    }
    // Step 2: 启动采集任务
    const collectRes = await fetchJSON("/api/articles/collect-latest", {
      method: "POST",
      body: JSON.stringify({ fakeid, account_name: account, limit: count, skip_existing: true }),
    })
    return { taskId: collectRes.task_id, total: count, account }
  },

  /** 列出所有任务 —— 真实后端暂无此端点，返回空数组 */
  async listTasks() {
    if (USE_MOCK) { await delay(300); return MOCK_TASKS }
    try {
      return await fetchJSON("/api/tasks")
    } catch {
      // wechat-mp-tools 没有 /api/tasks，降级返回空数组 + 错误提示
      console.warn("[api] /api/tasks 未实现，返回空列表")
      return []
    }
  },

  /**
   * 列出文章 —— 真实后端需要 fakeid，这里用公众号名搜索后拉取
   * @param {{query?: string, account?: string}} [params]
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
    // 真实流程：如果指定了公众号，先搜索 fakeid → 拉列表 → 字段归一化
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
      // query 前端过滤（真实后端没提供搜索）
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

  /** 列出知识库 —— 真实后端暂无，返回空数组 */
  async listKnowledgeBases() {
    if (USE_MOCK) { await delay(200); return MOCK_KB_LIST }
    console.warn("[api] /api/kb 未实现，返回空列表")
    return []
  },

  /** 切换活动知识库 —— 真实后端暂无 */
  async setActiveKB(id) {
    if (USE_MOCK) { await delay(200); return { ok: true, active: id } }
    console.warn("[api] /api/kb/active 未实现")
    return { ok: false, reason: "后端未实现" }
  },

  /** 新增知识库 —— 真实后端暂无 */
  async createKB({ name, path }) {
    if (USE_MOCK) { await delay(300); return { id: `kb_${Date.now()}`, name, path, isActive: false, articleCount: 0 } }
    console.warn("[api] /api/kb 未实现")
    return null
  },

  /** 检查服务是否在线 */
  async healthCheck() {
    if (USE_MOCK) return { ok: true, mock: true }
    try {
      const res = await fetchJSON("/api/auth/status")
      return { ok: true, auth: res }
    } catch (err) {
      return { ok: false, message: err.message }
    }
  },
}
