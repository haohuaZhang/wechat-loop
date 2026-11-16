import * as React from "react"
import { Button } from "@/components/ui/button"
import { CollectPanel } from "@/components/collect/CollectPanel"
import { DowngradePath } from "@/components/governance/DowngradePath"
import { api } from "@/api/client"

const COLLECT_STATUS = {
  IDLE: "idle",
  COLLECTING: "collecting",
  COMPLETED: "completed",
  ERROR: "error",
}

/**
 * 采集向导页 —— 真实 API：POST /api/accounts/search → POST /api/articles/collect-latest → 轮询 /api/articles/download-status/<task_id>
 */
export function CollectPage() {
  const [account, setAccount] = React.useState("")
  const [collectStatus, setCollectStatus] = React.useState(COLLECT_STATUS.IDLE)
  const [progress, setProgress] = React.useState(0)
  const [current, setCurrent] = React.useState("")
  const [currentGrade, setCurrentGrade] = React.useState("L1")
  const [errorMsg, setErrorMsg] = React.useState("")
  const [taskId, setTaskId] = React.useState(null)

  // 轮询真实进度 —— 每 2s 查一次 /api/articles/download-status/<task_id>
  React.useEffect(() => {
    if (collectStatus !== COLLECT_STATUS.COLLECTING || !taskId) return
    setErrorMsg("")

    const poll = async () => {
      try {
        const status = await api.pollTaskStatus(taskId)
        if (!status) return  // 任务还没创建好，继续轮询
        setProgress(status.progress || 0)
        setCurrent(
          `${status.title || account} · 成功 ${status.successCount || 0}/${status.total || 50}` +
          (status.failedCount ? ` · 失败 ${status.failedCount}` : "")
        )
        if (status.status === "done") {
          setCollectStatus(COLLECT_STATUS.COMPLETED)
          setCurrent(`已完成：成功 ${status.successCount || 0} 篇，失败 ${status.failedCount || 0} 篇`)
        } else if (status.status === "error" || status.status === "cancelled") {
          setCollectStatus(COLLECT_STATUS.ERROR)
          setErrorMsg(status.errorHint || "采集失败")
        }
      } catch (err) {
        console.warn("[CollectPage] 轮询失败:", err.message)
      }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => clearInterval(timer)
  }, [collectStatus, taskId, account])

  const handleStart = async () => {
    if (!account.trim()) return
    setCollectStatus(COLLECT_STATUS.COLLECTING)
    setProgress(0)
    setErrorMsg("")
    setCurrent(`正在搜索「${account}」的公众号…`)
    try {
      const res = await api.startCollect({ account, count: 50 })
      setTaskId(res.taskId)
      setCurrent(`已启动任务 ${res.taskId}，等待采集进度…`)
    } catch (err) {
      setErrorMsg(err?.message || "采集启动失败")
      setCollectStatus(COLLECT_STATUS.ERROR)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 01</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">采集向导</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          输入公众号名称，前端自动搜索 fakeid 并调用 collect-latest 启动任务，然后轮询 download-status 显示真实进度。
        </p>
      </header>

      <CollectPanel
        accountValue={account}
        onAccountChange={setAccount}
        onStart={handleStart}
        loading={collectStatus === COLLECT_STATUS.COLLECTING}
        status={collectStatus}
        progress={progress}
        current={current}
        errorMessage={errorMsg}
      />

      <DowngradePath current={currentGrade} onDowngrade={() => setCurrentGrade("L2")} />

      <section className="rounded-md border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold tracking-tight">兜底导入</h2>
        <p className="mt-1 text-sm leading-7 text-muted-foreground">
          当 L1 自动通道不可用时，直接粘贴公开文章链接、RSS 地址或 OPML 文件内容。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: "批量文章链接", desc: "一行一个 mp.weixin.qq.com 链接" },
            { label: "RSS / Atom 订阅", desc: "一行一个 feed 地址" },
            { label: "OPML 文件内容", desc: "粘贴 .opml 的 XML 全文" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex flex-col gap-1 rounded-sm border border-border bg-surface/40 p-4 transition-colors hover:border-primary/40"
            >
              <strong className="text-sm font-semibold">{item.label}</strong>
              <span className="text-[11px] leading-5 text-muted-foreground">{item.desc}</span>
              <Button variant="ghost" size="sm" className="mt-2 self-start h-auto p-0 text-xs font-normal text-primary hover:text-primary/80">
                点击输入 →
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
