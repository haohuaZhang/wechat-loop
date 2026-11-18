import * as React from "react"
import PropTypes from "prop-types"
import { Search, Plus, Check, Trash2, Loader2, AlertTriangle, RefreshCw, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/EmptyState"
import { api } from "@/api/client"

/**
 * 公众号管理页 —— 搜索并关注公众号，一键采集所有已关注公众号的最新文章
 */
export function AccountsPage() {
  const [keyword, setKeyword] = React.useState("")
  const [searching, setSearching] = React.useState(false)
  const [searchResults, setSearchResults] = React.useState([])
  const [searchError, setSearchError] = React.useState("")

  const [favState, setFavState] = React.useState({ loading: true, error: "", accounts: [], total: 0 })
  const [busyKey, setBusyKey] = React.useState("")
  const [toast, setToast] = React.useState("")

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
    () => new Set(favState.accounts.map((a) => a.fakeid)),
    [favState.accounts]
  )

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

  const flashToast = (text) => {
    setToast(text)
    window.setTimeout(() => setToast(""), 2500)
  }

  const handleAdd = async (acc) => {
    setBusyKey(`add:${acc.fakeid}`)
    try {
      await api.addFavorite({
        fakeid: acc.fakeid,
        nickname: acc.nickname,
        bookId: acc.bookId,
        avatar: acc.avatar,
      })
      flashToast(`已关注「${acc.nickname}」`)
      await loadFavorites()
      // 同步刷新搜索结果里的状态
      setSearchResults((prev) => prev.map((r) => r.fakeid === acc.fakeid ? { ...r, _followed: true } : r))
    } catch (err) {
      flashToast(err?.message || "关注失败")
    } finally {
      setBusyKey("")
    }
  }

  const handleRemove = async (acc) => {
    setBusyKey(`remove:${acc.fakeid}`)
    try {
      await api.removeFavorite(acc.fakeid)
      flashToast(`已取消关注「${acc.nickname}」`)
      await loadFavorites()
      setSearchResults((prev) => prev.map((r) => r.fakeid === acc.fakeid ? { ...r, _followed: false } : r))
    } catch (err) {
      flashToast(err?.message || "取消关注失败")
    } finally {
      setBusyKey("")
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 00.5</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">公众号管理</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          搜索并关注公众号，一键采集所有已关注公众号的最新文章。
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
            <Button
              type="submit"
              size="default"
              disabled={searching}
              className="h-9 gap-2 active:scale-95"
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {searching ? "搜索中…" : "搜索"}
            </Button>
          </form>

          {searchError && (
            <p className="text-[12px] leading-6 text-[#7d2f26]">{searchError}</p>
          )}

          {/* 搜索结果列表 */}
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
                      {r.avatar ? (
                        <img src={r.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />
                      ) : (
                        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#12372e] font-serif text-sm font-bold text-white">
                          {(r.nickname || "?").slice(0, 1)}
                        </span>
                      )}
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

      {/* 已关注列表 */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-semibold tracking-tight">已关注公众号</h2>
            <p className="mt-1 text-sm leading-7 text-muted-foreground">
              共 {favState.total} 个。点击右侧按钮可取消关注，采集时会逐个轮换。
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
            title="还没有关注任何公众号"
            description="先在上面的搜索面板里搜一个公众号并点击「关注」，之后就可以在采集向导里一键采集所有已关注公众号的最新文章。"
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {favState.accounts.map((acc) => {
              const removing = busyKey === `remove:${acc.fakeid}`
              return (
                <li key={acc.fakeid} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {acc.avatar ? (
                      <img src={acc.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />
                    ) : (
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#12372e] font-serif text-sm font-bold text-white">
                        {(acc.nickname || "?").slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{acc.nickname}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>文章 {acc.subscribeCount || 0}</span>
                        <span>更新 {formatTime(acc.updateTime)}</span>
                        {acc.fakeid && (
                          <span className="font-mono text-muted-foreground/70 tabular-nums truncate" title={acc.fakeid}>
                            {acc.fakeid.length > 16 ? acc.fakeid.slice(0, 8) + "…" + acc.fakeid.slice(-6) : acc.fakeid}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:ml-4">
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

      {/* toast 提示 */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-[#4F7A5A]/40 bg-[#4F7A5A]/[0.08] px-4 py-2 text-sm text-[#385742] shadow-card">
          {toast}
        </div>
      )}
    </div>
  )
}

AccountsPage.propTypes = {}

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
