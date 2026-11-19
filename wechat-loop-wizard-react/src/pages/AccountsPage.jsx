import * as React from "react"
import PropTypes from "prop-types"
import {
  Search, Plus, Check, Trash2, Loader2, AlertTriangle, RefreshCw, BookOpen,
  CloudDownload, Newspaper, Radio, X, Copy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/EmptyState"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"

/**
 * 公众号管理页 —— 搜索 / 从微信读书同步 / 收藏 / RSS 订阅
 *
 * @param {{onNavigate?: (to: string) => void}} props
 */
export function AccountsPage({ onNavigate }) {
  const [keyword, setKeyword] = React.useState("")
  const [searching, setSearching] = React.useState(false)
  const [searchResults, setSearchResults] = React.useState([])
  const [searchError, setSearchError] = React.useState("")

  const [favState, setFavState] = React.useState({ loading: true, error: "", accounts: [], total: 0 })
  const [busyKey, setBusyKey] = React.useState("")
  const [toast, setToast] = React.useState("")

  // 微信读书同步
  const [syncing, setSyncing] = React.useState(false)
  const [syncState, setSyncState] = React.useState(null) // { mps, total, cached, error, throttled, needVerify }
  const [syncError, setSyncError] = React.useState("")

  const [rssTarget, setRssTarget] = React.useState(null)

  const loadFavorites = React.useCallback(async () => {
    setFavState((s) => ({ ...s, loading: true, error: "" }))
    try {
      const res = await api.listFavorites()
      setFavState({ loading: false, error: "", accounts: res.accounts, total: res.total })
    } catch (err) {
      setFavState((s) => ({ ...s, loading: false, error: err?.message || "读取公众号列表失败" }))
    }
  }, [])

  React.useEffect(() => { loadFavorites() }, [loadFavorites])

  const favFakeids = React.useMemo(
    () => new Set(favState.accounts.map((a) => a.fakeid).filter(Boolean)),
    [favState.accounts]
  )

  const flashToast = React.useCallback((text) => {
    setToast(text)
    window.setTimeout(() => setToast(""), 2500)
  }, [])

  // ── 搜索 ──
  const handleSearch = async (e) => {
    if (e) e.preventDefault()
    const kw = keyword.trim()
    if (!kw) {
      setSearchError("请输入公众号名称、文章链接或 biz")
      return
    }
    setSearching(true)
    setSearchError("")
    setSearchResults([])
    try {
      const res = await api.searchAccounts(kw)
      setSearchResults(res.results || [])
      if (!res.results?.length) {
        setSearchError("没有搜到匹配的公众号，试试不同的关键字或直接贴文章链接")
      }
    } catch (err) {
      setSearchError(err?.message || "搜索失败")
    } finally {
      setSearching(false)
    }
  }

  // ── 从微信读书同步 ──
  const handleSync = async (force = false) => {
    setSyncing(true)
    setSyncError("")
    try {
      const res = await api.listUserMps({ force })
      setSyncState(res)
      if (res.throttled) {
        setSyncError(res.error || `触发微信读书频控，请 ${res.cooldownLeft || 30} 秒后再试`)
      } else if (res.needVerify) {
        setSyncError("微信读书要求人机验证，请先在账号池页完成验证后再同步")
      } else if (!res.mps.length) {
        setSyncError("书架里没有公众号，先去微信读书里关注几个公众号")
      }
    } catch (err) {
      setSyncState(null)
      setSyncError(err?.message || "从微信读书同步失败")
    } finally {
      setSyncing(false)
    }
  }

  // ── 关注 / 取消关注 ──
  const handleAdd = async (acc, { silent = false } = {}) => {
    if (!acc.fakeid) {
      if (!silent) flashToast("缺少公众号标识，无法收藏")
      return false
    }
    setBusyKey(`add:${acc.fakeid}`)
    try {
      await api.addFavorite({
        fakeid: acc.fakeid,
        nickname: acc.nickname,
        bookId: acc.bookId,
        avatar: acc.avatar,
      })
      if (!silent) flashToast(`已关注「${acc.nickname}」`)
      setSearchResults((prev) => prev.map((r) => (r.fakeid === acc.fakeid ? { ...r, _followed: true } : r)))
      return true
    } catch (err) {
      if (!silent) flashToast(err?.message || "关注失败")
      return false
    } finally {
      setBusyKey("")
    }
  }

  const handleFollowAllSynced = async () => {
    const pending = (syncState?.mps || []).filter((m) => m.fakeid && !favFakeids.has(m.fakeid))
    if (!pending.length) {
      flashToast("没有需要新关注的公众号")
      return
    }
    setBusyKey("sync:all")
    let ok = 0
    for (const m of pending) {
      // 串行，避免后端写 accounts.json 并发覆盖
      const done = await handleAdd(m, { silent: true })
      if (done) ok += 1
      await new Promise((r) => window.setTimeout(r, 120))
    }
    setBusyKey("")
    await loadFavorites()
    flashToast(ok ? `已关注 ${ok} 个公众号` : "关注失败，请重试")
  }

  const handleRemove = async (acc) => {
    setBusyKey(`remove:${acc.fakeid}`)
    try {
      await api.removeFavorite(acc.fakeid)
      flashToast(`已取消关注「${acc.nickname}」`)
      await loadFavorites()
      setSearchResults((prev) => prev.map((r) => (r.fakeid === acc.fakeid ? { ...r, _followed: false } : r)))
    } catch (err) {
      flashToast(err?.message || "取消关注失败")
    } finally {
      setBusyKey("")
    }
  }

  const openArticles = (acc) => {
    if (!acc.fakeid) {
      flashToast("该公众号缺少 fakeid，请删除后重新收藏")
      return
    }
    const qs = new URLSearchParams({ fakeid: acc.fakeid, name: acc.nickname || "" }).toString()
    onNavigate?.(`articles?${qs}`)
  }

  const syncPendingCount = (syncState?.mps || []).filter((m) => m.fakeid && !favFakeids.has(m.fakeid)).length

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 00.5</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">公众号管理</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          搜索、从微信读书同步、收藏公众号。收藏后可在「公众号文章」页打开列表、按需下载。
        </p>
      </header>

      {/* 搜索面板 */}
      <Card className="rounded-md shadow-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="font-serif text-lg font-semibold">搜索公众号</CardTitle>
          <CardDescription className="mt-0.5 text-xs leading-6">
            支持三种输入：公众号名称关键字、文章链接（mp.weixin.qq.com/s/…）、或 biz 标识。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pb-5 pt-0">
          <form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入公众号名称、文章链接 或 biz…"
                className="h-9 w-full pl-9 text-sm"
                aria-label="搜索公众号"
              />
            </div>
            <Button type="submit" size="default" disabled={searching} className="h-9 gap-2 active:scale-95">
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {searching ? "搜索中…" : "搜索"}
            </Button>
          </form>

          {searchError && <p className="text-[12px] leading-6 text-[#7d2f26]">{searchError}</p>}

          {searching ? (
            <SearchSkeleton />
          ) : searchResults.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface/40">
              {searchResults.map((r) => {
                const followed = favFakeids.has(r.fakeid) || r._followed
                const adding = busyKey === `add:${r.fakeid}`
                return (
                  <li key={r.fakeid || r.bookId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar acc={r} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.nickname}</p>
                        {r.signature && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={r.signature}>
                            {r.signature}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:ml-2">
                      <Button
                        type="button"
                        variant={followed ? "outline" : "default"}
                        size="sm"
                        onClick={() => handleAdd(r)}
                        disabled={followed || adding}
                        className="h-8 gap-1.5 text-[12px] active:scale-95"
                      >
                        {adding ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : followed ? (
                          <Check className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        )}
                        {followed ? "已关注" : adding ? "关注中…" : "关注"}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* 从微信读书同步 */}
      <Card className="rounded-md shadow-card">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2 pt-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="font-serif text-lg font-semibold">从微信读书同步关注</CardTitle>
            <CardDescription className="mt-0.5 text-xs leading-6">
              拉取微信读书书架里已关注的公众号，批量加入收藏列表。
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={() => handleSync(true)}
              className="h-8 gap-1.5 text-[12px] active:scale-95"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {syncing ? "同步中…" : "同步关注"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pb-5 pt-0">
          {syncing && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-[12px] leading-6 text-muted-foreground">
                正在读取微信读书书架，通常需要 5–20 秒，请稍候…
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface/40">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-2.5 w-40" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {syncError && (
            <Alert variant="destructive" className="mt-2">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle className="font-serif text-sm font-semibold">同步未完成</AlertTitle>
              <AlertDescription className="mt-1 flex flex-col gap-2 text-[12px] leading-6">
                <span>{syncError}</span>
                {needsAccountPool(syncError) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 self-start gap-1 text-[12px] active:scale-95"
                    onClick={() => onNavigate?.("pool")}
                  >
                    去账号池登录
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 self-start gap-1 text-[12px] active:scale-95"
                  onClick={() => handleSync(true)}
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  重试同步
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {syncState && syncState.mps.length > 0 && (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-muted-foreground">
                  书架共 {syncState.total} 个公众号{syncState.cached ? "（缓存）" : ""}，待新增{" "}
                  <span className="font-medium text-foreground">{syncPendingCount}</span> 个
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={!syncPendingCount || busyKey === "sync:all"}
                  onClick={handleFollowAllSynced}
                  className="h-8 gap-1.5 text-[12px] active:scale-95"
                >
                  {busyKey === "sync:all" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {busyKey === "sync:all" ? "关注中…" : `全部关注（${syncPendingCount}）`}
                </Button>
              </div>
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface/40">
                {syncState.mps.map((m) => {
                  const followed = favFakeids.has(m.fakeid)
                  const adding = busyKey === `add:${m.fakeid}`
                  return (
                    <li key={m.bookId || m.fakeid} className="flex items-center gap-3 px-4 py-3">
                      <Avatar acc={m} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.nickname}</p>
                        {m.signature && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={m.signature}>
                            {m.signature}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant={followed ? "ghost" : "outline"}
                        size="sm"
                        disabled={followed || adding}
                        onClick={() => handleAdd(m)}
                        className="h-8 shrink-0 gap-1.5 text-[12px] active:scale-95"
                      >
                        {adding ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : followed ? (
                          <Check className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        )}
                        {followed ? "已关注" : adding ? "关注中…" : "关注"}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 已关注列表 */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-semibold tracking-tight">已收藏公众号</h2>
            <p className="mt-1 text-sm leading-7 text-muted-foreground">
              共 {favState.total} 个。点击「文章」打开列表按需下载，采集时会逐个轮换。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadFavorites}
            disabled={favState.loading}
            className="gap-2 active:scale-95"
          >
            {favState.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            刷新
          </Button>
        </div>

        {favState.loading ? (
          <FavoritesSkeleton />
        ) : favState.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="font-serif text-base font-semibold tracking-tight">读取公众号列表失败</AlertTitle>
            <AlertDescription className="mt-1 flex flex-col gap-3 text-sm leading-7">
              <span>{favState.error}</span>
              <Button variant="outline" size="sm" onClick={loadFavorites} className="self-start gap-1 active:scale-95">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : favState.accounts.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="还没有收藏的公众号"
            description="先在上面搜索并关注，或点「同步关注」从微信读书书架批量导入。"
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {favState.accounts.map((acc) => {
              const removing = busyKey === `remove:${acc.fakeid}`
              return (
                <li
                  key={acc.fakeid || acc.nickname}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"
                >
                  <button
                    type="button"
                    onClick={() => openArticles(acc)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Avatar acc={acc} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium hover:text-primary">{acc.nickname}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>文章 {acc.subscribeCount || 0}</span>
                        <span>更新 {formatTime(acc.updateTime)}</span>
                        {acc.fakeid && (
                          <span className="truncate font-mono tabular-nums text-muted-foreground/70" title={acc.fakeid}>
                            {acc.fakeid.length > 16 ? acc.fakeid.slice(0, 8) + "…" + acc.fakeid.slice(-6) : acc.fakeid}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 sm:ml-4">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5 text-[12px] active:scale-95"
                      onClick={() => openArticles(acc)}
                    >
                      <Newspaper className="h-3 w-3" aria-hidden="true" />
                      文章
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-[12px] active:scale-95"
                      onClick={() => setRssTarget(acc)}
                    >
                      <Radio className="h-3 w-3" aria-hidden="true" />
                      RSS
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemove(acc)}
                      disabled={removing}
                      className="h-8 gap-1.5 text-[12px] text-[#7d2f26] hover:text-[#7d2f26] active:scale-95"
                    >
                      {removing ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      )}
                      {removing ? "取消中…" : "取消关注"}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {rssTarget && (
        <RssDialog
          account={rssTarget}
          onClose={() => setRssTarget(null)}
          onToast={flashToast}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-[#4F7A5A]/40 bg-[#4F7A5A]/[0.08] px-4 py-2 text-sm text-[#385742] shadow-card">
          {toast}
        </div>
      )}
    </div>
  )
}

AccountsPage.propTypes = {
  onNavigate: PropTypes.func,
}

/**
 * RSS 订阅弹窗 —— 查看状态 / 开关订阅 / 复制 RSS 链接
 * @param {{account: {fakeid: string, nickname: string}, onClose: () => void, onToast: (t: string) => void}} props
 */
function RssDialog({ account, onClose, onToast }) {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [sub, setSub] = React.useState(null)
  const [interval, setInterval] = React.useState(60)
  const [error, setError] = React.useState("")
  const [rssUrl, setRssUrl] = React.useState("")

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [subsRes, settings] = await Promise.all([
          api.rssSubscriptions(),
          api.getSettings().catch(() => ({})),
        ])
        if (cancelled) return
        const found = (subsRes.subscriptions || []).find((s) => s.fakeid === account.fakeid) || null
        setSub(found)
        setInterval(found?.interval_minutes || 60)

        const base = String(settings?.rss_base_url || window.location.origin).trim().replace(/\/+$/, "")
        const token = String(settings?.rss_token || "").trim()
        const q = token ? `?token=${encodeURIComponent(token)}` : ""
        setRssUrl(`${base.startsWith("http") ? base : `https://${base}`}/api/articles/rss/${encodeURIComponent(account.nickname)}${q}`)
      } catch (err) {
        if (!cancelled) setError(err?.message || "读取 RSS 订阅状态失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [account.fakeid, account.nickname])

  const toggle = async (enable) => {
    setSaving(true)
    setError("")
    try {
      if (enable) {
        await api.rssSubscribe(account.fakeid, interval)
        onToast(`已开启「${account.nickname}」的 RSS 自动抓取`)
      } else {
        await api.rssUnsubscribe(account.fakeid)
        onToast(`已关闭「${account.nickname}」的 RSS 自动抓取`)
      }
      const subsRes = await api.rssSubscriptions()
      setSub((subsRes.subscriptions || []).find((s) => s.fakeid === account.fakeid) || null)
    } catch (err) {
      setError(err?.message || "操作失败")
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rssUrl)
      onToast("RSS 链接已复制")
    } catch {
      onToast("复制失败，请手动选中复制")
    }
  }

  const enabled = !!sub?.enabled

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-md border border-border bg-card p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="RSS 订阅设置"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-serif text-lg font-semibold tracking-tight">RSS 订阅</h3>
            <p className="mt-1 text-xs text-muted-foreground">{account.nickname}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="关闭">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="mt-5 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border border-border bg-surface/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">订阅状态</span>
              <span className={cn("font-medium", enabled ? "text-[#385742]" : "text-muted-foreground")}>
                {enabled ? "运行中" : "未订阅"}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <label htmlFor="rss-interval" className="text-sm text-muted-foreground">抓取间隔</label>
              <select
                id="rss-interval"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-primary"
              >
                <option value={30}>30 分钟</option>
                <option value={60}>1 小时</option>
                <option value={180}>3 小时</option>
                <option value={360}>6 小时</option>
              </select>
            </div>

            {enabled && sub?.last_fetch_time && (
              <p className="text-[11px] text-muted-foreground">
                上次抓取：{new Date(sub.last_fetch_time * 1000).toLocaleString("zh-CN")}
                {sub.last_fetch_count !== undefined ? ` · 新增 ${sub.last_fetch_count} 篇` : ""}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">RSS 链接</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface/60 px-2.5 py-1.5 font-mono text-[11px]">
                  {rssUrl}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={copy} className="h-8 shrink-0 gap-1 text-[12px]">
                  <Copy className="h-3 w-3" aria-hidden="true" />
                  复制
                </Button>
              </div>
            </div>

            {error && <p className="text-[12px] text-[#7d2f26]">{error}</p>}

            <div className="flex justify-end gap-2">
              {enabled ? (
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => toggle(false)} className="gap-1.5">
                  {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                  关闭订阅
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={saving} onClick={() => toggle(true)} className="gap-1.5">
                  {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                  开启订阅
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

RssDialog.propTypes = {
  account: PropTypes.shape({ fakeid: PropTypes.string, nickname: PropTypes.string }).isRequired,
  onClose: PropTypes.func.isRequired,
  onToast: PropTypes.func.isRequired,
}

/**
 * 公众号头像（无图时用首字占位）
 * @param {{acc: {nickname?: string, avatar?: string}}} props
 */
function Avatar({ acc }) {
  if (acc.avatar) {
    return <img src={acc.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />
  }
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#12372e] font-serif text-sm font-bold text-white">
      {(acc.nickname || "?").slice(0, 1)}
    </span>
  )
}

Avatar.propTypes = {
  acc: PropTypes.shape({ nickname: PropTypes.string, avatar: PropTypes.string }).isRequired,
}

/**
 * 错误文案里出现「账号池 / 登录 / 扫码」时，提示用户去账号池页
 * @param {string} message
 */
function needsAccountPool(message) {
  return /账号池|扫码|登录|未登录/.test(String(message || ""))
}

/**
 * 时间格式化 —— 秒级时间戳 → MM-DD HH:mm
 * @param {number} ts
 */
function formatTime(ts) {
  if (!ts) return "—"
  const d = new Date(ts * 1000)
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** 搜索结果骨架屏 */
function SearchSkeleton() {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface/40">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-8 w-16 rounded-md" />
        </li>
      ))}
    </ul>
  )
}

/** 已关注列表骨架屏 */
function FavoritesSkeleton() {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </li>
      ))}
    </ul>
  )
}
