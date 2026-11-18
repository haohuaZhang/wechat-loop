import * as React from "react"
import PropTypes from "prop-types"
import { Users, RefreshCw, Loader2, AlertTriangle, Plus, X, QrCode, RotateCcw, Search, Trash2, Smartphone } from "lucide-react"
import { createPortal } from "react-dom"
import { api } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

// ── 状态映射（严格对齐原版 login.js） ──────────────────────────
const STATUS_LABEL = {
  active: "正常运行",
  cooldown: "冷却中",
  banned: "已失效 · 风控",
  invalid: "已失效 · 登录过期",
}
const STATUS_COLOR = {
  active: "#12372e",    // 深绿
  cooldown: "#C87137",  // 赭石橙
  banned: "#7d2f26",    // 红
  invalid: "#7d2f26",
}

function statusLabel(s) { return STATUS_LABEL[s] || s || "未知" }
function statusColor(s) { return STATUS_COLOR[s] || "#6B6B6B" }
function formatDate(ts) {
  if (!ts) return "未记录"
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

// ── 统计概要小胶囊 ──────────────────────────────────────────────
function SummaryPill({ icon, label, value, tone }) {
  const toneClass = {
    green: "bg-[#12372e]/10 text-[#12372e]",
    amber: "bg-[#C87137]/12 text-[#C87137]",
    red: "bg-[#7d2f26]/10 text-[#7d2f26]",
    gray: "bg-[#1A1A1A]/5 text-[#6B6B6B]",
  }[tone] || "bg-[#1A1A1A]/5 text-[#6B6B6B]"
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ${toneClass}`}>
      {icon} {label} {value}
    </span>
  )
}
SummaryPill.propTypes = { icon: PropTypes.node, label: PropTypes.string, value: PropTypes.number, tone: PropTypes.string }

// ── 单账号卡片 ──────────────────────────────────────────────────
function AccountCard({ acc, busy, onRefresh, onVerify, onRescan, onRemove }) {
  const isKicked = acc.status === "banned" || acc.status === "invalid"
  const color = statusColor(acc.status)
  const refreshing = busy === `refresh:${acc.id}`
  const verifying = busy === `verify:${acc.id}`

  return (
    <div
      className="group relative rounded-md border border-[#1A1A1A]/10 bg-white p-5 transition-shadow hover:shadow-md"
      style={{ borderColor: isKicked ? "rgba(125, 47, 38, 0.3)" : undefined }}
    >
      {/* 状态徽标 */}
      <div className="absolute right-4 top-4 flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{
            backgroundColor: color,
            boxShadow: acc.status === "active" ? `0 0 6px ${color}` : undefined,
          }}
        />
        <span className="text-[12px] font-semibold" style={{ color }}>
          {statusLabel(acc.status)}
        </span>
      </div>

      {/* 头像 + 昵称 */}
      <div className="mb-4 flex items-center gap-3">
        {acc.avatar ? (
          <img src={acc.avatar} alt="" className="h-11 w-11 rounded-full border-2 border-white object-cover shadow-sm"
            onError={(e) => { e.currentTarget.style.display = "none" }} />
        ) : null}
        <div
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#12372e] font-serif text-lg font-bold text-white"
          style={{ display: acc.avatar ? "none" : undefined }}
        >
          {(acc.nickname || "?").charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-base font-bold tracking-tight text-[#1A1A1A]">
            {acc.nickname || "微信读书用户"}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-[#6B6B6B]">
            VID: {acc.vid || acc.id}
          </div>
        </div>
      </div>

      {/* 统计行 */}
      <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-[#F5F3EF] px-3 py-2.5 text-[12px] text-[#1A1A1A]/80">
        <div>
          绑定设备: <strong className="text-[#12372e]">{acc.deviceName || "未知设备"}</strong>
        </div>
        <div>
          换票算法: <strong>S-Box 纯算</strong>
        </div>
        <div>
          成功换票: <strong>{acc.success_refreshes || acc.successRefreshes || 0}</strong> 次
        </div>
        <div>
          连续失败: <strong>{acc.failures || 0}</strong> 次
        </div>
        {acc.saveTime || acc.save_time ? (
          <div className="col-span-2 text-[11px] text-[#6B6B6B]">
            更新时间: {formatDate(acc.saveTime || acc.save_time)}
          </div>
        ) : null}
      </div>

      {acc.lastError || acc.last_error ? (
        <div className="mb-2 break-all text-[12px] text-[#7d2f26]">
          最近异常: {acc.lastError || acc.last_error}
        </div>
      ) : null}

      {/* 操作按钮 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline" size="sm"
          onClick={() => onRefresh(acc.id)}
          disabled={Boolean(busy)}
          className="gap-1 rounded-md text-[12px] active:scale-95"
          title="使用 RefreshToken 立即重新换取最新 AccessToken"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          🔄 换新 Token
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={() => onVerify(acc.id)}
          disabled={Boolean(busy)}
          className="gap-1 rounded-md text-[12px] active:scale-95"
          title="向微信读书发起验证接口确认凭证活性"
        >
          {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          🔍 验证
        </Button>
        {isKicked && (
          <Button
            variant="default" size="sm"
            onClick={onRescan}
            disabled={Boolean(busy)}
            className="gap-1 rounded-md bg-[#C87137] hover:bg-[#C87137]/90 text-white text-[12px] active:scale-95"
          >
            <QrCode className="h-3.5 w-3.5" />
            重新扫码
          </Button>
        )}
        <Button
          variant="ghost" size="sm"
          onClick={() => onRemove(acc.id)}
          disabled={Boolean(busy)}
          className="ml-auto gap-1 rounded-md text-[12px] text-[#7d2f26] hover:bg-[#7d2f26]/10 active:scale-95"
        >
          <Trash2 className="h-3.5 w-3.5" /> 删除
        </Button>
      </div>
    </div>
  )
}
AccountCard.propTypes = {
  acc: PropTypes.object.isRequired,
  busy: PropTypes.string,
  onRefresh: PropTypes.func.isRequired,
  onVerify: PropTypes.func.isRequired,
  onRescan: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}

// ── 全屏扫码 Modal（Portal，fixed inset-0） ─────────────────────
function QrLoginModal({ open, onClose, onSuccess }) {
  const [qrUrl, setQrUrl] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [status, setStatus] = React.useState("loading") // loading | scanning | scanned | success | failed | expired
  const [statusMsg, setStatusMsg] = React.useState("")
  const [error, setError] = React.useState("")
  const pollTimerRef = React.useRef(null)
  const startTimeRef = React.useRef(0)

  const startPolling = React.useCallback(() => {
    pollTimerRef.current = setInterval(async () => {
      try {
        const data = await api.pollAuthStatus()
        const state = data?.login_state || {}
        if (state.status === "scanned") {
          setStatus("scanned")
          setStatusMsg("📱 已扫码，请在手机上点击【确认登录】")
        } else if (state.status === "success" || data?.loggedIn === true) {
          setStatus("success")
          setStatusMsg(state.message || "登录成功！")
          clearInterval(pollTimerRef.current); pollTimerRef.current = null
          setTimeout(() => {
            onSuccess?.()
          }, 1200)
        } else if (state.status === "failed") {
          setStatus("failed")
          setStatusMsg(state.message || "登录失败")
          clearInterval(pollTimerRef.current); pollTimerRef.current = null
        } else if (state.status === "expired") {
          setStatus("expired")
          setStatusMsg("二维码已过期")
          clearInterval(pollTimerRef.current); pollTimerRef.current = null
        } else if (state.status === "idle") {
          const elapsed = Date.now() - startTimeRef.current
          if (elapsed > 3500) {
            // 长时间 idle 视为后端未启动
          }
        }
      } catch (_e) { /* silent */ }
    }, 1500)
  }, [onSuccess])

  const launchLogin = React.useCallback(async () => {
    setLoading(true)
    setError("")
    setStatus("loading")
    setStatusMsg("正在获取微信读书官方授权二维码...")
    setQrUrl("")
    startTimeRef.current = Date.now()
    try {
      const data = await api.startLogin()
      let raw = data?.qrcode_url || data?.login_state?.qrcode || data?.qrcode
      if (raw) {
        let src = String(raw)
        if (!/^(data:|https?:\/\/)/.test(src)) {
          src = `data:image/jpeg;base64,${src}`
        }
        setQrUrl(src)
      }
      setLoading(false)
      setStatus("scanning")
      setStatusMsg("正在等待手机微信扫码授权...")
      startPolling()
    } catch (err) {
      setLoading(false)
      setStatus("failed")
      setError(err?.message || "获取二维码失败")
      setStatusMsg("获取失败")
    }
  }, [startPolling])

  // open 时自动启动
  React.useEffect(() => {
    if (open) {
      launchLogin()
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [open, launchLogin])

  // ESC 关闭
  React.useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const handleClose = React.useCallback(async () => {
    try { await api.cancelAuth() } catch (_e) { /* silent */ }
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    onClose()
  }, [onClose])

  if (!open) return null

  const iconMap = {
    loading: <Loader2 className="h-8 w-8 animate-spin text-[#12372e]" />,
    scanning: qrUrl ? null : <Loader2 className="h-8 w-8 animate-spin text-[#12372e]" />,
    scanned: null,
    success: <span className="text-5xl">🎉</span>,
    failed: <span className="text-4xl text-[#7d2f26]">❌</span>,
    expired: <span className="text-4xl text-[#C87137]">⏳</span>,
  }

  const msgColor = {
    loading: "#6B6B6B",
    scanning: "#6B6B6B",
    scanned: "#C87137",
    success: "#12372e",
    failed: "#7d2f26",
    expired: "#C87137",
  }[status] || "#6B6B6B"

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-5"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-[380px] rounded-md border border-[#1A1A1A]/10 bg-white p-6 text-center shadow-2xl">
        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-3.5 top-3.5 rounded-md p-1 text-[#6B6B6B] hover:bg-[#1A1A1A]/5"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="mb-1 font-serif text-[17px] font-bold text-[#1A1A1A]">
          📱 微信读书扫码登录
        </h3>
        <p className="mb-4 text-[12px] text-[#6B6B6B]">
          使用手机微信「扫一扫」并确认授权
        </p>

        {/* 二维码区 */}
        <div className="mx-auto flex min-h-[220px] items-center justify-center">
          {status === "success" || status === "failed" || status === "expired" ? (
            iconMap[status]
          ) : qrUrl ? (
            <div className="inline-block rounded-md border border-[#1A1A1A]/10 bg-white p-3 shadow-sm">
              <img src={qrUrl} alt="微信扫码授权" className="h-[210px] w-[210px] rounded-md object-cover" />
            </div>
          ) : iconMap[status] || <Loader2 className="h-8 w-8 animate-spin text-[#12372e]" />}
        </div>

        {/* 状态文字 */}
        <div
          className="mt-4 min-h-[22px] text-[13px] font-medium"
          style={{ color: msgColor }}
        >
          {error ? `获取失败: ${error}` : statusMsg}
        </div>

        {/* 过期/失败后的重试按钮 */}
        {(status === "expired" || status === "failed") && (
          <div className="mt-2">
            <Button
              variant="default" size="sm"
              onClick={launchLogin}
              className="rounded-md bg-[#C87137] hover:bg-[#C87137]/90 text-white active:scale-95"
            >
              {status === "expired" ? "刷新二维码" : "重新尝试"}
            </Button>
          </div>
        )}

        {/* 底部取消按钮 */}
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={handleClose} className="rounded-md active:scale-95">
            取消
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
QrLoginModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
}

// ── 主页面 ──────────────────────────────────────────────────────
export function AccountPoolPage() {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [accounts, setAccounts] = React.useState([])
  const [summary, setSummary] = React.useState(null)
  const [qrOpen, setQrOpen] = React.useState(false)
  const [busy, setBusy] = React.useState("")
  const [toast, setToast] = React.useState({ type: "", text: "" })

  const showToast = React.useCallback((type, text) => {
    setToast({ type, text })
    setTimeout(() => setToast({ type: "", text: "" }), 3000)
  }, [])

  const loadAccounts = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [list, sum] = await Promise.all([api.listPool(), api.poolSummary()])
      setAccounts(list.accounts || [])
      setSummary(sum)
    } catch (err) {
      setError(err?.message || "加载账号列表失败")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { loadAccounts() }, [loadAccounts])

  const handleRefresh = async (id) => {
    setBusy(`refresh:${id}`)
    showToast("", "")
    try {
      await api.refreshAccount(id)
      showToast("success", "Token 刷新成功")
      await loadAccounts()
    } catch (err) {
      showToast("error", err?.message || "刷新失败")
    } finally {
      setBusy("")
    }
  }

  const handleVerify = async (id) => {
    setBusy(`verify:${id}`)
    try {
      const res = await api.verifyAccount(id)
      showToast(res.valid ? "success" : "warning", res.message || "验证完成")
    } catch (err) {
      showToast("error", err?.message || "验证失败")
    } finally {
      setBusy("")
    }
  }

  const handleRemove = async (id) => {
    const acc = accounts.find((a) => a.id === id)
    const name = acc?.nickname || "该账号"
    if (!window.confirm(`确定要从账号池中删除「${name}」吗？`)) return
    try {
      await api.removeAccount(id)
      showToast("success", "已删除")
      await loadAccounts()
    } catch (err) {
      showToast("error", err?.message || "删除失败")
    }
  }

  const handleQrSuccess = React.useCallback(async () => {
    setQrOpen(false)
    showToast("success", "微信读书账号登录成功！")
    await loadAccounts()
  }, [loadAccounts, showToast])

  const empty = !loading && !error && accounts.length === 0

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部标题行 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1A1A1A]">
            微信读书账号池
          </h1>
          <p className="mt-1 text-[13px] text-[#6B6B6B]">
            管理您的微信读书账号池与登录状态，凭证只保存在本机
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={loadAccounts}
            disabled={loading || Boolean(busy)}
            className="gap-1.5 rounded-md text-[13px] active:scale-95"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            🔄 刷新列表
          </Button>
          <Button
            variant="default" size="sm"
            onClick={() => setQrOpen(true)}
            disabled={Boolean(busy)}
            className="gap-1.5 rounded-md bg-[#12372e] text-white font-semibold hover:bg-[#12372e]/90 text-[13px] active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            扫码添加账号
          </Button>
        </div>
      </header>

      {/* 概要胶囊 */}
      {summary && !loading && (
        <div className="flex flex-wrap gap-2">
          <SummaryPill icon={<span>🟢</span>} label="可用账号" value={summary.active} tone="green" />
          {summary.cooldown > 0 && (
            <SummaryPill icon={<span>🟡</span>} label="冷却中" value={summary.cooldown} tone="amber" />
          )}
          {(summary.banned + summary.invalid) > 0 && (
            <SummaryPill icon={<span>🔴</span>} label="已失效" value={summary.banned + summary.invalid} tone="red" />
          )}
          <SummaryPill icon={<Users className="h-3.5 w-3.5" />} label="共" value={summary.total} tone="gray" />
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="font-serif text-base font-semibold">加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 账号网格 */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-md border border-[#1A1A1A]/10 bg-white p-5">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="mt-3 h-4 w-40" />
              <Skeleton className="mt-6 h-20 w-full rounded-md" />
            </div>
          ))}
        </div>
      ) : empty ? (
        <div className="rounded-md border border-dashed border-[#1A1A1A]/20 bg-white p-16 text-center">
          <div className="mb-4 text-5xl opacity-60">📖</div>
          <h3 className="mb-2 font-serif text-lg font-semibold text-[#1A1A1A]">
            微信读书账号池为空
          </h3>
          <p className="mx-auto mb-6 max-w-lg text-[13px] leading-7 text-[#6B6B6B]">
            点击右上角「扫码添加账号」，使用手机微信扫码授权登录，系统将自动录入并静默维护换票凭证。
          </p>
          <Button
            variant="default" size="sm"
            onClick={() => setQrOpen(true)}
            className="rounded-md bg-[#12372e] text-white font-semibold hover:bg-[#12372e]/90 active:scale-95"
          >
            <Smartphone className="mr-1.5 h-4 w-4" /> 立即扫码添加
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((acc) => (
            <AccountCard
              key={acc.id || acc.vid}
              acc={acc}
              busy={busy}
              onRefresh={handleRefresh}
              onVerify={handleVerify}
              onRescan={() => setQrOpen(true)}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {/* 全屏扫码 Modal */}
      <QrLoginModal open={qrOpen} onClose={() => setQrOpen(false)} onSuccess={handleQrSuccess} />

      {/* Toast */}
      {toast.text && (
        <div
          className="fixed bottom-6 left-1/2 z-[10000] -translate-x-1/2 rounded-md px-5 py-2.5 text-sm font-medium text-white shadow-lg"
          style={{
            background: toast.type === "error" ? "#7d2f26" :
              toast.type === "warning" ? "#C87137" :
              toast.type === "success" ? "#12372e" : "#1A1A1A",
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

AccountPoolPage.propTypes = {
  onNavigate: PropTypes.func,
}
