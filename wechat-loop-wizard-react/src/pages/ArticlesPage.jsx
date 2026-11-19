import * as React from "react"
import PropTypes from "prop-types"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { proxiedImage } from "@/lib/media"

/**
 * ArticlesPage —— 文章下载（严格对齐 wechat-mp-tools/frontend/js/components/articles.js v1 817 行）
 *
 * 实现原版全部 14 个交互点：
 *   1. 顶栏 + 公众号 Chip 选择器 + 「⚡ 全部关注公众号一键采集」
 *   2. 控制区第一行：搜索框 + Enter 搜索 + 「搜索/清除」按钮 + 模式切换
 *   3. 多选模式下：全选已加载 / 取消全选 / 下载选中（disabled）
 *   4. 控制区第二行：日期范围 + 快捷日期下拉 + 按时间下载 + 采集最新50篇 + 重置
 *   5. 文章卡片（横向 flex）：封面图（可选） + 标题（hover 赭石橙）+ digest + meta + 原创徽章 + 操作按钮
 *   6. 多选 checkbox（点击不冒泡）
 *   7. 分页（begin = currentPage * pageSize, pageSize=20）+ can_msg_continue 判断
 *   8. 页面缓存 pageCache + 跨页 loadedArticlesMap（翻页优化、跨页多选）
 *   9. 下载进度卡片 + 1 秒轮询
 *  10. 进度统计：当前号/总数 + 完成 + 失败 + 总计 + 已扫描（可选）
 *  11. 进度状态徽章（running/completed/failed/cancelled/cancelling）
 *  12. 停止 / 打开目录按钮
 *  13. 防水墙错误态（🛡️ + 两个按钮）
 *  14. 凭证过期错误态（🔐 + 自动同步 + 重新检测）
 */

const PAGE_SIZE = 20

function fmtDateTime(ts) {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ──────────── 下载进度卡片 ────────────

function DownloadProgressCard({ task, status, onCancel, onOpenFolder }) {
  const total = task?.total || 0
  const completed = task?.completed || 0
  const failed = task?.failed || 0
  const pct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0

  const statusLabelMap = {
    running: "下载中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
    cancelling: "停止中",
  }
  const label = statusLabelMap[status] || "下载中"

  const badgeVariantMap = {
    running: "bg-[#C87137]/10 text-[#C87137] border-[#C87137]/40",
    completed: "bg-[#4F7A5A]/10 text-[#385742] border-[#4F7A5A]/40",
    failed: "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/40",
    cancelled: "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/40",
    cancelling: "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/40",
  }

  const currentText = (() => {
    let t = task?.current || "-"
    if (task?.total_accounts && task?.current_account_idx) {
      t = `[${task.current_account_idx}/${task.total_accounts}] ${t}`
    }
    return t
  })()

  const progressColor =
    status === "failed"
      ? "bg-[#A94438]"
      : status === "completed"
      ? "bg-[#4F7A5A]"
      : "bg-[#C87137]"

  return (
    <Card className="bg-card">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base font-semibold">📥 下载进度</h3>
            <Badge
              variant="outline"
              className={cn("rounded-sm text-[11px]", badgeVariantMap[status])}
            >
              {label}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onOpenFolder}>
              📂 打开下载目录
            </Button>
            {(status === "running" || status === "cancelling") && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onCancel}
                disabled={status === "cancelling"}
              >
                {status === "cancelling" ? "停止中..." : "停止"}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-sm border border-border bg-surface">
          <div
            className={cn("h-full transition-all duration-500", progressColor)}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            当前：<strong className="text-foreground">{currentText}</strong>
          </span>
          <span>
            完成：<strong className="text-[#385742]">{completed}</strong>
          </span>
          <span>
            失败：<strong className="text-[#7d2f26]">{failed}</strong>
          </span>
          <span>
            总计：<strong className="text-foreground">{total}</strong>
          </span>
          {task?.scanned != null && (
            <span>
              已扫描：<strong className="text-foreground">{task.scanned}</strong>
            </span>
          )}
        </div>

        {task?.stop_reason && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            停止原因：{task.stop_reason}
          </div>
        )}

        {status === "completed" && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            下载完成后可在"下载历史"中查看文件列表。
          </div>
        )}
      </CardContent>
    </Card>
  )
}

