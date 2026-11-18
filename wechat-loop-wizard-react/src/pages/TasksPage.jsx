import * as React from "react"
import PropTypes from "prop-types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { StatusBadge } from "@/components/common/StatusBadge"
import { EmptyState } from "@/components/common/EmptyState"
import { FailureCounter } from "@/components/governance/FailureCounter"
import { EvidencePanel } from "@/components/governance/EvidencePanel"
import { HandoffDialog } from "@/components/governance/HandoffDialog"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FolderOpen,
  FileText,
  Trash2,
  Trash,
  Download,
  AlertCircle,
  CalendarDays,
} from "lucide-react"

// ──────────────────── Tab 切换 ────────────────────

const PAGE_TABS = [
  { key: "tasks", label: "采集任务", hint: "任务进度 · 失败处理 · 证据链" },
  { key: "history", label: "下载历史", hint: "浏览已下载文章 · 打开文件" },
]

/**
 * 页面 Tab 分段器（沿用 CollectTabs 风格）
 * @param {object} props
 * @param {'tasks'|'history'} props.value
 * @param {function('tasks'|'history')} props.onChange
 * @param {string} [props.className]
 */
function PageTabs({ value, onChange, className }) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface/60 p-1",
        className
      )}
      role="tablist"
      aria-label="页面分段"
    >
      {PAGE_TABS.map((tab) => {
        const active = value === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex flex-col items-start rounded-sm px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <span className="text-xs font-medium leading-tight">{tab.label}</span>
            <span
              className={cn(
                "text-[10px] leading-snug",
                active ? "text-primary-foreground/70" : "text-muted-foreground/70"
              )}
            >
              {tab.hint}
            </span>
          </button>
        )
      })}
    </div>
  )
}

PageTabs.propTypes = {
  value: PropTypes.oneOf(["tasks", "history"]).isRequired,
  onChange: PropTypes.func.isRequired,
  className: PropTypes.string,
}

// ──────────────────── 工具函数 ────────────────────

/**
 * 从路径中提取文件/目录名
 * @param {string} p
 */
