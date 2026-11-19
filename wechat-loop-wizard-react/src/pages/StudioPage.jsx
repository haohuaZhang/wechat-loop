import * as React from "react"
import PropTypes from "prop-types"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Lightbulb, FileText, LayoutTemplate, Send, RefreshCw, Loader2, Copy, Check,
  ChevronRight, Sparkles, Image as ImageIcon, AlertTriangle,
} from "lucide-react"

/**
 * StudioPage —— 选题与写作（闭环后半段）
 *
 * 四步流水线：
 *   ① 选题候选（后端 /api/loop/topics 打分）
 *   ② 生成写作 prompt（检索证据 + 人格/框架/维度）
 *   ③ 贴回成稿 Markdown → 排版预览
 *   ④ 生成封面 → 发公众号草稿箱
 */

const PERSONAS = [
  ["industry-observer", "行业观察者"],
  ["warm-storyteller", "温暖叙事者"],
  ["sharp-reviewer", "犀利评测者"],
]
const FRAMEWORKS = ["清单型", "故事型", "对比型", "问答型"]
const DIMENSIONS = [
  "叙事视角:问答体 + 类比域:电影 + 情绪基调:毒舌调侃",
  "叙事视角:第一人称 + 类比域:做饭 + 情绪基调:温和平实",
  "叙事视角:清单体 + 类比域:工具箱 + 情绪基调:干练直接",
]

const STEPS = [
  { key: "topics", label: "选题", icon: Lightbulb },
  { key: "prompt", label: "写作 prompt", icon: FileText },
  { key: "draft", label: "成稿与排版", icon: LayoutTemplate },
  { key: "publish", label: "发草稿箱", icon: Send },
]

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

/**
 * 步骤条
 * @param {{current: string, done: Record<string, boolean>, onJump: (k: string) => void}} props
 */
