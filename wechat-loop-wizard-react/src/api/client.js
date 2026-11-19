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
 *   GET    /api/accounts                        已收藏公众号列表
 *   POST   /api/accounts/search                 搜索公众号（关键字 / 链接 / biz）
 *   POST   /api/accounts                        收藏/添加公众号
 *   DELETE /api/accounts/<fakeid>               取消收藏公众号
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
    const raw = await res.text().catch(() => "")
    // 后端错误统一是 {"error": "人话"}，直接抽出来；
    // 否则（Flask 默认 HTML 错误页）只留状态码，避免把整页 HTML 甩到界面上
    let detail = ""
    try {
      const parsed = JSON.parse(raw)
      detail = parsed?.error || parsed?.message || ""
    } catch {
      detail = ""
    }
    const err = new Error(detail || `请求失败（HTTP ${res.status}）`)
    err.status = res.status
    err.raw = raw
    throw err
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

function normalizeAccount(raw = {}) {
  const fakeid = raw.fakeid || raw.fake_id || raw.biz || raw.id || ""
  const bookId = raw.bookId || raw.book_id || ""
  return {
    // 老版本收藏记录可能只有 bookId，这里用它兜底；
    // 上游 biz_to_book_id 对 MP_ 开头的 id 会原样返回，可直接当 fakeid 用
    fakeid: fakeid || bookId,
    bookId: bookId || fakeid,
    nickname: raw.nickname || raw.alias || "未命名公众号",
    avatar: raw.round_head_img || raw.avatar || "",
    signature: raw.signature || "",
    subscribeCount: Number(raw.subscribe_count) || 0,
    updateTime: Number(raw.update_time || raw.added_time) || 0,
  }
}

