import * as React from "react"
import PropTypes from "prop-types"
import { Bookmark, FolderTree, Plus, Check, Loader2, Settings2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { TOKENS, KbButton, KbInput } from "./KbShared"

const NONE = "__none__"

function SideItem({ active, label, count, dot, avatar, onClick, title, indent = 0 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      style={indent ? { paddingLeft: 8 + indent * 12 } : undefined}
      className={cn(
        "relative flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[13px] transition-colors",
        active ? "bg-[#EEF0FB] font-medium text-[#4F5BD5]" : "text-[#3D3D3A] hover:bg-[#F5F5F3]",
      )}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[#4F5BD5]" />}
      {avatar != null ? (
        <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px]", active ? "bg-[#DDE0F7] text-[#4F5BD5]" : "bg-[#F1F1EE] text-[#77776F]")}>
          {avatar}
        </span>
      ) : dot ? (
        <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", active ? "bg-[#4F5BD5]" : "bg-[#D4D4D0]")} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", active ? "text-[#4F5BD5]" : "text-[#9A9A96]")}>{count}</span>
      )}
    </button>
  )
}

SideItem.propTypes = {
  active: PropTypes.bool,
  label: PropTypes.string.isRequired,
  count: PropTypes.number,
  dot: PropTypes.bool,
  avatar: PropTypes.string,
  onClick: PropTypes.func,
  title: PropTypes.string,
  indent: PropTypes.number,
}

function Group({ title, children, action }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-2 pb-1.5 text-[11px] tracking-[0.06em] text-[#8E8E89]">
        <span>{title}</span>
        {action}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

Group.propTypes = { title: PropTypes.string.isRequired, children: PropTypes.node, action: PropTypes.node }

export function LibrarySidebar({
  stats, collections, views, listTotal, filters, savedId,
  onFilter, onApplyView, onSaveView, savingView, onManageCollections,
}) {
  const [showSave, setShowSave] = React.useState(false)
  const [name, setName] = React.useState("")

  const total = Number(stats?.total) || listTotal || 0
  const collectionCounts = collections.reduce((sum, c) => sum + (Number(c.count) || 0), 0)
  const uncollected = Math.max(0, total - collectionCounts)
  const byAccount = Array.isArray(stats?.byAccount) ? stats.byAccount : []
  const hasFilters = Boolean(filters.collection || filters.account || filters.status || filters.tag)

  const tree = React.useMemo(() => {
    const ids = new Set(collections.map((c) => c.id))
    const byParent = new Map()
    for (const c of collections) {
      const parent = c.parent && ids.has(c.parent) ? c.parent : ""
      if (!byParent.has(parent)) byParent.set(parent, [])
      byParent.get(parent).push(c)
    }
    const out = []
    const seen = new Set()
    const walk = (parent, depth) => {
      for (const c of byParent.get(parent) || []) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        out.push({ c, depth })
        walk(c.id, depth + 1)
      }
    }
    walk("", 0)
    for (const c of collections) {
      if (!seen.has(c.id)) out.push({ c, depth: 0 })
    }
    return out
  }, [collections])

  const submit = async () => {
    const value = name.trim()
    if (!value) return
    const ok = await onSaveView(value)
    if (ok) { setShowSave(false); setName("") }
  }

  return (
    <aside className={cn("flex w-[220px] shrink-0 flex-col overflow-auto border-r px-2.5 pb-6 pt-3", TOKENS.line, TOKENS.panel)} aria-label="知识库筛选">
      <Group
        title="集合"
        action={(
          <button
            type="button"
            onClick={onManageCollections}
            title="管理集合（新建 / 重命名 / 删除）"
            className="inline-flex items-center gap-1 rounded px-1 text-[10px] normal-case tracking-normal text-[#8E8E89] hover:bg-[#F5F5F3] hover:text-[#4F5BD5]"
          >
            <Settings2 className="h-3 w-3" /> 管理
          </button>
        )}
      >
        <SideItem
          active={!filters.collection}
          label="全部素材"
          count={total}
          dot
          onClick={() => onFilter({ collection: "", savedId: "" })}
        />
        <SideItem
          active={filters.collection === NONE}
          label="未归类"
          count={uncollected}
          dot
          onClick={() => onFilter({ collection: NONE, savedId: "" })}
        />
        {tree.map(({ c, depth }) => (
          <SideItem
            key={c.id || c.name}
            active={filters.collection === c.name}
            label={c.name}
            count={Number(c.count) || 0}
            dot
            indent={depth}
            onClick={() => onFilter({ collection: c.name, savedId: "" })}
          />
        ))}
        {!collections.length && <div className="px-2 py-1 text-[11px] text-[#A0A09A]">还没有集合</div>}
      </Group>

      <Group title="账号">
        {byAccount.map((a) => (
          <SideItem
            key={a.key || a.name}
            active={filters.account === a.name}
            label={a.name}
            avatar={(a.name || "?").slice(0, 1)}
            count={Number(a.count) || 0}
            onClick={() => onFilter({ account: filters.account === a.name ? "" : a.name, savedId: "" })}
          />
        ))}
        {!byAccount.length && <div className="px-2 py-1 text-[11px] text-[#A0A09A]">暂无账号数据</div>}
      </Group>

      <Group title="已保存视图">
        {views.map((v) => (
          <SideItem
            key={v.id}
            active={savedId === v.id}
            label={v.name}
            onClick={() => onApplyView(v)}
          />
        ))}
        {!views.length && <div className="px-2 py-1 text-[11px] text-[#A0A09A]">把常用筛选存成视图</div>}

        {hasFilters && !showSave && (
          <button
            type="button"
            onClick={() => { setShowSave(true); setName("") }}
            className="mt-1 flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-[#4F5BD5] hover:bg-[#F5F5F3]"
          >
            <Plus className="h-3.5 w-3.5" /> 保存当前筛选为视图
          </button>
        )}
        {showSave && (
          <div className="mt-1.5 space-y-1.5 rounded-md border border-[#E7E7E4] bg-[#FCFCFB] p-2">
            <KbInput
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="视图名称，如：待写选题"
              className="h-7 text-[12px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit()
                if (e.key === "Escape") { e.stopPropagation(); setShowSave(false) }
              }}
            />
            <div className="flex justify-end gap-1">
              <KbButton variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setShowSave(false)} disabled={savingView}>
                取消
              </KbButton>
              <KbButton variant="primary" className="h-6 px-2 text-[11px]" onClick={submit} disabled={savingView || !name.trim()}>
                {savingView ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                保存
              </KbButton>
            </div>
          </div>
        )}

        {!hasFilters && !views.length && (
          <div className="flex items-start gap-1.5 px-2 text-[11px] leading-5 text-[#A0A09A]">
            <Bookmark className="mt-1 h-3 w-3 shrink-0" /> 选好集合/账号后即可保存
          </div>
        )}
      </Group>

      <div className="mt-auto flex items-center gap-1.5 px-2 pt-2 text-[11px] text-[#A0A09A]">
        <FolderTree className="h-3 w-3" /> 集合与标签均来自当前知识库
      </div>
    </aside>
  )
}

LibrarySidebar.propTypes = {
  stats: PropTypes.object,
  collections: PropTypes.arrayOf(PropTypes.object).isRequired,
  views: PropTypes.arrayOf(PropTypes.object).isRequired,
  listTotal: PropTypes.number,
  filters: PropTypes.shape({
    collection: PropTypes.string,
    account: PropTypes.string,
    status: PropTypes.string,
    tag: PropTypes.string,
  }).isRequired,
  savedId: PropTypes.string,
  onFilter: PropTypes.func.isRequired,
  onApplyView: PropTypes.func.isRequired,
  onSaveView: PropTypes.func.isRequired,
  savingView: PropTypes.bool,
  onManageCollections: PropTypes.func,
}
