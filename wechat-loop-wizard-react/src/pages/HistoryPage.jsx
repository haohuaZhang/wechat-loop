import * as React from "react"
import PropTypes from "prop-types"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/EmptyState"
import { proxiedImage } from "@/lib/media"
import { Badge } from "@/components/ui/badge"
import {
  FolderOpen,
  Radio,
  Trash2,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  FileWarning,
  Copy,
  Check,
  RefreshCw,
  Bug,
} from "lucide-react"

/**
 * HistoryPage —— 下载历史（双栏布局 + iframe 预览）
 * 完整对齐原版 wechat-mp-tools/frontend/js/components/history.js 的核心体验
 *
 * 左栏（固定 380px）：公众号筛选、按日期分组的文章列表
 * 右栏（flex-1）：操作条 + iframe HTML 预览
 *   - 成功的文章 → 加载 `/api/articles/serve-file/<dir>/<file>.html?path=...`
 *   - 失败的文章 → 显示错误信息
 *   - iframe 内注入样式（max-width 100%、padding、图片灯箱、视频点击播放、a 新标签打开）
 * 顶部操作：打开下载目录、RSS 订阅、清空历史
 */

// ─────────────────── 工具函数 ───────────────────

/**
 * 从路径中提取相对目录（原版 buildArticleServeUrl 的核心）
 * @param {string} rawPath 绝对路径
 * @param {string} account 公众号名称（兜底）
 * @returns {string} 相对于下载根目录的路径（不含末尾 .html 文件名）
 */
function extractRelativeDir(rawPath, account) {
  const norm = String(rawPath || "").replace(/\\/g, "/")
  const marker = "/articles_full/"
  const idx = norm.lastIndexOf(marker)
  if (idx >= 0) {
    return norm.slice(idx + marker.length)
  }
  if (norm) {
    const parts = norm.split("/").filter(Boolean)
    if (parts.length >= 2) return parts.slice(-2).join("/")
    if (parts.length === 1) return [account || "", parts[0]].filter(Boolean).join("/")
  }
  return ""
}

/**
 * UTF-8 字符串 → base64url（纯 ASCII）
 * @param {string} str
 * @returns {string}
 */
function utf8ToB64Url(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ""
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * 拼接正文 URL
 *
 * 注意：URL 里绝不能出现中文（即使百分号编码）。实测浏览器对 path/query
 * 中编码后的中文一律 400，而 curl 直连是 200。公众号下载目录基本都带
 * 中文名，所以把绝对路径整体 base64url，交给 bridge 的 /api/article-html。
 * @param {{ path?: string, account?: string }} item
 * @returns {string}
 */
function buildArticleServeUrl(item) {
  const title = item?.title || "article"
  const relDir = extractRelativeDir(item?.path || "", item?.account || "")
  const parts = (relDir || title).split("/").filter(Boolean)
  const target = item?.path || parts.join("/")
  return `/api/article-html?p=${utf8ToB64Url(target)}`
}

/**
 * 给正文 HTML 补上 charset 与 base，保证 srcDoc 渲染时资源可解析
 * 下载下来的公众号正文图片都是远端绝对地址，base 取站点根即可
 * @param {string} html
 * @returns {string}
 */
function withBaseHref(html) {
  const head = '<meta charset="utf-8"><base href="/">'
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + head)
  }
  return `<!DOCTYPE html><html><head>${head}</head><body>${html}</body></html>`
}

const WEIXIN_IMG_HOST_SUFFIX = ["qpic.cn", "qlogo.cn", "gtimg.com", "wx.qq.com"]

/**
 * 图片诊断面板 —— 把后端 inspect 的结果翻译成人话
 * @param {{diag: object, onClose: () => void}} props
 */
