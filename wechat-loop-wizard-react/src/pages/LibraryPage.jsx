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
  Search, X, Download, FileText, ExternalLink, RefreshCw, Loader2, Tag, FolderTree, Plus, Database, Upload,
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
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState("")
  const [data, setData] = React.useState({ total: 0, items: [], accounts: [], topics: [] })

  const [activeId, setActiveId] = React.useState("")
  const [detail, setDetail] = React.useState(null)
  const [detailLoading, setDetailLoading] = React.useState(false)

  // 知识库列表 / 切换 / 新建
  const [kbs, setKbs] = React.useState([])
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [newPath, setNewPath] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  // 导入采集结果
  const [importing, setImporting] = React.useState(false)
  const [showImport, setShowImport] = React.useState(false)
  const [importPreview, setImportPreview] = React.useState(null)
  const [notice, setNotice] = React.useState("")

  const PAGE_SIZE = 50

  // 搜索框 debounce 300ms
  React.useEffect(() => {
    const t = setTimeout(() => setKeyword(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  const loadKbs = React.useCallback(async () => {
    try {
      setKbs(await api.kbList())
    } catch {
      // 知识库列表失败不阻塞检索
    }
  }, [])

  React.useEffect(() => { loadKbs() }, [loadKbs])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await api.kbArticles({ q: keyword, account, tag, sort, limit: PAGE_SIZE })
      setData(res)
    } catch (err) {
      setError(err?.message || "读取知识库失败")
      setData({ total: 0, items: [], accounts: [], topics: [] })
    } finally {
      setLoading(false)
    }
  }, [keyword, account, tag, sort])

  React.useEffect(() => { load() }, [load])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const res = await api.kbArticles({
        q: keyword, account, tag, sort, limit: PAGE_SIZE, offset: data.items.length,
      })
      setData((prev) => ({ ...res, items: [...prev.items, ...(res.items || [])] }))
    } catch (err) {
      setError(err?.message || "加载更多失败")
    } finally {
      setLoadingMore(false)
    }
  }

  const switchKb = async (id) => {
    if (!id || kbs.find((k) => k.id === id && k.isActive)) return
    setLoading(true)
    setError("")
    try {
      await api.kbSetActive(id)
      setActiveId("")
      await loadKbs()
      await load()
    } catch (err) {
      setError(err?.message || "切换知识库失败")
      setLoading(false)
    }
  }

  const openCreate = () => {
    setNewName("")
    setNewPath("")
    setCreating(true)
  }

  const submitCreate = async () => {
    const name = newName.trim()
    if (!name) { setError("请填写知识库名称"); return }
    // 路径自动生成：ASCII 名称直接用作文件名，中文名用时间戳
    const slug = /^[A-Za-z0-9_-]+$/.test(name) ? name.toLowerCase() : `kb_${Date.now().toString(36)}`
    const path = (newPath.trim() || `loop/kb/${slug}.json`)
    setSaving(true)
    setError("")
    try {
      const created = await api.kbCreate({ name, path })
      setCreating(false)
      await loadKbs()
      if (created?.id) await switchKb(created.id)
    } catch (err) {
      setError(err?.message || "新建知识库失败")
    } finally {
      setSaving(false)
    }
  }

  const activeKbName = kbs.find((k) => k.isActive)?.name || "当前知识库"

  // 导入采集结果：先预览数量，再确认导入
  const openImport = async () => {
    setImporting(true)
    setError("")
    setNotice("")
    try {
      const prev = await api.kbImportSources()
      setImportPreview(prev)
      if (!prev.available) {
        setNotice("暂无可导入的采集结果（wechat-mp-tools/data/articles_full 为空）")
        setShowImport(false)
      } else if (!prev.toImport) {
        setNotice(`采集结果共 ${prev.available} 篇，均已在当前知识库中，无需重复导入。`)
        setShowImport(false)
      } else {
        setShowImport(true)
      }
    } catch (err) {
      setError(err?.message || "读取采集结果失败")
    } finally {
      setImporting(false)
    }
  }

  const confirmImport = async () => {
    setImporting(true)
    setError("")
    setNotice("")
    try {
      const res = await api.kbImport()
      setShowImport(false)
      const msg = res.added > 0
        ? `成功导入 ${res.added} 篇${res.skipped ? `，跳过 ${res.skipped} 篇已存在` : ""}。`
        : (res.message || `没有新增导入（跳过 ${res.skipped || 0} 篇已存在）。`)
      setNotice(msg)
      setActiveId("")
      await loadKbs()
      await load()
    } catch (err) {
      setError(err?.message || "导入采集结果失败")
    } finally {
      setImporting(false)
    }
  }

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
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={kbs.find((k) => k.isActive)?.id || ""}
              onChange={(e) => switchKb(e.target.value)}
              className="max-w-[180px] bg-transparent text-xs outline-none"
              aria-label="切换知识库"
            >
              {kbs.length === 0 && <option value="">加载中…</option>}
              {kbs.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}（{k.articleCount}）
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={openCreate}
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="新建知识库"
              title="新建知识库"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.open(api.kbExportUrl("md", filters), "_blank")} className="gap-1">
            <Download className="h-3 w-3" /> 导出 MD
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(api.kbExportUrl("zip", filters), "_blank")} className="gap-1">
            <Download className="h-3 w-3" /> 导出 ZIP
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(api.kbExportUrl("json", filters), "_blank")} className="gap-1">
            <Download className="h-3 w-3" /> 导出 JSON
          </Button>
          <Button variant="outline" size="sm" onClick={openImport} disabled={importing} className="gap-1">
            {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} 导入采集结果
          </Button>
          <Button variant="outline" size="sm" onClick={load} className="gap-1">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> 刷新
          </Button>
        </div>
      </header>

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="rounded-sm p-0.5 hover:bg-emerald-500/20" aria-label="关闭提示">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

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
            {!loading && !error && data.items.length > 0 && data.items.length < data.total && (
              <div className="border-t border-border p-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
                  加载更多（已显示 {data.items.length}/{data.total}）
                </Button>
              </div>
            )}
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

      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setCreating(false)}
        >
          <div
            className="w-full max-w-sm rounded-md border border-border bg-card p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="新建知识库"
          >
            <h3 className="font-serif text-lg font-semibold">新建知识库</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              会创建在 loop/kb/ 下，创建后自动切换过去。
            </p>
            <label htmlFor="kb-name" className="mt-4 block text-[13px] font-medium">名称</label>
            <Input
              id="kb-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：游戏赛道"
              className="mt-1 h-9"
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate() }}
            />
            <label htmlFor="kb-path" className="mt-3 block text-[13px] font-medium">
              文件路径 <span className="font-normal text-muted-foreground">（可选）</span>
            </label>
            <Input
              id="kb-path"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="留空自动生成 loop/kb/xxx.json"
              className="mt-1 h-9 font-mono text-xs"
            />
            {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreating(false)} disabled={saving}>取消</Button>
              <Button size="sm" onClick={submitCreate} disabled={saving} className="gap-1">
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                创建
              </Button>
            </div>
          </div>
        </div>
      )}

      {showImport && importPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => { if (!importing) setShowImport(false) }}
        >
          <div
            className="w-full max-w-sm rounded-md border border-border bg-card p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="导入采集结果"
          >
            <h3 className="font-serif text-lg font-semibold">导入采集结果</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              将上游 wechat-mp-tools 采集到的文章导入当前知识库，按文章链接去重。
            </p>
            <div className="mt-4 space-y-1.5 rounded-md border border-border bg-secondary/40 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">目标知识库</span>
                <span className="font-medium">{activeKbName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">采集结果总数</span>
                <span className="font-mono">{importPreview.available}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">未入库（将导入）</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">{importPreview.toImport}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">已存在（将跳过）</span>
                <span className="font-mono text-muted-foreground">{importPreview.alreadyInKb}</span>
              </div>
              {importPreview.accounts?.length > 0 && (
                <div className="pt-1 text-muted-foreground">来源：{importPreview.accounts.join("、")}</div>
              )}
            </div>
            {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowImport(false)} disabled={importing}>取消</Button>
              <Button size="sm" onClick={confirmImport} disabled={importing || !importPreview.toImport} className="gap-1">
                {importing && <Loader2 className="h-3 w-3 animate-spin" />}
                开始导入
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
