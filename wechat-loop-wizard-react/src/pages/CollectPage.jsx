import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
 * 采集向导页 —— 集成微信读书扫码登录 + 真实采集流程
 *
 * 扫码流程：POST /api/auth/qrcode → 拿到 qrcode_url + uuid → 每 2s 轮询 GET /api/auth/status
 * 采集流程：POST /api/accounts/search → POST /api/articles/collect-latest → 每 2s 轮询 GET /api/articles/download-status/<task_id>
 */
export function CollectPage() {
  // 认证状态
  const [authState, setAuthState] = React.useState({
    loggedIn: false,
    qrcodeUrl: "",
    status: "idle", // idle | scanning | confirmed | success | failed
    message: "",
  })

  // 采集状态
  const [account, setAccount] = React.useState("")
  const [collectStatus, setCollectStatus] = React.useState(COLLECT_STATUS.IDLE)
  const [progress, setProgress] = React.useState(0)
  const [current, setCurrent] = React.useState("")
  const [currentGrade, setCurrentGrade] = React.useState("L1")
  const [errorMsg, setErrorMsg] = React.useState("")
  const [taskId, setTaskId] = React.useState(null)

  // 启动扫码
  const startLogin = React.useCallback(async () => {
    setAuthState((s) => ({ ...s, status: "scanning", message: "正在生成二维码…" }))
    try {
      const res = await api.startLogin()
      setAuthState((s) => ({
        ...s,
        qrcodeUrl: res.qrcode_url || res.qrcode?.qrcodebase64 || "",
        status: "scanning",
        message: "请使用微信扫描二维码授权登录",
      }))
    } catch (err) {
      setAuthState((s) => ({
        ...s,
        status: "failed",
        message: err?.message || "二维码生成失败",
      }))
    }
  }, [])

  // 轮询扫码状态（每 3s 一次，登录成功后停）
  React.useEffect(() => {
    const poll = async () => {
      try {
        const res = await api.pollAuthStatus()
        const st = res?.login_state?.status
        const qrUrl = res?.login_state?.qrcode
        const msg = res?.login_state?.message || ""
        const loggedIn = Boolean(res?.logged_in) || st === "success" || st === "confirmed"

        if (loggedIn || st === "success") {
          setAuthState({ loggedIn: true, qrcodeUrl: "", status: "success", message: "授权有效" })
        } else if (st === "confirmed") {
          setAuthState((s) => ({ ...s, status: "confirmed", message: msg || "已扫码，等待确认" }))
        } else if (st === "failed") {
          setAuthState((s) => ({ ...s, status: "failed", message: msg || "二维码已过期" }))
        } else {
          // idle / scanning / 其他 —— 刷新二维码
          setAuthState((s) => ({
            ...s,
            status: st || "scanning",
            qrcodeUrl: qrUrl || s.qrcodeUrl,
            message: msg || s.message,
          }))
        }
      } catch (err) {
        console.warn("[CollectPage] auth poll 失败:", err.message)
      }
    }

    poll()
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
  }, [])

  // 轮询采集进度（每 2s 一次）
  React.useEffect(() => {
    if (collectStatus !== COLLECT_STATUS.COLLECTING || !taskId) return
    setErrorMsg("")

    const poll = async () => {
      try {
        const status = await api.pollTaskStatus(taskId)
        if (!status) return
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
        console.warn("[CollectPage] 采集轮询失败:", err.message)
      }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => clearInterval(timer)
  }, [collectStatus, taskId, account])

  const handleStart = async () => {
    if (!account.trim()) return
    if (!authState.loggedIn) {
      setErrorMsg("请先扫码登录微信读书账号")
      return
    }
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

  const isLoginLoading = authState.status === "scanning" || authState.status === "confirmed"

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 01</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">采集向导</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          未登录时显示扫码入口，扫码成功后下方采集面板自动解锁。
        </p>
      </header>

      {/* 扫码登录卡 */}
      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle className="font-serif text-lg font-semibold">微信读书授权</CardTitle>
            <CardDescription className="mt-1 text-xs leading-6">
              扫码登录后，wechat-mp-tools 的账号池会自动记录凭证，后续自动采集不需要重新扫码。
            </CardDescription>
          </div>
          <Badge
            variant={authState.loggedIn ? "secondary" : "destructive"}
            className="rounded-sm text-[11px]"
          >
            {authState.loggedIn ? "授权有效" : "尚未连接"}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pt-2 sm:flex-row sm:items-start sm:gap-8">
          {authState.loggedIn ? (
            <div className="flex h-24 w-24 items-center justify-center rounded-sm border border-dashed border-border bg-surface/50 text-muted-foreground">
              <span className="text-xs">✓ 已登录</span>
            </div>
          ) : authState.qrcodeUrl ? (
            <img
              src={authState.qrcodeUrl}
              alt="微信读书扫码登录二维码"
              className="h-44 w-44 rounded-sm border border-border bg-card object-contain"
            />
          ) : (
            <div className="flex h-36 w-36 items-center justify-center rounded-sm border border-dashed border-border bg-surface/50 text-center">
              <span className="text-xs text-muted-foreground">二维码生成后显示在此处</span>
            </div>
          )}

          <div className="flex flex-1 flex-col gap-3">
            <p className="text-sm leading-7">
              {authState.message ||
                "点击「获取二维码」按钮生成登录码，用微信 App 扫一扫确认授权。凭证只保存在本机，不入库不上传。"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant={authState.loggedIn ? "ghost" : "default"}
                size="sm"
                onClick={startLogin}
                disabled={isLoginLoading}
                className="active:scale-95"
              >
                {isLoginLoading ? "正在获取二维码…" : authState.loggedIn ? "刷新授权" : "获取二维码"}
              </Button>
              {authState.status === "scanning" && (
                <span className="text-[11px] text-muted-foreground">二维码 2 分钟内有效</span>
              )}
              {authState.status === "failed" && authState.message && !authState.loggedIn && (
                <span className="text-[11px] text-[#A94438]">{authState.message}</span>
              )}
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              如因网络环境无法访问微信读书服务器（常见于受限网络），可改用下方「兜底导入」面板，无需登录。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 采集面板 */}
      <CollectPanel
        accountValue={account}
        onAccountChange={setAccount}
        onStart={handleStart}
        loading={collectStatus === COLLECT_STATUS.COLLECTING}
        status={collectStatus}
        progress={progress}
        current={current}
        errorMessage={errorMsg}
        disabled={!authState.loggedIn}
        disabledHint={!authState.loggedIn ? "请先扫码登录微信读书，或改用兜底导入" : ""}
      />

      <DowngradePath current={currentGrade} onDowngrade={() => setCurrentGrade("L2")} />

      <section className="rounded-md border border-border bg-card p-6 shadow-card">
        <h2 className="font-serif text-xl font-semibold tracking-tight">兜底导入（L2，无需登录）</h2>
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
