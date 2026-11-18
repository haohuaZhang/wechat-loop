import * as React from "react"
import PropTypes from "prop-types"
import { BookOpen, Loader2, AlertTriangle, RefreshCw, Download, ChevronLeft, ChevronRight, ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { EmptyState } from "@/components/common/EmptyState"
import { Skeleton } from "@/components/ui/skeleton"
import { CollectProgress } from "@/components/collect/CollectProgress"
import { api } from "@/api/client"

/**
 * 文章浏览 Tab —— 从已关注公众号中选择并批量下载文章
 *
 * @param {object} props
 * @param {function(string)} [props.onNavigate] 点击「去公众号管理」时触发的路由跳转
 */
export function ArticleBrowseTab({ onNavigate }) {
  const [favorites, setFavorites] = React.useState({ loading: true, error: "", accounts: [] })
  const [selectedFakeid, setSelectedFakeid] = React.useState("")

  const [articles, setArticles] = React.useState({ loading: false, error: "", list: [], total: 0, canContinue: false, throttled: false, cooldownLeft: 0 })
  const [begin, setBegin] = React.useState(0)
  const pageSize = 20

  const [checkedIds, setCheckedIds] = React.useState(new Set())

  const [dlStatus, setDlStatus] = React.useState("idle") // idle | running | done | error
  const [dlTaskId, setDlTaskId] = React.useState("")
  const [dlProgress, setDlProgress] = React.useState(0)
  const [dlCurrent, setDlCurrent] = React.useState("")
  const [dlSuccess, setDlSuccess] = React.useState(0)
  const [dlFailed, setDlFailed] = React.useState(0)
  const [dlMsg, setDlMsg] = React.useState("")

  // 加载已关注公众号
  const loadFavorites = React.useCallback(async () => {
    setFavorites((s) => ({ ...s, loading: true, error: "" }))
    try {
      const res = await api.listFavorites()
      setFavorites({ loading: false, error: "", accounts: res.accounts })
      if (res.accounts.length && !selectedFakeid) {
        setSelectedFakeid(res.accounts[0].fakeid)
      }
    } catch (err) {
      setFavorites((s) => ({ ...s, loading: false, error: err?.message || "读取公众号列表失败" }))
    }
  }, [selectedFakeid])

  React.useEffect(() => { loadFavorites() }, [loadFavorites])

  // 加载文章列表（分页 begin）
  const loadArticles = React.useCallback(async (fakeid, b) => {
    if (!fakeid) return
    setArticles((s) => ({ ...s, loading: true, error: "" }))
    setCheckedIds(new Set())
    try {
      const res = await api.listArticlesPage(fakeid, { begin: b, count: pageSize })
      setArticles({
        loading: false,
        error: "",
        list: res.articles,
        total: res.total,
        canContinue: res.canContinue,
        throttled: res.throttled,
        cooldownLeft: res.cooldownLeft,
      })
      setBegin(b)
    } catch (err) {
      setArticles((s) => ({ ...s, loading: false, error: err?.message || "读取文章列表失败" }))
    }
  }, [])

  // 选中 fakeid 变化时加载第一页
  React.useEffect(() => {
    if (!selectedFakeid) return
    loadArticles(selectedFakeid, 0)
  }, [selectedFakeid, loadArticles])

  // 切换 checkbox
  const toggleOne = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 全选 / 取消全选
  const toggleAll = () => {
    if (checkedIds.size === articles.list.length) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(articles.list.map((a) => a.id)))
    }
  }

  const checkedArticles = React.useMemo(
    () => articles.list.filter((a) => checkedIds.has(a.id)),
    [articles.list, checkedIds]
  )

  // 轮询下载进度（每 2s 一次）
  React.useEffect(() => {
    if (dlStatus !== "running" || !dlTaskId) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await api.pollTaskStatus(dlTaskId)
        if (cancelled) return
        if (!res) {
          setDlStatus("error")
          setDlMsg("下载任务不存在或已过期，请重新提交")
          return
        }
        setDlProgress(res.progress || 0)
        setDlSuccess(res.successCount || 0)
        setDlFailed(res.failedCount || 0)
        if (res.status === "done") {
          setDlProgress(100)
          setDlStatus("done")
          setDlCurrent(`已完成：成功 ${res.successCount || 0} 篇，失败 ${res.failedCount || 0} 篇`)
        } else if (res.status === "error" || res.status === "cancelled") {
          setDlStatus("error")
          setDlMsg(res.errorHint || (res.status === "cancelled" ? "任务已取消" : "下载失败"))
        } else {
          setDlCurrent(
            `正在下载 · 成功 ${res.successCount || 0} 篇，失败 ${res.failedCount || 0} 篇` +
            (res.current ? ` · ${res.current}` : "")
          )
        }
      } catch (err) {
        if (!cancelled) {
          setDlStatus("error")
          setDlMsg(err?.message || "查询下载进度失败")
        }
      }
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [dlStatus, dlTaskId])

  // 启动批量下载
  const handleDownload = async () => {
    if (!checkedArticles.length) return
    const account = favorites.accounts.find((a) => a.fakeid === selectedFakeid)
    setDlStatus("running")
    setDlMsg("")
    setDlTaskId("")
    setDlProgress(0)
    setDlSuccess(0)
    setDlFailed(0)
    setDlCurrent(`正在提交 ${checkedArticles.length} 篇文章…`)
    try {
      const res = await api.downloadArticles({
        articles: checkedArticles,
        accountName: account?.nickname || "unknown",
      })
      setDlTaskId(res.taskId)
      setDlCurrent(res.message || `已启动任务 ${res.taskId}`)
    } catch (err) {
      setDlStatus("error")
      setDlMsg(err?.message || "启动下载失败")
    }
  }

  const handleReset = () => {
    setDlStatus("idle")
    setDlTaskId("")
    setDlProgress(0)
    setDlSuccess(0)
    setDlFailed(0)
    setDlMsg("")
    setDlCurrent("")
  }

  const handlePrev = () => {
    if (begin > 0) loadArticles(selectedFakeid, Math.max(0, begin - pageSize))
  }
  const handleNext = () => {
    loadArticles(selectedFakeid, begin + pageSize)
  }

  const isFavEmpty = !favorites.loading && !favorites.error && favorites.accounts.length === 0
  const running = dlStatus === "running"

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部选择器 */}
      <section className="rounded-md border border-border bg-card p-5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-serif text-lg font-semibold tracking-tight">选择公众号</h3>
            <p className="mt-0.5 text-[12px] leading-6 text-muted-foreground">
              从已关注公众号中挑一个，下方会加载它的文章列表。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadFavorites}
              disabled={favorites.loading}
              className="h-8 gap-1.5 text-[12px] active:scale-95"
            >
              {favorites.loading ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              )}
              刷新
            </Button>
          </div>
        </div>

        {/* 公众号选择区 */}
        {favorites.loading ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-28 rounded-md" />)}
          </div>
        ) : favorites.error ? (
          <div className="mt-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle className="font-serif text-base font-semibold tracking-tight">读取公众号失败</AlertTitle>
              <AlertDescription className="mt-1 text-sm leading-7">{favorites.error}</AlertDescription>
            </Alert>
          </div>
        ) : isFavEmpty ? (
          <div className="mt-4">
            <EmptyState
              icon={BookOpen}
              title="还没有关注任何公众号"
              description="先去「公众号管理」页搜索并关注几个公众号，这里就能加载它们的文章了。"
              action={
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onNavigate && onNavigate("accounts")}
                  className="gap-2 active:scale-95"
                >
                  去公众号管理
                </Button>
              }
              className="py-10"
            />
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {favorites.accounts.map((a) => {
              const active = a.fakeid === selectedFakeid
              return (
                <button
                  key={a.fakeid}
                  type="button"
                  onClick={() => setSelectedFakeid(a.fakeid)}
                  className={
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                    (active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface/40 text-foreground hover:bg-secondary")
                  }
                  aria-current={active ? "page" : undefined}
                >
                  {a.avatar ? (
                    <img src={a.avatar} alt="" className="h-5 w-5 rounded-full border border-border object-cover" />
                  ) : (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#12372e] font-serif text-[10px] font-bold text-white">
                      {(a.nickname || "?").slice(0, 1)}
                    </span>
                  )}
                  <span className="max-w-[160px] truncate">{a.nickname}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* 文章列表区 */}
      {!isFavEmpty && selectedFakeid && (
        <section className="rounded-md border border-border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-serif text-lg font-semibold tracking-tight">文章列表</h3>
              <p className="mt-0.5 text-[12px] leading-6 text-muted-foreground">
                共 {articles.total} 篇 · 当前第 {Math.floor(begin / pageSize) + 1} 页 · 每页 {pageSize} 篇
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                已选 {checkedIds.size} / {articles.list.length}
              </span>
            </div>
          </div>

          {articles.loading ? (
            <ArticleListSkeleton />
          ) : articles.error ? (
            <div className="mt-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle className="font-serif text-base font-semibold tracking-tight">读取文章列表失败</AlertTitle>
                <AlertDescription className="mt-1 text-sm leading-7">{articles.error}</AlertDescription>
              </Alert>
            </div>
          ) : articles.throttled ? (
            <div className="mt-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle className="font-serif text-base font-semibold tracking-tight">被微信侧频控了</AlertTitle>
                <AlertDescription className="mt-1 text-sm leading-7">
                  后端返回 errcode -2014，需要等待冷却。剩余约 {articles.cooldownLeft || "—"} 秒后再试。
                </AlertDescription>
              </Alert>
            </div>
          ) : articles.list.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={ListChecks}
                title="这个公众号暂时没有拉到文章"
                description="也许是最近没有发文，或者后端还没建立缓存。可以试试切换到另一个公众号。"
                className="py-10"
              />
            </div>
          ) : (
            <>
              {/* 批量选择 + 下载按钮 */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface/40 px-3 py-2.5">
                <label className="inline-flex cursor-pointer items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={checkedIds.size === articles.list.length && articles.list.length > 0}
                    onChange={toggleAll}
                  />
                  <span>全选当前页</span>
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleDownload}
                  disabled={!checkedIds.size || running}
                  className="h-8 gap-1.5 text-[12px] active:scale-95"
                >
                  {running ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-3 w-3" aria-hidden="true" />
                  )}
                  {running ? "下载中…" : `下载选中 ${checkedIds.size} 篇`}
                </Button>
              </div>

              {/* 文章列表 */}
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border">
                {articles.list.map((a) => {
                  const checked = checkedIds.has(a.id)
                  return (
                    <li key={a.id} className={"flex items-start gap-3 px-4 py-3 transition-colors " + (checked ? "bg-primary/5" : "")}>
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        checked={checked}
                        onChange={() => toggleOne(a.id)}
                        aria-label={`选择 ${a.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block truncate text-sm font-medium text-foreground hover:text-primary"
                          title={a.title}
                        >
                          {a.title}
                        </a>
                        {(a.author || a.publishAt) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            {a.author && <span>{a.author}</span>}
                            {a.publishAt && <span>{formatPublishAt(a.publishAt)}</span>}
                          </div>
                        )}
                        {a.digest && (
                          <p className="mt-1 line-clamp-2 text-[12px] leading-6 text-muted-foreground">
                            {a.digest}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* 分页 */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {articles.total > 0 ? `${begin + 1} – ${Math.min(begin + articles.list.length, articles.total)} / ${articles.total}` : "—"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePrev}
                    disabled={begin <= 0 || articles.loading}
                    className="h-7 gap-1 text-[11px] active:scale-95"
                  >
                    <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                    上一页
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleNext}
                    disabled={articles.loading || articles.list.length < pageSize}
                    className="h-7 gap-1 text-[11px] active:scale-95"
                  >
                    下一页
                    <ChevronRight className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* 下载进度区 */}
      {(dlStatus !== "idle" || (running && dlTaskId)) && (
        <section className="rounded-md border border-border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-serif text-lg font-semibold tracking-tight">下载进度</h3>
            {!running && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-7 text-[11px] active:scale-95"
              >
                清空
              </Button>
            )}
          </div>

          {dlStatus === "running" || dlStatus === "done" ? (
            <div className="mt-3 flex flex-col gap-3">
              <CollectProgress
                value={dlProgress}
                running={dlStatus === "running"}
                current={dlCurrent}
                label="下载进度"
              />
              <div className="grid grid-cols-3 gap-3">
                <CountBlock label="总数" value={dlSuccess + dlFailed} />
                <CountBlock label="成功" value={dlSuccess} tone="success" />
                <CountBlock label="失败" value={dlFailed} tone={dlFailed > 0 ? "danger" : undefined} />
              </div>
              {dlStatus === "done" && (
                <div className="rounded-md border border-[#4F7A5A]/30 bg-[#4F7A5A]/[0.06] px-4 py-2.5 text-sm leading-6 text-[#385742]">
                  下载任务已完成：成功 {dlSuccess} 篇，失败 {dlFailed} 篇。
                </div>
              )}
            </div>
          ) : dlStatus === "error" ? (
            <div className="mt-3">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle className="font-serif text-base font-semibold tracking-tight">下载失败</AlertTitle>
                <AlertDescription className="mt-1 flex flex-col gap-3 text-sm leading-7">
                  <span>{dlMsg || "下载任务未能完成。"}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    disabled={!checkedArticles.length}
                    className="self-start gap-1 active:scale-95"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    重试
                  </Button>
                </AlertDescription>
              </Alert>
              {(dlSuccess > 0 || dlFailed > 0) && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <CountBlock label="总数" value={dlSuccess + dlFailed} />
                  <CountBlock label="成功" value={dlSuccess} tone="success" />
                  <CountBlock label="失败" value={dlFailed} tone="danger" />
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  )
}

ArticleBrowseTab.propTypes = {
  onNavigate: PropTypes.func,
}

/**
 * 发布时间格式化 —— 秒级时间戳 → YYYY-MM-DD HH:mm
 * @param {number} ts
 */
function formatPublishAt(ts) {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** 结果计数块 */
function CountBlock({ label, value, tone }) {
  const valueClass =
    tone === "success" ? "text-[#385742]" : tone === "danger" ? "text-[#7d2f26]" : "text-foreground"
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2.5">
      <div className={`font-serif text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

CountBlock.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  tone: PropTypes.oneOf(["success", "danger"]),
}

/** 文章列表骨架屏 */
function ArticleListSkeleton() {
  return (
    <ul className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3">
          <Skeleton className="mt-1 h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </li>
      ))}
    </ul>
  )
}
