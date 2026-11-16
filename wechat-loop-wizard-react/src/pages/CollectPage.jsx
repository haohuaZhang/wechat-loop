import * as React from "react"
import { Button } from "@/components/ui/button"
import { CollectPanel } from "@/components/collect/CollectPanel"
import { DowngradePath } from "@/components/governance/DowngradePath"
import { COLLECT_STATUS } from "@/mock/data"

/**
 * 采集向导页 —— 自动采集 / 兜底导入 / 通道降级
 */
export function CollectPage() {
  const [account, setAccount] = React.useState("")
  const [collectStatus, setCollectStatus] = React.useState(COLLECT_STATUS.IDLE)
  const [progress, setProgress] = React.useState(0)
  const [current, setCurrent] = React.useState("")
  const [currentGrade, setCurrentGrade] = React.useState("L1")

  React.useEffect(() => {
    if (collectStatus !== COLLECT_STATUS.COLLECTING) return
    setProgress(0)
    const timer = setInterval(() => {
      setProgress((p) => {
        const next = p + 6
        if (next >= 100) {
          clearInterval(timer)
          setCollectStatus(COLLECT_STATUS.COMPLETED)
          setCurrent("已完成，共入库 53 篇")
          return 100
        }
        setCurrent(`${account || "当前公众号"} · 第 ${Math.round((next / 100) * 50)}/50 篇`)
        return next
      })
    }, 220)
    return () => clearInterval(timer)
  }, [collectStatus, account])

  const handleStart = () => {
    if (!account.trim()) return
    setCollectStatus(COLLECT_STATUS.COLLECTING)
    setCurrent(`正在发现 ${account} 的文章列表…`)
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 01</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">采集向导</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          输入公众号名称或提供链接，系统自动拉取文章并入库。首次请少量试采。
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
      />

      <DowngradePath current={currentGrade} onDowngrade={() => setCurrentGrade("L2")} />

      {/* 兜底导入区 */}
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