function normalizeArticle(raw = {}) {
  return {
    id: raw.id || raw.article_id || raw.appmsgid || String(Math.random()).slice(-8),
    title: raw.title || "未命名文章",
    author: raw.author || "",
    publishAt: raw.update_time || raw.create_time || 0,
    digest: raw.digest || "",
    url: raw.link || raw.url || "",
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

  // ── 下载历史浏览（单文章维度） ──

  /**
   * 拉取下载历史（单文章维度，按时间倒序）
   * 返回 { items: [...], total }
   * 每个 item: { _index, title, account, link, success, time, path, displayPath, hasMarkdown, hasPdf, digest, error }
   */
  async listHistory() {
    if (USE_MOCK) {
      await delay(300)
      return {
        items: [
          { _index: 0, title: "S15 世界赛复盘：两支 LPL 队伍的 BP 思路差异", account: "游戏汇总", link: "https://mp.weixin.qq.com/s/demo-s15", success: true, time: 1763130000, path: "downloads/游戏汇总/S15世界赛复盘.md", displayPath: "~/Downloads/游戏汇总/S15世界赛复盘.md", hasMarkdown: true, hasPdf: false, digest: "本届世界赛四强战中...", error: "" },
          { _index: 1, title: "11 月新游观察：三款独立作品在 Switch 上的表现", account: "游戏研究社", link: "https://mp.weixin.qq.com/s/demo-indie", success: true, time: 1762950000, path: "downloads/游戏研究社/11月新游观察.md", displayPath: "~/Downloads/游戏研究社/11月新游观察.md", hasMarkdown: true, hasPdf: true, digest: "十一月任天堂 eShop 迎来一波...", error: "" },
          { _index: 2, title: "小游戏长线运营的三条路径", account: "手游那点事", link: "https://mp.weixin.qq.com/s/demo-mini", success: false, time: 1762770000, path: "", displayPath: "", hasMarkdown: false, hasPdf: false, digest: "", error: "目标页面不存在或已被删除" },
        ],
        total: 3,
      }
    }
    try {
      const res = await fetchJSON("/api/articles/history?limit=999999")
      const items = (res.history || []).map((h) => ({
        _index: h._index ?? null,
        title: h.title || "",
        account: h.account || h.account_name || "",
        link: h.link || "",
        success: Boolean(h.success),
        time: Number(h.time) || 0,
        publishAt: Number(h.publish_time) || 0,
        cover_url: h.cover_url || "",
        path: h.path || "",
        displayPath: h.display_path || "",
        hasMarkdown: Boolean(h.has_markdown),
        hasPdf: Boolean(h.has_pdf),
        digest: h.digest || "",
        error: h.error || "",
      }))
      return { items, total: Number(res.total) || items.length }
    } catch (err) {
      throw toError(err, "读取下载历史失败")
    }
  },

  /**
   * 删除下载历史（全部 或 单条）
   * @param {number} [index] 不传则清空全部；传数字则删除对应下标语
   */
  async deleteHistory(index) {
    if (USE_MOCK) {
      await delay(300)
      return { ok: true, message: typeof index === "number" ? "已删除该条记录" : "历史已清空" }
    }
    try {
      const url = typeof index === "number" && index >= 0
        ? `/api/articles/history/${encodeURIComponent(index)}`
        : "/api/articles/history"
      const res = await fetch(url, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
      }
      return await res.json()
    } catch (err) {
      throw toError(err, "删除历史失败")
    }
  },

  /**
   * 在系统默认程序中打开文件
   * @param {string} filePath 绝对路径
   * @param {"md"|"pdf"} [targetType] 当 filePath 是目录时，指定打开其中哪种文件
   */
  async openFile(filePath, targetType) {
    if (USE_MOCK) { await delay(200); return { ok: true, message: "已打开" } }
    try {
      const body = { path: filePath }
      if (targetType) body.type = targetType
      return await fetchJSON("/api/articles/open-file", {
        method: "POST",
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw toError(err, "打开文件失败")
    }
  },

  /**
   * 打开公众号下载目录（或指定的绝对路径文件夹）
   * @param {string} dirPathOrAccount 绝对路径 或 公众号名称（后端会自动定位 download_dir/account）
   */
  async openFolder(dirPathOrAccount) {
    if (USE_MOCK) { await delay(200); return { ok: true, message: "文件夹已打开" } }
    try {
      const body = dirPathOrAccount && /^[\/~]/.test(dirPathOrAccount)
        ? { path: dirPathOrAccount }
        : { account: dirPathOrAccount }
      return await fetchJSON("/api/articles/open-folder", {
        method: "POST",
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw toError(err, "打开文件夹失败")
    }
  },

  /**
   * 在系统文件管理器中打开文件所在目录（并高亮文件）
   * @param {string} filePath 绝对路径
   */
  async openParent(filePath) {
    if (USE_MOCK) { await delay(200); return { ok: true, message: "已打开所在目录" } }
    try {
      return await fetchJSON("/api/articles/open-parent", {
        method: "POST",
        body: JSON.stringify({ path: filePath }),
      })
    } catch (err) {
      throw toError(err, "打开所在目录失败")
    }
  },

  // ── 公众号管理 ──────────────────────────────────────

  /**
   * 已收藏的公众号列表
   * GET /api/accounts
   * 返回 { accounts: [{fakeid, bookId, nickname, avatar, signature, subscribeCount, updateTime}], total }
   */
  async listFavorites() {
    if (USE_MOCK) {
      await delay(200)
      return { accounts: [], total: 0 }
    }
    try {
      const res = await fetchJSON("/api/accounts")
      const accounts = (res?.accounts || []).map(normalizeAccount)
      return { accounts, total: Number(res?.total) || accounts.length }
    } catch (err) {
      throw toError(err, "读取公众号列表失败")
    }
  },

  /**
   * 从微信读书书架同步「已关注公众号」候选列表
   * GET /api/accounts/user-mps?force=0|1
   * 返回 { mps: [{fakeid, bookId, nickname, avatar, signature}], total, cached,
   *        throttled?, cooldown_left?, need_verify?, error? }
   */
  async listUserMps({ force = false, timeoutMs = 75000 } = {}) {
    if (USE_MOCK) {
      await delay(300)
      return { mps: [], total: 0, cached: false }
    }
    // 后端要真去请求微信读书，正常情况下 5–20 秒；不设超时会让按钮永远「同步中…」
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchJSON(`/api/accounts/user-mps${force ? "?force=1" : ""}`, {
        signal: ctrl.signal,
      })
      const mps = (res?.mps || []).map(normalizeAccount)
      return {
        mps,
        total: Number(res?.total) || mps.length,
        cached: !!res?.cached,
        throttled: !!res?.throttled,
        cooldownLeft: Number(res?.cooldown_left) || 0,
        needVerify: !!res?.need_verify,
        error: res?.error || "",
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`微信读书 ${Math.round(timeoutMs / 1000)} 秒内没有返回，请重试；若反复超时通常是账号被风控`)
      }
      if (err?.status === 401) {
        throw new Error(err.message || "微信读书账号池里没有可用账号，请先去『账号池』扫码登录")
      }
      throw toError(err, "从微信读书同步失败")
    } finally {
      window.clearTimeout(timer)
    }
  },

  /**
   * RSS 订阅状态
   * GET /api/accounts/rss-subscriptions
   * 返回 { subscriptions: [{fakeid, enabled, interval_minutes, last_fetch_time, ...}] }
   */
  async rssSubscriptions() {
    if (USE_MOCK) return { subscriptions: [] }
    try {
      const res = await fetchJSON("/api/accounts/rss-subscriptions")
      return { subscriptions: res?.subscriptions || [] }
    } catch (err) {
      throw toError(err, "读取 RSS 订阅失败")
    }
  },

  /**
   * 开启 / 更新 RSS 自动抓取
   * POST /api/accounts/<fakeid>/rss-subscribe  body: { interval_minutes }
   */
  async rssSubscribe(fakeid, intervalMinutes = 60) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (USE_MOCK) return { ok: true }
    try {
      const res = await fetchJSON(`/api/accounts/${encodeURIComponent(fakeid)}/rss-subscribe`, {
        method: "POST",
        body: JSON.stringify({ interval_minutes: intervalMinutes }),
      })
      return { ok: true, subscription: res?.subscription, message: res?.message || "已启用 RSS 自动抓取" }
    } catch (err) {
      throw toError(err, "开启 RSS 失败")
    }
  },

  /**
   * 关闭 RSS 自动抓取
   * DELETE /api/accounts/<fakeid>/rss-subscribe
   */
  async rssUnsubscribe(fakeid) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (USE_MOCK) return { ok: true }
    try {
      await fetchJSON(`/api/accounts/${encodeURIComponent(fakeid)}/rss-subscribe`, { method: "DELETE" })
      return { ok: true }
    } catch (err) {
      throw toError(err, "关闭 RSS 失败")
    }
  },

  /**
   * 搜索公众号（按关键字 / 文章链接 / biz）
   * POST /api/accounts/search  body: { keyword }
   * 返回 { results: [{fakeid, bookId, nickname, avatar, signature}] }
   */
  async searchAccounts(keyword) {
    const kw = String(keyword || "").trim()
    if (!kw) throw new Error("请输入搜索关键字或文章链接")
    if (USE_MOCK) {
      await delay(350)
      return { results: [] }
    }
    try {
      const res = await fetchJSON("/api/accounts/search", {
        method: "POST",
        body: JSON.stringify({ keyword: kw }),
      })
      const results = (res?.results || []).map(normalizeAccount)
      return { results }
    } catch (err) {
      throw toError(err, "搜索公众号失败")
    }
  },

  /**
   * 收藏/添加公众号
   * POST /api/accounts  body: { fakeid, nickname, bookId?, avatar? }
   * 返回 { ok, account, message }
   * @param {{fakeid: string, nickname?: string, bookId?: string, avatar?: string}} payload
   */
  async addFavorite(payload) {
    if (!payload?.fakeid) throw new Error("缺少 fakeid")
    if (!payload?.nickname) throw new Error("缺少公众号名称")
    if (USE_MOCK) {
      await delay(250)
      return { ok: true, account: normalizeAccount(payload), message: "添加成功" }
    }
    try {
      const body = { fakeid: payload.fakeid, nickname: payload.nickname }
      if (payload.bookId) body.bookId = payload.bookId
      if (payload.avatar) body.round_head_img = payload.avatar
      const res = await fetchJSON("/api/accounts", {
        method: "POST",
        body: JSON.stringify(body),
      })
      return {
        ok: true,
        account: res?.account
          ? normalizeAccount(res.account)
          : normalizeAccount({ ...payload, update_time: Math.floor(Date.now() / 1000) }),
        message: res?.message || "添加成功",
      }
    } catch (err) {
      throw toError(err, "添加公众号失败")
    }
  },

  /**
   * 取消收藏公众号
   * DELETE /api/accounts/<fakeid>
   * 返回 { ok }
   */
  async removeFavorite(fakeid) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (USE_MOCK) { await delay(200); return { ok: true } }
    try {
      await fetchJSON(`/api/accounts/${encodeURIComponent(fakeid)}`, { method: "DELETE" })
      return { ok: true }
    } catch (err) {
      throw toError(err, "取消收藏失败")
    }
  },

  /**
   * 分页获取指定公众号的文章列表
   * GET /api/articles/list/<fakeid>?begin=<begin>&count=<count>
   * @param {string} fakeid
   * @param {{begin?: number, count?: number}} [options]
   * 返回 { articles, total, canContinue, throttled, cooldownLeft }
   */
  async listArticlesPage(fakeid, { begin = 0, count = 20 } = {}) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (USE_MOCK) {
      await delay(300)
      return { articles: [], total: 0, canContinue: false, throttled: false, cooldownLeft: 0 }
    }
    try {
      const qs = new URLSearchParams({ begin: String(begin), count: String(count) }).toString()
      const res = await fetchJSON(`/api/articles/list/${encodeURIComponent(fakeid)}?${qs}`)
      const articles = (res?.articles || []).map(normalizeArticle)
      return {
        articles,
        total: Number(res?.total) || articles.length,
        canContinue: Boolean(res?.can_msg_continue) || articles.length >= count,
        throttled: Boolean(res?.throttled),
        cooldownLeft: Number(res?.cooldown_left) || 0,
      }
    } catch (err) {
      throw toError(err, "读取文章列表失败")
    }
  },

  // ── 原版 articles.js 对应 ──────────────────────────────

  /**
   * 一键采集所有已关注公众号最新文章
   * POST /api/articles/collect-all
   * 返回 { taskId, message }
   * @param {{limit?: number, skipExisting?: boolean}} [options]
   */
  async collectAllLatest({ limit = 50, skipExisting = true } = {}) {
    if (USE_MOCK) {
      await delay(400)
      return { taskId: `collect_all_${Date.now()}`, message: `已启动全量采集，每号约 ${limit} 篇` }
    }
    try {
      const res = await fetchJSON("/api/articles/collect-all", {
        method: "POST",
        body: JSON.stringify({ limit, skip_existing: skipExisting }),
      })
      return { taskId: res?.task_id || "", message: res?.message || "已启动全量采集" }
    } catch (err) {
      throw toError(err, "启动全量采集失败")
    }
  },

  /**
   * 启动批量下载任务
   * POST /api/articles/download  body: { articles: [...], account_name }
   * 返回 { taskId, message }
   * @param {{ articles: Array<{link:string,title?:string,digest?:string,update_time?:number}>, account_name: string }} payload
   */
  async startDownload({ articles, account_name = "" }) {
    const list = (Array.isArray(articles) ? articles : []).filter((a) => a && a.link)
    if (!list.length) throw new Error("请至少选择一篇有链接的文章")
    if (USE_MOCK) {
      await delay(300)
      return { taskId: `dl_${Date.now()}`, message: `已启动下载，共 ${list.length} 篇` }
    }
    try {
      const res = await fetchJSON("/api/articles/download", {
        method: "POST",
        body: JSON.stringify({ articles: list, account_name }),
      })
      if (!res?.task_id) throw new Error("服务未返回 task_id")
      return { taskId: res.task_id, message: res.message || `已启动下载 ${list.length} 篇` }
    } catch (err) {
      throw toError(err, "启动下载失败")
    }
  },

  /**
   * 按链接批量下载（不依赖公众号）
   * POST /api/articles/download-url  body: { urls: [...] }
   */
  async startDownloadByUrl(urls) {
    const list = (Array.isArray(urls) ? urls : [])
      .map((u) => String(u || "").trim())
      .filter(Boolean)
    if (!list.length) throw new Error("请输入有效的文章链接")
    if (USE_MOCK) {
      await delay(300)
      return { taskId: `url_dl_${Date.now()}`, message: `已启动链接下载 ${list.length} 篇` }
    }
    try {
      const res = await fetchJSON("/api/articles/download-url", {
        method: "POST",
        body: JSON.stringify({ urls: list }),
      })
      return { taskId: res?.task_id || "", message: res?.message || "" }
    } catch (err) {
      throw toError(err, "按链接下载失败")
    }
  },

  /**
   * 轮询下载任务状态
   * GET /api/articles/download-status/<taskId>
   * 返回原始 task 对象
   */
  async fetchDownloadStatus(taskId) {
    if (!taskId) throw new Error("缺少 taskId")
    if (USE_MOCK) return null
    try {
      return await fetchJSON(`/api/articles/download-status/${encodeURIComponent(taskId)}`)
    } catch (err) {
      if (err?.message?.includes("404")) return null
      throw err
    }
  },

  /**
   * 取消下载任务
   * POST /api/articles/download-cancel/<taskId>
   */
  async cancelDownloadTask(taskId) {
    if (!taskId) throw new Error("缺少 taskId")
    if (USE_MOCK) return { ok: true }
    try {
      return await fetchJSON(`/api/articles/download-cancel/${encodeURIComponent(taskId)}`, {
        method: "POST",
      })
    } catch (err) {
      throw toError(err, "停止下载失败")
    }
  },

  /**
   * 清空下载历史（POST，原版 history.js 用 POST /api/articles/clear-history）
   * 现有 deleteHistory() 已经 DELETE /api/articles/history，直接用它清空即可
   */
  async clearHistoryPosts() {
    if (USE_MOCK) { await delay(300); return { ok: true, message: "历史已清空" } }
    try {
      return await fetchJSON("/api/articles/clear-history", { method: "POST" })
    } catch (err) {
      // 兼容后端只实现了 DELETE /api/articles/history
      if (err?.message?.includes("404")) {
        return fetchJSON("/api/articles/history", { method: "DELETE" })
      }
      throw toError(err, "清空历史失败")
    }
  },

  /**
   * 获取系统设置（rss_token 等）
   * GET /api/settings
   */
  async fetchSettings() {
    if (USE_MOCK) return { rss_token: "", rss_base_url: "" }
    try {
      const res = await fetchJSON("/api/settings")
      return {
        rssToken: res?.rss_token || "",
        rssBaseUrl: (res?.rss_base_url || "").replace(/\/+$/, ""),
        ...res,
      }
    } catch (err) {
      console.warn("[api] fetchSettings 失败:", err.message)
      return { rssToken: "", rssBaseUrl: "" }
    }
  },

  /**
   * 原版风格的文章列表（完整字段，不做 normalize）
   * GET /api/articles/list/<fakeid>?begin=&count=20
   * 返回原始 { articles, total, can_msg_continue, ... }
   */
  async fetchArticlesListRaw(fakeid, { begin = 0, count = 20 } = {}) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (USE_MOCK) {
      await delay(300)
      return { articles: [], total: 0, can_msg_continue: 0 }
    }
    try {
      const qs = new URLSearchParams({ begin: String(begin), count: String(count) }).toString()
      return await fetchJSON(`/api/articles/list/${encodeURIComponent(fakeid)}?${qs}`)
    } catch (err) {
      throw toError(err, "读取文章列表失败")
    }
  },

  // ── 网址下载 & 内容过滤 ──────────────────────────────────

  /**
   * 按链接批量下载（单复数别名，与原版 download.js 对齐）
   * POST /api/articles/download-url  body: { urls: [...] }
   * 返回 { task_id, message }
   * @param {string[]} urls
   */
  async downloadByUrl(urls) {
    return this.downloadByUrls(urls)
  },

  /**
   * 查询下载任务状态
   * GET /api/articles/download-status/<taskId>
   * 返回 { status, current, total, completed, failed, ... }
   * @param {string} taskId
   */
  async downloadStatus(taskId) {
    if (!taskId) throw new Error("缺少 taskId")
    if (USE_MOCK) {
      await delay(200)
      return { status: "running", current: "模拟下载中", total: 3, completed: 1, failed: 0 }
    }
    try {
      return await fetchJSON(`/api/articles/download-status/${encodeURIComponent(taskId)}`)
    } catch (err) {
      throw toError(err, "查询下载状态失败")
    }
  },

  /**
   * 停止下载任务
   * POST /api/articles/download-cancel/<taskId>
   * @param {string} taskId
   */
  async cancelDownload(taskId) {
    if (!taskId) throw new Error("缺少 taskId")
    if (USE_MOCK) { await delay(100); return { ok: true, message: "已请求停止" } }
    try {
      return await fetchJSON(`/api/articles/download-cancel/${encodeURIComponent(taskId)}`, {
        method: "POST",
        body: JSON.stringify({ task_id: taskId }),
      })
    } catch (err) {
      throw toError(err, "停止下载失败")
    }
  },

  /**
   * 读取内容过滤设置
   * GET /api/articles/content-filter
   * 返回 { rules: { enabled, banner_images, remove_image_keywords, remove_text_keywords } }
   */
  async contentFilter() {
    if (USE_MOCK) {
      await delay(150)
      return {
        rules: {
          enabled: true,
          banner_images: { enabled: true, max_ratio: 0.22, min_width: 500 },
          remove_image_keywords: ["分割线", "二维码", "扫码"],
          remove_text_keywords: ["点击上方蓝字", "扫码关注"],
        },
      }
    }
    try {
      return await fetchJSON("/api/articles/content-filter")
    } catch (err) {
      throw toError(err, "读取过滤设置失败")
    }
  },

  /**
   * 保存内容过滤设置
   * POST /api/articles/content-filter  body: { rules }
   * @param {object} rules
   */
  async saveContentFilter(rules) {
    if (USE_MOCK) { await delay(200); return { ok: true } }
    try {
      return await fetchJSON("/api/articles/content-filter", {
        method: "POST",
        body: JSON.stringify({ rules }),
      })
    } catch (err) {
      throw toError(err, "保存过滤设置失败")
    }
  },

  /**
   * 将过滤规则应用到已下载的文章
   * POST /api/articles/content-filter/apply-existing  body: { dry_run? }
   * 返回 { scanned, changed }
   * @param {{dry_run?: boolean}} [options]
   */
  async applyContentFilter(options = {}) {
    if (USE_MOCK) {
      await delay(400)
      const scanned = 56
      const changed = 12
      return { scanned, changed, message: options.dry_run
        ? `预览：扫描 ${scanned} 篇，预计改写 ${changed} 篇`
        : `已改写 ${changed} 篇` }
    }
    try {
      return await fetchJSON("/api/articles/content-filter/apply-existing", {
        method: "POST",
        body: JSON.stringify({ dry_run: options.dry_run !== false }),
      })
    } catch (err) {
      throw toError(err, "应用过滤失败")
    }
  },

  /**
   * 打开下载目录（label 版 —— 与原版 download.js 对齐）
   * POST /api/articles/open-folder  body: { label }
   * @param {string} [label="url_download"]
   */
  async openFolderByLabel(label = "url_download") {
    if (USE_MOCK) { await delay(100); return { ok: true } }
    try {
      return await fetchJSON("/api/articles/open-folder", {
        method: "POST",
        body: JSON.stringify({ label }),
      })
    } catch (err) {
      throw toError(err, "打开目录失败")
    }
  },

  /**
   * 验证单个账号凭证活性
   * POST /api/account-pool/<id>/verify
   * 返回 { valid, message }
   * @param {string} id
   */
  async verifyAccount(id) {
    if (!id) throw new Error("缺少账号 id")
    if (USE_MOCK) { await delay(400); return { valid: true, message: "凭证活性正常" } }
    try {
      return await fetchJSON(`/api/account-pool/${encodeURIComponent(id)}/verify`, { method: "POST" })
    } catch (err) {
      throw toError(err, "验证账号失败")
    }
  },

  /**
   * 从账号池删除账号
   * DELETE /api/account-pool/<id>
   * @param {string} id
   */
  async removeAccount(id) {
    if (!id) throw new Error("缺少账号 id")
    if (USE_MOCK) { await delay(200); return { ok: true } }
    try {
      const res = await fetch(`/api/account-pool/${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
      }
      return await res.json()
    } catch (err) {
      throw toError(err, "删除账号失败")
    }
  },

  /**
   * 取消扫码登录（后端停止轮询 + 清理状态）
   * POST /api/auth/cancel
   */
  async cancelAuth() {
    if (USE_MOCK) return { ok: true }
    try {
      return await fetchJSON("/api/auth/cancel", { method: "POST" })
    } catch (err) {
      throw toError(err, "取消登录失败")
    }
  },

  /**
   * 一键采集当前公众号最新文章
   * POST /api/articles/collect-latest
   * 返回 { taskId, message }
   * @param {{fakeid: string, account_name?: string, limit?: number, skip_existing?: boolean}} payload
   */
  async collectLatest({ fakeid, account_name = "", limit = 50, skip_existing = true }) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (USE_MOCK) {
      await delay(400)
      return { taskId: `collect_${Date.now()}`, message: `已启动采集，约 ${limit} 篇` }
    }
    try {
      const res = await fetchJSON("/api/articles/collect-latest", {
        method: "POST",
        body: JSON.stringify({ fakeid, account_name, limit, skip_existing }),
      })
      return { taskId: res?.task_id || "", message: res?.message || "已启动采集" }
    } catch (err) {
      throw toError(err, "启动采集失败")
    }
  },

  /**
   * 按时间范围批量下载
   * POST /api/articles/download-range
   * 返回 { taskId, message }
   * @param {{fakeid: string, account_name?: string, start_time: number, end_time: number, keyword?: string, page_size?: number}} payload
   */
  async downloadRange({ fakeid, account_name = "", start_time, end_time, keyword = "", page_size = 20 }) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (!start_time || !end_time) throw new Error("需要 start_time 和 end_time")
    if (USE_MOCK) {
      await delay(300)
      return { taskId: `dl_range_${Date.now()}`, message: "已启动按时间范围下载" }
    }
    try {
      const res = await fetchJSON("/api/articles/download-range", {
        method: "POST",
        body: JSON.stringify({ fakeid, account_name, start_time, end_time, keyword, page_size }),
      })
      return { taskId: res?.task_id || "", message: res?.message || "已启动按时间下载" }
    } catch (err) {
      throw toError(err, "按时间范围下载失败")
    }
  },

  /**
   * 清除防水墙（人机验证）状态
   * POST /api/waterwall/clear
   */
  async clearWaterwall() {
    if (USE_MOCK) return { ok: true }
    try {
      return await fetchJSON("/api/waterwall/clear", { method: "POST" })
    } catch (err) {
      throw toError(err, "清除防水墙失败")
    }
  },

  /**
   * 自动为指定公众号同步 PC 微信凭证（打开公众号主页建立阅读会话）
   * POST /api/accounts/sync-pc-wechat  body: { keyword }
   * @param {string} keyword 公众号名称
   */
  async syncPcWechat(keyword) {
    if (!keyword) throw new Error("缺少公众号名称")
    if (USE_MOCK) return { success: true, message: "已触发自动同步" }
    try {
      return await fetchJSON("/api/accounts/sync-pc-wechat", {
        method: "POST",
        body: JSON.stringify({ keyword }),
      })
    } catch (err) {
      throw toError(err, "自动同步凭证失败")
    }
  },

  /**
   * 带搜索关键字的文章列表（原版 API.articles.list）
   * GET /api/articles/list/<fakeid>?begin=&count=&keyword=
   * 返回原始 { articles, total, can_msg_continue }
   * @param {string} fakeid
   * @param {{begin?: number, count?: number, keyword?: string}} [options]
   */
  async fetchArticlesList(fakeid, { begin = 0, count = 20, keyword = "" } = {}) {
    if (!fakeid) throw new Error("缺少 fakeid")
    if (USE_MOCK) {
      await delay(300)
      return { articles: [], total: 0, can_msg_continue: 0 }
    }
    try {
      const qs = new URLSearchParams({ begin: String(begin), count: String(count) })
      if (keyword) qs.set("keyword", keyword)
      return await fetchJSON(`/api/articles/list/${encodeURIComponent(fakeid)}?${qs.toString()}`)
    } catch (err) {
      throw toError(err, "读取文章列表失败")
    }
  },

  /**
   * 批量下载文章（从文章浏览 Tab 调用）
   * POST /api/articles/download  body: { articles: [{link,title,digest,...}], account_name }
   * 返回 { taskId, message }
   * @param {{articles: Array<{url:string,title?:string,digest?:string,publishAt?:number}>, accountName?: string}} payload
   */
  async downloadArticles({ articles, accountName = "unknown" }) {
    const list = (Array.isArray(articles) ? articles : []).filter(Boolean)
    if (!list.length) throw new Error("请至少选择一篇文章")
    if (USE_MOCK) {
      await delay(350)
      return { taskId: `batch_demo_${Date.now()}`, message: `已启动下载任务，共 ${list.length} 篇` }
    }
    try {
      const payload = list.map((a) => ({
        link: a.url || a.link || "",
        title: a.title || "",
        digest: a.digest || "",
        update_time: a.publishAt || 0,
      })).filter((x) => x.link)
      const res = await fetchJSON("/api/articles/download", {
        method: "POST",
        body: JSON.stringify({ articles: payload, account_name: accountName }),
      })
      if (!res?.task_id) throw new Error("服务未返回任务 ID")
      return { taskId: res.task_id, message: res.message || `已启动下载任务，共 ${payload.length} 篇` }
    } catch (err) {
      throw toError(err, "启动批量下载失败")
    }
  },
}
