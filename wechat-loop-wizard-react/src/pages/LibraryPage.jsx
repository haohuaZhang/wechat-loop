import * as React from "react"
import PropTypes from "prop-types"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/EmptyState"
import {
  Search, X, Download, FileText, ExternalLink, RefreshCw, Loader2, Tag, FolderTree,
} from "lucide-react"

/**
 * LibraryPage —— 入库文章（知识库）
 *
 * 左栏：搜索 + 公众号/标签筛选 + 文章列表（后端 /api/kb/articles 检索）
 * 右栏：正文详情 + 导出
 */

/**
 * 高亮命中的关键词
 * @param {{text: string, keyword: string}} props
 */
function Highlight({ text, keyword }) {
  if (!keyword) return text
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-amber-200/70 px-0.5 text-foreground">{text.slice(idx, idx + keyword.length)}</mark>
      {text.slice(idx + keyword.length)}
    </>
  )
}

Highlight.propTypes = { text: PropTypes.string, keyword: PropTypes.string }

/**
 * @param {{label: string, value: string, onChange: (v: string) => void, options: {name: string, count: number}[], icon?: React.ElementType}} props
 */
function FilterRow({ label, value, onChange, options, icon: Icon }) {
  if (!options.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </span>
      <button
        type="button"
        onClick={() => onChange("all")}
        className={cn(
          "rounded-sm border px-2 py-0.5 text-xs transition-colors",
          value === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
        )}
      >
        全部
      </button>
      {options.map((o) => (
        <button
          key={o.name}
          type="button"
          onClick={() => onChange(value === o.name ? "all" : o.name)}
          className={cn(
            "rounded-sm border px-2 py-0.5 text-xs transition-colors",
            value === o.name ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
          )}
        >
          {o.name} <span className="font-mono tabular-nums opacity-70">{o.count}</span>
        </button>
      ))}
    </div>
  )
}

FilterRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.object).isRequired,
  icon: PropTypes.elementType,
}

export function LibraryPage() {
  const [query, setQuery] = React.useState("")
  const [keyword, setKeyword] = React.useState("")
  const [account, setAccount] = React.useState("all")
  const [tag, setTag] = React.useState("all")
  const [sort, setSort] = React.useState("date")

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [data, setData] = React.useState({ total: 0, items: [], accounts: [], topics: [] })

  const [activeId, setActiveId] = React.useState("")
  const [detail, setDetail] = React.useState(null)
  const [detailLoading, setDetailLoading] = React.useState(false)

  // 搜索框 debounce 300ms
  React.useEffect(() => {
    const t = setTimeout(() => setKeyword(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await api.kbArticles({ q: keyword, account, tag, sort, limit: 200 })
      setData(res)
    } catch (err) {
      setError(err?.message || "读取知识库失败")
      setData({ total: 0, items: [], accounts: [], topics: [] })
    } finally {
      setLoading(false)
    }
  }, [keyword, account, tag, sort])

  React.useEffect(() => { load() }, [load])

  // 选中文章 → 拉正文
  React.useEffect(() => {
    if (!activeId) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true)
    api.kbArticle(activeId)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((err) => { if (!cancelled) setDetail({ error: err?.message || "加载失败" }) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [activeId])

  // 筛选变化后，若当前选中项不在结果里则清空
  React.useEffect(() => {
    if (activeId && !data.items.some((i) => i.id === activeId)) setActiveId("")
  }, [data.items, activeId])

  const filters = { q: keyword, account, tag }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[560px] flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 03</p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">入库文章</h1>
          <p className="text-sm leading-7 text-muted-foreground">
            知识库里共有 <span className="font-medium text-foreground">{data.total}</span> 篇匹配文章，可检索、按公众号/标签筛选、导出。
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => window.open(api.kbExportUrl("md", filters), "_blank")} className="gap-1">
            <Download className="h-3 w-3" /> 导出 MD
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(api.kbExportUrl("zip", filters), "_blank")} className="gap-1">
            <Download className="h-3 w-3" /> 导出 ZIP
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(api.kbExportUrl("json", filters), "_blank")} className="gap-1">
            <Download className="h-3 w-3" /> 导出 JSON
          </Button>
          <Button variant="outline" size="sm" onClick={load} className="gap-1">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> 刷新
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左栏 */}
        <div className="flex w-[380px] shrink-0 flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、摘要、标签…"
              className="h-10 w-full pl-9 pr-9"
              aria-label="搜索知识库"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-secondary"
                aria-label="清除搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border bg-card p-2.5">
            <FilterRow label="公众号" value={account} onChange={setAccount} options={data.accounts} icon={FolderTree} />
            <FilterRow label="标签" value={tag} onChange={setTag} options={data.topics.slice(0, 12)} icon={Tag} />
            <div className="flex items-center gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground">排序</span>
              {[
                ["date", "按时间"], ["words", "按字数"], ["title", "按标题"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={cn(
                    "rounded-sm border px-2 py-0.5 text-xs transition-colors",
                    sort === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-auto rounded-md border border-border bg-card">
            {loading && (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            )}
            {!loading && error && (
              <div className="p-4 text-sm text-destructive">
                {error}
                <Button variant="outline" size="sm" className="mt-2 w-full" onClick={load}>重试</Button>
              </div>
            )}
            {!loading && !error && !data.items.length && (
              <EmptyState
                title="没有匹配的文章"
                description={keyword || account !== "all" || tag !== "all" ? "换个关键词或清空筛选试试。" : "先去「公众号文章」采集，入库后就会出现在这里。"}
              />
            )}
            {!loading && !error && data.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className={cn(
                  "block w-full border-b border-border px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-secondary/60",
                  activeId === item.id && "bg-secondary",
                )}
              >
                <div className="line-clamp-2 text-sm font-medium leading-6">
                  <Highlight text={item.title} keyword={keyword} />
                </div>
                {item.snippet && (
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.snippet}</div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="font-mono">{item.publishDate || "—"}</span>
                  <span>·</span>
                  <span className="truncate">{item.account}</span>
                  {item.wordCount > 0 && <><span>·</span><span className="font-mono tabular-nums">{item.wordCount} 字</span></>}
                  {item.topics.slice(0, 2).map((t) => (
                    <Badge key={t} variant="secondary" className="px-1.5 py-0 text-[10px]">{t}</Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 右栏 */}
        <div className="flex min-w-0 flex-1 flex-col rounded-md border border-border bg-card">
          {!activeId && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              从左侧选一篇文章查看正文
            </div>
          )}
          {activeId && detailLoading && (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 读取正文…
            </div>
          )}
          {activeId && !detailLoading && detail?.error && (
            <div className="p-4 text-sm text-destructive">{detail.error}</div>
          )}
          {activeId && !detailLoading && detail && !detail.error && (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-6">{detail.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{detail.account}</span>
                    <span>·</span>
                    <span className="font-mono">{detail.publishDate || "—"}</span>
                    {detail.usedAsSource && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">已用作素材</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {detail.url && (
                    <Button variant="outline" size="sm" onClick={() => window.open(detail.url, "_blank")} className="gap-1">
                      <ExternalLink className="h-3 w-3" /> 原文
                    </Button>
                  )}
                  {!detail.content && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-border px-2 text-[11px] text-muted-foreground">
                      <FileText className="h-3 w-3" /> 无正文
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-auto px-5 py-4">
                {detail.content ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-7 text-foreground">
                    {detail.content}
                  </pre>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    这篇文章在知识库里只有元数据（标题/日期/链接），没有正文。
                    <br />
                    要读到正文，请用「公众号文章」把这篇重新采集一次（采集时会写入 local_md_path）。
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
