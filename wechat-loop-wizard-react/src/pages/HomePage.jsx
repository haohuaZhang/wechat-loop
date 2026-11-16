import * as React from "react"
import { NavBar } from "@/components/layout/NavBar"
import { CollectPanel } from "@/components/collect/CollectPanel"
import { ArticleList } from "@/components/article/ArticleList"
import { COLLECT_STATUS, mockArticles } from "@/mock/data"

/**
 * 首页 / 工作台
 * 演示四种状态：loading → empty → data → error，通过按钮切换体验
 */
export function HomePage() {
  // 采集面板状态
  const [account, setAccount] = React.useState("")
  const [collectStatus, setCollectStatus] = React.useState(COLLECT_STATUS.IDLE)
  const [progress, setProgress] = React.useState(0)
  const [current, setCurrent] = React.useState("")

  // 文章列表状态（四种模式可切换）
  const [listMode, setListMode] = React.useState("data")
  const [listItems, setListItems] = React.useState(mockArticles)
  const [errorMsg] = React.useState("200013：公众号后台接口暂时限流，请稍后再试或切换到链接导入。")

  // 演示：采集进度
  React.useEffect(() => {
    if (collectStatus !== COLLECT_STATUS.COLLECTING) return
    setProgress(0)
    const timer = setInterval(() => {
      setProgress((p) => {
        const next = p + 6
        if (next >= 100) {
          clearInterval(timer)
          setCollectStatus(COLLECT_STATUS.COMPLETED)
          setCurrent(`已完成，共入库 ${listItems.length + 3} 篇`)
          setListMode("data")
          return 100
        }
        setCurrent(`${account || "当前公众号"} · 第 ${Math.round((next / 100) * 50)}/50 篇`)
        return next
      })
    }, 220)
    return () => clearInterval(timer)
  }, [collectStatus, account, listItems.length])

  const handleStart = () => {
    if (!account.trim()) return
    setCollectStatus(COLLECT_STATUS.COLLECTING)
    setCurrent(`正在发现 ${account} 的文章列表…`)
  }

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 md:px-6">
        {/* 顶部演示切换条 —— 方便你快速看到四种状态 */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/60 p-2 text-xs text-muted-foreground">
          <span className="mr-2 font-medium text-foreground">快速切换文章列表状态：</span>
          {[
            { key: "loading", label: "加载中" },
            { key: "empty", label: "空状态" },
            { key: "data", label: "有数据" },
            { key: "error", label: "出错" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setListMode(item.key)}
              className={
                "rounded-sm px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (listMode === item.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground")
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        <CollectPanel
          accountValue={account}
          onAccountChange={setAccount}
          onStart={handleStart}
          loading={collectStatus === COLLECT_STATUS.COLLECTING}
          status={collectStatus}
          progress={progress}
          current={current}
        />

        <section className="flex flex-col gap-4">
          <header className="flex items-baseline justify-between gap-4">
            <h2 className="font-serif text-2xl font-semibold tracking-tight">
              已采集文章
            </h2>
            {listMode === "data" && (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                共 {listItems.length} 篇
              </span>
            )}
          </header>
          <ArticleList
            mode={listMode}
            items={listItems}
            errorMessage={errorMsg}
            onRetry={() => {
              setListMode("loading")
              setTimeout(() => setListMode("data"), 1200)
            }}
            onStartCollect={() => {
              setAccount("游戏汇总")
              handleStart()
            }}
          />
        </section>
      </main>
    </div>
  )
}
