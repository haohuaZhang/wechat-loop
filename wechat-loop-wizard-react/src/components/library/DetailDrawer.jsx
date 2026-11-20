import * as React from "react"
import PropTypes from "prop-types"
import {
  X, Quote, Copy, ExternalLink, AlertTriangle, Loader2, Tag as TagIcon, FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  STATUS_META, STATUS_ORDER, StatusPill, TagPill, KbButton, KbInput, fmtDate, fmtWords,
} from "./KbShared"

export function DetailDrawer({
  detail, loading, error, onClose, onStatus, onAddTag, onRemoveTag,
  onCite, onCopyLink, onOpenRelated, busy,
}) {
  const [tagInput, setTagInput] = React.useState("")

  React.useEffect(() => {
    setTagInput("")
  }, [detail?.id])

  const submitTag = () => {
    const value = tagInput.trim()
    if (!value) return
    onAddTag(value)
    setTagInput("")
  }

  const dup = detail?.duplicateOf
  const dupTitle = (() => {
    if (!dup) return ""
    if (typeof dup === "string") {
      return detail.related?.find((r) => r.id === dup)?.title || dup
    }
    return dup.title || dup.id || ""
  })()

  return (
    <aside
      className="absolute inset-y-0 right-0 z-40 flex w-[480px] max-w-[92vw] flex-col border-l border-[#E7E7E4] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)] xl:static xl:z-auto xl:shadow-none"
      aria-label="素材详情"
    >
      {loading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-[#6B6B6B]">
          <Loader2 className="h-4 w-4 animate-spin" /> 读取正文…
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-1 flex-col">
          <div className="flex justify-end p-2">
            <button type="button" onClick={onClose} aria-label="关闭详情" className="grid h-7 w-7 place-items-center rounded-md text-[#6B6B6B] hover:bg-[#F5F5F3]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-4 text-[13px] text-[#C53030]">{error}</div>
        </div>
      )}

      {!loading && !error && !detail && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-[#6B6B6B]">
          从左侧选一篇素材查看正文
        </div>
      )}

      {!loading && !error && detail && (
        <>
          <div className="relative shrink-0 border-b border-[#E7E7E4] px-4 pb-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭详情"
              className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-md text-[#6B6B6B] hover:bg-[#F5F5F3] hover:text-[#1A1A1A]"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mb-1 text-[11px] tracking-[0.06em] text-[#8E8E89]">素材详情</div>
            <h2 className="mb-1.5 pr-7 text-[16px] font-semibold leading-[1.55] text-[#1A1A1A]">{detail.title}</h2>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#6B6B6B]">
              <StatusPill status={detail.status} />
              <span className="truncate">{detail.account || "未知公众号"}</span>
              <span className="text-[#D0D0CB]">·</span>
              <span className="font-mono tabular-nums">{detail.date || "—"}</span>
              <span className="text-[#D0D0CB]">·</span>
              <span>{fmtWords(detail.words)}{detail.words ? " 字" : ""}</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-8 pt-3">
            {dup && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-[#EAD9A8] bg-[#FFFBF0] px-2.5 py-2 text-[12px] leading-[1.6] text-[#8A6D2F]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B7791F]" />
                <span>与《{dupTitle}》疑似重复，引用前建议先对比。</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {detail.tags.map((t) => (
                <TagPill key={t} tag={t} onRemove={busy ? undefined : onRemoveTag} />
              ))}
              <div className="flex items-center gap-1">
                <KbInput
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitTag() }}
                  placeholder="+ 新标签"
                  className="h-6 w-[92px] px-1.5 text-[11px]"
                  aria-label="添加标签"
                />
                {tagInput.trim() && (
                  <KbButton variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={submitTag} disabled={busy}>添加</KbButton>
                )}
              </div>
            </div>

            <div className="my-3.5 h-px bg-[#E7E7E4]" />

            <div className="mb-1.5 flex items-center justify-between text-[11px] tracking-[0.04em] text-[#8E8E89]">
              <span>正文</span>
              <span className="text-[#A0A09A]">{detail.content ? `${detail.content.length} 字符` : "无正文"}</span>
            </div>
            {detail.content ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-[1.7] text-[#2E2E2B]">{detail.content}</pre>
            ) : (
              <div className="rounded-md border border-dashed border-[#DDDDD8] bg-[#FCFCFB] px-3 py-4 text-[12px] leading-6 text-[#6B6B6B]">
                这篇文章在知识库里只有元数据（标题/日期/链接），没有正文。
                <br />
                要读到正文，请用「公众号文章」重新采集一次。
              </div>
            )}

            <div className="my-4 h-px bg-[#E7E7E4]" />

            <div className="mb-2 flex items-center justify-between text-[11px] tracking-[0.04em] text-[#8E8E89]">
              <span>状态</span>
              <span className="text-[#A0A09A]">更改会同步到列表</span>
            </div>
            <div className="flex gap-1.5">
              {STATUS_ORDER.map((s) => {
                const meta = STATUS_META[s]
                const active = detail.status === s
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => onStatus(s)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors disabled:opacity-50",
                      active ? meta.btn : "border-[#E7E7E4] bg-white text-[#6B6B6B] hover:bg-[#F5F5F3]",
                    )}
                    aria-pressed={active}
                  >
                    <span className={cn("h-[6px] w-[6px] rounded-full", meta.dot)} />
                    {meta.label}
                  </button>
                )
              })}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onCite}
                disabled={busy}
                className="flex h-[34px] items-center gap-2 rounded-md border border-[#DDE0F7] bg-[#EEF0FB] px-2.5 text-left text-[12.5px] text-[#4F5BD5] transition-colors hover:bg-[#E4E7FA] disabled:opacity-50"
              >
                <Quote className="h-3.5 w-3.5" /> 引用到写作
              </button>
              <button
                type="button"
                onClick={onCopyLink}
                disabled={busy}
                className="flex h-[34px] items-center gap-2 rounded-md border border-[#E7E7E4] bg-white px-2.5 text-left text-[12.5px] text-[#1A1A1A] transition-colors hover:bg-[#F5F5F3] disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5 text-[#6B6B6B]" /> 复制链接
              </button>
              {detail.url && (
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noreferrer"
                  className="col-span-2 flex h-[34px] items-center gap-2 rounded-md border border-[#E7E7E4] bg-white px-2.5 text-[12.5px] text-[#1A1A1A] transition-colors hover:bg-[#F5F5F3]"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-[#6B6B6B]" /> 打开原文
                </a>
              )}
            </div>

            <div className="my-4 h-px bg-[#E7E7E4]" />

            <div className="mb-1.5 flex items-center justify-between text-[11px] tracking-[0.04em] text-[#8E8E89]">
              <span>相关素材</span>
              <span className="text-[#A0A09A]">{detail.related?.length || 0} 条</span>
            </div>
            <div className="flex flex-col gap-px">
              {(detail.related || []).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onOpenRelated(r.id)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-[7px] text-left transition-colors hover:bg-[#F5F5F3]"
                >
                  <span className="mt-1.5 h-[6px] w-[6px] shrink-0 rounded-full bg-[#C9C9C4]" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-[12.5px] leading-[1.55] text-[#1A1A1A]">
                      {r.title || r.id}
                    </span>
                    {r.reason && <span className="mt-px block text-[11px] text-[#6B6B6B]">{r.reason}</span>}
                  </span>
                </button>
              ))}
              {!detail.related?.length && (
                <div className="flex items-center gap-1.5 text-[12px] text-[#A0A09A]">
                  <FileText className="h-3 w-3" /> 暂无相关素材
                </div>
              )}
            </div>

            {detail.tags.length > 0 && (
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-[#A0A09A]">
                <TagIcon className="h-3 w-3" /> 标签增删会立即写回知识库
              </div>
            )}
            <div className="mt-1 text-[11px] text-[#A0A09A]">入库于 {fmtDate(detail.date)}</div>
          </div>
        </>
      )}
    </aside>
  )
}

DetailDrawer.propTypes = {
  detail: PropTypes.object,
  loading: PropTypes.bool,
  error: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onStatus: PropTypes.func.isRequired,
  onAddTag: PropTypes.func.isRequired,
  onRemoveTag: PropTypes.func.isRequired,
  onCite: PropTypes.func.isRequired,
  onCopyLink: PropTypes.func.isRequired,
  onOpenRelated: PropTypes.func.isRequired,
  busy: PropTypes.bool,
}