function basename(p) {
  if (!p) return ""
  const norm = p.replace(/\\/g, "/")
  const trimmed = norm.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

/**
 * 格式化时间戳 → 友好日期
 * @param {number} unixTs
 */
function formatTime(unixTs) {
  if (!unixTs) return "-"
  const d = new Date(unixTs * 1000)
  if (Number.isNaN(d.getTime())) return "-"
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const pad = (n) => String(n).padStart(2, "0")
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ──────────────────── Tab 1：采集任务（原有，向后兼容） ────────────────────

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

/**
 * 采集任务 Tab 内容（保留原有交互，向后兼容）
 */
function TasksTab() {
  const [task, setTask] = React.useState(TASK_SCENARIOS[0])
  const [recentList, setRecentList] = React.useState([])
  const [loadingRecent, setLoadingRecent] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoadingRecent(true)
    api
      .listTasks()
      .then((list) => {
        if (!cancelled) setRecentList(list)
      })
      .finally(() => {
        if (!cancelled) setLoadingRecent(false)
      })
    return () => {
      cancelled = true
    }
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
              <span
                className={`inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[11px] font-medium ${STATUS_VARIANT[statusKey].cls}`}
              >
                <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {STATUS_VARIANT[statusKey].label}
              </span>
              {task.key === "verifying" || task.key === "blocked" ? (
                <HandoffDialog
                  reason={handoffReason}
                  trigger={
                    <Button type="button" variant="destructive" size="sm" className="gap-2 active:scale-95">
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
              <strong>已停机：</strong>
              {task.errorHint}
              <div className="mt-2 text-[11px]">下一步：降级通道，或在人工接管弹窗中确认后手动处理。</div>
            </div>
          )}
          {task.key === "verifying" && (
            <div className="rounded-md border border-[#B8862F]/40 bg-[#B8862F]/[0.06] px-4 py-3 text-sm leading-6 text-[#8a6520]">
              <strong>需要人机验证：</strong>
              {task.errorHint}
              <div className="mt-2 text-[11px]">下一步：点击「需人工接管」，按弹窗中的步骤手动完成滑块/扫码。</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 最近任务列表 —— 来自 API */}
      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-xl font-semibold tracking-tight">最近任务</h2>
        {loadingRecent ? (
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
        ) : recentList.length === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>暂未读到历史任务。检查后端服务是否已启动。</AlertDescription>
          </Alert>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
            {recentList.map((t) => {
              const v = STATUS_VARIANT[t.status]
              const I = v.icon
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface/60">
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-sm border ${v.cls}`}>
                    <I className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {t.id} · {t.at}
                    </div>
                  </div>
                  <Badge variant="outline" className={`rounded-sm text-[11px] ${v.cls}`}>
                    {v.label}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// ──────────────────── Tab 2：下载历史 ────────────────────

/**
 * 下载历史 Tab 内容：浏览单文章维度的下载历史，支持打开文件 / 删除
 */
function HistoryTab() {
  /** @type {[ReturnType<typeof api.listHistory>, React.Dispatch<...>]} */
  const [data, setData] = React.useState({ items: [], total: 0 })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [filterAccount, setFilterAccount] = React.useState("all")
  const [openingIdx, setOpeningIdx] = React.useState(null)
  const [deletingIdx, setDeletingIdx] = React.useState(null)
  const [clearingAll, setClearingAll] = React.useState(false)
  const [toast, setToast] = React.useState("")

  /** 公众号选项（从历史中自动推导） */
  const accounts = React.useMemo(() => {
    const set = new Set()
    data.items.forEach((it) => it.account && set.add(it.account))
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"))
  }, [data.items])

  /** 过滤后的列表（公众号维度） */
  const filteredItems = React.useMemo(() => {
    if (filterAccount === "all") return data.items
    return data.items.filter((it) => it.account === filterAccount)
  }, [data.items, filterAccount])

  async function refresh() {
    setLoading(true)
    setError("")
    try {
      const res = await api.listHistory()
      setData(res)
    } catch (err) {
      setError(err?.message || "读取下载历史失败")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    refresh()
  }, [])

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 2400)
    return () => clearTimeout(t)
  }, [toast])

  /** 打开文件 / 所在文件夹 */
  async function handleOpen(item) {
    if (!item.success || !item.path) {
      setToast("这条记录没有可打开的文件")
      return
    }
    setOpeningIdx(item._index)
    try {
      const res = await api.openFile(item.path, item.hasMarkdown ? "md" : undefined)
      if (res?.mode === "headless") {
        setToast(`无桌面环境，请在宿主机打开：${res.host_path || item.path}`)
      } else {
        setToast("已在系统默认程序中打开")
      }
    } catch (err) {
      setToast(`打开失败：${err?.message || "未知错误"}`)
    } finally {
      setOpeningIdx(null)
    }
  }

  async function handleOpenParent(item) {
    if (!item.path) {
      setToast("这条记录没有文件路径")
      return
    }
    setOpeningIdx(item._index)
    try {
      const res = await api.openParent(item.path)
      if (res?.mode === "headless") {
        setToast(`无桌面环境，请在宿主机打开：${res.host_path || item.path}`)
      } else {
        setToast("已打开所在文件夹")
      }
    } catch (err) {
      setToast(`打开失败：${err?.message || "未知错误"}`)
    } finally {
      setOpeningIdx(null)
    }
  }

  async function handleOpenAccountFolder(accountName) {
    if (!accountName) return
    try {
      await api.openFolder(accountName)
      setToast(`已打开「${accountName}」的下载目录`)
    } catch (err) {
      setToast(`打开文件夹失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleDeleteOne(item) {
    if (!window.confirm(`确定删除《${item.title}》的下载文件和历史记录吗？此操作不可恢复。`)) return
    setDeletingIdx(item._index)
    try {
      await api.deleteHistory(item._index)
      setToast("已删除")
      await refresh()
    } catch (err) {
      setToast(`删除失败：${err?.message || "未知错误"}`)
    } finally {
      setDeletingIdx(null)
    }
  }

  async function handleClearAll() {
    if (data.items.length === 0) return
    const ok = window.confirm(
      `确定清空全部下载历史吗？\n\n将一并删除本地下载的 Markdown / PDF 文件，共 ${data.items.length} 条记录。此操作不可恢复。`
    )
    if (!ok) return
    setClearingAll(true)
    try {
      await api.deleteHistory()
      setToast("历史已清空")
      await refresh()
      setFilterAccount("all")
    } catch (err) {
      setToast(`清空失败：${err?.message || "未知错误"}`)
    } finally {
      setClearingAll(false)
    }
  }

  // ── 渲染 ──

  return (
    <div className="flex flex-col gap-6">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">按公众号：</span>
          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            className="h-8 rounded-sm border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">全部（{data.items.length} 篇）</option>
            {accounts.map((acc) => {
              const count = data.items.filter((it) => it.account === acc).length
              return (
                <option key={acc} value={acc}>
                  {acc}（{count}）
                </option>
              )
            })}
          </select>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} className="gap-1">
            <Download className={cn("h-3.5 w-3.5", loading && "animate-pulse")} />
            刷新
          </Button>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={loading || clearingAll || data.items.length === 0}
          onClick={handleClearAll}
          className="gap-2"
        >
          <Trash className="h-3.5 w-3.5" />
          {clearingAll ? "清空中..." : "清空全部历史"}
        </Button>
      </div>

      {/* 错误态 */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Toast 提示条 */}
      {toast && (
        <div
          role="status"
          className={cn(
            "rounded-md border px-3 py-2 text-xs shadow-sm animate-in fade-in",
            toast.includes("失败") || toast.includes("请在宿主机")
              ? "border-[#B8862F]/40 bg-[#B8862F]/[0.08] text-[#8a6520]"
              : "border-[#4F7A5A]/40 bg-[#4F7A5A]/[0.08] text-[#385742]"
          )}
        >
          {toast}
        </div>
      )}

      {/* 加载骨架 */}
      {loading && !error && (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
              <Skeleton className="h-5 w-5 rounded-sm" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-7 w-20 rounded-sm" />
              <Skeleton className="h-7 w-7 rounded-sm" />
              <Skeleton className="h-7 w-7 rounded-sm" />
            </div>
          ))}
        </div>
      )}

      {/* 空态 */}
      {!loading && !error && filteredItems.length === 0 && (
        <EmptyState
          icon={FileText}
          title="还没有下载过文章"
          description={
            filterAccount === "all"
              ? "到采集向导跑一次吧，下载完成后这里会自动记录。"
              : `公众号「${filterAccount}」还没有下载记录。`
          }
        />
      )}

      {/* 列表（按公众号分组） */}
      {!loading && !error && filteredItems.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          {filteredItems.map((item) => (
            <li
              key={`${item._index}-${item.title}`}
              className="group flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface/60 sm:flex-row sm:items-center sm:gap-3"
            >
              {/* 左侧：状态 + 标题信息 */}
              <div className="flex flex-1 min-w-0 items-start gap-3 sm:items-center">
                <StatusBadge
                  status={item.success ? "completed" : "error"}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{item.title || "(无标题)"}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    <span
                      className="cursor-pointer hover:text-primary"
                      onClick={() => handleOpenAccountFolder(item.account)}
                      title={`打开「${item.account}」的下载目录`}
                    >
                      @{item.account || "未知公众号"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {formatTime(item.time)}
                    </span>
                    {item.path && (
                      <span className="truncate max-w-[260px]" title={item.path}>
                        {basename(item.path)}
                      </span>
                    )}
                    {!item.success && item.error && (
                      <span className="truncate text-[#7d2f26] max-w-[260px]" title={item.error}>
                        · {item.error}
                      </span>
                    )}
                    {item.hasMarkdown && <span className="text-[#385742]">· .md</span>}
                    {item.hasPdf && <span className="text-[#7d2f26]">· .pdf</span>}
                  </div>
                </div>
              </div>

              {/* 右侧：按钮组 */}
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!item.success || !item.path || openingIdx === item._index}
                  onClick={() => handleOpen(item)}
                  title={!item.success ? "下载失败，没有文件可打开" : "在系统默认程序中打开"}
                  className="gap-1"
                >
                  <FileText className="h-3.5 w-3.5" />
                  打开
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!item.path || openingIdx === item._index}
                  onClick={() => handleOpenParent(item)}
                  title="打开文件所在文件夹"
                  className="gap-1"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  所在文件夹
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={deletingIdx === item._index}
                  onClick={() => handleDeleteOne(item)}
                  title="删除这条下载记录"
                  aria-label="删除"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ──────────────────── 页面根组件 ────────────────────

/**
 * TasksPage —— 任务中心（采集任务 + 下载历史 两 Tab）
 *
 * 上游：wechat-mp-tools 的 download-status + history + open-file/open-folder/open-parent
 * 暖米白杂志风：沿用 tailwind.config.js 里的 surface (#FBF9F6) / card / serif 体系
 */
export function TasksPage() {
  const [tab, setTab] = React.useState("tasks")

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 02</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          {tab === "tasks" ? "采集任务" : "下载历史"}
        </h1>
        <p className="text-sm leading-7 text-muted-foreground">
          {tab === "tasks"
            ? "查看进度、处理失败、验证证据。同一环节连续失败 ≥ 5 次时自动停机。"
            : "浏览所有已下载的 Markdown / PDF 文件，可直接在系统中打开。"}
        </p>
      </header>

      <PageTabs value={tab} onChange={setTab} />

      {tab === "tasks" ? <TasksTab /> : <HistoryTab />}
    </div>
  )
}
