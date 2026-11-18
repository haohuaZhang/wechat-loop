import * as React from "react"
import PropTypes from "prop-types"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/EmptyState"
import { Badge } from "@/components/ui/badge"
import {
  ListChecks,
  Download,
  FileText,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react"

/**
 * ArticlesPage —— 文章浏览 & 批量下载
 * 对齐原版 wechat-mp-tools/frontend/js/components/articles.js 的核心能力
 *
 * 数据流：
 *   GET  /api/accounts                 → 已关注公众号（顶部 Chip 选择器）
 *   GET  /api/articles/list/<fakeid>   → 分页文章列表（begin 步进 20）
 *   POST /api/articles/download         → 批量下载（返回 task_id）
 *   POST /api/articles/collect-all     → 一键采集所有已关注公众号
 *   GET  /api/articles/download-status/<task_id> → 轮询进度
 */

/** 每页数量（与原版 pageSize 对齐） */
const PAGE_SIZE = 20

function fmtDateTime(ts) {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─────────────────── 进度条组件 ───────────────────

/**
 * 下载进度卡片
 * @param {object} props
 * @param {string} props.status - running | completed | failed | cancelled | cancelling
 * @param {number} props.total
 * @param {number} props.completed
 * @param {number} props.failed
 * @param {string} [props.current]
 * @param {string} [props.stopReason]
 * @param {number} [props.scanned]
 * @param {boolean} props.onCancel
 */
function DownloadProgressCard({ task, onCancel, onOpenFolder, status }) {
  const total = task?.total || 0
  const completed = task?.completed || 0
  const failed = task?.failed || 0
  const pct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0

  const statusBadgeVariant =
    status === "completed"
      ? "bg-[#4F7A5A]/10 text-[#385742] border-[#4F7A5A]/40"
      : status === "failed"
      ? "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/40"
      : status === "cancelled" || status === "cancelling"
      ? "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/40"
      : "bg-[#C87137]/10 text-[#C87137] border-[#C87137]/40"

  const statusLabel =
    status === "completed"
      ? "已完成"
      : status === "failed"
      ? "失败"
      : status === "cancelled"
      ? "已停止"
      : status === "cancelling"
      ? "停止中"
      : "下载中"

  return (
    <Card className="bg-card">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base font-semibold">📥 下载进度</h3>
            <Badge variant="outline" className={cn("rounded-sm text-[11px]", statusBadgeVariant)}>
              {statusLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onOpenFolder}>
              📂 打开下载目录
            </Button>
            {(status === "running" || status === "cancelling") && (
              <Button type="button" variant="destructive" size="sm" onClick={onCancel} disabled={status === "cancelling"}>
                {status === "cancelling" ? "停止中..." : "停止"}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-sm border border-border bg-surface">
          <div
            className={cn(
              "h-full transition-all duration-500",
              status === "failed"
                ? "bg-[#A94438]"
                : status === "completed"
                ? "bg-[#4F7A5A]"
                : "bg-[#C87137]"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>当前：<strong className="text-foreground">{task?.current || "-"}</strong></span>
          <span>完成：<strong className="text-[#385742]">{completed}</strong></span>
          <span>失败：<strong className="text-[#7d2f26]">{failed}</strong></span>
          <span>总计：<strong className="text-foreground">{total}</strong></span>
          {task?.scanned != null && <span>已扫描：<strong className="text-foreground">{task.scanned}</strong></span>}
        </div>
        {task?.stop_reason && (
          <div className="mt-2 text-[11px] text-muted-foreground">停止原因：{task.stop_reason}</div>
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

// ─────────────────── 主页面 ───────────────────

/**
 * ArticlesPage
 */
export function ArticlesPage() {
  /** @type {[Array, React.Dispatch]} */
  const [accounts, setAccounts] = React.useState([])
  const [accountsLoading, setAccountsLoading] = React.useState(true)
  const [accountsError, setAccountsError] = React.useState("")

  const [activeFakeid, setActiveFakeid] = React.useState("")
  const [activeName, setActiveName] = React.useState("")

  const [page, setPage] = React.useState(0)
  const [articles, setArticles] = React.useState([])
  const [canContinue, setCanContinue] = React.useState(true)
  const [articlesLoading, setArticlesLoading] = React.useState(false)
  const [articlesError, setArticlesError] = React.useState("")

  const [selectedSet, setSelectedSet] = React.useState(() => new Set())
  const [mode, setMode] = React.useState("single") // single | multi

  // 下载任务
  const [downloadTaskId, setDownloadTaskId] = React.useState("")
  const [downloadTask, setDownloadTask] = React.useState(null)
  const [downloadStatus, setDownloadStatus] = React.useState("idle") // idle | running | completed | failed | cancelled | cancelling

  // Toast
  const [toast, setToast] = React.useState("")

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // 轮询下载进度
  React.useEffect(() => {
    if (!downloadTaskId || downloadStatus !== "running") return
    const timer = setInterval(async () => {
      try {
        const task = await api.fetchDownloadStatus(downloadTaskId)
        setDownloadTask(task)
        if (task?.status === "completed") {
          setDownloadStatus("completed")
          setToast(`下载完成！成功 ${task.completed} 篇，失败 ${task.failed} 篇`)
        } else if (task?.status === "failed") {
          setDownloadStatus("failed")
          setToast(`下载失败：${task.stop_reason || "未知错误"}`)
        } else if (task?.status === "cancelled") {
          setDownloadStatus("cancelled")
        } else if (task?.status === "cancelling") {
          setDownloadStatus("cancelling")
        }
      } catch {
        // 静默
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [downloadTaskId, downloadStatus])

  async function loadAccounts() {
    setAccountsLoading(true)
    setAccountsError("")
    try {
      const res = await api.listFavorites()
      setAccounts(res?.accounts || [])
    } catch (err) {
      setAccountsError(err?.message || "加载公众号列表失败")
    } finally {
      setAccountsLoading(false)
    }
  }

  async function loadArticles(nextFakeid, pageIdx = 0) {
    setArticlesLoading(true)
    setArticlesError("")
    try {
      const begin = pageIdx * PAGE_SIZE
      const raw = await api.fetchArticlesListRaw(nextFakeid, { begin, count: PAGE_SIZE })
      setArticles(raw?.articles || [])
      setCanContinue(raw?.can_msg_continue === undefined ? true : Boolean(raw.can_msg_continue))
      setPage(pageIdx)
      // 翻页时清理选中（跨页选中太复杂，原版用了 pageCache + loadedArticlesMap）
      setSelectedSet(new Set())
    } catch (err) {
      setArticlesError(err?.message || "加载文章列表失败")
      setArticles([])
    } finally {
      setArticlesLoading(false)
    }
  }

  React.useEffect(() => { loadAccounts() }, [])

  function handleSelectAccount(fakeid, nickname) {
    setActiveFakeid(fakeid)
    setActiveName(nickname)
    loadArticles(fakeid, 0)
  }

  async function handleCollectAll() {
    const ok = window.confirm(
      "确定一键采集【全部已关注公众号】各最近 50 篇推文吗？\n\n系统将自动跳过本地已下载的推文，按顺序依次采集。"
    )
    if (!ok) return
    try {
      setToast("已启动全量采集任务")
      const res = await api.collectAllLatest({ limit: 50, skipExisting: true })
      setDownloadTaskId(res.taskId)
      setDownloadTask(null)
      setDownloadStatus("running")
    } catch (err) {
      setToast(`启动失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleDownloadSelected() {
    if (!selectedSet.size) {
      setToast("请先选择文章")
      return
    }
    const payload = articles
      .filter((_, idx) => selectedSet.has(idx))
      .map((a) => ({ link: a.link || a.url || "", title: a.title || "", digest: a.digest || "", update_time: a.update_time || 0 }))
      .filter((a) => a.link)
    if (!payload.length) {
      setToast("所选文章没有有效链接")
      return
    }
    try {
      const res = await api.startDownload({ articles: payload, account_name: activeName })
      setDownloadTaskId(res.taskId)
      setDownloadTask(null)
      setDownloadStatus("running")
      setSelectedSet(new Set())
      setMode("single")
    } catch (err) {
      setToast(`下载失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleDownloadSingle(article) {
    const payload = [{
      link: article.link || article.url || "",
      title: article.title || "",
      digest: article.digest || "",
      update_time: article.update_time || 0,
    }]
    try {
      const res = await api.startDownload({ articles: payload, account_name: activeName })
      setDownloadTaskId(res.taskId)
      setDownloadTask(null)
      setDownloadStatus("running")
    } catch (err) {
      setToast(`下载失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleCancelDownload() {
    if (!downloadTaskId) return
    try {
      await api.cancelDownloadTask(downloadTaskId)
      setDownloadStatus("cancelling")
      setToast("正在停止...")
    } catch (err) {
      setToast(`停止失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleOpenFolder() {
    try {
      await api.openFolder(activeName)
      setToast("已打开下载目录")
    } catch (err) {
      setToast(`打开失败：${err?.message || "未知错误"}`)
    }
  }

  function toggleSelect(idx) {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function selectAll() {
    setSelectedSet(new Set(articles.map((_, i) => i)))
  }

  function clearSelection() {
    setSelectedSet(new Set())
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 页头 */}
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 03</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">文章浏览 & 下载</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          选择已关注公众号 → 浏览文章 → 批量下载 Markdown / PDF / HTML
        </p>
      </header>

      {/* 公众号选择器 */}
      <Card className="bg-card">
        <CardHeader className="gap-2 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-serif text-base">📌 选择公众号</CardTitle>
            <Button type="button" variant="default" size="sm" className="gap-2" onClick={handleCollectAll}>
              <Sparkles className="h-3.5 w-3.5" />
              一键采集所有已关注公众号（各 50 篇）
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
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex items-center gap-2">
                {accountsError}
                <Button type="button" variant="outline" size="sm" onClick={loadAccounts}>
                  <RefreshCw className="h-3 w-3" /> 重试
                </Button>
              </AlertDescription>
            </Alert>
          ) : accounts.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="还没有关注任何公众号"
              description="到【公众号管理】Tab 添加几个公众号，回来就能在这里选择并浏览文章了。"
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {accounts.map((acc) => {
                const active = activeFakeid === acc.fakeid
                return (
                  <button
                    key={acc.fakeid}
                    type="button"
                    onClick={() => handleSelectAccount(acc.fakeid, acc.nickname)}
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

      {/* 文章列表 */}
      {activeFakeid && (
        <Card className="bg-card">
          <CardHeader className="gap-2 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="font-serif text-base">
                📖 {activeName} · 第 {page + 1} 页
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={mode === "single" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setMode("single"); setSelectedSet(new Set()) }}
                >
                  单篇
                </Button>
                <Button
                  type="button"
                  variant={mode === "multi" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("multi")}
                >
                  多选
                </Button>
                {mode === "multi" && (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
                      ☑️ 全选
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                      ❌ 清空
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {articlesLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex gap-3 rounded-md border border-border bg-surface/60 p-3">
                    <Skeleton className="h-20 w-20 rounded-sm" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : articlesError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex items-center gap-2">
                  {articlesError}
                  <Button type="button" variant="outline" size="sm" onClick={() => loadArticles(activeFakeid, page)}>
                    <RefreshCw className="h-3 w-3" /> 重试
                  </Button>
                </AlertDescription>
              </Alert>
            ) : articles.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="该公众号暂无文章"
                description="可能是没有历史推文，或者该号还没建立微信阅读会话。"
              />
            ) : (
              <div className="flex flex-col gap-2">
                {articles.map((a, idx) => {
                  const isSel = selectedSet.has(idx)
                  const coverSrc = a.cover || a.cover_url || a.thumb_url || ""
                  return (
                    <div
                      key={`${a.id || a.appmsgid || idx}-${idx}`}
                      onClick={() => {
                        if (mode === "multi") toggleSelect(idx)
                        else if (a.link) window.open(a.link, "_blank", "noopener")
                      }}
                      className={cn(
                        "flex gap-3 rounded-md border bg-surface/60 p-3 cursor-pointer transition-colors",
                        isSel
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-secondary hover:border-primary/40"
                      )}
                    >
                      {mode === "multi" && (
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={(e) => { e.stopPropagation(); toggleSelect(idx) }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-4 w-4 accent-[#C87137]"
                        />
                      )}
                      {coverSrc && (
                        <img
                          src={coverSrc}
                          alt=""
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = "none" }}
                          className="h-20 w-20 flex-shrink-0 rounded-sm object-cover"
                        />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium leading-tight">
                            {a.title || "无标题"}
                          </div>
                          {a.digest && (
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {a.digest}
                            </div>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {a.update_time && <span>📅 {fmtDateTime(a.update_time)}</span>}
                          {a.author && <span>✍️ {a.author}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {a.link && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(a.link, "_blank", "noopener")}
                          >
                            🌐
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => handleDownloadSingle(a)}
                          className="gap-1"
                        >
                          <Download className="h-3 w-3" /> 下载
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 分页 */}
      {activeFakeid && !articlesLoading && articles.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface/60 px-4 py-2">
          <div className="text-xs text-muted-foreground">
            第 {page + 1} 页 · 本页 {articles.length} 篇
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 0}
              onClick={() => loadArticles(activeFakeid, page - 1)}
              className="gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canContinue}
              onClick={() => loadArticles(activeFakeid, page + 1)}
              className="gap-1"
            >
              下一页 <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 底部下载按钮（多选模式） */}
      {activeFakeid && mode === "multi" && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-md border border-primary bg-background/90 px-4 py-3 shadow-lg backdrop-blur">
          <div className="text-sm">
            已选中 <span className="font-semibold text-primary">{selectedSet.size}</span> 篇
          </div>
          <Button
            type="button"
            variant="default"
            size="default"
            onClick={handleDownloadSelected}
            disabled={!selectedSet.size}
            className="gap-2"
          >
            <Download className="h-4 w-4" /> 下载选中 {selectedSet.size} 篇
          </Button>
        </div>
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
            toast.includes("失败") || toast.includes("停止")
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

export default ArticlesPage
