/**
 * API 客户端 —— 封装本机采集服务的请求，统一走 mock stub 或真实 fetch
 *
 * 对接真实后端时：把 USE_MOCK 改为 false，BASE_URL 指向 wechat-mp-tools 的 Flask 服务
 * （默认 http://127.0.0.1:5200），下方 fetchJSON 的注释代码即为真实请求骨架。
 *
 * 当前为纯前端原型，全部返回模拟数据。
 */

const USE_MOCK = true
const BASE_URL = "http://127.0.0.1:5200"

/**
 * 真实请求骨架 —— 暂时注释保留，USE_MOCK=false 时启用
 */
// async function fetchJSON(path, options = {}) {
//   const res = await fetch(`${BASE_URL}${path}`, {
//     headers: { "Content-Type": "application/json", ...(options.headers || {}) },
//     ...options,
//   })
//   if (!res.ok) throw new Error(`HTTP ${res.status}`)
//   return res.json()
// }

/** 模拟延迟 —— 让 loading 状态可被感知 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Mock 知识库列表 */
const MOCK_KB_LIST = [
  { id: "default", name: "主知识库", path: "loop/knowledge_base.json", isActive: true, articleCount: 128 },
  { id: "game", name: "游戏赛道", path: "loop/kb/game.json", isActive: false, articleCount: 46 },
  { id: "temp", name: "临时导入", path: "loop/kb/temp.json", isActive: false, articleCount: 7 },
]

/** Mock 任务历史 */
const MOCK_TASKS = [
  { id: "task-003", title: "游戏汇总 · 最近 50 篇", status: "done", at: "11-14 18:40" },
  { id: "task-002", title: "游戏研究社 · 最近 30 篇", status: "done", at: "11-12 09:15" },
  { id: "task-001", title: "手游那点事 · 按日期 10月", status: "error", at: "11-10 14:20" },
]

/** Mock 文章列表 */
const MOCK_ARTICLES = [
  {
    id: "a1", title: "S15 世界赛复盘：两支 LPL 队伍的 BP 思路差异", account: "游戏汇总",
    publishAt: "2026-11-14T09:20:00Z",
    digest: "本届世界赛四强战中，两支 LPL 队伍在面对相同对手时拿出了截然不同的英雄选择。本文从版本理解、选手池深度和教练组风格三个维度拆解这两条路径的优劣。",
    url: "https://mp.weixin.qq.com/s/demo-s15",
  },
  {
    id: "a2", title: "11 月新游观察：三款独立作品在 Switch 上的表现", account: "游戏研究社",
    publishAt: "2026-11-12T15:42:00Z",
    digest: "十一月任天堂 eShop 迎来一波独立游戏小高峰。我们选取三款体量接近的作品，从首日销量、媒体评分到玩家社区反馈进行横向对比。",
    url: "https://mp.weixin.qq.com/s/demo-indie",
  },
  {
    id: "a3", title: "小游戏长线运营的三条路径", account: "手游那点事",
    publishAt: "2026-11-10T07:30:00Z",
    digest: "从《羊了个羊》到今年的几款黑马，小游戏的生命周期正在被拉长。本文拆解三种已被验证的长线玩法：内容季更、UGC 生态和跨端联动。",
    url: "https://mp.weixin.qq.com/s/demo-mini",
  },
  {
    id: "a4", title: "合作派对游戏的设计原则", account: "独立游戏观察",
    publishAt: "2026-11-08T11:05:00Z",
    digest: "派对游戏看似门槛低，真正做好却需要在「协作感」和「挫败感」之间找到微妙的平衡。我们采访了三款爆款派对游戏的核心设计师。",
    url: "https://mp.weixin.qq.com/s/demo-party",
  },
  {
    id: "a5", title: "电竞赞助的 ROI 到底怎么算", account: "电竞产业评论",
    publishAt: "2026-11-05T18:00:00Z",
    digest: "品牌方在电竞领域的投入逐年上涨，但很少有人能清晰回答「这笔钱换来了什么」。本文梳理行业内三种主流的 ROI 评估模型。",
    url: "https://mp.weixin.qq.com/s/demo-sponsor",
  },
  {
    id: "a6", title: "二次元内容产能的瓶颈在哪里", account: "游戏研究社",
    publishAt: "2026-11-03T10:15:00Z",
    digest: "过去两年二次元赛道内容量翻了三倍，但玩家体感上的「精品感」却没有同步增长。本文从 IP 孵化、美术产能和剧本管线三个环节分析瓶颈所在。",
    url: "https://mp.weixin.qq.com/s/demo-anime",
  },
]

export const api = {
  /**
   * 开始采集任务
   * @param {{account: string, count: number}} params
   */
  async startCollect(params) {
    if (USE_MOCK) {
      await delay(400)
      return { taskId: "task_demo", total: 50, ...params }
    }
    // return fetchJSON("/api/articles/collect-latest", { method: "POST", body: JSON.stringify(params) })
  },

  /** 列出所有任务（历史 + 进行中） */
  async listTasks() {
    if (USE_MOCK) { await delay(300); return MOCK_TASKS }
    // return fetchJSON("/api/tasks")
  },

  /**
   * 列出文章（支持搜索和筛选）
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
      if (params.account && params.account !== "all") {
        list = list.filter((a) => a.account === params.account)
      }
      return list
    }
    // const qs = new URLSearchParams(params).toString()
    // return fetchJSON(`/api/articles?${qs}`)
  },

  /** 列出知识库 */
  async listKnowledgeBases() {
    if (USE_MOCK) { await delay(200); return MOCK_KB_LIST }
    // return fetchJSON("/api/kb")
  },

  /** 切换活动知识库 */
  async setActiveKB(id) {
    if (USE_MOCK) { await delay(200); return { ok: true, active: id } }
    // return fetchJSON("/api/kb/active", { method: "POST", body: JSON.stringify({ id }) })
  },

  /** 新增知识库 */
  async createKB({ name, path }) {
    if (USE_MOCK) {
      await delay(300)
      return { id: `kb_${Date.now()}`, name, path, isActive: false, articleCount: 0 }
    }
    // return fetchJSON("/api/kb", { method: "POST", body: JSON.stringify({ name, path }) })
  },
}
