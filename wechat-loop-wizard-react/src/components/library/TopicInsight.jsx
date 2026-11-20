import * as React from "react"
import PropTypes from "prop-types"
import { Inbox, AlertTriangle, Loader2, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { TOKENS, KbButton, ratePercent } from "./KbShared"

function SectionEmpty({ title, description, action }) {
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

SectionEmpty.propTypes = { title: PropTypes.string.isRequired, description: PropTypes.string, action: PropTypes.node }

function LoadingBox() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#E7E7E4] bg-white px-3 py-3 text-[12px] text-[#6B6B6B]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在整理素材…
    </div>
  )
}

export function TopicView({ stats, loading, onPickTag, onImport }) {
  if (loading) return <LoadingBox />
  const byTag = (Array.isArray(stats?.byTag) ? stats.byTag : []).slice(0, 8)
  if (!byTag.length) {
    return (
      <SectionEmpty
        title="素材还不够聚类 · 采集 10 篇后自动生成"
        description="当前知识库还没有足够的标签样本，先导入一批采集结果"
        action={<KbButton variant="primary" onClick={onImport}>导入采集结果</KbButton>}
      />
    )
  }
  const max = Math.max(...byTag.map((t) => Number(t.count) || 0), 1)
  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.005em] text-[#1A1A1A]">按主题聚类</h2>
          <p className="mt-0.5 text-[12px] text-[#6B6B6B]">点击主题卡片，把该标签设为筛选并回到素材视图</p>
        </div>
        <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-[#6B6B6B]">{byTag.length} 个主题</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {byTag.map((t) => {
          const n = Number(t.count) || 0
          return (
            <button
              key={t.tag}
              type="button"
              onClick={() => onPickTag(t.tag)}
              className="group flex min-h-[104px] flex-col rounded-lg border border-[#E7E7E4] bg-white p-3.5 text-left transition-colors hover:border-[#C9CEF3] hover:bg-[#FAFBFF]"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-[#8E8E89]">
                <Layers className="h-3 w-3" /> 主题
              </div>
              <div className="mt-1 line-clamp-2 text-[14px] font-medium leading-[1.5] text-[#1A1A1A] group-hover:text-[#4F5BD5]">{t.tag}</div>
              <div className="mt-auto pt-2">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-mono text-[12px] tabular-nums text-[#6B6B6B]">{n} 篇素材</span>
                  <span className="text-[11px] text-[#A0A09A]">查看</span>
                </div>
                <span className="block h-[4px] overflow-hidden rounded-sm bg-[#F1F1EE]">
                  <span className="block h-full rounded-sm bg-[#4F5BD5]" style={{ width: `${Math.round((n / max) * 100)}%` }} />
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

TopicView.propTypes = {
  stats: PropTypes.object,
  loading: PropTypes.bool,
  onPickTag: PropTypes.func.isRequired,
  onImport: PropTypes.func.isRequired,
}

export function InsightView({ stats, loading, onPickAccount, onPickTag }) {
  if (loading) return <LoadingBox />
  if (!stats || !Number(stats.total)) {
    return (
      <SectionEmpty
        title="还没有素材，先去采集一篇"
        description="洞察基于当前知识库的统计，导入素材后自动生成"
      />
    )
  }

  const total = Number(stats.total) || 0
  const unused = Number(stats.unused) || 0
  const weekAdded = Number(stats.weekAdded) || 0
  const rate = ratePercent(stats.citedRate)
  const byAccount = [...(Array.isArray(stats.byAccount) ? stats.byAccount : [])]
    .map((a) => ({ name: a.name || a.key || "未知", count: Number(a.count) || 0 }))
    .sort((a, b) => b.count - a.count)
  const maxAccount = Math.max(...byAccount.map((a) => a.count), 1)
  const byTag = [...(Array.isArray(stats.byTag) ? stats.byTag : [])]
    .map((t) => ({ tag: t.tag || "未命名", count: Number(t.count) || 0 }))
    .sort((a, b) => b.count - a.count)
  const topTags = byTag.slice(0, 16)
  const maxTag = Math.max(...topTags.map((t) => t.count), 1)
  const topTag = byTag[0]

  const cards = [
    { label: "素材总数", value: total, sub: `覆盖 ${byAccount.length} 个账号` },
    { label: "未使用", value: unused, sub: "尚未进入写作流程" },
    { label: "本周新增", value: weekAdded, sub: "最近 7 天采集入库" },
    { label: "被引用率", value: `${rate}%`, sub: `${Number(stats.cited) || 0} 篇已引用` },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-[#E7E7E4] bg-white px-4 py-3.5">
            <div className="flex items-center justify-between text-[12px] text-[#6B6B6B]">
              <span>{c.label}</span>
            </div>
            <div className="mt-1.5 font-mono text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] tabular-nums text-[#1A1A1A]">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-[#8E8E89]">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-lg border border-[#E7E7E4] bg-white px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between gap-2 text-[13px] font-semibold text-[#1A1A1A]">
          <span>账号分布</span>
          <span className="text-[11px] font-normal text-[#6B6B6B]">点击条形筛选素材</span>
        </div>
        <div className="flex flex-col gap-[7px]">
          {byAccount.map((a) => (
            <button
              key={a.name}
              type="button"
              onClick={() => onPickAccount(a.name)}
              className="grid grid-cols-[100px_minmax(0,1fr)_34px] items-center gap-2.5 rounded px-1 py-0.5 text-left text-[12px] transition-colors hover:bg-[#F5F5F3]"
            >
              <span className="truncate text-[#3D3D3A]" title={a.name}>{a.name}</span>
              <span className="h-2 overflow-hidden rounded-sm bg-[#F1F1EE]">
                <span className={cn("block h-full rounded-sm", "bg-[#4F5BD5]")} style={{ width: `${Math.round((a.count / maxAccount) * 100)}%` }} />
              </span>
              <span className="text-right font-mono tabular-nums text-[#6B6B6B]">{a.count}</span>
            </button>
          ))}
          {!byAccount.length && <span className="text-[12px] text-[#A0A09A]">暂无账号分布数据</span>}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-[#E7E7E4] bg-white px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between gap-2 text-[13px] font-semibold text-[#1A1A1A]">
          <span>高频标签</span>
          <span className="text-[11px] font-normal text-[#6B6B6B]">字号代表出现次数 · 点击筛选</span>
        </div>
        <div className="flex flex-wrap items-center gap-[7px] py-0.5">
          {topTags.map((t) => {
            const size = 12 + Math.min(6, Math.round((t.count / maxTag) * 6))
            return (
              <button
                key={t.tag}
                type="button"
                onClick={() => onPickTag(t.tag)}
                className="inline-flex items-baseline gap-1 rounded border border-[#EDEDEA] bg-[#F7F7F5] px-2 py-0.5 leading-[1.6] text-[#3D3D3A] transition-colors hover:border-[#DDE0F7] hover:bg-[#EEF0FB] hover:text-[#4F5BD5]"
                style={{ fontSize: `${size}px` }}
              >
                {t.tag}<span className="font-mono text-[10px] text-[#9A9A96]">{t.count}</span>
              </button>
            )
          })}
          {!topTags.length && <span className="text-[12px] text-[#A0A09A]">暂无标签数据</span>}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-[#EDE3C8] bg-[#FFFBF0] px-3 py-2 text-[13px] leading-[1.65] text-[#6F5722]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B7791F]" />
        <span>
          {unused} 篇素材尚未被引用{topTag ? `，其中主题「${topTag.tag}」素材最多（${topTag.count} 篇）` : ""}。本周新增 {weekAdded} 篇，建议先补齐标签再进入选题池。
        </span>
      </div>
    </div>
  )
}

InsightView.propTypes = {
  stats: PropTypes.object,
  loading: PropTypes.bool,
  onPickAccount: PropTypes.func.isRequired,
  onPickTag: PropTypes.func.isRequired,
}
