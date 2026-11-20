import * as React from "react"
import PropTypes from "prop-types"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/** 设计 token（对齐 prototype/kb-workspace.html） */
export const TOKENS = {
  bg: "bg-[#FAFAF9]",
  panel: "bg-white",
  line: "border-[#E7E7E4]",
  muted: "text-[#6B6B6B]",
  faint: "text-[#8E8E89]",
  accent: "text-[#4F5BD5]",
  accentBg: "bg-[#EEF0FB]",
  hover: "hover:bg-[#F5F5F3]",
}

export const STATUS_META = {
  unused: {
    label: "未用",
    dot: "bg-[#C9C9C4]",
    pill: "border-[#E7E7E4] bg-[#FCFCFB] text-[#6B6B6B]",
    btn: "border-[#E7E7E4] bg-white text-[#6B6B6B]",
  },
  cited: {
    label: "已引用",
    dot: "bg-[#4F5BD5]",
    pill: "border-[#DDE0F7] bg-[#EEF0FB] text-[#4F5BD5]",
    btn: "border-[#DDE0F7] bg-[#EEF0FB] text-[#4F5BD5]",
  },
  drafted: {
    label: "已成稿",
    dot: "bg-[#2F855A]",
    pill: "border-[#CDE5D8] bg-[#F2F8F4] text-[#2F855A]",
    btn: "border-[#CDE5D8] bg-[#F2F8F4] text-[#2F855A]",
  },
}

export const STATUS_ORDER = ["unused", "cited", "drafted"]

export function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase()
  if (s === "cited" || s === "已引用" || s === "used") return "cited"
  if (s === "drafted" || s === "已成稿" || s === "draft") return "drafted"
  if (s === "未用" || s === "未使用" || s === "unused") return "unused"
  return "unused"
}

export function normalizeItem(raw = {}) {
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : Array.isArray(raw.topics)
      ? raw.topics
      : []
  const collections = Array.isArray(raw.collections)
    ? raw.collections
    : raw.collection
      ? [raw.collection]
      : []
  return {
    id: String(raw.id ?? raw.article_id ?? raw.link ?? ""),
    title: raw.title || "未命名文章",
    account: raw.account || raw.accountName || "",
    date: String(raw.publishDate || raw.publish_date || raw.date || ""),
    tags: tags.filter(Boolean),
    status: normalizeStatus(raw.status),
    collections: collections.filter(Boolean),
    words: Number(raw.wordCount ?? raw.words ?? raw.word_count ?? 0) || 0,
    snippet: String(raw.snippet || raw.digest || "").replace(/<[^>]*>/g, ""),
    quality: raw.quality,
    url: raw.url || raw.link || "",
  }
}

export function normalizeDetail(raw = {}) {
  const base = normalizeItem(raw)
  return {
    ...base,
    content: raw.content || "",
    url: raw.url || raw.link || "",
    usedAsSource: Boolean(raw.usedAsSource || raw.used_as_source),
    duplicateOf: raw.duplicateOf || raw.duplicate_of || null,
    related: (raw.related || []).map((r) => (
      typeof r === "string"
        ? { id: String(r), title: "", reason: "" }
        : { id: String(r.id ?? ""), title: r.title || "", reason: r.reason || "" }
    )).filter((r) => r.id),
  }
}

