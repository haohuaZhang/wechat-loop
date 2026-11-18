import * as React from "react"
import PropTypes from "prop-types"
import { Users, RefreshCw, Loader2, QrCode, AlertTriangle, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/EmptyState"
import { StatusBadge } from "@/components/common/StatusBadge"
import { api } from "@/api/client"

const STATUS_MAP = {
  active: { badge: "completed", label: "可用" },
  cooldown: { badge: "collecting", label: "冷却中" },
  invalid: { badge: "error", label: "失效" },
}

function statusMeta(status) {
  return STATUS_MAP[status] || { badge: "idle", label: status || "未知" }
}

function formatTime(ts) {
  if (!ts) return "—"
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * 账号池页 —— 扫码登录 + 多账号轮换状态
 */
export function AccountPoolPage() {
  const [auth, setAuth] = React.useState({
    loading: true,
    error: "",
    loggedIn: false,
    tokenPreview: "",
    saveTime: 0,
    message: "",
    loginState: { status: "idle", message: "" },
  })
  const [qr, setQr] = React.useState({ url: "", loading: false, error: "", polling: false })
  const [pool, setPool] = React.useState({ loading: true, error: "", accounts: [], total: 0, summary: null })
  const [action, setAction] = React.useState({ busy: "", error: "", success: "" })
  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000))

  const loadAuth = React.useCallback(async () => {
    setAuth((s) => ({ ...s, loading: true, error: "" }))
    try {
      const res = await api.authStatus()
      setAuth({
        loading: false,
        error: "",
        loggedIn: res.loggedIn,
        tokenPreview: res.tokenPreview,
        saveTime: res.saveTime,
        message: res.message,
        loginState: res.loginState,
      })
    } catch (err) {
      setAuth((s) => ({ ...s, loading: false, error: err?.message || "读取登录状态失败" }))
    }
  }, [])

  const loadPool = React.useCallback(async () => {
    setPool((s) => ({ ...s, loading: true, error: "" }))
    try {
      const [list, summary] = await Promise.all([api.listPool(), api.poolSummary()])
      setPool({ loading: false, error: "", accounts: list.accounts, total: list.total, summary })
    } catch (err) {
      setPool((s) => ({ ...s, loading: false, error: err?.message || "读取账号池失败" }))
    }
  }, [])

  React.useEffect(() => {
    loadAuth()
    loadPool()
  }, [loadAuth, loadPool])

  // 冷却倒计时每秒刷新
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  // 出码后每 2 秒轮询登录状态，登录成功后停止并刷新账号列表
  React.useEffect(() => {
    if (!qr.polling) return
    let cancelled = false

    const poll = async () => {
      try {
        const res = await api.authStatus()
        if (cancelled) return
        setAuth((s) => ({
          ...s,
          loading: false,
          error: "",
          loggedIn: res.loggedIn,
          tokenPreview: res.tokenPreview || s.tokenPreview,
          saveTime: res.saveTime || s.saveTime,
          message: res.message,
          loginState: res.loginState,
        }))
        if (res.loggedIn) {
          setQr({ url: "", loading: false, error: "", polling: false })
          loadPool()
        } else if (res.loginState?.status === "expired" || res.loginState?.status === "failed") {
          setQr({
            url: "",
            loading: false,
            error: res.loginState?.message || "二维码已过期，请重新生成",
            polling: false,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setQr((s) => ({ ...s, error: err?.message || "登录状态查询失败" }))
        }
      }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [qr.polling, loadPool])

  const handleGenerateQr = async () => {
    setQr({ url: "", loading: true, error: "", polling: false })
    try {
      const res = await api.startLogin()
      const qrcodeUrl = res?.qrcode_url || res?.qrcode?.qrcodebase64 || ""
      if (!qrcodeUrl) throw new Error("未获取到二维码")
      const src = /^(data:|https?:\/\/)/.test(qrcodeUrl)
        ? qrcodeUrl
        : `https://open.weixin.qq.com/connect/qrcode/${qrcodeUrl}`
      setQr({ url: src, loading: false, error: "", polling: true })
      setAuth((s) => ({ ...s, loginState: res?.login_state || s.loginState, error: "" }))
    } catch (err) {
      setQr({ url: "", loading: false, error: err?.message || "二维码生成失败", polling: false })
    }
  }

  const runAction = async (key, task, successText) => {
    setAction({ busy: key, error: "", success: "" })
    try {
      const res = await task()
      setAction({ busy: "", error: "", success: successText || res?.message || "操作完成" })
      await loadPool()
    } catch (err) {
      setAction({ busy: "", error: err?.message || "操作失败", success: "" })
    }
  }

  const handleVerifyAll = () => {
    runAction("verify-all", () => api.verifyAllAccounts(), "已校验全部账号")
  }

  const handleRefresh = (id) => {
    runAction(`refresh:${id}`, async () => {
      const res = await api.refreshAccount(id)
      if (!res.ok) throw new Error(res.message || "刷新失败，请重新扫码登录")
      return res
    })
  }

  const handleRevive = (id) => {
    runAction(`revive:${id}`, () => api.reviveAccount(id))
  }

  const summary = pool.summary || { total: pool.total, active: 0, cooldown: 0, invalid: 0, banned: 0 }
  const waitingScan = qr.polling && !auth.loggedIn

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 00</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">账号池</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          扫码登录 · 多号轮换。凭证只保存在本机，账号状态由上游服务统一调度。
        </p>
      </header>

      {/* 登录状态卡 */}
      <Card className="rounded-lg shadow-card">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle className="font-serif text-lg font-semibold">登录状态</CardTitle>
            <CardDescription className="mt-1 text-xs leading-6">
              扫码登录微信读书，成功后自动写入账号池，采集时会自动轮换可用账号。
            </CardDescription>
          </div>
          <Badge variant={auth.loggedIn ? "secondary" : "outline"} className="rounded-sm text-[11px]">
            {auth.loggedIn ? "已登录" : "未登录"}
          </Badge>
        </CardHeader>
        <CardContent className="pt-2">
          {auth.loading ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Skeleton className="h-36 w-36 rounded-sm" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
                <Skeleton className="h-8 w-28 rounded-sm" />
              </div>
            </div>
          ) : auth.error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle className="font-serif text-base font-semibold tracking-tight">无法读取登录状态</AlertTitle>
              <AlertDescription className="mt-1 flex flex-col gap-3 text-sm leading-7">
                <span>{auth.error}</span>
                <Button variant="outline" size="sm" onClick={loadAuth} className="self-start gap-1 active:scale-95">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:gap-8">
              {auth.loggedIn ? (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-sm border border-[#4F7A5A]/30 bg-[#4F7A5A]/[0.06]">
                  <ShieldCheck className="h-8 w-8 text-[#4F7A5A]" aria-hidden="true" />
                </div>
              ) : qr.loading ? (
                <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-sm border border-dashed border-border bg-surface/50">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
              ) : qr.url ? (
                <img
                  src={qr.url}
                  alt="微信扫码登录二维码"
                  className="h-40 w-40 shrink-0 rounded-sm border border-border bg-card object-contain"
                />
              ) : (
                <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-sm border border-dashed border-border bg-surface/50 p-4 text-center">
                  <span className="text-xs leading-6 text-muted-foreground">生成二维码后显示在此处</span>
                </div>
              )}

              <div className="flex flex-1 flex-col gap-3">
                {auth.loggedIn ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="h-2 w-2 rounded-full bg-[#4F7A5A]" aria-hidden="true" />
                      <span className="font-medium">登录有效</span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {auth.tokenPreview || "暂无 token 预览"}
                      </span>
                    </div>
                    <p className="text-[11px] leading-6 text-muted-foreground">
                      凭证保存于 {formatTime(auth.saveTime)}。如需更换账号，可重新生成二维码扫码登录。
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-7">
                      {auth.loginState?.message || auth.message || "未登录。点击「生成二维码」，用微信扫码授权。"}
                    </p>
                    {waitingScan && (
                      <p className="text-[11px] leading-6 text-[#8a6520]">
                        已出码，正在等待扫码确认（每 2 秒自动检查）。二维码约 2 分钟内有效。
                      </p>
                    )}
                    {auth.tokenPreview && (
                      <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        最近 token：{auth.tokenPreview}
                      </p>
                    )}
                  </>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={auth.loggedIn ? "outline" : "default"}
                    size="sm"
                    onClick={handleGenerateQr}
                    disabled={qr.loading || waitingScan}
                    className="gap-2 active:scale-95"
                  >
                    {qr.loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {qr.loading ? "正在生成…" : waitingScan ? "等待扫码…" : auth.loggedIn ? "重新生成二维码" : "生成二维码"}
                  </Button>
                  {!auth.loggedIn && !waitingScan && qr.url && (
                    <span className="text-[11px] text-muted-foreground">二维码已生成，请用微信扫码</span>
                  )}
                </div>

                {qr.error && (
                  <p className="text-[11px] leading-6 text-[#A94438]">{qr.error}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 账号池概要 */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryBlock label="账号总数" value={summary.total} />
        <SummaryBlock label="可用" value={summary.active} tone="success" />
        <SummaryBlock label="冷却中" value={summary.cooldown} tone="warning" />
        <SummaryBlock label="失效" value={summary.invalid} tone="danger" />
      </section>

      {/* 账号列表 */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-semibold tracking-tight">账号列表</h2>
            <p className="mt-1 text-sm leading-7 text-muted-foreground">
              共 {pool.total} 个账号。失败次数过多会进入冷却，失效账号可尝试复活。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleVerifyAll}
            disabled={pool.loading || action.busy === "verify-all"}
            className="gap-2 active:scale-95"
          >
            {action.busy === "verify-all" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            校验全部
          </Button>
        </div>

        {action.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="font-serif text-base font-semibold tracking-tight">操作失败</AlertTitle>
            <AlertDescription className="mt-1 text-sm leading-7">{action.error}</AlertDescription>
          </Alert>
        )}
        {action.success && (
          <div className="rounded-md border border-[#4F7A5A]/30 bg-[#4F7A5A]/[0.06] px-4 py-2.5 text-sm leading-6 text-[#385742]">
            {action.success}
          </div>
        )}

        {pool.loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-4">
                <Skeleton className="h-9 w-9 rounded-sm" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-7 w-16 rounded-sm" />
              </div>
            ))}
          </div>
        ) : pool.error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle className="font-serif text-base font-semibold tracking-tight">读取账号池失败</AlertTitle>
            <AlertDescription className="mt-1 flex flex-col gap-3 text-sm leading-7">
              <span>{pool.error}</span>
              <Button variant="outline" size="sm" onClick={loadPool} className="self-start gap-1 active:scale-95">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : pool.accounts.length === 0 ? (
          <EmptyState
            icon={Users}
            title="账号池还是空的"
            description="点击上方「生成二维码」扫码登录，成功后账号会自动进入池中。"
            action={
              <Button size="sm" onClick={handleGenerateQr} disabled={qr.loading || waitingScan} className="gap-2 active:scale-95">
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                生成二维码
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {pool.accounts.map((acc) => {
              const meta = statusMeta(acc.status)
              const remain = Math.max(0, acc.cooldownUntil - now)
              const refreshing = action.busy === `refresh:${acc.id}`
              const reviving = action.busy === `revive:${acc.id}`
              return (
                <li key={acc.id || acc.vid} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {acc.avatar ? (
                      <img src={acc.avatar} alt="" className="h-9 w-9 shrink-0 rounded-sm border border-border object-cover" />
                    ) : (
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-secondary font-serif text-sm font-semibold text-muted-foreground">
                        {acc.nickname.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{acc.nickname}</span>
                        <StatusBadge status={meta.badge} label={meta.label} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>设备 {acc.deviceName}</span>
                        <span>失败 {acc.failures} 次</span>
                        {remain > 0 && <span className="text-[#8a6520]">冷却剩余 {remain} 秒</span>}
                        <span>保存 {formatTime(acc.saveTime)}</span>
                      </div>
                      {acc.lastError && (
                        <p className="mt-1 truncate text-[11px] text-[#A94438]" title={acc.lastError}>
                          最近错误：{acc.lastError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1 sm:items-end">
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {acc.tokenPreview || "无 token"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">最近使用 {formatTime(acc.lastUsed)}</span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRefresh(acc.id)}
                      disabled={!acc.id || Boolean(action.busy)}
                      className="gap-1 active:scale-95"
                    >
                      {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      刷新
                    </Button>
                    {acc.status === "invalid" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRevive(acc.id)}
                        disabled={!acc.id || Boolean(action.busy)}
                        className="gap-1 active:scale-95"
                      >
                        {reviving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                        复活
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/**
 * 概要数字块
 * @param {object} props
 * @param {string} props.label
 * @param {number} props.value
 * @param {'success'|'warning'|'danger'} [props.tone]
 */
function SummaryBlock({ label, value, tone }) {
  const valueClass =
    tone === "success"
      ? "text-[#385742]"
      : tone === "warning"
      ? "text-[#8a6520]"
      : tone === "danger"
      ? "text-[#7d2f26]"
      : "text-foreground"
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className={`font-serif text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-1 text-[11px] tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

SummaryBlock.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  tone: PropTypes.oneOf(["success", "warning", "danger"]),
}
