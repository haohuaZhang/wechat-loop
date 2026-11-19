import * as React from "react"
import PropTypes from "prop-types"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * CollectJobsPanel —— 稳定采集（批量 / 断点续采 / 失败重试 / 去重）
 *
 * 上游一次只能跑一个公众号，且任务只存在内存里。这里包了一层可落盘的作业：
 *   - 多号串行采集，不并发轰炸风控
 *   - 单号失败自动重试
 *   - 中断后只补没采完的公众号
 *   - 已下载文章走上游 skip_existing，自动跳过
 */

const JOB_STATUS = {
  pending: { label: "排队中", cls: "bg-[#C87137]/10 text-[#C87137] border-[#C87137]/40" },
  running: { label: "采集中", cls: "bg-[#C87137]/10 text-[#C87137] border-[#C87137]/40" },
  cancelling: { label: "停止中", cls: "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/40" },
  cancelled: { label: "已取消", cls: "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/40" },
  partial: { label: "部分完成", cls: "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/40" },
  failed: { label: "失败", cls: "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/40" },
  completed: { label: "已完成", cls: "bg-[#4F7A5A]/10 text-[#385742] border-[#4F7A5A]/40" },
}

const ACC_STATUS = {
  pending: { label: "等待", cls: "text-muted-foreground" },
  running: { label: "采集中", cls: "text-[#C87137]" },
  completed: { label: "完成", cls: "text-[#4F7A5A]" },
  failed: { label: "失败", cls: "text-[#A94438]" },
  cancelled: { label: "已取消", cls: "text-[#B8862F]" },
}

const ACTIVE_STATUS = new Set(["pending", "running", "cancelling"])

function fmtTime(ts) {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function jobProgress(job) {
  const accs = job?.accounts || []
  const done = accs.reduce((s, a) => s + (Number(a.completed) || 0), 0)
  const fail = accs.reduce((s, a) => s + (Number(a.failed) || 0), 0)
  const total = accs.reduce((s, a) => s + (Number(a.total) || 0), 0)
  return { done, fail, total }
}

function AccountRow({ acc }) {
  const st = ACC_STATUS[acc.status] || ACC_STATUS.pending
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <span className={cn("w-14 shrink-0", st.cls)}>{st.label}</span>
      <span className="min-w-0 flex-1 truncate text-foreground/80">{acc.name || acc.fakeid}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        已处理 {acc.completed || 0} / 共 {acc.total || 0}
        {acc.failed ? ` · 失败 ${acc.failed}` : ""}
        {acc.attempts > 1 ? ` · 第 ${acc.attempts} 次` : ""}
      </span>
      {acc.stop_reason && (
        <span className="max-w-[180px] shrink-0 truncate text-[#A94438]" title={acc.stop_reason}>
          {acc.stop_reason}
        </span>
      )}
    </div>
  )
}

AccountRow.propTypes = {
  acc: PropTypes.object.isRequired,
}

function JobItem({ job, onCancel, onResume, busy }) {
  const [open, setOpen] = React.useState(false)
  const meta = JOB_STATUS[job.status] || JOB_STATUS.pending
  const { done, fail, total } = jobProgress(job)
  const active = ACTIVE_STATUS.has(job.status)
  const accs = job.accounts || []
  const unfinished = accs.filter((a) => a.status !== "completed").length

  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("border text-[10px]", meta.cls)}>{meta.label}</Badge>
        <span className="text-xs font-medium">
          {job.completed_accounts || 0}/{job.total_accounts || accs.length} 个号完成
          {job.failed_accounts ? ` · ${job.failed_accounts} 个失败` : ""}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          文章 已处理 {done} / 共 {total}
          {fail ? ` · 失败 ${fail}` : ""}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">{fmtTime(job.created_at)}</span>
      </div>

      {(job.current || job.stop_reason) && (
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          {job.current || job.stop_reason}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          {open ? "收起明细" : `展开明细（${accs.length} 个号）`}
        </button>
        {active ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onCancel(job)}>
            停止
          </Button>
        ) : (
          unfinished > 0 && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onResume(job)}>
              继续未完成（{unfinished}）
            </Button>
          )
        )}
      </div>

      {open && (
        <div className="mt-2 divide-y divide-border/60 border-t border-border/60 pt-1">
          {accs.map((acc) => (
            <AccountRow key={acc.fakeid} acc={acc} />
          ))}
        </div>
      )}
    </div>
  )
}