export function fmtDate(value) {
  const s = String(value || "")
  if (!s) return "—"
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[2]}-${m[3]}` : s
}

export function fmtWords(n) {
  const v = Number(n) || 0
  if (!v) return "—"
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}

export function ratePercent(value) {
  const n = Number(value) || 0
  const pct = n <= 1 ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** 关键词高亮（支持多处命中） */
export function Highlight({ text, keyword, className }) {
  const raw = String(text || "")
  const kw = String(keyword || "").trim()
  if (!kw) return <span className={className}>{raw}</span>
  const lower = raw.toLowerCase()
  const target = kw.toLowerCase()
  const parts = []
  let cursor = 0
  let idx = lower.indexOf(target)
  while (idx >= 0) {
    if (idx > cursor) parts.push(raw.slice(cursor, idx))
    parts.push(
      <mark key={`${idx}-${parts.length}`} className="rounded-[2px] bg-[#FFF1B8] px-px text-inherit">
        {raw.slice(idx, idx + kw.length)}
      </mark>,
    )
    cursor = idx + kw.length
    idx = lower.indexOf(target, cursor)
  }
  if (cursor < raw.length) parts.push(raw.slice(cursor))
  return <span className={className}>{parts}</span>
}

Highlight.propTypes = {
  text: PropTypes.string,
  keyword: PropTypes.string,
  className: PropTypes.string,
}

export function StatusPill({ status, className }) {
  const meta = STATUS_META[status] || STATUS_META.unused
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[3px] border px-1.5 text-[11px] leading-[17px]", meta.pill, className)}>
      <span className={cn("h-[6px] w-[6px] rounded-full", meta.dot)} />
      {meta.label}
    </span>
  )
}

StatusPill.propTypes = { status: PropTypes.string, className: PropTypes.string }

export function TagPill({ tag, onRemove, onClick, className }) {
  const Comp = onClick ? "button" : "span"
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex max-w-[140px] items-center gap-1 rounded-[3px] border border-[#ECECE9] bg-[#F4F4F2] px-1.5 text-[11px] leading-5 text-[#55554F]",
        onClick && "hover:border-[#DDE0F7] hover:bg-[#EEF0FB] hover:text-[#4F5BD5]",
        className,
      )}
      title={tag}
    >
      <span className="truncate">{tag}</span>
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`移除标签 ${tag}`}
          className="rounded-[2px] p-px hover:bg-[#E4E7FA]"
          onClick={(e) => { e.stopPropagation(); onRemove(tag) }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onRemove(tag) } }}
        >
          <X className="h-2.5 w-2.5" />
        </span>
      )}
    </Comp>
  )
}

TagPill.propTypes = {
  tag: PropTypes.string.isRequired,
  onRemove: PropTypes.func,
  onClick: PropTypes.func,
  className: PropTypes.string,
}

/** 轻量 toast 容器 */
export function ToastStack({ items }) {
  if (!items.length) return null
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[200] flex max-w-[92vw] -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-[min(560px,90vw)] items-center gap-3 rounded-md bg-[#1F1F1D] px-3.5 py-2 text-[12.5px] leading-5 text-white shadow-[0_6px_18px_rgba(0,0,0,0.15)]"
          role="status"
        >
          <span className="min-w-0">{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

ToastStack.propTypes = {
  items: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.number, msg: PropTypes.string })).isRequired,
}

/** 通用遮罩弹窗 */
export function Overlay({ children, onClose, width = "max-w-[440px]", label }) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#1A1A1A]/30 p-5"
      onClick={() => onClose && onClose()}
      role="presentation"
    >
      <div
        className={cn("w-full rounded-[10px] bg-white p-5 shadow-[0_16px_40px_rgba(0,0,0,0.16)]", width)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  )
}

Overlay.propTypes = {
  children: PropTypes.node.isRequired,
  onClose: PropTypes.func,
  width: PropTypes.string,
  label: PropTypes.string,
}

/** 设计系统按钮（本地化，避免与全局主题冲突） */
export function KbButton({ variant = "outline", className, children, ...props }) {
  const variants = {
    outline: "border-[#E7E7E4] bg-white text-[#1A1A1A] hover:bg-[#F5F5F3] hover:border-[#D8D8D4]",
    primary: "border-[#4F5BD5] bg-[#4F5BD5] text-white hover:bg-[#4450C4]",
    ghost: "border-transparent bg-transparent text-[#6B6B6B] hover:bg-[#F5F5F3] hover:text-[#1A1A1A]",
    danger: "border-[#DEB8B8] bg-white text-[#C53030] hover:bg-[#FDF3F3]",
    soft: "border-[#DDE0F7] bg-[#EEF0FB] text-[#4F5BD5] hover:bg-[#E4E7FA]",
  }
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant] || variants.outline,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

KbButton.propTypes = {
  variant: PropTypes.oneOf(["outline", "primary", "ghost", "danger", "soft"]),
  className: PropTypes.string,
  children: PropTypes.node,
}

export function KbInput({ className, ...props }) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-[#E7E7E4] bg-[#FAFAF9] px-2.5 text-[13px] text-[#1A1A1A] outline-none transition-colors placeholder:text-[#9A9A96] focus:border-[#4F5BD5] focus:bg-white focus:ring-2 focus:ring-[#EEF0FB]",
        className,
      )}
      {...props}
    />
  )
}

KbInput.propTypes = { className: PropTypes.string }