DownloadProgressCard.propTypes = {
  task: PropTypes.object,
  status: PropTypes.oneOf(["idle", "running", "completed", "failed", "cancelled", "cancelling"]).isRequired,
  onCancel: PropTypes.func.isRequired,
  onOpenFolder: PropTypes.func.isRequired,
}

// ──────────── 日期快捷 ────────────

function applyQuickDate(type) {
  if (!type) return { start: "", end: "" }
  const now = new Date()
  const fmt = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }
  const endStr = fmt(now)
  let startStr = endStr

  if (type === "today") {
    startStr = endStr
  } else if (type === "3days") {
    startStr = fmt(new Date(now.getTime() - 2 * 86400000))
  } else if (type === "7days") {
    startStr = fmt(new Date(now.getTime() - 6 * 86400000))
  } else if (type === "30days") {
    startStr = fmt(new Date(now.getTime() - 29 * 86400000))
  } else if (type === "this_month") {
    startStr = fmt(new Date(now.getFullYear(), now.getMonth(), 1))
  }
  return { start: startStr, end: endStr }
}

function buildDateRange(startVal, endVal) {
  if (!startVal && !endVal) return null
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  const todayStr = `${year}-${month}-${day}`

  const effectiveStart = startVal || "2000-01-01"
  const effectiveEnd = endVal || todayStr

  const startTimestamp = Math.floor(new Date(effectiveStart + "T00:00:00").getTime() / 1000)
  const endTimestamp = Math.floor(new Date(effectiveEnd + "T23:59:59").getTime() / 1000)
  if (Number.isNaN(startTimestamp) || Number.isNaN(endTimestamp)) {
    return { error: "日期格式不正确" }
  }
  if (startTimestamp > endTimestamp) {
    return { error: "开始日期不能晚于结束日期" }
  }
  return { startTimestamp, endTimestamp }
}

// ──────────── 主页面 ────────────

