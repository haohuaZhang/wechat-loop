import * as React from "react"
import { Rss, RefreshCw, Loader2, AlertTriangle, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/EmptyState"
import { api } from "@/api/client"

/**
 * RSS 订阅 Tab —— 展示定时抓取订阅，支持立即上传待传文章
 */
export function RssSubscriptionTab() {
  const [state, setState] = React.useState({ loading: true, error: "", subscriptions: [] })
  const [busyFakeid, setBusyFakeid] = React.useState("")
  const [feedback, setFeedback] = React.useState({ type: "", message: "" })

  const load = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }))
    try {
      const res = await api.listRssSubscriptions()
      setState({ loading: false, error: "", subscriptions: res.subscriptions })
    } catch (err) {
      setState({ loading: false, error: err?.message || "读取 RSS 订阅失败", subscriptions: [] })
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const handleForceUpload = async (sub) => {
    setBusyFakeid(sub.fakeid)
    setFeedback({ type: "", message: "" })
    try {
      const res = await api.forceRssUpload(sub.fakeid)
      if (!res.success) {
        setFeedback({ type: "error", message: res.error || "立即上传失败" })
      } else {
        const parts = [res.count > 0 ? `已上传 ${res.count} 篇` : "没有待上传的文章"]
        if (res.failed > 0) parts.push(`失败 ${res.failed} 篇`)
        if (res.quarantined > 0) parts.push(`隔离 ${res.quarantined} 篇`)
        setFeedback({ type: "success", message: parts.join("，") })
      }
      await load()
    } catch (err) {
      setFeedback({ type: "error", message: err?.message || "立即上传失败" })
    } finally {
      setBusyFakeid("")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-xl font-semibold tracking-tight">RSS 订阅</h2>
        <p className="mt-1 text-sm leading-7 text-muted-foreground">
          按公众号定时抓取最新文章，并把下载成功但未上传的文章推送到远端网关。
        </p>
      </div>

      {feedback.message && (
        <div
          className={
            feedback.type === "error"
              ? "rounded-md border border-[#A94438]/40 bg-[#A94438]/[0.06] px-4 py-2.5 text-sm leading-6 text-[#7d2f26]"
              : "rounded-md border border-[#4F7A5A]/30 bg-[#4F7A5A]/[0.06] px-4 py-2.5 text-sm leading-6 text-[#385742]"
          }
        >
          {feedback.message}
        </div>
      )}

      {state.loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-4">
              <Skeleton className="h-9 w-9 rounded-sm" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-7 w-20 rounded-sm" />
            </div>
          ))}
        </div>
      ) : state.error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle className="font-serif text-base font-semibold tracking-tight">读取订阅失败</AlertTitle>
          <AlertDescription className="mt-1 flex flex-col gap-3 text-sm leading-7">
            <span>{state.error}</span>
            <Button variant="outline" size="sm" onClick={load} className="self-start gap-1 active:scale-95">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : state.subscriptions.length === 0 ? (
        <EmptyState
          icon={Rss}
          title="还没有 RSS 订阅"
          description="订阅入口在「公众号采集」成功后出现：采集成功后即可为该公众号启用定时抓取（每行按设定间隔执行）。当前没有订阅记录，也不会伪造数据。"
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          {state.subscriptions.map((sub) => {
            const uploading = busyFakeid === sub.fakeid
            return (
              <li key={sub.fakeid || sub.nickname} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-secondary font-serif text-sm font-semibold text-muted-foreground">
                    {sub.nickname.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{sub.nickname}</span>
                      <Badge variant={sub.enabled ? "secondary" : "outline"} className="rounded-sm text-[11px]">
                        {sub.enabled ? "抓取中" : "已停用"}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>间隔 {sub.intervalMinutes} 分钟</span>
                      <span>待上传 {sub.pendingUploadCount} 篇</span>
                      {sub.quarantinedCount > 0 && (
                        <span className="text-[#8a6520]">已隔离 {sub.quarantinedCount} 篇</span>
                      )}
                      <span>累计 {sub.totalArticles} 篇</span>
                    </div>
                    {sub.lastError && (
                      <p className="mt-1 truncate text-[11px] text-[#A94438]" title={sub.lastError}>
                        最近抓取错误：{sub.lastError}
                      </p>
                    )}
                    {sub.lastUploadError && (
                      <p className="mt-1 truncate text-[11px] text-[#A94438]" title={sub.lastUploadError}>
                        最近上传错误：{sub.lastUploadError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 sm:ml-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleForceUpload(sub)}
                    disabled={!sub.fakeid || Boolean(busyFakeid)}
                    className="gap-1.5 active:scale-95"
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    立即上传
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
