import * as React from "react"
import PropTypes from "prop-types"
import { Inbox, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  TOKENS, STATUS_META, Highlight, TagPill, KbButton, fmtDate, fmtWords,
} from "./KbShared"

const GRID = "grid grid-cols-[24px_8px_minmax(0,1fr)_52px] items-center gap-2.5 lg:grid-cols-[24px_8px_minmax(0,1fr)_104px_52px] xl:grid-cols-[24px_8px_minmax(0,1fr)_104px_68px_52px] 2xl:grid-cols-[24px_8px_minmax(0,1fr)_104px_68px_132px_52px]"

function EmptyBox({ title, description, action }) {
  return (
    <div className="rounded-lg border border-dashed border-[#DDDDD8] bg-white px-5 py-12 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg border border-[#E7E7E4] bg-[#FCFCFB] text-[#A8A8A2]">
        <Inbox className="h-5 w-5" />
      </div>
      <h3 className="text-[14px] font-semibold text-[#1A1A1A]">{title}</h3>
      {description && <p className="mt-1 text-[12px] text-[#6B6B6B]">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

EmptyBox.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  action: PropTypes.node,
}

function RowSkeleton({ compact }) {
  return (
    <div className={cn("border-b border-[#F1F1EE] px-3", compact ? "py-2" : "py-3")}>
      <div className="h-3.5 w-2/3 animate-pulse rounded bg-[#EFEFEC]" />
      <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-[#F4F4F2]" />
    </div>
  )
}

RowSkeleton.propTypes = { compact: PropTypes.bool }

export function MaterialView({
  items, total, loading, loadingMore, error, keyword, layout, density, activeId,
  checked, onToggleCheck, onToggleAll, selectAllRef, onOpen, onRetry,
  onLoadMore, paginated, page, pageCount, onPage,
  onClearFilters, onImport, hasAnyFilter, searchMode,
}) {
  const compact = density === "compact"
  const allChecked = items.length > 0 && items.every((i) => checked.has(i.id))
  const someChecked = items.some((i) => checked.has(i.id))

  React.useEffect(() => {
    if (selectAllRef?.current) selectAllRef.current.indeterminate = someChecked && !allChecked
  }, [someChecked, allChecked, selectAllRef, items.length])

  if (loading) {
    return (
      <div className="rounded-lg border border-[#E7E7E4] bg-white">
        <div className="flex items-center gap-2 border-b border-[#F1F1EE] px-3 py-3 text-[12px] text-[#6B6B6B]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在整理素材…
        </div>
        {[0, 1, 2, 3, 4].map((i) => <RowSkeleton key={i} compact={compact} />)}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[#EAD1D1] bg-white p-5 text-center">
        <p className="text-[13px] text-[#C53030]">{error}</p>
        <p className="mt-1 text-[12px] text-[#6B6B6B]">页面没有白屏，数据可能只是暂时读不到。</p>
        <KbButton className="mt-3" onClick={onRetry}>重试</KbButton>
      </div>
    )
  }

  if (!items.length) {
    if (searchMode) {
      return (
        <EmptyBox
          title={`没有匹配「${keyword}」的素材`}
          description="换个关键词，或清除搜索后回到素材列表"
          action={<KbButton onClick={onClearFilters}>清除筛选</KbButton>}
        />
      )
    }
    if (hasAnyFilter) {
      return (
        <EmptyBox
          title="该条件下没有素材"
          description="调整筛选条件，或先去采集一批新文章"
          action={<KbButton onClick={onClearFilters}>清除筛选</KbButton>}
        />
      )
    }
    return (
      <EmptyBox
        title="还没有素材，先去采集一篇"
        description="从上游采集结果导入，或到「公众号文章」手动采集"
        action={<KbButton variant="primary" onClick={onImport}>导入采集结果</KbButton>}
      />
    )
  }

  if (layout === "card") {
    return (
      <div className={cn("grid gap-3", "grid-cols-1 xl:grid-cols-2")}>
        {items.map((item, index) => {
          const meta = STATUS_META[item.status] || STATUS_META.unused
          const selected = checked.has(item.id)
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={(e) => (e.metaKey || e.ctrlKey ? onToggleCheck(item.id, index, e) : onOpen(item.id))}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(item.id) }}
              className={cn(
                "relative flex min-h-[150px] cursor-pointer flex-col gap-2 rounded-lg border bg-white p-3.5 transition-colors",
                selected ? "border-[#C9CEF3] bg-[#FAFBFF]" : "border-[#E7E7E4] hover:border-[#D5D5D0]",
                activeId === item.id && "border-[#4F5BD5]",
                compact && "min-h-[132px] gap-1.5 p-3",
              )}
            >
              <input
                type="checkbox"
                className="absolute right-3 top-3 z-[2] h-3.5 w-3.5 accent-[#4F5BD5]"
                checked={selected}
                aria-label={`选择 ${item.title}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onToggleCheck(item.id, index, e)}
              />
              <div className="flex items-center gap-1.5 pr-6">
                <span className={cn("h-[7px] w-[7px] rounded-full", meta.dot)} />
                <span className="text-[11px] text-[#6B6B6B]">{meta.label}</span>
              </div>
              <div className="line-clamp-2 pr-4 text-[14px] font-medium leading-[1.55] text-[#1A1A1A]">
                <Highlight text={item.title} keyword={keyword} />
              </div>
              <div className="line-clamp-3 text-[12px] leading-[1.65] text-[#6B6B6B]">
                <Highlight text={item.snippet || "（无摘要）"} keyword={keyword} />
              </div>
              <div className="flex flex-wrap gap-1">
                {item.tags.slice(0, 3).map((t) => <TagPill key={t} tag={t} />)}
              </div>
              <div className="mt-auto flex items-center gap-1.5 overflow-hidden whitespace-nowrap pt-0.5 text-[11px] text-[#8E8E89]">
                <span className="truncate">{item.account || "未知公众号"}</span>
                <span>·</span><span>{fmtDate(item.date)}</span>
                <span>·</span><span>{fmtWords(item.words)}{item.words ? " 字" : ""}</span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#E7E7E4] bg-white">
      <div className={cn(GRID, "border-b border-[#E7E7E4] bg-[#FCFCFB] px-3 py-[7px] text-[11px] text-[#8E8E89]")}>
        <input
          ref={selectAllRef}
          type="checkbox"
          className="h-3.5 w-3.5 accent-[#4F5BD5]"
          checked={allChecked}
          onChange={onToggleAll}
          aria-label="全选当前列表"
        />
        <span />
        <span>标题</span>
        <span className="hidden lg:block">账号</span>
        <span className="hidden xl:block">日期</span>
        <span className="hidden 2xl:block">标签</span>
        <span className="text-right">字数</span>
      </div>

      {items.map((item, index) => {
        const meta = STATUS_META[item.status] || STATUS_META.unused
        const selected = checked.has(item.id)
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={(e) => (e.metaKey || e.ctrlKey ? onToggleCheck(item.id, index, e) : onOpen(item.id))}
            onKeyDown={(e) => { if (e.key === "Enter") onOpen(item.id) }}
            className={cn(
              GRID,
              "cursor-pointer border-b border-[#F1F1EE] px-3 transition-colors last:border-b-0",
              compact ? "py-1.5" : "py-2.5",
              selected ? "bg-[#F7F7FC]" : "hover:bg-[#FAFAF8]",
              activeId === item.id && "bg-[#EEF0FB]",
            )}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#4F5BD5]"
              checked={selected}
              aria-label={`选择 ${item.title}`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggleCheck(item.id, index, e)}
            />
            <span className={cn("h-[7px] w-[7px] rounded-full", meta.dot)} title={meta.label} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium leading-[1.55] text-[#1A1A1A]" title={item.title}>
                <Highlight text={item.title} keyword={keyword} />
              </div>
              {keyword && item.snippet && (
                <div className="mt-1 line-clamp-2 border-l-2 border-[#E8D48A] bg-[#FCFCFB] px-2 py-0.5 text-[12px] leading-[1.65] text-[#4A4A47]">
                  <Highlight text={item.snippet} keyword={keyword} />
                </div>
              )}
            </div>
            <div className="hidden min-w-0 items-center gap-1 text-[12px] text-[#4A4A47] lg:flex">
              <span className="truncate">{item.account || "—"}</span>
            </div>
            <div className="hidden whitespace-nowrap font-mono text-[12px] tabular-nums text-[#6B6B6B] xl:block">{fmtDate(item.date)}</div>
            <div className="hidden items-center gap-1 overflow-hidden 2xl:flex">
              {item.tags.slice(0, 2).map((t) => <TagPill key={t} tag={t} />)}
              {item.tags.length > 2 && <span className="text-[11px] text-[#9A9A96]">+{item.tags.length - 2}</span>}
            </div>
            <div className="text-right font-mono text-[12px] tabular-nums text-[#6B6B6B]">{fmtWords(item.words)}</div>
          </div>
        )
      })}

      {!paginated && items.length < total && (
        <div className="border-t border-[#E7E7E4] p-2">
          <KbButton className="w-full" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
            加载更多（已显示 {items.length}/{total}）
          </KbButton>
        </div>
      )}

      {paginated && pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-[#E7E7E4] px-3 py-2 text-[12px] text-[#6B6B6B]">
          <span className="font-mono tabular-nums">第 {page + 1} / {pageCount} 页 · 共 {total} 篇</span>
          <div className="flex gap-1.5">
            <KbButton className="h-7 px-2" onClick={() => onPage(page - 1)} disabled={page <= 0 || loading}>
              <ChevronLeft className="h-3.5 w-3.5" /> 上一页
            </KbButton>
            <KbButton className="h-7 px-2" onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1 || loading}>
              下一页 <ChevronRight className="h-3.5 w-3.5" />
            </KbButton>
          </div>
        </div>
      )}
    </div>
  )
}

MaterialView.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object).isRequired,
  total: PropTypes.number,
  loading: PropTypes.bool,
  loadingMore: PropTypes.bool,
  error: PropTypes.string,
  keyword: PropTypes.string,
  layout: PropTypes.oneOf(["list", "card"]),
  density: PropTypes.oneOf(["compact", "comfortable"]),
  activeId: PropTypes.string,
  checked: PropTypes.instanceOf(Set).isRequired,
  onToggleCheck: PropTypes.func.isRequired,
  onToggleAll: PropTypes.func.isRequired,
  selectAllRef: PropTypes.object,
  onOpen: PropTypes.func.isRequired,
  onRetry: PropTypes.func.isRequired,
  onLoadMore: PropTypes.func.isRequired,
  paginated: PropTypes.bool,
  page: PropTypes.number,
  pageCount: PropTypes.number,
  onPage: PropTypes.func.isRequired,
  onClearFilters: PropTypes.func.isRequired,
  onImport: PropTypes.func.isRequired,
  hasAnyFilter: PropTypes.bool,
  searchMode: PropTypes.bool,
}

export { GRID as MATERIAL_GRID }
