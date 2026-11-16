import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FailureCounter } from "@/components/governance/FailureCounter"
import { EvidencePanel } from "@/components/governance/EvidencePanel"
import { HandoffDialog } from "@/components/governance/HandoffDialog"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/api/client"
import { ShieldAlert, Clock, CheckCircle2, AlertTriangle, XCircle } from "lucide-react"

const TASK_SCENARIOS = [
  { key: "done", label: "完成", attempts: 0, exitCode: 0, valid: 50, total: 50, errorHint: "" },
  { key: "partial", label: "部分完成", attempts: 1, exitCode: 1, valid: 38, total: 50, errorHint: "部分文章链接已失效。" },
  { key: "running", label: "采集中失败 2 次", attempts: 2, exitCode: null, valid: 13, total: 50, errorHint: "200013：频控冷却 60s" },
  { key: "blocked", label: "已停机（5 次）", attempts: 5, exitCode: null, valid: 11, total: 50, errorHint: "同一频控问题已连续失败 5 次，自动修复已停机" },
  { key: "verifying", label: "需人工验证", attempts: 1, exitCode: null, valid: 5, total: 50, errorHint: "遇到滑块验证，系统无法自动绕过" },
]

const STATUS_VARIANT = {
  done: { icon: CheckCircle2, label: "已完成", cls: "bg-[#4F7A5A]/10 text-[#385742] border-[#4F7A5A]/30" },
  running: { icon: Clock, label: "采集中", cls: "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/30" },
  error: { icon: XCircle, label: "出错", cls: "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/30" },
  blocked: { icon: ShieldAlert, label: "已停机", cls: "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/40" },
  verifying: { icon: AlertTriangle, label: "需人工验证", cls: "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/40" },
}

export function TasksPage() {
  const [task, setTask] = React.useState(TASK_SCENARIOS[0])
  const [history, setHistory] = React.useState([])
  const [loadingHistory, setLoadingHistory] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    api.listTasks()
      .then((list) => { if (!cancelled) setHistory(list) })
      .finally(() => { if (!cancelled) setLoadingHistory(false) })
    return () => { cancelled = true }
  }, [])

  const handoffReason =
    task.key === "blocked"
      ? "连续失败 5 次，触发停机保护"
      : task.key === "verifying"
      ? "遇到滑块验证，需手动扫码或完成人机校验"
      : "当前任务状态正常，人工接管为预防性入口"

  const statusKey = ["running", "blocked", "verifying"].includes(task.key)
    ? task.key
    : task.key === "partial"
    ? "error"
    : "done"
  const StatusIcon = STATUS_VARIANT[statusKey]?.icon || CheckCircle2

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 02</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">采集任务</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          查看进度、处理失败、验证证据。同一环节连续失败 ≥ 5 次时自动停机。
        </p>
      </header>

      {/* 场景切换 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface/60 p-2 text-xs text-muted-foreground">
        <span className="mr-2 font-medium text-foreground">演示任务状态：</span>
        {TASK_SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setTask(s)}
            className={
              "rounded-sm px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (task.key === s.key
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground")
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 当前任务卡 */}
      <Card className="bg-card shadow-card transition-all duration-200 hover:shadow-card-hover">
        <CardHeader className="gap-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                任务：游戏汇总 · 最近 50 篇
              </CardTitle>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
                task_demo · 启动于 2026-11-15 18:40
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[11px] font-medium ${STATUS_VARIANT[statusKey].cls}`}>
                <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {STATUS_VARIANT[statusKey].label}
              </span>
              {(task.key === "verifying" || task.key === "blocked") ? (
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
                    <Button type="button" variant="outline" size="sm" className="gap-2 active:scale-95">
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      人工接管流程
                    </Button>
                  }
                />
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {(task.key === "running" || task.key === "blocked" || task.key === "partial") && (
            <FailureCounter attempts={task.attempts} currentError={task.errorHint} />
          )}

          {(task.key === "done" || task.key === "partial") && (
            <EvidencePanel
              status={task.key}
              command={"python3 wechat-mp-tools/app_mp.py collect --account 游戏汇总 --count 50 --resume"}
              exitCode={task.exitCode}
              validArticles={task.valid}
              totalAttempted={task.total}
              kbPath="loop/knowledge_base.json"
              errorHint={task.errorHint}
            />
          )}

          {task.key === "running" && (
            <div className="rounded-md border border-border bg-surface/60 px-4 py-3 text-sm text-muted-foreground">
              采集中……已完成 {task.valid}/{task.total} 篇。失败 {task.attempts} 次，尚未触发停机。
            </div>
          )}
          {task.key === "blocked" && (
            <div className="rounded-md border border-[#A94438]/40 bg-[#A94438]/[0.06] px-4 py-3 text-sm leading-6 text-[#7d2f26]">
              <strong>已停机：</strong>{task.errorHint}
              <div className="mt-2 text-[11px]">下一步：降级通道，或在人工接管弹窗中确认后手动处理。</div>
            </div>
          )}
          {task.key === "verifying" && (
            <div className="rounded-md border border-[#B8862F]/40 bg-[#B8862F]/[0.06] px-4 py-3 text-sm leading-6 text-[#8a6520]">
              <strong>需要人机验证：</strong>{task.errorHint}
              <div className="mt-2 text-[11px]">下一步：点击「需人工接管」，按弹窗中的步骤手动完成滑块/扫码。</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 最近任务列表 —— 来自 API */}
      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-xl font-semibold tracking-tight">最近任务</h2>
        {loadingHistory ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
                <Skeleton className="h-6 w-6 rounded-sm" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-16 rounded-sm" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {history.map((t) => {
              const v = STATUS_VARIANT[t.status]
              const I = v.icon
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface/60">
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-sm border ${v.cls}`}>
                    <I className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="font-mono text-[11px] text-muted-foreground tabular-nums">{t.id} · {t.at}</div>
                  </div>
                  <Badge variant="outline" className={`rounded-sm text-[11px] ${v.cls}`}>{v.label}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
