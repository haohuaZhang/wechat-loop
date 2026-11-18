import * as React from "react"
import PropTypes from "prop-types"
import { Download, Trash2, Clipboard, Play, Square, FolderOpen, Save, Wrench, Loader2, AlertCircle } from "lucide-react"
import { api } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

// ── 工具函数 ──────────────────────────────────────────────────

/** 逗号/顿号/换行 分隔的关键词 → 数组 */
function splitKeywords(raw) {
  return String(raw || "")
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 从文本中智能提取 mp.weixin.qq.com 链接 */
function extractUrls(text) {
  const raw = String(text || "").trim()
  if (!raw) return []
  const matches = raw.match(/https?:\/\/[^\s'"<>]+/g) || []
  let urls = matches
    .map((u) => u.replace(/[)\]>，。]+$/, "").trim())
    .filter((u) => u.includes("mp.weixin.qq.com"))
  if (urls.length === 0) {
    urls = raw.split("\n")
      .map((u) => u.trim())
      .filter((u) => u && (u.startsWith("http://") || u.startsWith("https://")))
  }
  return urls
}

// ── 下载进度面板 ──────────────────────────────────────────────
function DownloadProgress({ task, onCancel, onOpenFolder }) {
  if (!task) return null
  const { status, current = "-", total = 0, completed = 0, failed = 0 } = task
  const progress = total > 0
    ? Math.min(100, Math.round(((completed + failed) / total) * 100))
    : 0

  const isRunning = status === "running" || status === "pending"
  const badgeText = {
    running: "下载中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  }[status] || status
  const badgeColor = {
    running: "#C87137",
    completed: "#12372e",
    failed: "#7d2f26",
    cancelled: "#6B6B6B",
  }[status] || "#6B6B6B"

  return (
    <Card className="rounded-md border border-[#1A1A1A]/10 bg-white">
      <CardContent className="pt-5 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-[#12372e]" />
            <span className="font-serif text-base font-bold text-[#1A1A1A]">📥 下载进度</span>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
              style={{ background: badgeColor }}
            >
              {badgeText}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Button
                variant="outline" size="sm"
                onClick={onCancel}
                className="gap-1 rounded-md text-[12px] text-[#7d2f26] border-[#7d2f26]/40 hover:bg-[#7d2f26]/10 active:scale-95"
              >
                <Square className="h-3.5 w-3.5" /> ⏹️ 停止下载
              </Button>
            )}
            <Button
              variant="outline" size="sm"
              onClick={onOpenFolder}
              className="gap-1 rounded-md text-[12px] active:scale-95"
            >
              <FolderOpen className="h-3.5 w-3.5" /> 📂 打开下载目录
            </Button>
          </div>
        </div>

        {/* 进度条 */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#F5F3EF]">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, background: status === "failed" ? "#7d2f26" : "#12372e" }}
          />
        </div>

        {/* 统计 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-[#1A1A1A]/75">
          <span>当前: <strong className="font-semibold text-[#1A1A1A]">{current}</strong></span>
          <span>完成: <strong className="font-semibold text-[#12372e]">{completed}</strong></span>
          <span>失败: <strong className="font-semibold text-[#7d2f26]">{failed}</strong></span>
          <span>总计: <strong className="font-semibold text-[#1A1A1A]">{total}</strong></span>
          <span className="ml-auto font-mono text-[11px] text-[#6B6B6B]">{progress}%</span>
        </div>

        {status === "completed" && (
          <p className="mt-3 text-[12px] text-[#6B6B6B]">
            下载完成。请到「下载历史」查看文件列表。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
DownloadProgress.propTypes = {
  task: PropTypes.object,
  onCancel: PropTypes.func.isRequired,
  onOpenFolder: PropTypes.func.isRequired,
}

// ── 内容过滤卡 ────────────────────────────────────────────────
function ContentFilterCard({ rules, setRules, badgeText, loading }) {
  const handleNum = (key, numKey, val, min, max, defaultVal) => {
    let n = parseFloat(val)
    if (isNaN(n)) n = defaultVal
    n = Math.min(Math.max(n, min), max)
    setRules((r) => ({ ...r, [key]: { ...r[key], [numKey]: n } }))
  }

  return (
    <Card className="rounded-md border border-[#1A1A1A]/10 bg-white">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="font-serif text-base font-bold text-[#1A1A1A] flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[#C87137]" /> 🧹 内容过滤
          </CardTitle>
          <CardDescription className="mt-1 text-[12px] text-[#6B6B6B]">
            去掉广告块、二维码，以及被当作小节标题的横幅图片
          </CardDescription>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            rules.enabled
              ? "bg-[#12372e]/10 text-[#12372e]"
              : "bg-[#1A1A1A]/8 text-[#6B6B6B]"
          }`}
        >
          {badgeText}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-2 pb-5">
        {/* 总开关 */}
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-[#1A1A1A]/10 bg-[#F5F3EF]/50 px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-[#1A1A1A]">下载时自动过滤</div>
            <div className="mt-0.5 text-[11px] text-[#6B6B6B]">
              去掉广告块、二维码、横幅图
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rules.enabled}
            onClick={() => setRules((r) => ({ ...r, enabled: !r.enabled, banner_images: { ...r.banner_images, enabled: !r.enabled } }))}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              rules.enabled ? "bg-[#12372e]" : "bg-[#1A1A1A]/20"
            }`}
          >
            <span
              className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
              style={{ transform: rules.enabled ? "translateX(18px)" : "translateX(2px)" }}
            />
          </button>
        </label>

        {/* 横幅图配置 */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#1A1A1A]">横幅图宽高比阈值</label>
            <input
              type="number" step="0.01" min="0.05" max="0.9"
              value={rules.banner_images?.max_ratio ?? 0.22}
              onChange={(e) => handleNum("banner_images", "max_ratio", e.target.value, 0.05, 0.9, 0.22)}
              className="w-full rounded-md border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[13px] text-[#1A1A1A] focus:border-[#12372e] focus:outline-none"
            />
            <div className="mt-1 text-[11px] text-[#6B6B6B]">微信 data-ratio = 高/宽；小节标题图通常 0.1~0.2，正文配图 ≥0.5</div>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#1A1A1A]">最小宽度 (px)</label>
            <input
              type="number" step="50" min="0"
              value={rules.banner_images?.min_width ?? 500}
              onChange={(e) => handleNum("banner_images", "min_width", e.target.value, 0, 10000, 500)}
              className="w-full rounded-md border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[13px] text-[#1A1A1A] focus:border-[#12372e] focus:outline-none"
            />
            <div className="mt-1 text-[11px] text-[#6B6B6B]">宽度达到该值的图才会被判为横幅</div>
          </div>
        </div>

        {/* 图片关键词 */}
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#1A1A1A]">图片关键词</label>
          <input
            type="text"
            value={(rules.remove_image_keywords || []).join("、")}
            onChange={(e) => setRules((r) => ({ ...r, remove_image_keywords: splitKeywords(e.target.value) }))}
            placeholder="分割线、二维码、扫码"
            className="w-full rounded-md border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[13px] text-[#1A1A1A] focus:border-[#12372e] focus:outline-none"
          />
          <div className="mt-1 text-[11px] text-[#6B6B6B]">图片的 alt / title / 文件名命中任一词即删除，逗号分隔</div>
        </div>

        {/* 文本关键词 */}
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[#1A1A1A]">文本关键词</label>
          <input
            type="text"
            value={(rules.remove_text_keywords || []).join("、")}
            onChange={(e) => setRules((r) => ({ ...r, remove_text_keywords: splitKeywords(e.target.value) }))}
            placeholder="点击上方蓝字、扫码关注"
            className="w-full rounded-md border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[13px] text-[#1A1A1A] focus:border-[#12372e] focus:outline-none"
          />
          <div className="mt-1 text-[11px] text-[#6B6B6B]">200 字以内的短段落命中任一词即删除，逗号分隔</div>
        </div>
      </CardContent>
      <div className="flex gap-2 border-t border-[#1A1A1A]/8 bg-[#F5F3EF]/40 px-5 py-3">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-[#6B6B6B]" /> : null}
      </div>
    </Card>
  )
}
ContentFilterCard.propTypes = {
  rules: PropTypes.object.isRequired,
  setRules: PropTypes.func.isRequired,
  badgeText: PropTypes.string.isRequired,
  loading: PropTypes.bool,
}

// ── 主页面 ─────────────────────────────────────────────────────
export function DownloadPage({ onNavigate }) {
  const [urlsText, setUrlsText] = React.useState("")
  const [rules, setRules] = React.useState({
    enabled: true,
    banner_images: { enabled: true, max_ratio: 0.22, min_width: 500 },
    remove_image_keywords: ["分割线", "二维码", "扫码"],
    remove_text_keywords: ["点击上方蓝字", "扫码关注"],
  })
  const [cfBadge, setCfBadge] = React.useState("加载中")
  const [cfLoading, setCfLoading] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)
  const [taskId, setTaskId] = React.useState("")
  const [task, setTask] = React.useState(null)
  const [error, setError] = React.useState("")
  const [toast, setToast] = React.useState({ type: "", text: "" })
  const pollRef = React.useRef(null)

  const showToast = React.useCallback((type, text) => {
    setToast({ type, text })
    setTimeout(() => setToast({ type: "", text: "" }), 3000)
  }, [])

  // 加载过滤设置
  const loadFilter = React.useCallback(async () => {
    setCfLoading(true)
    try {
      const res = await api.contentFilter()
      const r = res?.rules || {}
      setRules({
        enabled: r.enabled !== false,
        banner_images: {
          enabled: r.enabled !== false,
          max_ratio: r.banner_images?.max_ratio ?? 0.22,
          min_width: r.banner_images?.min_width ?? 500,
        },
        remove_image_keywords: Array.isArray(r.remove_image_keywords) ? r.remove_image_keywords : [],
        remove_text_keywords: Array.isArray(r.remove_text_keywords) ? r.remove_text_keywords : [],
      })
      setCfBadge(r.enabled !== false ? "已开启" : "已关闭")
    } catch (_err) {
      setCfBadge("未配置")
    } finally {
      setCfLoading(false)
    }
  }, [])

  React.useEffect(() => { loadFilter() }, [loadFilter])

  // 清理轮询
  React.useEffect(() => () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // ── 事件处理 ──

  const handleStartDownload = async () => {
    const urls = extractUrls(urlsText)
    if (urls.length === 0) {
      showToast("error", "未检测到有效的微信公众号文章 URL")
      return
    }
    setDownloading(true)
    setError("")
    try {
      const res = await api.downloadByUrl(urls)
      setTaskId(res.taskId || "")
      showToast("success", res.message || `已启动下载，共 ${urls.length} 篇`)
      // 开始轮询
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const t = await api.downloadStatus(res.taskId)
          setTask(t)
          if (t.status === "completed") {
            showToast("success", `下载完成！成功 ${t.completed || 0} 篇，失败 ${t.failed || 0} 篇`)
            clearInterval(pollRef.current); pollRef.current = null
          } else if (t.status === "failed") {
            showToast("error", "下载任务失败")
            clearInterval(pollRef.current); pollRef.current = null
          } else if (t.status === "cancelled") {
            clearInterval(pollRef.current); pollRef.current = null
          }
        } catch (_err) {
          clearInterval(pollRef.current); pollRef.current = null
        }
      }, 1000)
    } catch (err) {
      setError(err?.message || "启动下载失败")
    } finally {
      setDownloading(false)
    }
  }

  const handleCancelDownload = async () => {
    if (!taskId) return
    try {
      await api.cancelDownload(taskId)
      showToast("info", "已请求停止下载")
    } catch (err) {
      showToast("error", err?.message || "停止失败")
    }
  }

  const handleOpenFolder = async () => {
    try {
      await api.openFolderByLabel("url_download")
      showToast("success", "下载目录已打开")
    } catch (err) {
      showToast("error", err?.message || "打开目录失败")
    }
  }

  const handleClear = () => { setUrlsText("") }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setUrlsText(text)
      showToast("success", "已粘贴剪贴板内容")
    } catch (_err) {
      showToast("error", "无法读取剪贴板，请手动粘贴")
    }
  }

  const handleSaveFilter = async () => {
    setCfLoading(true)
    try {
      await api.saveContentFilter(rules)
      setCfBadge(rules.enabled ? "已开启" : "已关闭")
      showToast("success", "过滤设置已保存，之后下载的文章生效")
    } catch (err) {
      showToast("error", err?.message || "保存失败")
    } finally {
      setCfLoading(false)
    }
  }

  const handleApplyFilter = async () => {
    setCfLoading(true)
    try {
      // 先 dry-run 预览
      const preview = await api.applyContentFilter({ dry_run: true })
      if (!preview.changed) {
        showToast("info", `已扫描 ${preview.scanned || 0} 篇，没有需要改写的文章`)
        return
      }
      const ok = window.confirm(
        `将扫描 ${preview.scanned} 篇，改写 ${preview.changed} 篇（原文会备份为 .html.bak）。确定继续？`
      )
      if (!ok) return
      const r = await api.applyContentFilter({ dry_run: false })
      showToast("success", `已改写 ${r.changed || preview.changed} 篇`)
    } catch (err) {
      showToast("error", err?.message || "应用失败")
    } finally {
      setCfLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 顶栏标题 */}
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-[#6B6B6B]">URL Download</p>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1A1A1A]">网址下载</h1>
        <p className="text-[13px] text-[#6B6B6B]">
          输入微信公众号文章 URL，直接下载文章内容（含图片和视频）
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-serif text-base font-semibold">下载启动失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 卡 1 - URL 输入 */}
      <Card className="rounded-md border border-[#1A1A1A]/10 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="font-serif text-base font-bold text-[#1A1A1A] flex items-center gap-2">
            <Download className="h-4 w-4 text-[#12372e]" /> 🔗 输入文章网址
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-5">
          <label className="mb-1 block text-[12px] font-medium text-[#1A1A1A]">
            文章 URL（每行一个，支持批量下载）
          </label>
          <textarea
            rows={6}
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder="https://mp.weixin.qq.com/s/xxxxxx&#10;https://mp.weixin.qq.com/s/yyyyyy&#10;&#10;每行输入一个微信文章链接..."
            className="w-full rounded-md border border-[#1A1A1A]/15 bg-white px-3 py-2 text-[13px] text-[#1A1A1A] placeholder:text-[#6B6B6B]/50 focus:border-[#12372e] focus:outline-none resize-y"
          />
          <div className="mt-1 text-[11px] text-[#6B6B6B]">
            支持 mp.weixin.qq.com 格式的文章链接，每行一个
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="default" size="sm"
              onClick={handleStartDownload}
              disabled={downloading || !urlsText.trim()}
              className="gap-1.5 rounded-md bg-[#12372e] text-white font-semibold hover:bg-[#12372e]/90 active:scale-95"
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              📥 开始下载
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={handleClear}
              disabled={downloading}
              className="gap-1.5 rounded-md text-[13px] active:scale-95"
            >
              <Trash2 className="h-3.5 w-3.5" /> 清空
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={handlePaste}
              disabled={downloading}
              className="gap-1.5 rounded-md text-[13px] active:scale-95"
            >
              <Clipboard className="h-3.5 w-3.5" /> 📋 粘贴
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 卡 2 - 内容过滤 */}
      <ContentFilterCard
        rules={rules}
        setRules={setRules}
        badgeText={cfBadge}
        loading={cfLoading}
      />
      <div className="flex gap-2 -mt-4">
        <Button
          variant="default" size="sm"
          onClick={handleSaveFilter}
          disabled={cfLoading}
          className="gap-1.5 rounded-md bg-[#12372e] text-white font-semibold hover:bg-[#12372e]/90 active:scale-95"
        >
          {cfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存过滤设置
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={handleApplyFilter}
          disabled={cfLoading}
          className="gap-1.5 rounded-md text-[13px] active:scale-95"
        >
          <Wrench className="h-3.5 w-3.5" /> 应用到已下载文章
        </Button>
      </div>

      {/* 下载进度面板（有 task 时显示） */}
      {(task || downloading) && (
        <DownloadProgress
          task={task || { status: "running", total: 0, completed: 0, failed: 0, current: "初始化中..." }}
          onCancel={handleCancelDownload}
          onOpenFolder={handleOpenFolder}
        />
      )}

      {/* 底部提示 */}
      {onNavigate && (
        <p className="text-[12px] text-[#6B6B6B]">
          下载完成后可在 <button type="button" onClick={() => onNavigate("history")} className="font-medium text-[#12372e] hover:underline">下载历史</button> 中查看文件列表。
        </p>
      )}

      {/* Toast */}
      {toast.text && (
        <div
          className="fixed bottom-6 left-1/2 z-[10000] -translate-x-1/2 rounded-md px-5 py-2.5 text-sm font-medium text-white shadow-lg"
          style={{
            background: toast.type === "error" ? "#7d2f26" :
              toast.type === "info" ? "#1A1A1A" :
              toast.type === "success" ? "#12372e" : "#C87137",
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

DownloadPage.propTypes = {
  onNavigate: PropTypes.func,
}
