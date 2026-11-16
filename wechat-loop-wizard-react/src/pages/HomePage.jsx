import * as React from "react"
import { ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { NavBar } from "@/components/layout/NavBar"
import { CollectPanel } from "@/components/collect/CollectPanel"
import { ArticleList } from "@/components/article/ArticleList"
import { FailureCounter } from "@/components/governance/FailureCounter"
import { DowngradePath } from "@/components/governance/DowngradePath"
import { EvidencePanel } from "@/components/governance/EvidencePanel"
import { QualityGate } from "@/components/governance/QualityGate"
import { HandoffDialog } from "@/components/governance/HandoffDialog"
import { COLLECT_STATUS, mockArticles } from "@/mock/data"

/**
 * 首页 / 工作台
 * 演示：采集 → 入库 → 五种交付保护机制 → 防作弊自检
 */
export function HomePage() {
  // 采集面板状态
  const [account, setAccount] = React.useState("")
  const [collectStatus, setCollectStatus] = React.useState(COLLECT_STATUS.IDLE)
  const [progress, setProgress] = React.useState(0)
  const [current, setCurrent] = React.useState("")

  // 文章列表状态（四种模式可切换）
  const [listMode, setListMode] = React.useState("data")
  const [listItems] = React.useState(mockArticles)
  const errorMsg = "200013：公众号后台接口暂时限流，请稍后再试或切换到链接导入。"

  // 演示：当前通道级别（可切换）
  const [currentGrade, setCurrentGrade] = React.useState("L1")

  // 演示任务状态 —— 切换按钮改变 FailureCounter / EvidencePanel / HandoffDialog 触发原因
  const [taskDemo, setTaskDemo] = React.useState({
    kind: "done", // 'done' | 'partial' | 'running' | 'blocked' | 'verifying'
    attempts: 0,
    exitCode: 0,
    valid: 50,
    total: 50,
    errorHint: "",
  })

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

  const taskScenarios = [
    {
      key: "done",
      label: "完成",
      task: { kind: "done", attempts: 0, exitCode: 0, valid: 50, total: 50, errorHint: "" },
    },
    {
      key: "partial",
      label: "部分完成",
      task: { kind: "partial", attempts: 1, exitCode: 1, valid: 38, total: 50, errorHint: "部分文章链接已失效，正文无法获取。" },
    },
    {
      key: "running",
      label: "采集中失败 2 次",
      task: { kind: "running", attempts: 2, exitCode: null, valid: 13, total: 50, errorHint: "200013：频控冷却 60s" },
    },
    {
      key: "blocked",
      label: "已停机（5 次）",
      task: { kind: "blocked", attempts: 5, exitCode: null, valid: 11, total: 50, errorHint: "同一频控问题已连续失败 5 次，自动修复已停机" },
    },
    {
      key: "verifying",
      label: "需人工验证",
      task: { kind: "verifying", attempts: 1, exitCode: null, valid: 5, total: 50, errorHint: "遇到滑块验证，系统无法自动绕过" },
    },
  ]

  const handoffReason =
    taskDemo.kind === "blocked"
      ? "连续失败 5 次，触发停机保护"
      : taskDemo.kind === "verifying"
      ? "遇到滑块验证，需手动扫码或完成人机校验"
      : "当前任务状态正常，人工接管为预防性入口"

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 md:px-6">
        {/* 顶部演示切换条 */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/60 p-2 text-xs text-muted-foreground">
          <span className="mr-2 font-medium text-foreground">快速切换：</span>
          <span className="mr-1 opacity-60">文章列表 →</span>
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
          <span className="mx-1 opacity-60">|</span>
          <span className="mr-1 opacity-60">任务状态 →</span>
          {taskScenarios.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setTaskDemo(s.task)}
              className={
                "rounded-sm px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (taskDemo.kind === s.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground")
              }
            >
              {s.label}
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

        {/* 通道分级与降级路径 */}
        <section className="flex flex-col gap-3">
          <header className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-2xl font-semibold tracking-tight">
              通道分级与降级
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>当前通道：</span>
              <Badge
                variant="secondary"
                className="rounded-sm font-mono text-[11px]"
              >
                {currentGrade}
              </Badge>
              <div className="flex gap-1">
                {["L1", "L2", "L3"].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setCurrentGrade(g)}
                    className={
                      "rounded-sm border px-2 py-0.5 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (currentGrade === g
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground")
                    }
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </header>
          <DowngradePath
            current={currentGrade}
            onDowngrade={() => setCurrentGrade("L2")}
          />
        </section>

        {/* 任务与证据区 —— 演示五项机制中的失败循环 / 证据完成 / L4 人工接管 */}
        <section className="flex flex-col gap-4">
          <header className="flex items-baseline justify-between gap-4">
            <h2 className="font-serif text-2xl font-semibold tracking-tight">
              任务证据与人工接管
            </h2>
            <span className="text-xs text-muted-foreground">
              原型演示 · 切换上方「任务状态」按钮观察不同反馈
            </span>
          </header>

          <Card className="bg-card shadow-card transition-all duration-200 hover:shadow-card-hover">
            <CardHeader className="gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                    任务：游戏汇总 · 最近 50 篇
                  </CardTitle>
                  <CardDescription className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
                    task_demo · 启动于 2026-11-15 18:40
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {/* L4 人工接管按钮 —— 始终可点，verifying / blocked 时高亮 */}
                  {(taskDemo.kind === "verifying" || taskDemo.kind === "blocked") ? (
                    <HandoffDialog
                      reason={handoffReason}
                      trigger={
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="gap-2 active:scale-95"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          需人工接管
                        </Button>
                      }
                    />
                  ) : (
                    <HandoffDialog
                      reason={handoffReason}
                      trigger={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2 active:scale-95"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          查看人工接管流程
                        </Button>
                      }
                    />
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {/* 失败循环计数 —— 机制 ① */}
              {(taskDemo.kind === "running" ||
                taskDemo.kind === "blocked" ||
                taskDemo.kind === "partial") && (
                <FailureCounter
                  attempts={taskDemo.attempts}
                  currentError={taskDemo.errorHint}
                />
              )}

              {/* 证据面板 —— 机制 ④ */}
              {(taskDemo.kind === "done" ||
                taskDemo.kind === "partial") && (
                <EvidencePanel
                  status={taskDemo.kind}
                  command={
                    "python3 wechat-mp-tools/app_mp.py collect \\\n  --account 游戏汇总 --count 50 --resume"
                  }
                  exitCode={taskDemo.exitCode}
                  validArticles={taskDemo.valid}
                  totalAttempted={taskDemo.total}
                  kbPath="loop/knowledge_base.json"
                  errorHint={taskDemo.errorHint}
                />
              )}

              {/* 采集中 / 停机 —— 状态提示 */}
              {taskDemo.kind === "running" && (
                <div className="rounded-md border border-border bg-surface/60 px-4 py-3 text-sm text-muted-foreground">
                  采集中……已完成 {taskDemo.valid}/{taskDemo.total} 篇。失败 {taskDemo.attempts} 次，尚未触发停机。
                </div>
              )}

              {taskDemo.kind === "blocked" && (
                <div className="rounded-md border border-[#A94438]/40 bg-[#A94438]/[0.06] px-4 py-3 text-sm leading-6 text-[#7d2f26]">
                  <strong>已停机：</strong>{taskDemo.errorHint}
                  <div className="mt-2 text-[11px]">
                    下一步：点击上方「改用 L2 链接导入」，或在人工接管弹窗中确认后手动降级通道。
                  </div>
                </div>
              )}

              {taskDemo.kind === "verifying" && (
                <div className="rounded-md border border-[#B8862F]/40 bg-[#B8862F]/[0.06] px-4 py-3 text-sm leading-6 text-[#8a6520]">
                  <strong>需要人机验证：</strong>{taskDemo.errorHint}
                  <div className="mt-2 text-[11px]">
                    下一步：点击「需人工接管」，按弹窗中的步骤手动完成滑块/扫码。
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* 已采集文章 */}
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

        {/* 防作弊自检 —— 机制 ⑤ */}
        <section>
          <QualityGate />
        </section>

        {/* 五项规则说明 */}
        <section className="rounded-md border border-border bg-surface/40 p-6 text-sm leading-7 text-muted-foreground">
          <h3 className="mb-3 font-serif text-lg font-semibold tracking-tight text-foreground">
            五项交付保护机制
          </h3>
          <ol className="grid gap-2 text-[12px] sm:grid-cols-2 lg:grid-cols-1">
            <li><strong className="text-foreground">① 失败循环上限</strong>：连续失败 3 次必须换假设；≥5 次自动停机，禁止原路径重试。</li>
            <li><strong className="text-foreground">② 通道降级矩阵</strong>：L1 微信读书 → L2 链接/RSS → L3 只读 → L4 人工，逐层降级不原地重试。</li>
            <li><strong className="text-foreground">③ L4 停机清单</strong>：扫码、验证码、真实发布、填写凭证、连续失败 ≥5 次——AI 只给步骤，不代做。</li>
            <li><strong className="text-foreground">④ 证据完成</strong>：说「已完成」必须附命令、exit 码和正文文件计数；空结果不算数。</li>
            <li><strong className="text-foreground">⑤ 防作弊</strong>：禁止 skip/xfail/only、`|| true` 掩码、硬编码 exit 0——自检扫出来就是 FAIL。</li>
          </ol>
        </section>
      </main>
    </div>
  )
}
