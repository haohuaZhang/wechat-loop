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

export function TopicView({ stats, topics, loading, onPickTopic, onOpenArticle, onImport }) {
  if (loading) return <LoadingBox />
  const clusters = Array.isArray(topics?.clusters) ? topics.clusters : []
  const total = Number(topics?.total) || Number(stats?.total) || 0

  if (!clusters.length) {
    const byTag = (Array.isArray(stats?.byTag) ? stats.byTag : []).slice(0, 8)
    if (!byTag.length) {
      return (
        <SectionEmpty
          title="素材还不够聚类 · 采集 10 篇后自动生成"
          description="当前知识库还没有足够的标题/关键词样本，先导入一批采集结果"
          action={<KbButton variant="primary" onClick={onImport}>导入采集结果</KbButton>}
        />
      )
    }
    return (
      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.005em] text-[#1A1A1A]">按标签聚类</h2>
            <p className="mt-0.5 text-[12px] text-[#6B6B6B]">还没有足够的共现词，先用已有标签兜底</p>
          </div>
          <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-[#6B6B6B]">{byTag.length} 个标签</span>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {byTag.map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => onPickTopic(t.tag)}
              className="group flex min-h-[104px] flex-col rounded-lg border border-[#E7E7E4] bg-white p-3.5 text-left transition-colors hover:border-[#C9CEF3] hover:bg-[#FAFBFF]"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-[#8E8E89]"><Layers className="h-3 w-3" /> 标签</div>
              <div className="mt-1 line-clamp-2 text-[14px] font-medium leading-[1.5] text-[#1A1A1A] group-hover:text-[#4F5BD5]">{t.tag}</div>
              <div className="mt-auto pt-2 font-mono text-[12px] tabular-nums text-[#6B6B6B]">{Number(t.count) || 0} 篇素材</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const max = Math.max(...clusters.map((c) => Number(c.count) || 0), 1)
  const coverage = ratePercent(topics?.coverageRate)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.005em] text-[#1A1A1A]">主题聚类与覆盖度</h2>
          <p className="mt-0.5 text-[12px] text-[#6B6B6B]">标题/关键词共现自动成簇（无 LLM）· 点击簇名按主题检索</p>
        </div>
        <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-[#6B6B6B]">{clusters.length} 个主题</span>
      </div>

      <div className="mb-4 rounded-lg border border-[#E7E7E4] bg-white px-4 py-3.5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-[#1A1A1A]">主题覆盖度</span>
          <span className="font-mono text-[12px] tabular-nums text-[#4F5BD5]">{coverage}%</span>
        </div>
        <span className="block h-[6px] overflow-hidden rounded-sm bg-[#F1F1EE]">
          <span className="block h-full rounded-sm bg-[#4F5BD5]" style={{ width: `${coverage}%` }} />
        </span>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#6B6B6B]">
          <span>已覆盖 {Number(topics?.covered) || 0} / {total} 篇</span>
          <span>未归类 {Number(topics?.uncovered) || 0} 篇</span>
          <span className="text-[#A0A09A]">覆盖度 = 至少命中一个主题的文章占比</span>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
        {clusters.map((c) => (
          <div key={c.id || c.label} className="flex min-h-[150px] flex-col rounded-lg border border-[#E7E7E4] bg-white p-3.5 transition-colors hover:border-[#C9CEF3]">
            <button type="button" onClick={() => onPickTopic(c.label)} className="group text-left">
              <div className="flex items-center justify-between gap-2 text-[11px] text-[#8E8E89]">
                <span className="inline-flex items-center gap-1.5"><Layers className="h-3 w-3" /> 主题簇</span>
                <span className="font-mono tabular-nums">{Math.round((Number(c.coverage) || 0) * 100)}% 覆盖</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[15px] font-semibold text-[#1A1A1A] group-hover:text-[#4F5BD5]">{c.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-[#6B6B6B]">{Number(c.count) || 0} 篇</span>
              </div>
            </button>
            <span className="mt-1.5 block h-[4px] overflow-hidden rounded-sm bg-[#F1F1EE]">
              <span className="block h-full rounded-sm bg-[#4F5BD5]" style={{ width: `${Math.round(((Number(c.count) || 0) / max) * 100)}%` }} />
            </span>
            {Array.isArray(c.keywords) && c.keywords.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {c.keywords.slice(0, 4).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => onPickTopic(k)}
                    className="rounded border border-[#EDEDEA] bg-[#F7F7F5] px-1.5 text-[11px] leading-5 text-[#55554F] hover:border-[#DDE0F7] hover:bg-[#EEF0FB] hover:text-[#4F5BD5]"
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-col gap-px border-t border-[#F1F1EE] pt-1.5">
              {(c.articles || []).slice(0, 3).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onOpenArticle(a.id)}
                  className="line-clamp-1 rounded px-1 py-[3px] text-left text-[11.5px] leading-[1.6] text-[#3D3D3A] hover:bg-[#F5F5F3] hover:text-[#4F5BD5]"
                  title={a.title}
                >
                  {a.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {Array.isArray(topics?.uncoveredArticles) && topics.uncoveredArticles.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#E7E7E4] bg-[#FCFCFB] px-4 py-3">
          <div className="mb-1.5 text-[12px] font-semibold text-[#1A1A1A]">未归类素材（{Number(topics?.uncovered) || 0} 篇）</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {topics.uncoveredArticles.slice(0, 6).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpenArticle(a.id)}
                className="max-w-[280px] truncate text-[11.5px] text-[#6B6B6B] hover:text-[#4F5BD5]"
                title={a.title}
              >
                · {a.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

TopicView.propTypes = {
  stats: PropTypes.object,
  topics: PropTypes.object,
  loading: PropTypes.bool,
  onPickTopic: PropTypes.func.isRequired,
  onOpenArticle: PropTypes.func.isRequired,
  onImport: PropTypes.func.isRequired,
}

export function InsightView({
  stats, duplicates, loading, onPickAccount, onPickTag, onOpenArticle, onShowThin,
}) {
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

  const thin = Number(stats.thin) || 0
  const avgQuality = Number(stats.avgQuality) || 0
  const dupGroups = Array.isArray(duplicates?.groups) ? duplicates.groups : []
  const cards = [
    { label: "素材总数", value: total, sub: `覆盖 ${byAccount.length} 个账号` },
    { label: "未使用", value: unused, sub: "尚未进入写作流程" },
    { label: "本周新增", value: weekAdded, sub: "最近 7 天采集入库" },
    { label: "被引用率", value: `${rate}%`, sub: `${Number(stats.cited) || 0} 篇已引用` },
    { label: "薄文", value: thin, sub: `平均质量分 ${avgQuality}`, warn: thin > 0 },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.label === "薄文" ? onShowThin : undefined}
            disabled={c.label !== "薄文"}
            className={cn(
              "rounded-lg border bg-white px-4 py-3.5 text-left",
              c.warn ? "border-[#EAD9A8] bg-[#FFFBF0]" : "border-[#E7E7E4]",
              c.label === "薄文" && "transition-colors hover:border-[#B7791F]",
            )}
          >
            <div className={cn("flex items-center justify-between text-[12px]", c.warn ? "text-[#8A6D2F]" : "text-[#6B6B6B]")}>
              <span>{c.label}</span>
              {c.label === "薄文" && c.warn ? <AlertTriangle className="h-3.5 w-3.5 text-[#B7791F]" /> : null}
            </div>
            <div className="mt-1.5 font-mono text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] tabular-nums text-[#1A1A1A]">{c.value}</div>
            <div className="mt-0.5 text-[11px] text-[#8E8E89]">{c.sub}</div>
          </button>
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

      <div className="mb-4 rounded-lg border border-[#E7E7E4] bg-white px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between gap-2 text-[13px] font-semibold text-[#1A1A1A]">
          <span>疑似重复</span>
          <span className="text-[11px] font-normal text-[#6B6B6B]">
            simhash + 余弦 · {Number(duplicates?.pairs) || 0} 组命中
          </span>
        </div>
        {dupGroups.length ? (
          <div className="flex flex-col gap-2">
            {dupGroups.slice(0, 5).map((g) => (
              <div key={g.id} className="rounded-md border border-[#F0EAD8] bg-[#FFFDF7] px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[#8A6D2F]">
                  <AlertTriangle className="h-3 w-3 text-[#B7791F]" />
                  相似度 {Math.round((Number(g.similarity) || 0) * 100)}% · {g.articles.length} 篇
                </div>
                <div className="flex flex-col gap-px">
                  {g.articles.slice(0, 4).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onOpenArticle(a.id)}
                      className="line-clamp-1 rounded px-1 py-[2px] text-left text-[12px] text-[#3D3D3A] hover:bg-[#FAF6EA] hover:text-[#8A6D2F]"
                      title={a.title}
                    >
                      {a.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-[#A0A09A]">当前知识库未发现高相似度重复文章。</div>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-[#EDE3C8] bg-[#FFFBF0] px-3 py-2 text-[13px] leading-[1.65] text-[#6F5722]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B7791F]" />
        <span>
          {unused} 篇素材尚未被引用{topTag ? `，其中主题「${topTag.tag}」素材最多（${topTag.count} 篇）` : ""}。本周新增 {weekAdded} 篇，另有 {thin} 篇薄文（正文不足 300 字），建议先补齐正文或排除后再进入选题池。
        </span>
      </div>
    </div>
  )
}

InsightView.propTypes = {
  stats: PropTypes.object,
  duplicates: PropTypes.object,
  loading: PropTypes.bool,
  onPickAccount: PropTypes.func.isRequired,
  onPickTag: PropTypes.func.isRequired,
  onOpenArticle: PropTypes.func.isRequired,
  onShowThin: PropTypes.func.isRequired,
}