JobItem.propTypes = {
  job: PropTypes.object.isRequired,
  onCancel: PropTypes.func.isRequired,
  onResume: PropTypes.func.isRequired,
  busy: PropTypes.bool,
}

export function CollectJobsPanel({ accounts = [], activeFakeid = "", activeName = "", onFinished }) {
  const [jobs, setJobs] = React.useState([])
  const [scope, setScope] = React.useState("all")
  const [limit, setLimit] = React.useState(50)
  const [retries, setRetries] = React.useState(2)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const finishedRef = React.useRef("")

  const hasActive = jobs.some((j) => ACTIVE_STATUS.has(j.status))

  const loadJobs = React.useCallback(async () => {
    try {
      const res = await api.collectJobs()
      setJobs(res?.jobs || [])
      setError("")
    } catch (err) {
      setError(err?.message || "读取采集作业失败")
    }
  }, [])

  React.useEffect(() => {
    loadJobs()
  }, [loadJobs])

  // 有作业在跑就 2 秒轮询一次，全停后停止
  React.useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(loadJobs, 2000)
    return () => clearInterval(timer)
  }, [hasActive, loadJobs])

  // 作业从运行变为结束的瞬间，通知外层刷新文章列表
  React.useEffect(() => {
    const latest = jobs[0]
    if (!latest) return
    const done = !ACTIVE_STATUS.has(latest.status)
    if (done && finishedRef.current !== latest.id) {
      finishedRef.current = latest.id
      if (onFinished) onFinished()
    }
  }, [jobs, onFinished])

  async function handleStart() {
    setError("")
    let targets = []
    if (scope === "current") {
      if (!activeFakeid) {
        setError("请先在上方选择一个公众号")
        return
      }
      targets = [{ fakeid: activeFakeid, name: activeName || activeFakeid }]
    } else {
      targets = accounts.map((a) => ({ fakeid: a.fakeid, name: a.nickname })).filter((a) => a.fakeid)
    }
    if (!targets.length) {
      setError("没有可采集的公众号，请先在「公众号管理」关注")
      return
    }
    setBusy(true)
    try {
      await api.createCollectJob({ accounts: targets, limit, retries })
      finishedRef.current = ""
      await loadJobs()
    } catch (err) {
      setError(err?.message || "创建采集作业失败")
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel(job) {
    setBusy(true)
    try {
      await api.cancelCollectJob(job.id)
      await loadJobs()
    } catch (err) {
      setError(err?.message || "取消失败")
    } finally {
      setBusy(false)
    }
  }

  async function handleResume(job) {
    setBusy(true)
    try {
      await api.resumeCollectJob(job.id)
      finishedRef.current = ""
      await loadJobs()
    } catch (err) {
      setError(err?.message || "续采失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-base">稳定采集</CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            批量 · 断点续采 · 失败自动重试 · 已下载自动跳过
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            aria-label="每号采集篇数"
          >
            {[20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>每号 {n} 篇</option>
            ))}
          </select>
          <select
            value={retries}
            onChange={(e) => setRetries(Number(e.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            aria-label="失败重试次数"
          >
            {[0, 1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>重试 {n} 次</option>
            ))}
          </select>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            aria-label="采集范围"
          >
            <option value="all">全部关注（{accounts.length}）</option>
            <option value="current">仅当前公众号</option>
          </select>
          <Button type="button" size="sm" disabled={busy || hasActive} onClick={handleStart}>
            {hasActive ? "采集中…" : "发起采集"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {error && <p className="mb-2 text-[11px] text-[#A94438]">{error}</p>}
        {jobs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            还没有采集作业。选好范围后点「发起采集」，中途断了可以点「继续未完成」接着采。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {jobs.map((job) => (
              <JobItem
                key={job.id}
                job={job}
                busy={busy}
                onCancel={handleCancel}
                onResume={handleResume}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

CollectJobsPanel.propTypes = {
  accounts: PropTypes.array,
  activeFakeid: PropTypes.string,
  activeName: PropTypes.string,
  onFinished: PropTypes.func,
}
