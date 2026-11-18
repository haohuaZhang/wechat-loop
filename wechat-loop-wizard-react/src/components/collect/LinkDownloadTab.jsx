import * as React from "react"
import PropTypes from "prop-types"
import { Link2, Loader2, PlayCircle, AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { EmptyState } from "@/components/common/EmptyState"
import { CollectProgress } from "@/components/collect/CollectProgress"
import { api } from "@/api/client"

/**
 * 链接下载 Tab —— 粘贴多篇文章链接，批量下载并轮询进度
 */
export function LinkDownloadTab() {
  const [text, setText] = React.useState("")
  const [status, setStatus] = React.useState("idle") // idle | running | done | error
  const [taskId, setTaskId] = React.useState(null)
  const [progress, setProgress] = React.useState(0)
  const [current, setCurrent] = React.useState("")
  const [successCount, setSuccessCount] = React.useState(0)
  const [failedCount, setFailedCount] = React.useState(0)
  const [total, setTotal] = React.useState(0)
  const [errorMsg, setErrorMsg] = React.useState("")

  const urls = React.useMemo(
    () => text.split("\n").map((line) => line.trim()).filter(Boolean),
    [text]
  )

  // 轮询下载进度（每 2s 一次）
  React.useEffect(() => {
    if (status !== "running" || !taskId) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await api.pollTaskStatus(taskId)
        if (cancelled) return
        if (!res) {
          setStatus("error")
          setErrorMsg("下载任务不存在或已过期，请重新提交链接")
          return
        }
        setProgress(res.progress || 0)
        setSuccessCount(res.successCount || 0)
        setFailedCount(res.failedCount || 0)
        if (res.total) setTotal(res.total)

        if (res.status === "done") {
          setProgress(100)
          setStatus("done")
          setCurrent(`已完成：成功 ${res.successCount || 0} 篇，失败 ${res.failedCount || 0} 篇`)
        } else if (res.status === "error" || res.status === "cancelled") {
          setStatus("error")
          setErrorMsg(
            res.errorHint || (res.status === "cancelled" ? "任务已被取消" : "下载失败")
          )
        } else {
          setCurrent(
            `正在下载 · 成功 ${res.successCount || 0} 篇，失败 ${res.failedCount || 0} 篇` +
            (res.current ? ` · ${res.current}` : "")
          )
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error")
          setErrorMsg(err?.message || "查询下载进度失败")
        }
      }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status, taskId])

  const handleStart = async () => {
    if (!urls.length) {
      setStatus("error")
      setErrorMsg("请至少粘贴一个 mp.weixin.qq.com 文章链接")
      return
    }
    setStatus("running")
    setTaskId(null)
    setProgress(0)
    setSuccessCount(0)
    setFailedCount(0)
    setTotal(urls.length)
    setErrorMsg("")
    setCurrent(`正在提交 ${urls.length} 个链接…`)
    try {
      const res = await api.downloadByUrls(urls)
      if (!res.taskId) throw new Error("服务未返回任务 ID")
      setTaskId(res.taskId)
      setCurrent(res.message || `已启动任务 ${res.taskId}`)
    } catch (err) {
      setStatus("error")
      setErrorMsg(err?.message || "启动链接下载失败")
    }
  }

  const handleReset = () => {
    setText("")
    setStatus("idle")
    setTaskId(null)
    setProgress(0)
    setSuccessCount(0)
    setFailedCount(0)
    setTotal(0)
    setErrorMsg("")
    setCurrent("")
  }

  const running = status === "running"

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold tracking-tight">链接下载</h2>
        <p className="mt-1 text-sm leading-7 text-muted-foreground">
          每行一个 mp.weixin.qq.com 文章链接，可一次粘贴多篇。系统会逐篇下载并写入下载历史。
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"https://mp.weixin.qq.com/s/xxxxxxxx\nhttps://mp.weixin.qq.com/s/yyyyyyyy"}
            rows={7}
            disabled={running}
            spellCheck={false}
            aria-label="文章链接列表"
            className="w-full resize-y rounded-md border border-input bg-surface/40 px-3 py-2.5 font-mono text-xs leading-6 text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              已识别 {urls.length} 个链接
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={running}
                className="active:scale-95"
              >
                清空
              </Button>
              <Button
                size="sm"
                onClick={handleStart}
                disabled={running || !text.trim()}
                className="gap-2 active:scale-95"
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {running ? "下载中…" : "开始下载"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-xl font-semibold tracking-tight">下载进度</h2>

        {status === "idle" && (
          <EmptyState
            icon={Link2}
            title="等待粘贴链接"
            description="粘贴文章链接后点击「开始下载」，这里会显示进度、成功数与失败数。"
            className="py-10"
          />
        )}

        {(status === "running" || status === "done") && (
          <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-card">
            <CollectProgress value={progress} running={running} current={current} label="下载进度" />
            <div className="grid grid-cols-3 gap-3">
              <CountBlock label="总数" value={total} />
              <CountBlock label="成功" value={successCount} tone="success" />
              <CountBlock label="失败" value={failedCount} tone={failedCount > 0 ? "danger" : undefined} />
            </div>
            {status === "done" && (
              <div className="rounded-md border border-[#4F7A5A]/30 bg-[#4F7A5A]/[0.06] px-4 py-2.5 text-sm leading-6 text-[#385742]">
                下载任务已完成：成功 {successCount} 篇，失败 {failedCount} 篇。
              </div>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col gap-3">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle className="font-serif text-base font-semibold tracking-tight">下载失败</AlertTitle>
              <AlertDescription className="mt-1 flex flex-col gap-3 text-sm leading-7">
                <span>{errorMsg || "链接下载未能完成。"}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (urls.length ? handleStart() : handleReset())}
                  className="self-start gap-1 active:scale-95"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  重试
                </Button>
              </AlertDescription>
            </Alert>
            {(successCount > 0 || failedCount > 0) && (
              <div className="grid grid-cols-3 gap-3">
                <CountBlock label="总数" value={total} />
                <CountBlock label="成功" value={successCount} tone="success" />
                <CountBlock label="失败" value={failedCount} tone="danger" />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * 结果计数块
 * @param {object} props
 * @param {string} props.label
 * @param {number} props.value
 * @param {'success'|'danger'} [props.tone]
 */
function CountBlock({ label, value, tone }) {
  const valueClass =
    tone === "success" ? "text-[#385742]" : tone === "danger" ? "text-[#7d2f26]" : "text-foreground"
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2.5">
      <div className={`font-serif text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

CountBlock.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  tone: PropTypes.oneOf(["success", "danger"]),
}
