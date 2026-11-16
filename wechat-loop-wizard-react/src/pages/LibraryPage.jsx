import * as React from "react"
import { ArticleList } from "@/components/article/ArticleList"
import { mockArticles } from "@/mock/data"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowUpDown } from "lucide-react"

/**
 * 入库文章页 —— 搜索、筛选、排序
 */
export function LibraryPage() {
  const [mode, setMode] = React.useState("data")
  const [query, setQuery] = React.useState("")
  const [filterAccount, setFilterAccount] = React.useState("all")

  const filtered = React.useMemo(() => {
    return mockArticles.filter((a) => {
      const matchQuery = !query.trim() ||
        a.title.toLowerCase().includes(query.toLowerCase()) ||
        (a.digest || "").toLowerCase().includes(query.toLowerCase())
      const matchAccount = filterAccount === "all" || a.account === filterAccount
      return matchQuery && matchAccount
    })
  }, [query, filterAccount])

  const accounts = Array.from(new Set(mockArticles.map((a) => a.account)))

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 03</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">入库文章</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          浏览已采集的文章，按公众号或关键词筛选，查看正文与标签。
        </p>
      </header>

      {/* 搜索和筛选 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题或摘要…"
            className="h-10 w-full"
            aria-label="搜索文章"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filterAccount} onValueChange={setFilterAccount}>
            <SelectTrigger className="h-10 w-[180px] rounded-sm border-border bg-card text-sm">
              <SelectValue placeholder="全部公众号" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部公众号</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="切换排序"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            按时间
          </button>
        </div>
      </div>

      {/* 模式切换 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/60 p-2 text-xs text-muted-foreground">
        <span className="mr-2 font-medium text-foreground">演示列表状态：</span>
        {[
          { key: "loading", label: "加载中" },
          { key: "empty", label: "空状态" },
          { key: "data", label: "有数据" },
          { key: "error", label: "出错" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setMode(item.key)}
            className={
              "rounded-sm px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (mode === item.key
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground")
            }
          >
            {item.label}
          </button>
        ))}
        {mode === "data" && (
          <span className="ml-auto font-mono tabular-nums">
            共 {filtered.length} 篇
          </span>
        )}
      </div>

      <ArticleList
        mode={mode}
        items={filtered}
        errorMessage="读取知识库失败，请检查 loop/knowledge_base.json 是否可写。"
        onRetry={() => { setMode("loading"); setTimeout(() => setMode("data"), 1200) }}
        onStartCollect={() => { /* navigate collect */ }}
      />
    </div>
  )
}