function DiagPanel({ diag, onClose }) {
  if (diag?.loading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">正在检查正文里的图片…</div>
  }
  if (diag?.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          诊断失败：{diag.error}
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
      </div>
    )
  }

  const d = diag?.data || {}
  const hosts = d.img_hosts || {}
  const otherHosts = Object.keys(hosts).filter(
    (h) => h !== "<相对路径>" && !WEIXIN_IMG_HOST_SUFFIX.some((s) => h.endsWith(s)),
  )
  const verdicts = []
  if (d.img_tags === 0) {
    verdicts.push(["error", "正文里没有任何 img 标签：图片在下载环节就没保存下来，不是代理问题。"])
  }
  if (d.img_urls_relative > 0) {
    verdicts.push(["warn", `有 ${d.img_urls_relative} 张是相对路径图片：需要后端重启到最新版才支持。`])
  }
  if (otherHosts.length) {
    verdicts.push(["warn", `以下域名不在代理白名单，需加白：${otherHosts.join("、")}`])
  }
  if (!verdicts.length) {
    verdicts.push(["ok", "图片地址都在白名单内。若仍有空白，多半是原图本身失效（微信侧已删）。"])
  }

  const tone = { error: "border-destructive/40 bg-destructive/5 text-destructive", warn: "border-amber-400/50 bg-amber-50 text-amber-800", ok: "border-emerald-400/50 bg-emerald-50 text-emerald-800" }

  return (
    <div className="flex-1 overflow-auto bg-surface p-4">
      <div className="space-y-2">
        {verdicts.map(([level, text]) => (
          <div key={text} className={cn("rounded-md border px-3 py-2 text-sm", tone[level])}>{text}</div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["img 标签", d.img_tags],
          ["远端地址", d.img_urls_remote],
          ["相对路径", d.img_urls_relative],
          ["文件大小", `${d.bytes || 0} B`],
        ].map(([k, v]) => (
          <div key={k} className="rounded border border-border bg-background px-2 py-1.5">
            <div className="text-muted-foreground">{k}</div>
            <div className="font-mono text-sm">{String(v)}</div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-1 text-xs font-medium text-muted-foreground">图片域名分布</div>
        <pre className="max-h-40 overflow-auto rounded border border-border bg-background p-2 font-mono text-[11px]">
{JSON.stringify(hosts, null, 2)}
        </pre>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>返回正文</Button>
      </div>
    </div>
  )
}

DiagPanel.propTypes = {
  diag: PropTypes.object,
  onClose: PropTypes.func.isRequired,
}

function getLocalDateString(unixTs) {
  if (!unixTs) return ""
  const d = new Date(unixTs * 1000)
  const today = new Date()
  const y = (a, b, c) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (y(d, today)) return "今天"
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (y(d, yesterday)) return "昨天"
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function getRelativeTimeString(unixTs) {
  const diff = Math.floor(Date.now() / 1000) - (unixTs || 0)
  if (diff < 60) return "刚刚"
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  const d = new Date(unixTs * 1000)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// ─────────────────── iframe 样式注入脚本 ───────────────────
// 原版 history.js 里 onIframeLoad 的核心逻辑，封装成可在 iframe 内执行的脚本字符串
const IFRAME_INJECT_SCRIPT = `
;(function() {
  try {
    var doc = document
    // 注入样式
    var style = doc.createElement('style')
    style.textContent = \`
      html, body {
        max-width: 100% !important;
        overflow-x: hidden !important;
        box-sizing: border-box !important;
        height: auto !important;
        overflow-y: auto !important;
      }
      body {
        padding: 24px !important;
        margin: 0 auto !important;
        background-color: #ffffff !important;
        color: #222222 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif !important;
      }
      #js_article, #page-content, .rich_media_area_primary, .rich_media_content, #js_content {
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 0 !important;
        margin: 0 auto !important;
        visibility: visible !important;
      }
      img {
        cursor: zoom-in;
        max-width: 100% !important;
        height: auto !important;
        display: block;
        margin: 12px auto;
      }
      img:hover { opacity: 0.92; }
      video {
        cursor: pointer;
        max-width: 100% !important;
        height: auto !important;
        display: block;
        margin: 12px auto;
      }
      .lightbox-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(10, 10, 20, 0.95);
        display: flex; align-items: center; justify-content: center;
        z-index: 999999; cursor: zoom-out; opacity: 0;
        transition: opacity 0.2s ease;
      }
      .lightbox-overlay.active { opacity: 1; }
      .lightbox-img {
        max-width: 95%; max-height: 95%; object-fit: contain;
        border-radius: 6px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.85);
        transform: scale(0.95);
        transition: transform 0.25s cubic-bezier(0.1, 0.8, 0.25, 1);
      }
      .lightbox-overlay.active .lightbox-img { transform: scale(1); }
    \`
    doc.head.appendChild(style)

    // 兜底：把懒加载图（data-src）真的加载出来，并清掉 opacity:0 的隐藏样式
    try {
      doc.querySelectorAll('img').forEach(function(img) {
        var ds = img.getAttribute('data-src')
        if (ds && img.getAttribute('src') !== ds) img.setAttribute('src', ds)
        if (!img.getAttribute('src')) img.style.display = 'none'
        img.style.opacity = '1'
        img.style.visibility = 'visible'
      })
    } catch (e) {}

    // 图片灯箱
    doc.body.addEventListener('click', function(e) {
      var target = e.target
      if (target.tagName === 'IMG' && !target.classList.contains('lightbox-img')) {
        e.preventDefault(); e.stopPropagation()
        var overlay = doc.createElement('div')
        overlay.className = 'lightbox-overlay'
        overlay.innerHTML = '<img class="lightbox-img" src="' + target.src + '">'
        doc.body.style.overflow = 'hidden'
        doc.body.appendChild(overlay)
        setTimeout(function() { overlay.classList.add('active') }, 20)
        overlay.addEventListener('click', function() {
          overlay.classList.remove('active')
          doc.body.style.overflow = ''
          setTimeout(function() { overlay.remove() }, 200)
        })
      }
    })

    // 视频点击播放/暂停
    doc.body.addEventListener('click', function(e) {
      var target = e.target
      if (target.tagName === 'VIDEO') {
        var rect = target.getBoundingClientRect()
        var clickY = e.clientY - rect.top
        if (rect.height - clickY < 50) return
        e.preventDefault(); e.stopPropagation()
        if (target.paused) target.play().catch(function(){})
        else target.pause()
      }
    })

    // 链接新标签打开
    doc.body.addEventListener('click', function(e) {
      var a = e.target.closest('a')
      if (a) {
        var href = a.getAttribute('href')
        if (href && (href.startsWith('http') || href.startsWith('//'))) {
          e.preventDefault(); e.stopPropagation()
          if (window.parent && window.parent !== window) {
            window.parent.open(a.href, '_blank')
          } else {
            window.open(a.href, '_blank')
          }
        }
      }
    }, true)
  } catch (err) {
    console.error('iframe inject failed:', err)
  }
})()
`

// ─────────────────── 确认弹窗（双重 Modal） ───────────────────

/**
 * 简单的二次确认（两级）
 * @param {{ title: string, message: string, confirmText?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
async function doubleConfirm(opts) {
  const ok1 = window.confirm(`${opts.title}\n\n${opts.message}`)
  if (!ok1) return false
  return window.confirm("此操作不可恢复！确定要继续吗？")
}

// ─────────────────── 主页面 ───────────────────

export function HistoryPage() {
  // 原始数据
  const [items, setItems] = React.useState([])
  const [uniqueAccounts, setUniqueAccounts] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")

  // 左栏筛选
  const [filterAccount, setFilterAccount] = React.useState("")

  // 选中文章
  const [activeIdx, setActiveIdx] = React.useState(-1)

  // 正文 HTML（用 fetch 取回后经 srcDoc 渲染，避免 iframe 文档请求被 dev 代理拦截）
  const [frameHtml, setFrameHtml] = React.useState("")
  const [frameErr, setFrameErr] = React.useState("")
  const [diag, setDiag] = React.useState(null)

  // RSS 模态
  const [rssOpen, setRssOpen] = React.useState(false)
  const [settings, setSettings] = React.useState({})
  const [copiedKey, setCopiedKey] = React.useState("")

  // Toast
  const [toast, setToast] = React.useState("")

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 2400)
    return () => clearTimeout(t)
  }, [toast])

  React.useEffect(() => {
    if (!rssOpen) return
    api.fetchSettings().then(setSettings).catch(() => {})
  }, [rssOpen])

  async function refresh() {
    setLoading(true); setError("")
    try {
      const res = await api.listHistory()
      const raw = res?.items || []
      // 对齐原版过滤：成功+有路径，或永久失败（删除/屏蔽/过期）
      const filtered = raw.filter((it) =>
        (it.success && it.path) ||
        (!it.success && it.error && (it.error.includes("删除") || it.error.includes("屏蔽") || it.error.includes("过期")))
      )
      // 按时间降序
      filtered.sort((a, b) => {
        const ta = a.publishAt || a.time || 0
        const tb = b.publishAt || b.time || 0
        return tb - ta
      })
      setItems(filtered)
      const set = new Set()
      filtered.forEach((it) => it.account && set.add(it.account))
      setUniqueAccounts(Array.from(set))
      // 重置选中
      setActiveIdx(filtered.length > 0 ? 0 : -1)
    } catch (err) {
      setError(err?.message || "读取下载历史失败")
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { refresh() }, [])

  const filteredItems = React.useMemo(() => {
    if (!filterAccount) return items
    return items.filter((it) => it.account === filterAccount)
  }, [items, filterAccount])

  // 按日期分组
  const dateGroups = React.useMemo(() => {
    const groups = {}
    filteredItems.forEach((it) => {
      const ts = it.publishAt || it.time || 0
      const label = getLocalDateString(ts) || "未知日期"
      if (!groups[label]) groups[label] = []
      groups[label].push(it)
    })
    return Object.entries(groups)
  }, [filteredItems])

  const activeItem = activeIdx >= 0 && activeIdx < filteredItems.length
    ? filteredItems[activeIdx]
    : null

  // 拉取正文 HTML → srcDoc
  React.useEffect(() => {
    let cancelled = false
    setFrameHtml("")
    setFrameErr("")
    setDiag(null)
    if (!activeItem || !activeItem.success) return
    const url = buildArticleServeUrl(activeItem)
    fetch(url, { headers: { Accept: "text/html" } })
      .then(async (res) => {
        const text = await res.text()
        if (cancelled) return
        if (!res.ok) {
          setFrameErr(`加载正文失败（HTTP ${res.status}）`)
          return
        }
        setFrameHtml(withBaseHref(text))
      })
      .catch((err) => {
        if (!cancelled) setFrameErr(`加载正文失败：${err.message}`)
      })
    return () => { cancelled = true }
  }, [activeItem, activeIdx])

  // ── 操作 ──

  async function handleDiagnose(item) {
    setDiag({ loading: true })
    try {
      const res = await fetch(`${buildArticleServeUrl(item)}&inspect=1`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setDiag({ data })
    } catch (err) {
      setDiag({ error: err?.message || "未知错误" })
    }
  }

  async function handleDeleteOne(item) {
    const ok = await doubleConfirm({
      title: "删除下载",
      message: `确定要删除《${item.title || ""}》的下载文件和历史记录吗？`,
    })
    if (!ok) return
    try {
      const res = await api.deleteHistory(item._index)
      setToast(res?.message || "已删除")
      await refresh()
    } catch (err) {
      setToast(`删除失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleClearAll() {
    const ok = await doubleConfirm({
      title: "清空历史",
      message: "确定要清空所有公众号下载历史记录吗？",
    })
    if (!ok) return
    try {
      await api.clearHistoryPosts()
      setToast("历史已清空")
      await refresh()
    } catch (err) {
      // 回退 deleteHistory
      try {
        await api.deleteHistory()
        setToast("历史已清空")
        await refresh()
      } catch (err2) {
        setToast(`清空失败：${err2?.message || "未知错误"}`)
      }
    }
  }

  async function handleOpenFile(item, targetType) {
    if (!item.path) { setToast("无效路径"); return }
    try {
      const res = await api.openFile(item.path, targetType)
      if (res?.url) {
        window.open(res.url, "_blank", "noopener")
        setToast("已在新标签页打开")
      } else {
        setToast(targetType ? `正在打开 ${targetType.toUpperCase()}...` : "正在打开...")
      }
    } catch (err) {
      setToast(`打开失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleOpenParent(item) {
    if (!item.path) { setToast("无效路径"); return }
    try {
      await api.openParent(item.path)
      setToast("已打开所在文件夹")
    } catch (err) {
      setToast(`打开失败：${err?.message || "未知错误"}`)
    }
  }

  async function handleOpenRootFolder() {
    try {
      await api.openFolder("")
      setToast("已打开下载目录")
    } catch (err) {
      setToast(`打开失败：${err?.message || "未知错误"}`)
    }
  }

  // ── RSS URL 拼接 ──

  const rssBaseOrigin = React.useMemo(() => {
    const token = settings.rssBaseUrl || ""
    if (!token) return window.location.origin
    let base = String(token).replace(/\/+$/, "")
    if (base && !/^https?:\/\//i.test(base)) base = "https://" + base
    return base
  }, [settings])
  const rssToken = settings.rssToken || settings.rss_token || ""

  const globalRssUrl = React.useMemo(() => {
    const q = rssToken ? `?token=${encodeURIComponent(rssToken)}` : ""
    return `${rssBaseOrigin}/api/articles/rss${q}`
  }, [rssBaseOrigin, rssToken])

  function accountRssUrl(account) {
    const q = rssToken ? `?token=${encodeURIComponent(rssToken)}` : ""
    return `${rssBaseOrigin}/api/articles/rss/${encodeURIComponent(account)}${q}`
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setToast("订阅链接已复制")
      setTimeout(() => setCopiedKey(""), 1800)
    } catch {
      setToast("复制失败，请手动选择复制")
    }
  }

  // ── iframe ref + 注入脚本 ──
  const iframeRef = React.useRef(null)
  const injectTimerRef = React.useRef(null)

  React.useEffect(() => {
    if (!activeItem || !activeItem.success) return
    const iframe = iframeRef.current
    if (!iframe) return

    // 每次 iframe src 改变后注入脚本
    const handler = () => {
      if (injectTimerRef.current) clearTimeout(injectTimerRef.current)
      injectTimerRef.current = setTimeout(() => {
        try {
          const win = iframe.contentWindow
          if (!win) return
          const doc = iframe.contentDocument || win.document
          if (!doc) return
          if (typeof doc.defaultView !== "undefined" && doc.defaultView !== win) return
          // 检查是否已经注入过
          if (doc.getElementById("__wx_loop_injected")) return
          const marker = doc.createElement("script")
          marker.id = "__wx_loop_injected"
          marker.textContent = IFRAME_INJECT_SCRIPT
          doc.head.appendChild(marker)
        } catch (err) {
          // 跨域或未加载完成，静默
        }
      }, 120)
    }
    iframe.addEventListener("load", handler)
    // 如果已经加载过，立即尝试注入
    if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") handler()
    return () => {
      iframe.removeEventListener("load", handler)
      if (injectTimerRef.current) clearTimeout(injectTimerRef.current)
    }
  }, [activeItem, activeIdx])

  // ── 渲染 ──

  return (
    <div className="flex flex-col gap-4">
      {/* 页头 */}
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 04</p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">下载历史</h1>
            <p className="text-sm leading-7 text-muted-foreground">
              查看已下载的文章记录，并提供 RSS 订阅服务
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleOpenRootFolder} className="gap-2">
              <FolderOpen className="h-3.5 w-3.5" /> 打开下载目录
            </Button>
            <Button type="button" variant="default" size="sm" onClick={() => setRssOpen(true)} className="gap-2">
              <Radio className="h-3.5 w-3.5" /> RSS 订阅
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleClearAll}
              disabled={items.length === 0}
              className="gap-2"
            >
              <Trash2 className="h-3.5 w-3.5" /> 清空历史
            </Button>
          </div>
        </div>
      </header>

      {/* 错误态 */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center gap-2">
            {error}
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="h-3 w-3" /> 重试
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 加载骨架 */}
      {loading && !error && (
        <div className="flex h-[calc(100vh-260px)] gap-0 overflow-hidden rounded-md border border-border bg-surface">
          <div className="w-[380px] shrink-0 border-r border-border bg-card p-4">
            <div className="space-y-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-3 rounded-md border border-border bg-surface/60 p-3">
                  <Skeleton className="h-[70px] w-[70px] rounded-sm" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 p-6">
            <div className="mb-3 h-10 rounded-sm border border-border bg-card" />
            <Skeleton className="h-1/2 w-full rounded-sm" />
          </div>
        </div>
      )}

      {/* 空态 */}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={FileWarning}
          title="还没有下载过文章"
          description="到文章浏览 Tab 或采集向导跑一次吧，下载完成后这里会自动记录。"
        />
      )}

      {/* 双栏主体 */}
      {!loading && !error && items.length > 0 && (
        <div
          className="flex overflow-hidden rounded-md border border-border bg-surface"
          style={{ height: "calc(100vh - 220px)" }}
        >
          {/* 左栏 */}
          <aside className="flex w-[380px] min-w-[380px] max-w-[380px] flex-col border-r border-border bg-card">
            {/* 左栏头部 */}
            <div className="flex flex-col gap-2 border-b border-border p-4">
              <div className="flex items-center justify-between">
                <span className="font-serif text-base font-semibold">文章列表</span>
                <Badge variant="outline" className="rounded-sm text-[11px]">
                  共 {filteredItems.length} 篇
                </Badge>
              </div>
              <select
                value={filterAccount}
                onChange={(e) => { setFilterAccount(e.target.value); setActiveIdx(-1) }}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">全部公众号</option>
                {uniqueAccounts.map((acc) => {
                  const count = items.filter((it) => it.account === acc).length
                  return (
                    <option key={acc} value={acc}>
                      {acc}（{count}）
                    </option>
                  )
                })}
              </select>
            </div>

            {/* 列表区 */}
            <div className="flex-1 overflow-y-auto p-3">
              {dateGroups.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">暂无匹配记录</div>
              )}
              {dateGroups.map(([label, groupItems]) => (
                <div key={label} className="mb-3">
                  <div className="mb-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary border-b border-dashed border-border">
                    {label}
                  </div>
                  <div className="flex flex-col gap-2">
                    {groupItems.map((it, idxInGroup) => {
                      const globalIdx = filteredItems.indexOf(it)
                      const active = globalIdx === activeIdx
                      const coverSrc = it.cover_url || it.cover || ""
                      return (
                        <div
                          key={`${it._index}-${it.title}-${globalIdx}`}
                          onClick={() => setActiveIdx(globalIdx)}
                          className={cn(
                            "flex cursor-pointer gap-3 rounded-md border p-3 transition-colors",
                            active
                              ? "border-primary bg-primary/5 shadow-[0_0_12px_rgba(200,113,55,0.15)]"
                              : "border-border bg-surface/60 hover:bg-secondary hover:border-primary/40"
                          )}
                        >
                          <div className="flex min-w-0 flex-1 flex-col justify-between">
                            <div
                              className={cn(
                                "line-clamp-2 text-sm font-medium leading-tight",
                                active && "text-primary"
                              )}
                              title={it.title}
                            >
                              {it.title || "无标题"}
                              {!it.success && it.error && (
                                <span className="ml-1 inline-block rounded-sm border border-[#A94438]/40 bg-[#A94438]/[0.08] px-1 text-[10px] text-[#7d2f26] align-middle">
                                  <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5" />失败
                                </span>
                              )}
                            </div>
                            {it.digest && (
                              <div className="line-clamp-2 text-[11px] text-muted-foreground mt-1">
                                {it.digest}
                              </div>
                            )}
                            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="truncate" title={it.account}>
                                @{it.account || "未知"}
                              </span>
                              <span className="ml-2 shrink-0">
                                {getRelativeTimeString(it.publishAt || it.time)}
                              </span>
                            </div>
                          </div>
                          {coverSrc && (
                            <img
                              src={proxiedImage(coverSrc)}
                              alt=""
                              loading="lazy"
                              onError={(e) => { e.currentTarget.style.display = "none" }}
                              className="h-[70px] w-[70px] flex-shrink-0 rounded-sm object-cover border border-border"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* 右栏 */}
          <section className="flex min-w-0 flex-1 flex-col bg-white">
            {!activeItem ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <FileText className="h-12 w-12 opacity-50" />
                <p className="text-sm">请在左侧选择一篇文章进行阅读</p>
              </div>
            ) : !activeItem.success ? (
              // 失败文章：显示错误
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" title={activeItem.title}>{activeItem.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground" title={activeItem.link}>{activeItem.link}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {activeItem.link && (
                      <Button type="button" variant="outline" size="sm" onClick={() => window.open(activeItem.link, "_blank")} className="gap-1">
                        <ExternalLink className="h-3 w-3" /> 原文
                      </Button>
                    )}
                    <Button type="button" variant="destructive" size="sm" onClick={() => handleDeleteOne(activeItem)} className="gap-1">
                      <Trash2 className="h-3 w-3" /> 删除
                    </Button>
                  </div>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center text-[#7d2f26]">
                  <AlertTriangle className="h-16 w-16 opacity-80" />
                  <p className="text-base font-semibold">{activeItem.error || "下载失败"}</p>
                  <p className="text-xs text-muted-foreground">该微信文章目前已不可用，详情如上提示。</p>
                </div>
              </div>
            ) : (
              // 成功文章：iframe 预览
              <div className="flex h-full flex-col">
                {/* 右栏头部 */}
                <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="truncate text-sm font-semibold" title={activeItem.title}>{activeItem.title}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground" title={activeItem.displayPath || activeItem.path}>
                      {activeItem.displayPath || activeItem.path}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {activeItem.link && (
                      <Button type="button" variant="outline" size="sm" onClick={() => window.open(activeItem.link, "_blank")} className="gap-1">
                        <ExternalLink className="h-3 w-3" /> 原文链接
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => handleOpenFile(activeItem, "md")} className="gap-1">
                      📝 MD
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleOpenFile(activeItem, "pdf")} className="gap-1">
                      <FileSpreadsheet className="h-3 w-3" /> PDF
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleDiagnose(activeItem)} className="gap-1">
                      <Bug className="h-3 w-3" /> 图片诊断
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleOpenParent(activeItem)} className="gap-1">
                      <FolderOpen className="h-3 w-3" /> 文件夹
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => handleDeleteOne(activeItem)} className="gap-1">
                      <Trash2 className="h-3 w-3" /> 删除
                    </Button>
                  </div>
                </div>

                {/* iframe（srcDoc 渲染） */}
                {diag ? (
                  <DiagPanel diag={diag} onClose={() => setDiag(null)} />
                ) : frameErr ? (
                  <div className="flex flex-1 items-center justify-center bg-surface">
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      {frameErr}
                    </div>
                  </div>
                ) : (
                  <iframe
                    ref={iframeRef}
                    key={activeIdx + "-" + (activeItem.path || "")}
                    srcDoc={frameHtml}
                    className="h-0 w-full flex-1 border-0 bg-white"
                    title={activeItem.title || "文章正文"}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* RSS 模态（原生 dialog） */}
      {rssOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setRssOpen(false)}
        >
          <div
            className="relative w-full max-w-xl rounded-md border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-serif text-lg font-semibold">📺 RSS 订阅服务</h3>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              您可以将离线下载的文章转换为标准的 RSS 2.0 订阅。直接在阅读器（如 Follow、NetNewsWire、Reeder、TTRSS 等）中添加以下链接，即可实时同步离线文章：
            </p>

            {/* 全局源 */}
            <div className="mt-4 rounded-md border border-border bg-surface p-3">
              <div className="text-xs font-semibold text-primary">全局合并源（全部已下载的文章）</div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={globalRssUrl}
                  className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(globalRssUrl, "global")}
                  className="gap-1"
                >
                  {copiedKey === "global" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  复制
                </Button>
              </div>
            </div>

            {/* 按公众号分源 */}
            {uniqueAccounts.length > 0 && (
              <>
                <div className="mt-4 text-xs font-semibold text-muted-foreground">按公众号分源订阅：</div>
                <div className="mt-2 max-h-[240px] space-y-2 overflow-y-auto pr-1">
                  {uniqueAccounts.map((acc) => {
                    const url = accountRssUrl(acc)
                    const key = `acc-${acc}`
                    return (
                      <div key={acc} className="rounded-md border border-border bg-surface p-2">
                        <div className="text-xs font-semibold">{acc}</div>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            readOnly
                            value={url}
                            className="h-7 flex-1 rounded-sm border border-border bg-background px-2 text-[11px]"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyText(url, key)}
                            className="h-7 gap-1 text-[11px]"
                          >
                            {copiedKey === key ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            复制
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <div className="mt-5 flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setRssOpen(false)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-xs shadow-lg",
            toast.includes("失败")
              ? "border-[#A94438]/40 bg-[#A94438]/[0.06] text-[#7d2f26]"
              : "border-[#4F7A5A]/40 bg-[#4F7A5A]/[0.08] text-[#385742]"
          )}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

HistoryPage.propTypes = {
  onNavigate: PropTypes.func,
}

export default HistoryPage
