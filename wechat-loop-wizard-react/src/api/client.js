/**
 * API 客户端 —— 对接本机 wechat-mp-tools Flask 服务 + bridge.py 新增端点
 *
 * 切换方式：
 *   - USE_MOCK = false  → 走真实 fetch（Vite dev server 通过 proxy 代理 /api → 127.0.0.1:5200）
 *   - USE_MOCK 切到 true → 用内置 mock 数据（离线预览时的降级通道）
 *
 * 真实后端（bridge.py + wechat-mp-tools）端点：
 *   POST   /api/auth/qrcode                     获取扫码登录二维码
 *   GET    /api/auth/status                     查询扫码登录状态
 *   POST   /api/accounts/search                 搜索公众号（name → fakeid）
 *   POST   /api/articles/collect-latest        启动采集
 *   GET    /api/articles/download-status/<id>  轮询采集进度
 *   GET    /api/articles/history                下载历史（任务列表）
 *   GET    /api/articles/list/<fakeid>         文章列表
 *   POST   /api/articles/download-url          按链接批量下载
 *   ── 账号池 ──
 *   GET    /api/account-pool                    账号池列表
 *   GET    /api/account-pool/summary            账号池概要
 *   POST   /api/account-pool/verify-all         批量校验账号
 *   POST   /api/account-pool/<id>/refresh       刷新账号 Token
 *   POST   /api/account-pool/<id>/revive        复活失效账号
 *   ── RSS 订阅 ──
 *   GET    /api/accounts/rss-subscriptions      RSS 订阅列表
 *   POST   /api/accounts/<fakeid>/rss-subscribe 启用 RSS 订阅
 *   POST   /api/accounts/<fakeid>/rss-force-upload 立即上传待传文章
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

const MOCK_POOL_ACCOUNTS = [
  { id: "acc_demo_1", vid: "10001", nickname: "游戏汇总", avatar: "", status: "active", deviceName: "Xiaomi 14", failures: 0, save_time: 1763000000, last_used: 1763200000, cooldown_until: 0, token_preview: "wk12...9f31", has_refresh_token: true, last_error: null },
  { id: "acc_demo_2", vid: "10002", nickname: "游戏研究社", avatar: "", status: "cooldown", deviceName: "Pixel 8", failures: 2, save_time: 1762900000, last_used: 1763100000, cooldown_until: 1763300000, token_preview: "wr88...1a2b", has_refresh_token: true, last_error: "频率限制" },
  { id: "acc_demo_3", vid: "10003", nickname: "手游那点事", avatar: "", status: "invalid", deviceName: "OnePlus 12", failures: 5, save_time: 1762800000, last_used: 1763000000, cooldown_until: 0, token_preview: "wx77...3c4d", has_refresh_token: false, last_error: "登录已过期" },
]

const MOCK_RSS_SUBSCRIPTIONS = [
  { fakeid: "MzA5MjM0NTY3OA==", nickname: "游戏汇总", interval_minutes: 60, pending_upload_count: 4, quarantined_count: 0, enabled: true, total_articles: 126, last_fetch_count: 8, last_upload_error: null },
]

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

function readErrorBody(message) {
  const raw = String(message || "")
  const idx = raw.indexOf(": ")
  if (!raw.startsWith("HTTP ") || idx < 0) return raw
  const body = raw.slice(idx + 2)
  try {
    const parsed = JSON.parse(body)
    if (parsed?.error) return parsed.error
    if (parsed?.message) return parsed.message
  } catch {
    return body || raw
  }
  return raw
}

function toError(err, fallback) {
  const message = readErrorBody(err?.message) || fallback
  return new Error(message)
}

function normalizePoolAccount(raw = {}) {
  return {
    id: raw.id || "",
    vid: raw.vid || "",
    nickname: raw.nickname || "未命名账号",
    avatar: raw.avatar || "",
    status: raw.status || "active",
    deviceName: raw.deviceName || raw.device_name || "未知设备",
    failures: Number(raw.failures) || 0,
    saveTime: Number(raw.save_time) || 0,
    lastUsed: Number(raw.last_used) || 0,
    cooldownUntil: Number(raw.cooldown_until) || 0,
    tokenPreview: raw.token_preview || "",
    hasRefreshToken: Boolean(raw.has_refresh_token),
    lastError: raw.last_error || "",
  }
}

function normalizeSummary(raw = {}) {
  return {
    total: Number(raw.total) || 0,
    active: Number(raw.active) || 0,
    cooldown: Number(raw.cooldown) || 0,
    invalid: Number(raw.invalid) || 0,
    banned: Number(raw.banned) || 0,
  }
}

function normalizeRssSubscription(raw = {}) {
  return {
    fakeid: raw.fakeid || "",
    nickname: raw.nickname || raw.fakeid || "未命名公众号",
    intervalMinutes: Number(raw.interval_minutes) || 60,
    pendingUploadCount: Number(raw.pending_upload_count) || 0,
    quarantinedCount: Number(raw.quarantined_count) || 0,
    enabled: raw.enabled !== false,
    totalArticles: Number(raw.total_articles) || 0,
    lastFetchTime: Number(raw.last_fetch_time) || 0,
    lastFetchCount: Number(raw.last_fetch_count) || 0,
    lastError: raw.last_error || "",
    lastUploadTime: Number(raw.last_upload_time) || 0,
    lastUploadCount: Number(raw.last_upload_count) || 0,
    lastUploadError: raw.last_upload_error || "",
    nextFetchTime: Number(raw.next_fetch_time) || 0,
  }
}

function normalizeHistory(historyItems = []) {
  const STATUS_MAP = { "completed": "done", "failed": "error", "cancelled": "cancelled", "running": "running" }
  return historyItems.map((h) => ({
    id: h.id || h.task_id || String(h._index ?? Math.random()).slice(-6),
    title: `${h.account || h.account_name || "未知"} · ${h.type === "collect_latest" ? "最近采集" : h.type === "batch" ? "批量下载" : h.type || "下载"}`,
    status: STATUS_MAP[h.status] || h.status || "running",
    at: h.time ? new Date(h.time * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : "",
    count: h.count || h.success_count || 0,
  }))
}

function normalizeTaskStatus(task, taskId) {
  if (!task) return null
  const STATUS_MAP = { "running": "running", "completed": "done", "failed": "error", "cancelled": "cancelled", "success": "done" }
  const total = task.total || task.target_count || 50
  const successCount = task.completed || task.success_count || 0
  const failedCount = task.failed || task.failed_count || 0
  const progress = typeof task.progress === "number"
    ? task.progress
    : task.total
    ? Math.min(100, Math.round(((successCount + failedCount) / task.total) * 100))
    : 0
  const errorHint = task.error || (task.status === "failed" ? (task.stop_reason || "任务失败") : "")
  return {
    id: taskId,
    title: `${task.account_name || task.account || (task.mode === "url_download" ? "链接下载" : "未知")} · 正在采集`,
    status: STATUS_MAP[task.status] || task.status || "running",
    progress,
    total,
    successCount,
    failedCount,
    errorHint,
    current: task.current || "",
  }
}

export const api = {
  /**
   * 获取微信读书扫码登录二维码
   * 返回 { qrcode_url: "data:image/jpeg;base64,..." 或 "https://open.weixin.qq.com/...", uuid: "..." }
   */
  async startLogin() {
    if (USE_MOCK) {
      await delay(300)
      return {
        uuid: "mock-uuid-" + Date.now(),
        qrcode_url: "https://open.weixin.qq.com/connect/qrcode/mock",
        login_state: { status: "scanning", message: "模拟二维码" },
      }
    }
    return fetchJSON("/api/auth/qrcode", { method: "POST" })
  },

  /**
   * 轮询扫码登录状态
   */
  async pollAuthStatus() {
    if (USE_MOCK) { await delay(100); return { loggedIn: false, login_state: { status: "idle", message: "" } } }
    return fetchJSON("/api/auth/status")
  },

  /**
   * 账号池页使用的登录状态（归一化字段）
   */
  async authStatus() {
    if (USE_MOCK) {
      await delay(150)
      return {
        loggedIn: true,
        loginState: { status: "success", message: "模拟环境已登录" },
        tokenPreview: "wk12...9f31",
        saveTime: 1763000000,
        message: "登录有效",
        accountInfo: { nickname: "游戏汇总", avatar: "", vid: "10001" },
      }
    }
    try {
      const res = await fetchJSON("/api/auth/status")
      return {
        loggedIn: Boolean(res?.logged_in),
        loginState: res?.login_state || { status: "idle", message: "" },
        tokenPreview: res?.token_preview || "",
        saveTime: Number(res?.save_time) || 0,
        message: res?.message || "",
        accountInfo: res?.account_info || null,
      }
    } catch (err) {
      throw toError(err, "读取登录状态失败")
    }
  },

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

  async listKnowledgeBases() {
    if (USE_MOCK) { await delay(200); return MOCK_KB_LIST }
    try {
      return await fetchJSON("/api/kb")
    } catch (err) {
      console.warn("[api] listKnowledgeBases 失败:", err.message)
      return []
    }
  },

  async setActiveKB(id) {
    if (USE_MOCK) { await delay(200); return { ok: true, active: id } }
    return fetchJSON("/api/kb/active", {
      method: "POST",
      body: JSON.stringify({ id }),
    })
  },

  async createKB({ name, path }) {
    if (USE_MOCK) { await delay(300); return { id: `kb_${Date.now()}`, name, path, isActive: false, articleCount: 0 } }
    return fetchJSON("/api/kb", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    })
  },

  /**
   * 账号池列表
   * 返回 { accounts: [{id, vid, nickname, avatar, status, deviceName, failures,
   *   saveTime, lastUsed, cooldownUntil, tokenPreview, hasRefreshToken, lastError}], total }
   */
  async listPool() {
    if (USE_MOCK) {
      await delay(250)
      return { accounts: MOCK_POOL_ACCOUNTS.map(normalizePoolAccount), total: MOCK_POOL_ACCOUNTS.length }
    }
    try {
      const res = await fetchJSON("/api/account-pool")
      const accounts = (res?.accounts || []).map(normalizePoolAccount)
      return { accounts, total: Number(res?.total) || accounts.length }
    } catch (err) {
      throw toError(err, "读取账号池失败")
    }
  },

  /**
   * 账号池概要 { total, active, cooldown, invalid, banned }
   */
  async poolSummary() {
    if (USE_MOCK) {
      await delay(150)
      return normalizeSummary({
        total: MOCK_POOL_ACCOUNTS.length,
        active: 1,
        cooldown: 1,
        invalid: 1,
        banned: 0,
      })
    }
    try {
      return normalizeSummary(await fetchJSON("/api/account-pool/summary"))
    } catch (err) {
      throw toError(err, "读取账号池概要失败")
    }
  },

  /**
   * 批量校验账号
   * 返回 { results, summary }
   */
  async verifyAllAccounts() {
    if (USE_MOCK) {
      await delay(700)
      return { results: MOCK_POOL_ACCOUNTS.map(normalizePoolAccount), summary: normalizeSummary({ total: 3, active: 2, cooldown: 1, invalid: 0, banned: 0 }) }
    }
    try {
      const res = await fetchJSON("/api/account-pool/verify-all", { method: "POST" })
      return {
        results: (res?.results || []).map(normalizePoolAccount),
        summary: normalizeSummary(res?.summary),
      }
    } catch (err) {
      throw toError(err, "校验账号失败")
    }
  },

  /**
   * 刷新单个账号 Token
   * 返回 { ok, message, needsScan }
   */
  async refreshAccount(id) {
    if (USE_MOCK) { await delay(500); return { ok: true, message: "账号 Token 刷新成功", needsScan: false } }
    try {
      const res = await fetchJSON(`/api/account-pool/${encodeURIComponent(id)}/refresh`, { method: "POST" })
      return {
        ok: Boolean(res?.ok),
        message: res?.message || (res?.ok ? "账号 Token 刷新成功" : "刷新失败，请重新扫码登录"),
        needsScan: Boolean(res?.needs_scan),
      }
    } catch (err) {
      throw toError(err, "刷新账号失败")
    }
  },

  /**
   * 复活失效账号
   * 返回 { message, verifyResult }
   */
  async reviveAccount(id) {
    if (USE_MOCK) { await delay(500); return { message: "已重新激活并验证", verifyResult: null } }
    try {
      const res = await fetchJSON(`/api/account-pool/${encodeURIComponent(id)}/revive`, { method: "POST" })
      return {
        message: res?.message || "已重新激活并验证",
        verifyResult: res?.verify_result ? normalizePoolAccount(res.verify_result) : null,
      }
    } catch (err) {
      throw toError(err, "复活账号失败")
    }
  },

  /**
   * 按链接批量下载文章
   * 返回 { taskId, message }
   */
  async downloadByUrls(urls) {
    const list = (Array.isArray(urls) ? urls : [])
      .map((u) => String(u || "").trim())
      .filter(Boolean)
    if (!list.length) throw new Error("请至少输入一个文章链接")
    if (USE_MOCK) {
      await delay(400)
      return { taskId: `url_demo_${Date.now()}`, message: `已启动下载任务，共 ${list.length} 篇` }
    }
    try {
      const res = await fetchJSON("/api/articles/download-url", {
        method: "POST",
        body: JSON.stringify({ urls: list }),
      })
      return { taskId: res?.task_id || "", message: res?.message || "" }
    } catch (err) {
      throw toError(err, "启动链接下载失败")
    }
  },

  /**
   * RSS 订阅列表
   * 返回 { subscriptions: [{fakeid, nickname, intervalMinutes, pendingUploadCount,
   *   quarantinedCount, enabled, totalArticles, lastError, ...}] }
   */
  async listRssSubscriptions() {
    if (USE_MOCK) {
      await delay(250)
      return { subscriptions: MOCK_RSS_SUBSCRIPTIONS.map(normalizeRssSubscription) }
    }
    try {
      const res = await fetchJSON("/api/accounts/rss-subscriptions")
      return { subscriptions: (res?.subscriptions || []).map(normalizeRssSubscription) }
    } catch (err) {
      throw toError(err, "读取 RSS 订阅失败")
    }
  },

  /**
   * 立即上传某订阅的待传文章
   */
  async forceRssUpload(fakeid) {
    if (USE_MOCK) { await delay(700); return { success: true, count: 4, failed: 0, quarantined: 0, pendingCount: 0, error: "", message: "上传成功 4 篇" } }
    try {
      const res = await fetchJSON(`/api/accounts/${encodeURIComponent(fakeid)}/rss-force-upload`, { method: "POST" })
      const count = Number(res?.count) || 0
      const failed = Number(res?.failed) || 0
      const quarantined = Number(res?.quarantined) || 0
      return {
        success: res?.success !== false,
        count,
        failed,
        quarantined,
        pendingCount: Number(res?.pending_count) || 0,
        error: res?.error || "",
        message: res?.error || (count > 0 ? `上传成功 ${count} 篇` : "没有待上传的文章"),
      }
    } catch (err) {
      throw toError(err, "立即上传失败")
    }
  },

  /**
   * 启用 RSS 订阅
   * 返回 { subscription, message }
   */
  async subscribeRss(fakeid, intervalMinutes = 60) {
    if (USE_MOCK) {
      await delay(300)
      return { subscription: normalizeRssSubscription({ fakeid, nickname: fakeid, interval_minutes: intervalMinutes }), message: "已启用 RSS 自动抓取" }
    }
    try {
      const res = await fetchJSON(`/api/accounts/${encodeURIComponent(fakeid)}/rss-subscribe`, {
        method: "POST",
        body: JSON.stringify({ interval_minutes: intervalMinutes }),
      })
      return {
        subscription: res?.subscription ? normalizeRssSubscription(res.subscription) : null,
        message: res?.message || "已启用 RSS 自动抓取",
      }
    } catch (err) {
      throw toError(err, "启用 RSS 订阅失败")
    }
  },

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