export function ArticlesPage() {
  const [accounts, setAccounts] = React.useState([])
  const [accountsLoading, setAccountsLoading] = React.useState(true)
  const [accountsError, setAccountsError] = React.useState("")

  const [activeFakeid, setActiveFakeid] = React.useState("")
  const [activeName, setActiveName] = React.useState("")

  // 列表相关
  const [page, setPage] = React.useState(0)
  const [articles, setArticles] = React.useState([])
  const [total, setTotal] = React.useState(0)
  const [canMsgContinue, setCanMsgContinue] = React.useState(1)
  const [articlesLoading, setArticlesLoading] = React.useState(false)
  const [articlesError, setArticlesError] = React.useState("")
  const [errorKind, setErrorKind] = React.useState("") // "" | "waterwall" | "auth" | "generic"

  // 搜索
  const [keyword, setKeyword] = React.useState("")
  const searchInputRef = React.useRef(null)

  // 日期过滤
  const [startDate, setStartDate] = React.useState("")
  const [endDate, setEndDate] = React.useState("")
  const [quickDate, setQuickDate] = React.useState("")

  // 选择模式
  const [mode, setMode] = React.useState("single") // single | multi

  // 选中集合（全局索引，跨页用）
  const [selectedSet, setSelectedSet] = React.useState(() => new Set())

  // 页面缓存 { [pageNum]: { articles, total, canMsgContinue } }
  const pageCacheRef = React.useRef({})
  // 跨页已加载文章 Map：globalIdx → article
  const loadedArticlesMapRef = React.useRef(new Map())

  // 下载任务
  const [downloadTaskId, setDownloadTaskId] = React.useState("")
  const [downloadTask, setDownloadTask] = React.useState(null)
  const [downloadStatus, setDownloadStatus] = React.useState("idle")

  // Toast
  const [toast, setToast] = React.useState("")

  // ── Toast 自动消失 ──
  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 2600)
    return () => clearTimeout(t)
  }, [toast])

  function showToast(msg) {
    setToast(msg)
  }

  // ── 初始化：加载公众号列表（并处理跳转预选） ──
  React.useEffect(() => {
    loadAccounts()
  }, [])

  async function loadAccounts() {
    setAccountsLoading(true)
    setAccountsError("")
    try {
      const res = await api.listFavorites()
      const list = res?.accounts || []
      setAccounts(list)

      // 从「公众号管理」页跳转时 URL 里带着 fakeid，列表就绪后直接选中
      const params = new URLSearchParams(window.location.hash.split("?")[1] || "")
      const preFakeid = params.get("fakeid") || ""
      const preName = params.get("name") || ""
      if (preFakeid && list.some((a) => a.fakeid === preFakeid)) {
        handleSelectAccount(preFakeid, preName || list.find((a) => a.fakeid === preFakeid)?.nickname || "")
      }
    } catch (err) {
      setAccountsError(err?.message || "加载公众号列表失败")
    } finally {
      setAccountsLoading(false)
    }
  }

  // ── 轮询下载进度（1 秒） ──
  React.useEffect(() => {
    if (!downloadTaskId) return
    if (downloadStatus !== "running" && downloadStatus !== "cancelling") return
    const timer = setInterval(async () => {
      try {
        const task = await api.fetchDownloadStatus(downloadTaskId)
        setDownloadTask(task)
        if (task?.status === "completed") {
          setDownloadStatus("completed")
          showToast(`下载完成！成功 ${task.completed || 0} 篇，失败 ${task.failed || 0} 篇`)
        } else if (task?.status === "failed") {
          setDownloadStatus("failed")
          showToast(`下载失败：${task.stop_reason || "未知错误"}`)
        } else if (task?.status === "cancelled") {
          setDownloadStatus("cancelled")
          showToast("下载已停止")
        } else if (task?.status === "cancelling") {
          setDownloadStatus("cancelling")
        } else {
          setDownloadStatus("running")
        }
      } catch {
        // 静默
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [downloadTaskId, downloadStatus])

  // ── 识别错误类型（原版 articles.js 的两个特殊态） ──
  function classifyError(message) {
    const msg = String(message || "")
    if (
      msg.includes("防水墙") ||
      msg.includes("waterwall") ||
      msg.includes("tcaptcha") ||
      msg.includes("人机验证") ||
      msg.includes("安全验证")
    ) {
      return "waterwall"
    }
    if (
      msg.includes("失效") ||
      msg.includes("ret=-3") ||
      msg.includes("401") ||
      msg.includes("过期") ||
      msg.includes("会话") ||
      msg.includes("凭证") ||
      msg.includes("阅读")
    ) {
      return "auth"
    }
    return "generic"
  }

  // ── 加载文章列表（含缓存逻辑） ──
  async function loadArticles(nextPage = page, force = false, fakeidOverride = "") {
    setArticlesError("")
    setErrorKind("")

    // 翻页优化：缓存命中直接返回，不请求接口
    if (!force && pageCacheRef.current[nextPage]) {
      const cached = pageCacheRef.current[nextPage]
      setArticles(cached.articles)
      setTotal(cached.total)
      setCanMsgContinue(cached.canMsgContinue)
      setPage(nextPage)
      setArticlesLoading(false)
      return
    }

    setArticlesLoading(true)
    try {
      const begin = nextPage * PAGE_SIZE
      // fakeid 必须显式传：setActiveFakeid 之后立刻调用时 state 还没更新，
      // 从闭包读会拿到空串，后端直接报「缺少 fakeid」
      const fid = fakeidOverride || activeFakeid
      const raw = await api.fetchArticlesList(fid, {
        begin,
        count: PAGE_SIZE,
        keyword,
      })

      const list = raw?.articles || []
      const totalVal = raw?.total || list.length
      const canCont =
        raw?.can_msg_continue !== undefined ? raw.can_msg_continue : list.length > 0 ? 1 : 0

      setArticles(list)
      setTotal(totalVal)
      setCanMsgContinue(canCont)
      setPage(nextPage)

      // 写入页面缓存
      pageCacheRef.current[nextPage] = {
        articles: list,
        total: totalVal,
        canMsgContinue: canCont,
      }

      // 写入跨页已加载 Map（globalIdx → article）
      list.forEach((art, idx) => {
        const globalIdx = nextPage * PAGE_SIZE + idx
        loadedArticlesMapRef.current.set(globalIdx, art)
      })
    } catch (err) {
      const msg = err?.message || "加载文章列表失败"
      setArticlesError(msg)
      setErrorKind(classifyError(msg))
      setArticles([])
    } finally {
      setArticlesLoading(false)
    }
  }

  // ── 选择公众号 ──
  function handleSelectAccount(fakeid, nickname) {
    setActiveFakeid(fakeid)
    setActiveName(nickname)
    setPage(0)
    setSelectedSet(new Set())
    setKeyword("")
    setStartDate("")
    setEndDate("")
    setQuickDate("")
    setMode("single")
    setArticlesError("")
    setErrorKind("")
    // 清空缓存和跨页映射
    pageCacheRef.current = {}
    loadedArticlesMapRef.current = new Map()

    // 搜索框也清空
    if (searchInputRef.current) searchInputRef.current.value = ""

    loadArticles(0, true, fakeid)
  }

  // ── 搜索 / 清除 ──
  function handleSearch() {
    const kw = (searchInputRef.current?.value || "").trim()
    setKeyword(kw)
    setPage(0)
    setSelectedSet(new Set())
    pageCacheRef.current = {}
    loadedArticlesMapRef.current = new Map()
    loadArticles(0, true)
  }

  function handleClearSearch() {
    if (searchInputRef.current) searchInputRef.current.value = ""
    setKeyword("")
    setStartDate("")
    setEndDate("")
    setQuickDate("")
    setPage(0)
    setSelectedSet(new Set())
    pageCacheRef.current = {}
    loadedArticlesMapRef.current = new Map()
    loadArticles(0, true)
  }

  // ── 快捷日期 ──
  function handleQuickDateChange(val) {
    if (!val) return
    setQuickDate(val)
    const { start, end } = applyQuickDate(val)
    setStartDate(start)
    setEndDate(end)
  }

  function handleClearDateFilter() {
    setStartDate("")
    setEndDate("")
    setQuickDate("")
  }

  // ── 模式切换 ──
  function handleSetMode(nextMode) {
    setMode(nextMode)
    if (nextMode === "single") {
      setSelectedSet(new Set())
    }
  }

  // ── 多选操作 ──
  function toggleSelect(globalIdx) {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(globalIdx)) next.delete(globalIdx)
      else next.add(globalIdx)
      return next
    })
  }

  function selectAllLoaded() {
    const size = loadedArticlesMapRef.current.size
    if (size === 0) {
      showToast("当前暂无已加载的文章")
      return
    }
    const next = new Set()
    loadedArticlesMapRef.current.forEach((_, globalIdx) => next.add(globalIdx))
    setSelectedSet(next)
    showToast(`已选中所有已加载的 ${next.size} 篇文章`)
  }

  function clearSelection() {
    setSelectedSet(new Set())
    showToast("已取消选择")
  }

  // ── 下载单篇 ──
  async function handleDownloadSingle(article) {
    if (!article) return
    const payload = [
      {
        title: article.title || "",
        link: article.link || article.url || "",
        id: article.id || article.appmsgid || "",
        aid: article.id || article.appmsgid || "",
      },
    ].filter((a) => a.link)
    if (!payload.length) {
      showToast("文章没有有效链接，无法下载")
      return
    }
    try {
      const res = await api.startDownload({
        articles: payload,
        account_name: activeName,
      })
      startDownloadTask(res)
    } catch (err) {
      showToast(`下载失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 下载选中（跨页） ──
  async function handleDownloadSelected() {
    if (selectedSet.size === 0) {
      showToast("请先选择文章")
      return
    }
    const list = []
    selectedSet.forEach((gIdx) => {
      const art = loadedArticlesMapRef.current.get(gIdx)
      if (art && (art.link || art.url)) {
        list.push({
          title: art.title || "",
          link: art.link || art.url || "",
          id: art.id || art.appmsgid || "",
          aid: art.id || art.appmsgid || "",
        })
      }
    })
    if (!list.length) {
      showToast("所选文章没有有效链接")
      return
    }
    try {
      const res = await api.startDownload({
        articles: list,
        account_name: activeName,
      })
      startDownloadTask(res)
      setSelectedSet(new Set())
      setMode("single")
    } catch (err) {
      showToast(`下载失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 按时间范围下载 ──
  async function handleDownloadDateRange() {
    if (!activeFakeid) {
      showToast("请先选择公众号")
      return
    }
    const range = buildDateRange(startDate, endDate)
    if (!range) {
      showToast("请选择完整的开始和结束日期")
      return
    }
    if (range.error) {
      showToast(range.error)
      return
    }
    try {
      const res = await api.downloadRange({
        fakeid: activeFakeid,
        account_name: activeName,
        start_time: range.startTimestamp,
        end_time: range.endTimestamp,
        keyword,
        page_size: PAGE_SIZE,
      })
      startDownloadTask(res)
    } catch (err) {
      showToast(`按时间下载失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 采集当前号最新50篇 ──
  async function handleCollectCurrent() {
    if (!activeFakeid) {
      showToast("请先选择要采集的公众号")
      return
    }
    const ok = window.confirm(
      `确定一键采集【${activeName || "当前公众号"}】最近 50 篇推文吗？\n\n` +
        `📌 保护机制：系统会自动跳过本地已下载的推文，仅抓取最新增量，保护风控。`
    )
    if (!ok) return
    try {
      const res = await api.collectLatest({
        fakeid: activeFakeid,
        account_name: activeName,
        limit: 50,
        skip_existing: true,
      })
      startDownloadTask(res)
      showToast(res.message || "已启动一键采集任务")
    } catch (err) {
      showToast(`启动采集失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 全部号一键采集 ──
  async function handleCollectAll() {
    const ok = window.confirm(
      `确定一键采集【全部已关注公众号】各最近 50 篇推文吗？\n\n` +
        `📌 运行说明：\n` +
        `1. 系统将自动按顺序依次采集每个公众号；\n` +
        `2. 已下载文章自动秒级跳过，杜绝重复网络请求与风控封控；\n` +
        `3. 多号流转内置 2~3 秒平滑缓冲间隔。`
    )
    if (!ok) return
    try {
      const res = await api.collectAllLatest({ limit: 50, skipExisting: true })
      startDownloadTask(res)
      showToast(res.message || "已启动全量一键采集任务")
    } catch (err) {
      showToast(`启动全量采集失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 启动下载任务（重置状态 + 展示进度） ──
  function startDownloadTask(res) {
    if (!res?.taskId) {
      showToast(res?.message || "服务未返回 task_id")
      return
    }
    setDownloadTaskId(res.taskId)
    setDownloadTask(null)
    setDownloadStatus("running")
    showToast(res.message || "已启动下载任务")
  }

  // ── 停止下载 ──
  async function handleCancelDownload() {
    if (!downloadTaskId) return
    try {
      await api.cancelDownload(downloadTaskId)
      setDownloadStatus("cancelling")
      showToast("正在停止下载...")
    } catch (err) {
      showToast(`停止失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 打开目录 ──
  async function handleOpenFolder() {
    try {
      await api.openFolder(activeName)
      showToast("下载目录已打开")
    } catch (err) {
      showToast(`打开失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 防水墙：清除 ──
  async function handleClearWaterwall() {
    try {
      await api.clearWaterwall()
      showToast("已清除防水墙状态，正在重新加载...")
      setTimeout(() => loadArticles(page, true), 600)
    } catch (err) {
      showToast(`清除失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 凭证过期：自动同步 ──
  async function handleSyncTargetAccount() {
    if (!activeName) return
    showToast(`正在尝试为【${activeName}】自动在微信中打开文章，请稍候...`)
    try {
      const data = await api.syncPcWechat(activeName)
      if (data?.success) {
        showToast(`【${activeName}】文章已定位，正在重新拉取列表...`)
        setTimeout(() => loadArticles(page, true), 2500)
      } else {
        showToast("自动化指令已发送，若未成功请手动在微信点开一篇文章后点击重试。")
      }
    } catch (err) {
      showToast(`触发自动同步失败：${err?.message || "未知错误"}`)
    }
  }

  // ── 翻页 ──
  function handlePrevPage() {
    if (page <= 0) return
    loadArticles(page - 1)
  }
  function handleNextPage() {
    if (articles.length === 0) return
    loadArticles(page + 1)
  }

  // ──────────── 渲染 ────────────

  const hasNext = (canMsgContinue === 1 || canMsgContinue === undefined) && articles.length > 0

  // 顶部 Chip：空态处理
  const selectedCount = selectedSet.size
  const loadedTotal = loadedArticlesMapRef.current.size

  return (
    <div className="flex flex-col gap-6">
      {/* 顶栏 */}
      <header className="flex flex-col gap-1">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">文章下载</h2>
        <p className="text-sm text-muted-foreground">选择公众号，浏览并下载文章</p>
      </header>

      {/* 卡 1：公众号选择器 */}
      <Card className="bg-card">
        <CardHeader className="gap-2 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-serif text-base">📌 选择公众号</CardTitle>
            <Button type="button" size="sm" onClick={handleCollectAll}>
              ⚡ 全部关注公众号一键采集 (各50篇)
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {accountsLoading ? (
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8 w-24 rounded-md" />
              ))}
            </div>
          ) : accountsError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center gap-2">
                {accountsError}
                <Button type="button" variant="outline" size="sm" onClick={loadAccounts}>
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          ) : accounts.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              还没有收藏公众号
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {accounts.map((acc) => {
                const active = activeFakeid === acc.fakeid
                return (
                  <button
                    key={acc.fakeid || acc.nickname}
                    type="button"
                    onClick={() => {
                      if (!acc.fakeid) {
                        showToast("该公众号缺少 fakeid，请删除后重新收藏")
                        return
                      }
                      handleSelectAccount(acc.fakeid, acc.nickname)
                    }}
                    className={cn(
                      "h-8 rounded-md border px-3 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-foreground hover:bg-secondary"
                    )}
                  >
                    {acc.nickname}
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 文章列表控制区 + 列表 + 分页（仅选中公众号后显示） */}
      {activeFakeid && (
        <Card className="bg-card">
          {/* 控制区 */}
          <CardHeader className="gap-3 pb-3">
            {/* 第一行：搜索 + 模式切换 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex items-center">
                <svg
                  className="absolute left-2 h-4 w-4 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
                  <line
                    x1="21"
                    y1="21"
                    x2="16.65"
                    y2="16.65"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="搜索文章标题..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch()
                  }}
                  className="h-8 w-56 rounded-md border border-border bg-surface pl-8 pr-3 text-xs outline-none focus:border-primary"
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleSearch}>
                搜索
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleClearSearch}>
                清除
              </Button>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant={mode === "single" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSetMode("single")}
                >
                  单篇
                </Button>
                <Button
                  type="button"
                  variant={mode === "multi" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSetMode("multi")}
                >
                  多选
                </Button>
                {mode === "multi" && (
                  <div className="ml-2 flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={selectAllLoaded}>
                      ☑️ 全选已加载 ({loadedTotal})
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={clearSelection}>
                      ❌ 取消全选
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={handleDownloadSelected}
                      disabled={selectedCount === 0}
                    >
                      📥 下载选中 ({selectedCount})
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* 第二行：日期范围 + 快捷 + 操作 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">时间范围</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-primary"
              />
              <span className="text-xs text-muted-foreground">至</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-primary"
              />
              <select
                value={quickDate}
                onChange={(e) => handleQuickDateChange(e.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-primary cursor-pointer"
              >
                <option value="">快捷日期 ▾</option>
                <option value="today">今天</option>
                <option value="3days">近3天</option>
                <option value="7days">近7天</option>
                <option value="30days">近30天</option>
                <option value="this_month">本月</option>
              </select>
              <Button type="button" variant="default" size="sm" onClick={handleDownloadDateRange}>
                按时间下载
              </Button>
              <Button type="button" size="sm" onClick={handleCollectCurrent}>
                ⚡ 采集最新50篇
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleClearDateFilter}>
                重置
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {/* Loading Skeleton */}
            {articlesLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-start gap-4 rounded-md border border-border bg-surface/60 p-3">
                    <Skeleton className="h-[60px] w-[80px] flex-shrink-0 rounded-sm" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : articlesError ? (
              /* 错误态细分 */
              renderErrorState({
                errorKind,
                message: articlesError,
                accountName: activeName,
                onRetry: () => loadArticles(page, true),
                onClearWaterwall: handleClearWaterwall,
                onSyncAccount: handleSyncTargetAccount,
              })
            ) : articles.length === 0 ? (
              /* 空态 */
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-2 text-3xl">📰</div>
                <p className="text-sm text-muted-foreground">
                  {keyword ? "没有找到文章，尝试其他关键字" : "该公众号暂无文章"}
                </p>
              </div>
            ) : (
              /* 文章列表（横向布局） */
              <div className="flex flex-col gap-2">
                {articles.map((a, idx) => {
                  const globalIdx = page * PAGE_SIZE + idx
                  const isSel = selectedSet.has(globalIdx)
                  const coverSrc = a.cover || a.cover_url || a.thumb_url || ""
                  const time = fmtDateTime(a.update_time)

                  return (
                    <div
                      key={`${a.id || a.appmsgid || globalIdx}-${globalIdx}`}
                      className={cn(
                        "flex items-start gap-4 rounded-md border bg-surface/60 p-3 transition-colors",
                        isSel
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-secondary hover:border-primary/40"
                      )}
                    >
                      {/* 多选 checkbox */}
                      {mode === "multi" && (
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={(e) => {
                            e.stopPropagation()
                            toggleSelect(globalIdx)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-4 w-4 flex-shrink-0 accent-[#C87137]"
                        />
                      )}

                      {/* 左侧封面图 */}
                      {coverSrc && (
                        <img
                          src={proxiedImage(coverSrc)}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none"
                          }}
                          className="h-[60px] w-[80px] flex-shrink-0 rounded-sm object-cover"
                        />
                      )}

                      {/* 右侧信息区 */}
                      <div className="min-w-0 flex-1">
                        {/* 标题 */}
                        <div className="text-sm font-semibold leading-snug">
                          {a.link ? (
                            <a
                              href={a.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-foreground no-underline transition-colors hover:text-[#C87137] hover:underline"
                            >
                              {a.title || "无标题"} ↗
                            </a>
                          ) : (
                            <span className="text-foreground">{a.title || "无标题"}</span>
                          )}
                        </div>

                        {/* digest */}
                        {a.digest && (
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {a.digest}
                          </div>
                        )}

                        {/* meta 行 */}
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {time && <span>📅 {time}</span>}
                          {a.author && <span>✍️ {a.author}</span>}
                          {a.is_original && (
                            <Badge
                              variant="outline"
                              className="rounded-sm text-[10px] bg-[#C87137]/10 text-[#C87137] border-[#C87137]/40"
                            >
                              原创
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* 右侧操作按钮 */}
                      <div
                        className="flex flex-shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.link && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(a.link, "_blank", "noopener")}
                          >
                            🌐 打开原文
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => handleDownloadSingle(a)}
                        >
                          📥 下载
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 分页 */}
            {!articlesLoading && (articles.length > 0 || page > 0) && (
              <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-surface/60 px-4 py-2">
                <div className="text-xs text-muted-foreground">
                  第 {page + 1} 页 · 本页 {articles.length} 篇
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 0}
                    onClick={handlePrevPage}
                  >
                    上一页
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!hasNext}
                    onClick={handleNextPage}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 下载进度卡片 */}
      {downloadTaskId && (
        <DownloadProgressCard
          task={downloadTask}
          status={downloadStatus}
          onCancel={handleCancelDownload}
          onOpenFolder={handleOpenFolder}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-xs shadow-lg",
            toast.includes("失败") || toast.includes("错误") || toast.includes("停止")
              ? "border-[#A94438]/40 bg-[#A94438]/[0.06] text-[#7d2f26]"
              : "border-[#4F7A5A]/40 bg-[#4F7A5A]/[0.08] text-[#385742]"
          )}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

ArticlesPage.propTypes = {
  onNavigate: PropTypes.func,
}

ArticlesPage.defaultProps = {
  onNavigate: undefined,
}

// ──────────── 错误态细分渲染 ────────────

function renderErrorState({ errorKind, message, accountName, onRetry, onClearWaterwall, onSyncAccount }) {
  if (errorKind === "waterwall") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="text-5xl">🛡️</div>
        <div>
          <h3 className="mb-2 text-base font-semibold text-[#C87137]">触发腾讯安全验证（防水墙）</h3>
          <p className="mx-auto max-w-xl text-xs leading-relaxed text-muted-foreground">
            微信读书上游接口检测到频率较高，触发了人机验证。
            <br />
            👉 <strong>方法 1（推荐）</strong>：点击下方按钮清除防水墙状态后重试；
            <br />
            👉 <strong>方法 2</strong>：在手机微信读书 App 中打开任意书籍阅读片刻后，点击"已在App处理并重试"。
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" onClick={onClearWaterwall}>
            🧩 清除防水墙并重试
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            ✅ 已在App处理并重试
          </Button>
        </div>
      </div>
    )
  }

  if (errorKind === "auth") {
    const title = accountName
      ? `【${accountName}】尚未建立阅读会话`
      : "微信采集凭证已过期"
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="text-4xl">🔐</div>
        <div>
          <h3 className="mb-2 text-base font-semibold">{title}</h3>
          <p className="mx-auto max-w-xl text-xs leading-relaxed text-muted-foreground">
            微信 PC 客户端要求每个公众号首次抓取前建立独立阅读 Session（需打开公众号"主页"，仅点开文章不够）。
            <br />
            👉 <strong>方法 1</strong>：点击下方按钮，由系统自动在电脑微信中打开该号主页；
            <br />
            👉 <strong>方法 2</strong>：在电脑微信中进入该公众号任一文章 → 点击文章顶部的<strong>公众号名称/头像</strong>进入主页（出现历史文章列表即成功）。
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {accountName && (
            <Button type="button" size="sm" onClick={onSyncAccount}>
              🤖 自动为【{accountName}】同步凭证
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            🔄 重新检测并加载
          </Button>
        </div>
      </div>
    )
  }

  // 通用错误
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <span className="text-sm">{message}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          🔄 重试
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export default ArticlesPage