function StepBar({ current, done, onJump }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STEPS.map((s, i) => {
        const Icon = s.icon
        const active = current === s.key
        return (
          <React.Fragment key={s.key}>
            <button
              type="button"
              onClick={() => onJump(s.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs font-medium transition-colors",
                active && "border-primary bg-primary text-primary-foreground",
                !active && done[s.key] && "border-emerald-300 bg-emerald-50 text-emerald-700",
                !active && !done[s.key] && "border-border bg-card text-muted-foreground hover:bg-secondary",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {i + 1}. {s.label}
              {done[s.key] && !active && <Check className="h-3 w-3" />}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

StepBar.propTypes = {
  current: PropTypes.string.isRequired,
  done: PropTypes.object.isRequired,
  onJump: PropTypes.func.isRequired,
}

export function StudioPage() {
  const [step, setStep] = React.useState("topics")
  const [date, setDate] = React.useState(today())
  const [toast, setToast] = React.useState("")

  // ① 选题
  const [topics, setTopics] = React.useState([])
  const [topicsLoading, setTopicsLoading] = React.useState(true)
  const [topicsError, setTopicsError] = React.useState("")
  const [selected, setSelected] = React.useState(null)
  const [customTitle, setCustomTitle] = React.useState("")

  // ② prompt
  const [persona, setPersona] = React.useState(PERSONAS[0][0])
  const [framework, setFramework] = React.useState(FRAMEWORKS[0])
  const [dimensions, setDimensions] = React.useState(DIMENSIONS[0])
  const [prompt, setPrompt] = React.useState("")
  const [promptLoading, setPromptLoading] = React.useState(false)
  const [promptPath, setPromptPath] = React.useState("")
  const [evidenceCount, setEvidenceCount] = React.useState(0)
  const [copied, setCopied] = React.useState(false)

  // ③ 成稿
  const [markdown, setMarkdown] = React.useState("")
  const [theme, setTheme] = React.useState("professional-clean")
  const [html, setHtml] = React.useState("")
  const [previewUrl, setPreviewUrl] = React.useState("")
  const [draftLoading, setDraftLoading] = React.useState(false)
  const [draftNote, setDraftNote] = React.useState("")

  // ④ 发布
  const [coverUrl, setCoverUrl] = React.useState("")
  const [coverLoading, setCoverLoading] = React.useState(false)
  const [digest, setDigest] = React.useState("")
  const [publishing, setPublishing] = React.useState(false)
  const [publishResult, setPublishResult] = React.useState(null)

  const draftTitle = selected?.title || customTitle.trim()

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(""), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const loadTopics = React.useCallback(async () => {
    setTopicsLoading(true)
    setTopicsError("")
    try {
      const res = await api.loopTopics({ top_n: 8 })
      setTopics(res.top_topics || [])
    } catch (err) {
      setTopicsError(err?.message || "选题失败")
      setTopics([])
    } finally {
      setTopicsLoading(false)
    }
  }, [])

  React.useEffect(() => { loadTopics() }, [loadTopics])

  async function handleBuildPrompt() {
    if (!draftTitle) { setToast("先选一个选题，或自己填一个标题"); return }
    setPromptLoading(true)
    setPrompt("")
    setPublishResult(null)
    try {
      const res = await api.loopPrompt({
        title: draftTitle,
        keywords: selected?.keywords || [],
        persona, framework, dimensions, date,
      })
      setPrompt(res.prompt || "")
      setPromptPath(res.promptPath || "")
      setEvidenceCount(res.evidenceCount || 0)
      setStep("prompt")
    } catch (err) {
      setToast(err?.message || "生成 prompt 失败")
    } finally {
      setPromptLoading(false)
    }
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setToast("复制失败，请手动全选复制")
    }
  }

  async function handleDraft() {
    if (!markdown.trim()) { setToast("先贴入成稿 Markdown"); return }
    setDraftLoading(true)
    try {
      const res = await api.loopDraft({ markdown, date, theme })
      setHtml(res.html || "")
      setPreviewUrl(res.previewUrl || "")
      setDraftNote(res.note || "")
      setStep("draft")
      setToast("排版完成")
    } catch (err) {
      setToast(err?.message || "排版失败")
    } finally {
      setDraftLoading(false)
    }
  }

  async function handleCover() {
    if (!draftTitle) { setToast("缺少标题，无法生成封面"); return }
    setCoverLoading(true)
    try {
      const res = await api.loopCover({ title: draftTitle, subtitle: digest, date })
      setCoverUrl(res.url || "")
      setToast("封面已生成")
    } catch (err) {
      setToast(err?.message || "生成封面失败")
    } finally {
      setCoverLoading(false)
    }
  }

  async function handlePublish() {
    if (!draftTitle) { setToast("缺少标题"); return }
    if (!html) { setToast("先排版再发布"); return }
    setPublishing(true)
    setPublishResult(null)
    try {
      const res = await api.loopPublish({ title: draftTitle, digest, date })
      setPublishResult({ ok: true, data: res })
      setToast("已保存到草稿箱")
    } catch (err) {
      setPublishResult({ ok: false, error: err?.message || "发布失败" })
    } finally {
      setPublishing(false)
    }
  }

  const done = {
    topics: Boolean(draftTitle),
    prompt: Boolean(prompt),
    draft: Boolean(html),
    publish: Boolean(publishResult?.ok),
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 08</p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">选题与写作</h1>
          <p className="text-sm leading-7 text-muted-foreground">
            从知识库挑选题 → 生成写作 prompt → 贴回成稿排版 → 存进公众号草稿箱。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">工作日期</span>
          <Input value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-[120px] font-mono text-xs" />
        </div>
      </header>

      <StepBar current={step} done={done} onJump={setStep} />

      {toast && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">{toast}</div>
      )}

      {/* ① 选题 */}
      {step === "topics" && (
        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="text-sm font-semibold">候选选题</div>
              <Button variant="outline" size="sm" onClick={loadTopics} className="gap-1">
                <RefreshCw className={cn("h-3 w-3", topicsLoading && "animate-spin")} /> 重新打分
              </Button>
            </div>
            <div className="max-h-[46vh] overflow-auto">
              {topicsLoading && (
                <div className="space-y-2 p-3">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              )}
              {!topicsLoading && topicsError && (
                <div className="p-4 text-sm text-destructive">{topicsError}</div>
              )}
              {!topicsLoading && !topicsError && !topics.length && (
                <div className="p-6 text-sm text-muted-foreground">
                  没有可用选题。可能原因：知识库为空，或者素材都已被用过（used_as_source）。
                  <br />先去「公众号文章」采集几篇，或直接使用下方自定义标题。
                </div>
              )}
              {!topicsLoading && topics.map((t) => (
                <button
                  key={t.article_id}
                  type="button"
                  onClick={() => { setSelected(t); setCustomTitle("") }}
                  className={cn(
                    "block w-full border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-secondary/60",
                    selected?.article_id === t.article_id && "bg-secondary",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="line-clamp-2 text-sm font-medium leading-6">{t.title}</div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-primary">{(t.score ?? 0).toFixed(1)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-mono">{t.publish_date || "—"}</span>
                    <span>·</span>
                    <span>{t.source_account || "未知"}</span>
                    <span className="ml-auto font-mono">新鲜 {t.freshness} / 价值 {t.value}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-card p-3">
              <div className="mb-2 text-sm font-semibold">自定义选题</div>
              <Input
                value={customTitle}
                onChange={(e) => { setCustomTitle(e.target.value); setSelected(null) }}
                placeholder="比如：5 个免费看剧的网站"
                className="h-9"
              />
            </div>

            <div className="space-y-2.5 rounded-md border border-border bg-card p-3">
              <div className="text-sm font-semibold">写作参数</div>
              <label className="block text-xs text-muted-foreground">
                人格
                <select value={persona} onChange={(e) => setPersona(e.target.value)} className="mt-1 h-9 w-full rounded-sm border border-border bg-background px-2 text-sm text-foreground">
                  {PERSONAS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                框架
                <select value={framework} onChange={(e) => setFramework(e.target.value)} className="mt-1 h-9 w-full rounded-sm border border-border bg-background px-2 text-sm text-foreground">
                  {FRAMEWORKS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                维度随机化
                <select value={dimensions} onChange={(e) => setDimensions(e.target.value)} className="mt-1 h-9 w-full rounded-sm border border-border bg-background px-2 text-xs text-foreground">
                  {DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>

            <div className="rounded-md border border-border bg-surface p-3">
              <div className="text-xs text-muted-foreground">当前选题</div>
              <div className="mt-1 text-sm font-medium leading-6">
                {draftTitle || <span className="text-muted-foreground">未选择</span>}
              </div>
              <Button className="mt-3 w-full gap-1" onClick={handleBuildPrompt} disabled={promptLoading}>
                {promptLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                生成写作 prompt
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ② prompt */}
      {step === "prompt" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{draftTitle || "未选择选题"}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                证据 {evidenceCount} 条 · 人格 {persona} · 框架 {framework}
                {promptPath && <> · 已写入 <code className="font-mono">{promptPath}</code></>}
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={handleCopyPrompt} className="gap-1">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "已复制" : "复制"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setStep("draft")} className="gap-1">
                下一步：贴成稿 <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {!prompt && (
            <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
              还没有生成 prompt。回到「选题」选一个选题，点「生成写作 prompt」。
            </div>
          )}
          {prompt && (
            <>
              <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
                把这段 prompt 交给你的写作模型（Trae 里直接对话也行）。拿到成稿后，回到这一步点「下一步：贴成稿」。
              </div>
              <pre className="max-h-[52vh] overflow-auto rounded-md border border-border bg-background p-4 font-mono text-[11.5px] leading-6">
                {prompt}
              </pre>
            </>
          )}
        </section>
      )}

      {/* ③ 成稿与排版 */}
      {step === "draft" && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">主题</span>
              {["professional-clean", "sspai", "minimal"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={cn(
                    "rounded-sm border px-2 py-0.5 text-xs transition-colors",
                    theme === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={"# 标题\n\n正文段落…\n\n- 列表项\n- 列表项"}
              className="h-[46vh] w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-[12.5px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{markdown.length} 字符</span>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setMarkdown(prompt ? `# ${draftTitle}\n\n` : "")}>清空</Button>
                <Button size="sm" onClick={handleDraft} disabled={draftLoading} className="gap-1">
                  {draftLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5" />}
                  排版预览
                </Button>
              </div>
            </div>
          </div>

          <div className="flex min-h-[46vh] flex-col rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="text-sm font-semibold">排版预览</div>
              {previewUrl && (
                <Button variant="outline" size="sm" onClick={() => window.open(previewUrl, "_blank")}>新窗口打开</Button>
              )}
            </div>
            {draftNote && (
              <div className="border-b border-amber-300/60 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">{draftNote}</div>
            )}
            <div className="flex-1 overflow-auto p-4">
              {html ? (
                <div className="mx-auto max-w-[420px] rounded border border-border bg-white p-4">
                  <div dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  左侧贴入 Markdown 后点「排版预览」
                </div>
              )}
            </div>
            {html && (
              <div className="flex justify-end border-t border-border px-3 py-2">
                <Button size="sm" onClick={() => setStep("publish")} className="gap-1">
                  下一步：发草稿箱 <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ④ 发布 */}
      {step === "publish" && (
        <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-3 rounded-md border border-border bg-card p-4">
            <div className="text-sm font-semibold">发布前确认</div>
            <label className="block text-xs text-muted-foreground">
              标题
              <Input value={draftTitle} readOnly className="mt-1 h-9 bg-secondary/50" />
            </label>
            <label className="block text-xs text-muted-foreground">
              摘要（可选）
              <Input value={digest} onChange={(e) => setDigest(e.target.value)} placeholder="留空则用正文前几句" className="mt-1 h-9" />
            </label>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={handleCover} disabled={coverLoading} className="gap-1">
                {coverLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
                生成封面
              </Button>
              <Badge variant="outline" className="px-2 py-1 text-[11px]">
                排版 {html ? `${html.length} 字符` : "未完成"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handlePublish} disabled={publishing || !html} className="gap-1">
                {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                保存到草稿箱
              </Button>
              <span className="text-[11px] text-muted-foreground">
                需要公众号已登录（cookies.json），否则会报错
              </span>
            </div>

            {publishResult && !publishResult.ok && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-6 text-destructive">
                <div className="mb-1 flex items-center gap-1 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> 发布失败
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{publishResult.error}</pre>
              </div>
            )}
            {publishResult?.ok && (
              <div className="rounded-md border border-emerald-400/50 bg-emerald-50 p-3 text-xs leading-6 text-emerald-800">
                已保存到草稿箱。
                {publishResult.data?.result?.media_id && <div className="font-mono">media_id: {publishResult.data.result.media_id}</div>}
                <div>去 mp.weixin.qq.com → 草稿箱 里检查，然后手动群发。</div>
              </div>
            )}
          </div>

          <div className="rounded-md border border-border bg-card p-3">
            <div className="mb-2 text-sm font-semibold">封面</div>
            {coverUrl ? (
              <img src={coverUrl} alt="封面" className="w-full rounded border border-border" />
            ) : (
              <div className="flex h-[120px] items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                点「生成封面」后显示
              </div>
            )}
            <div className="mt-3 text-[11px] leading-6 text-muted-foreground">
              封面由 Pillow 本地绘制（900×383），不消耗 AI 额度。想换成自己设计的图，把 cover.png 覆盖到工作目录即可。
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
