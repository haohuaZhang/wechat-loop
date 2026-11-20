import * as React from "react"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"
import {
  Search, X, Download, RefreshCw, Loader2, Plus, Database, Upload,
  LayoutList, LayoutGrid, ChevronDown, Quote, Trash2, Pencil, FolderPlus,
} from "lucide-react"
import {
  TOKENS, STATUS_META, normalizeItem, normalizeDetail,
  ToastStack, Overlay, KbButton, KbInput,
} from "@/components/library/KbShared"
import { LibrarySidebar } from "@/components/library/LibrarySidebar"
import { MaterialView } from "@/components/library/MaterialView"
import { DetailDrawer } from "@/components/library/DetailDrawer"
import { TopicView, InsightView } from "@/components/library/TopicInsight"

const PAGE_SIZE = 50
const NONE = "__none__"
const SORT_OPTIONS = [
  ["date_desc", "最新优先"],
  ["date_asc", "最早优先"],
  ["words_desc", "字数最多"],
]

async function copyText(text) {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 剪贴板被禁用时退回 textarea + execCommand
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function BulkBtn({ children, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center rounded-md border px-2 text-[12px] transition-colors",
        danger
          ? "border-[#43302E] bg-transparent text-[#F0A3A3] hover:bg-[#332625]"
          : "border-[#3A3A36] bg-transparent text-[#EDEDEA] hover:bg-[#2C2C29]",
      )}
    >
      {children}
    </button>
  )
}

export function LibraryPage() {
  const [view, setView] = React.useState("material")
  const [layout, setLayout] = React.useState("list")
  const [density, setDensity] = React.useState("comfortable")

  const [kbs, setKbs] = React.useState([])
  const [stats, setStats] = React.useState(null)
  const [sideLoading, setSideLoading] = React.useState(true)
  const [collections, setCollections] = React.useState([])
  const [views, setViews] = React.useState([])
  const [savingView, setSavingView] = React.useState(false)

  const [query, setQuery] = React.useState("")
  const [searchQ, setSearchQ] = React.useState("")
  const [searchRes, setSearchRes] = React.useState(null)
  const [searchLoading, setSearchLoading] = React.useState(false)

  const [filters, setFilters] = React.useState({ collection: "", account: "", status: "", tag: "", quality: "" })
  const [savedId, setSavedId] = React.useState("")
  const [searchEngine, setSearchEngine] = React.useState("hybrid")
  const [topics, setTopics] = React.useState(null)
  const [topicsLoading, setTopicsLoading] = React.useState(false)
  const [duplicates, setDuplicates] = React.useState(null)
  const [excerpts, setExcerpts] = React.useState([])
  const [evidenceTitle, setEvidenceTitle] = React.useState("")
  const [evidenceBusy, setEvidenceBusy] = React.useState(false)
  const [newColName, setNewColName] = React.useState("")
  const [newColParent, setNewColParent] = React.useState("")
  const [colEdit, setColEdit] = React.useState(null)
  const [sort, setSort] = React.useState("date_desc")
  const [page, setPage] = React.useState(0)
  const [listVersion, setListVersion] = React.useState(0)

  const [list, setList] = React.useState({ items: [], total: 0 })
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState("")

  const [activeId, setActiveId] = React.useState("")
  const [detail, setDetail] = React.useState(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailError, setDetailError] = React.useState("")
  const [refreshTick, setRefreshTick] = React.useState(0)

  const [checked, setChecked] = React.useState(() => new Set())
  const [busy, setBusy] = React.useState(false)
  const [modal, setModal] = React.useState(null)
  const [tagInput, setTagInput] = React.useState("")
  const [collectionChoice, setCollectionChoice] = React.useState("")
  const [newCollectionName, setNewCollectionName] = React.useState("")
  const [newKbName, setNewKbName] = React.useState("")
  const [newKbPath, setNewKbPath] = React.useState("")
  const [importing, setImporting] = React.useState(false)
  const [importPreview, setImportPreview] = React.useState(null)
  const [exportOpen, setExportOpen] = React.useState(false)
  const [toasts, setToasts] = React.useState([])

  const searchRef = React.useRef(null)
  const selectAllRef = React.useRef(null)
  const lastIndexRef = React.useRef(null)
  const toastSeq = React.useRef(0)

  const pushToast = React.useCallback((msg) => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts((prev) => [...prev.slice(-3), { id, msg }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800)
  }, [])

  const loadKbs = React.useCallback(async () => {
    try {
      setKbs(await api.kbList())
    } catch {
      // 知识库列表失败不阻塞素材读取
    }
  }, [])

  const loadSide = React.useCallback(async () => {
    setSideLoading(true)
    const [s, c, v] = await Promise.allSettled([api.kbStats(), api.kbCollections(), api.kbViews()])
    if (s.status === "fulfilled") setStats(s.value || null)
    else pushToast(s.reason?.message || "统计加载失败")
    if (c.status === "fulfilled") setCollections(c.value || [])
    if (v.status === "fulfilled") setViews(v.value || [])
    setSideLoading(false)
  }, [pushToast])

  const loadList = React.useCallback(async (opts = {}) => {
    const offset = opts.offset != null ? opts.offset : page * PAGE_SIZE
    if (!opts.silent) setLoading(true)
    setError("")
    try {
      const res = await api.kbArticles({
        account: filters.account || "all",
        tag: filters.tag || "all",
        status: filters.status || "all",
        quality: filters.quality || "",
        collection: filters.collection || "all",
        sort,
        limit: PAGE_SIZE,
        offset,
      })
      const items = (res?.items || []).map(normalizeItem)
      setList({ items, total: Number(res?.total) || items.length })
    } catch (err) {
      setError(err?.message || "读取知识库失败")
      if (!opts.silent) pushToast(err?.message || "读取知识库失败")
    } finally {
      setLoading(false)
    }
  }, [filters.account, filters.tag, filters.status, filters.quality, filters.collection, sort, page, listVersion, pushToast])

  const loadExcerpts = React.useCallback(async () => {
    try {
      const res = await api.kbExcerpts()
      setExcerpts(res?.items || [])
    } catch {
      // 摘录读取失败不阻塞主流程
    }
  }, [])

  const loadTopics = React.useCallback(async () => {
    setTopicsLoading(true)
    try {
      setTopics(await api.kbTopics({ limit: 8 }))
    } catch (err) {
      pushToast(err?.message || "主题聚类失败")
    } finally {
      setTopicsLoading(false)
    }
  }, [pushToast])

  const loadDuplicates = React.useCallback(async () => {
    try {
      setDuplicates(await api.kbDuplicates({ limit: 30 }))
    } catch {
      setDuplicates(null)
    }
  }, [])

  React.useEffect(() => { loadKbs() }, [loadKbs])
  React.useEffect(() => { loadSide() }, [loadSide])
  React.useEffect(() => { loadList() }, [loadList])
  React.useEffect(() => { loadExcerpts() }, [loadExcerpts])
  React.useEffect(() => {
    if (view === "topic") loadTopics()
    if (view === "insight") loadDuplicates()
  }, [view, listVersion, loadTopics, loadDuplicates])

  React.useEffect(() => { setPage(0) }, [filters.collection, filters.account, filters.status, filters.tag, filters.quality, sort])
  React.useEffect(() => { setChecked(new Set()) }, [searchQ, filters.collection, filters.account, filters.status, filters.tag, filters.quality])

  React.useEffect(() => {
    const t = window.setTimeout(() => setSearchQ(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])

  React.useEffect(() => {
    if (!searchQ) { setSearchRes(null); setSearchLoading(false); return undefined }
    let cancelled = false
    setSearchLoading(true)
    api.kbSearch({ q: searchQ, limit: 50, mode: searchEngine })
      .then((res) => {
        if (cancelled) return
        setSearchRes({
          items: (res?.items || []).map(normalizeItem),
          total: Number(res?.total) || 0,
          mode: res?.mode || "",
        })
      })
      .catch((err) => {
        if (cancelled) return
        setSearchRes({ items: [], total: 0, error: err?.message || "搜索失败" })
        pushToast(err?.message || "搜索失败")
      })
      .finally(() => { if (!cancelled) setSearchLoading(false) })
    return () => { cancelled = true }
  }, [searchQ, searchEngine, pushToast])

  React.useEffect(() => {
    if (!activeId) { setDetail(null); setDetailError(""); return undefined }
    let cancelled = false
    setDetailLoading(true)
    setDetailError("")
    api.kbArticle(activeId)
      .then((raw) => { if (!cancelled) setDetail(normalizeDetail(raw || {})) })
      .catch((err) => {
        if (!cancelled) { setDetail(null); setDetailError(err?.message || "加载失败") }
      })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [activeId, refreshTick])

  const searchMode = Boolean(searchQ)
  const displayItems = searchMode ? (searchRes?.items || []) : list.items
  const displayTotal = searchMode ? (searchRes?.total || 0) : list.total
  const loadingState = loading || (searchMode && (searchLoading || !searchRes))
  const errorState = searchMode ? (searchRes?.error || "") : error
  const paginated = !searchMode && list.total > 200
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE))
  const hasStructural = Boolean(filters.collection || filters.account || filters.status || filters.tag)
  const hasAnyFilter = hasStructural || searchMode

  const clearSearch = () => {
    setQuery("")
    setSearchQ("")
    setSearchRes(null)
  }

  const applyFilters = (patch = {}) => {
    const next = { ...patch }
    if ("savedId" in next) {
      setSavedId(next.savedId || "")
      delete next.savedId
    } else {
      setSavedId("")
    }
    setFilters((prev) => ({ ...prev, ...next }))
    setView("material")
  }

  const clearFilters = () => {
    setFilters({ collection: "", account: "", status: "", tag: "", quality: "" })
    setSavedId("")
    clearSearch()
  }

  const applyView = (v) => {
    const f = v?.filter || {}
    setFilters({
      collection: f.collection || "",
      account: f.account || "",
      status: ["unused", "cited", "drafted"].includes(f.status) ? f.status : "",
      tag: f.tag || "",
      quality: ["thin", "no_body", "no_keywords"].includes(f.quality) ? f.quality : "",
    })
    if (f.sort) setSort(f.sort)
    if (f.q) { setQuery(f.q); setSearchQ(f.q) }
    setSavedId(v.id)
    setView("material")
  }

  const saveView = async (name) => {
    setSavingView(true)
    try {
      const filter = {}
      if (filters.collection) filter.collection = filters.collection
      if (filters.account) filter.account = filters.account
      if (filters.status) filter.status = filters.status
      if (filters.tag) filter.tag = filters.tag
      if (filters.quality) filter.quality = filters.quality
      filter.sort = sort
      await api.kbCreateView({ name, filter })
      await loadSide()
      pushToast(`已保存视图「${name}」`)
      return true
    } catch (err) {
      pushToast(err?.message || "保存视图失败")
      return false
    } finally {
      setSavingView(false)
    }
  }

  const toggleCheck = (id, index, event) => {
    const next = new Set(checked)
    if (event?.shiftKey && lastIndexRef.current != null && displayItems[lastIndexRef.current]) {
      const from = Math.min(lastIndexRef.current, index)
      const to = Math.max(lastIndexRef.current, index)
      for (let i = from; i <= to; i += 1) {
        const item = displayItems[i]
        if (item) next.add(item.id)
      }
    } else if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    lastIndexRef.current = index
    setChecked(next)
  }

  const allChecked = displayItems.length > 0 && displayItems.every((i) => checked.has(i.id))
  const toggleAll = () => {
    const next = new Set(checked)
    if (allChecked) displayItems.forEach((i) => next.delete(i.id))
    else displayItems.forEach((i) => next.add(i.id))
    setChecked(next)
  }

  const reloadAfterMutation = React.useCallback(async () => {
    await Promise.allSettled([loadList({ silent: true }), loadSide()])
    setRefreshTick((t) => t + 1)
    if (view === "topic") loadTopics()
    if (view === "insight") loadDuplicates()
  }, [loadList, loadSide, view, loadTopics, loadDuplicates])

  const runBatch = React.useCallback(async ({ ids, op, value = "", silent = false }) => {
    setBusy(true)
    try {
      const res = await api.kbBatch({ ids, op, value })
      if (!silent) {
        const updated = Number(res?.updated)
        const removed = Number(res?.removed)
        pushToast(`已更新 ${Number.isFinite(updated) ? updated : ids.length} 篇${removed ? `，移除 ${removed} 篇` : ""}`)
      }
      return res
    } catch (err) {
      pushToast(err?.message || "批量操作失败")
      return null
    } finally {
      setBusy(false)
    }
  }, [pushToast])

  const submitBulkTag = async () => {
    const value = tagInput.trim()
    if (!value) return
    const ids = [...checked]
    const res = await runBatch({ ids, op: "tag", value, silent: true })
    if (!res) return
    setModal(null)
    setChecked(new Set())
    pushToast(`已为 ${ids.length} 篇素材打上「${value}」`)
    await reloadAfterMutation()
  }

  const submitBulkCollection = async () => {
    if (!collectionChoice) return
    let name = collectionChoice
    if (collectionChoice === "__new__") {
      name = newCollectionName.trim()
      if (!name) return
      try {
        await api.kbCreateCollection(name)
      } catch (err) {
        pushToast(err?.message || "新建集合失败")
        return
      }
    }
    const ids = [...checked]
    const res = await runBatch({ ids, op: "move", value: name, silent: true })
    if (!res) return
    setModal(null)
    setChecked(new Set())
    pushToast(`已把 ${ids.length} 篇素材加入「${name}」`)
    await reloadAfterMutation()
  }

  const submitBulkDelete = async () => {
    const ids = [...checked]
    const res = await runBatch({ ids, op: "remove", silent: true })
    if (!res) return
    setModal(null)
    setChecked(new Set())
    if (ids.includes(activeId)) setActiveId("")
    pushToast(`已删除 ${ids.length} 篇素材`)
    await reloadAfterMutation()
  }

  const updateDetailStatus = async (status) => {
    if (!detail) return
    const res = await runBatch({ ids: [detail.id], op: "stage", value: status, silent: true })
    if (!res) return
    setDetail((d) => (d ? { ...d, status } : d))
    pushToast(`已标记为${STATUS_META[status].label}`)
    await reloadAfterMutation()
  }

  const addDetailTag = async (tag) => {
    if (!detail || !tag) return
    const res = await runBatch({ ids: [detail.id], op: "tag", value: tag, silent: true })
    if (!res) return
    setDetail((d) => (d ? { ...d, tags: d.tags.includes(tag) ? d.tags : [...d.tags, tag] } : d))
    pushToast(`已添加标签「${tag}」`)
    await reloadAfterMutation()
  }

  const removeDetailTag = async (tag) => {
    if (!detail || !tag) return
    const res = await runBatch({ ids: [detail.id], op: "untag", value: tag, silent: true })
    if (!res) return
    setDetail((d) => (d ? { ...d, tags: d.tags.filter((t) => t !== tag) } : d))
    pushToast(`已移除标签「${tag}」`)
    await reloadAfterMutation()
  }

  const citeDetail = async () => {
    if (!detail) return
    const copied = detail.url ? await copyText(detail.url) : false
    const res = await runBatch({ ids: [detail.id], op: "stage", value: "cited", silent: true })
    if (!res) return
    setDetail((d) => (d ? { ...d, status: "cited" } : d))
    await reloadAfterMutation()
    pushToast(copied ? "已复制原文链接，并标记为已引用" : "已标记为已引用（这篇没有原文链接）")
  }

  const copyDetailLink = async () => {
    if (!detail?.url) { pushToast("这篇没有原文链接"); return }
    const ok = await copyText(detail.url)
    pushToast(ok ? "已复制原文链接" : "复制失败，请手动复制")
  }

  const handleExcerpt = async (text) => {
    if (!detail) return
    try {
      const res = await api.kbAddExcerpt({ articleId: detail.id, text })
      await loadExcerpts()
      pushToast(res?.duplicate ? "这段已在素材篮里" : `已加入素材篮（${text.length} 字）`)
    } catch (err) {
      pushToast(err?.message || "保存摘录失败")
    }
  }

  const removeExcerpt = async (id) => {
    try {
      await api.kbDeleteExcerpt(id)
      await loadExcerpts()
    } catch (err) {
      pushToast(err?.message || "删除摘录失败")
    }
  }

  const openBasket = () => {
    setEvidenceTitle("")
    setModal("basket")
    loadExcerpts()
  }

  const submitEvidence = async () => {
    const excerptIds = excerpts.map((e) => e.id)
    const articleIds = [...checked]
    if (!excerptIds.length && !articleIds.length) {
      pushToast("素材篮是空的，先在正文里划线摘录或勾选文章")
      return
    }
    setEvidenceBusy(true)
    try {
      const res = await api.kbEvidence({ title: evidenceTitle.trim(), excerptIds, articleIds })
      setModal(null)
      pushToast(`证据包已生成：${res.evidencePath}（${res.evidenceCount} 条）`)
      if (res.promptPath) pushToast(`Prompt 已生成：${res.promptPath}`)
      for (const w of res.warnings || []) pushToast(w)
      await Promise.allSettled([loadExcerpts(), loadSide(), loadList({ silent: true })])
      setRefreshTick((t) => t + 1)
    } catch (err) {
      pushToast(err?.message || "生成证据包失败")
    } finally {
      setEvidenceBusy(false)
    }
  }

  const pickTopic = (label) => {
    const kw = String(label || "").trim()
    if (!kw) return
    setFilters({ collection: "", account: "", status: "", tag: "", quality: "" })
    setSavedId("")
    setQuery(kw)
    setSearchQ(kw)
    setView("material")
  }

  const showThin = () => {
    setView("material")
    applyFilters({ quality: "thin" })
  }

  const openCollections = () => {
    setColEdit(null)
    setNewColName("")
    setNewColParent("")
    setModal("manageCollections")
  }

  const createCollection = async () => {
    const name = newColName.trim()
    if (!name) return
    try {
      await api.kbCreateCollection(name, newColParent)
      setNewColName("")
      await loadSide()
      pushToast(`已新建集合「${name}」`)
    } catch (err) {
      pushToast(err?.message || "新建集合失败")
    }
  }

  const saveCollectionRename = async () => {
    if (!colEdit?.id || !colEdit.name.trim()) return
    try {
      await api.kbCollectionOp("rename", { id: colEdit.id, name: colEdit.name.trim() })
      setColEdit(null)
      await loadSide()
      pushToast("集合已重命名")
    } catch (err) {
      pushToast(err?.message || "重命名失败")
    }
  }

  const deleteCollection = async (c) => {
    try {
      await api.kbCollectionOp("delete", { id: c.id })
      if (filters.collection === c.name) applyFilters({ collection: "" })
      await loadSide()
      pushToast(`已删除集合「${c.name}」`)
    } catch (err) {
      pushToast(err?.message || "删除集合失败")
    }
  }

  const exportSelected = () => {
    if (!checked.size) return
    const url = api.kbExportUrl("md", { ...filters, sort, ids: [...checked] })
    window.open(url, "_blank")
    pushToast(`已开始导出 ${checked.size} 篇素材`)
  }

  const exportAll = (format) => {
    setExportOpen(false)
    window.open(api.kbExportUrl(format, { ...filters, sort }), "_blank")
  }

  const exportIncremental = () => {
    setExportOpen(false)
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    window.open(api.kbExportUrl("zip", { ...filters, sort, since }), "_blank")
    pushToast(`已开始增量导出（${since} 起新增，ZIP）`)
  }

  const switchKb = async (id) => {
    if (!id) return
    const target = kbs.find((k) => k.id === id)
    if (target?.isActive) return
    setLoading(true)
    try {
      await api.kbSetActive(id)
      setActiveId("")
      setChecked(new Set())
      setFilters({ collection: "", account: "", status: "", tag: "", quality: "" })
      setSavedId("")
      setPage(0)
      setListVersion((v) => v + 1)
      clearSearch()
      await Promise.all([loadKbs(), loadSide()])
    } catch (err) {
      pushToast(err?.message || "切换知识库失败")
      setLoading(false)
    }
  }

  const submitCreateKb = async () => {
    const name = newKbName.trim()
    if (!name) { pushToast("请填写知识库名称"); return }
    const slug = /^[A-Za-z0-9_-]+$/.test(name) ? name.toLowerCase() : `kb_${Date.now().toString(36)}`
    const path = newKbPath.trim() || `loop/kb/${slug}.json`
    setBusy(true)
    try {
      const created = await api.kbCreate({ name, path })
      setModal(null)
      await loadKbs()
      pushToast(`已创建知识库「${name}」`)
      if (created?.id) await switchKb(created.id)
    } catch (err) {
      pushToast(err?.message || "新建知识库失败")
    } finally {
      setBusy(false)
    }
  }

  const openImport = async () => {
    setImporting(true)
    try {
      const prev = await api.kbImportSources()
      setImportPreview(prev)
      const toImport = Number(prev.toImport) || 0
      if (!prev.available) pushToast("暂无可导入的采集结果")
      else if (!toImport) pushToast(`采集结果共 ${prev.available} 篇，均已在当前知识库中`)
      else setModal("import")
    } catch (err) {
      pushToast(err?.message || "读取采集结果失败")
    } finally {
      setImporting(false)
    }
  }

  const confirmImport = async () => {
    setImporting(true)
    try {
      const res = await api.kbImport()
      setModal(null)
      const msg = res.added > 0
        ? `成功导入 ${res.added} 篇${res.skipped ? `，跳过 ${res.skipped} 篇已存在` : ""}`
        : (res.message || `没有新增导入（跳过 ${res.skipped || 0} 篇）`)
      pushToast(msg)
      setActiveId("")
      await Promise.all([loadSide(), loadList({ silent: true, offset: 0 })])
    } catch (err) {
      pushToast(err?.message || "导入采集结果失败")
    } finally {
      setImporting(false)
    }
  }

  React.useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName
      const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable
      if (e.key === "Escape") {
        if (modal) { setModal(null); return }
        if (exportOpen) { setExportOpen(false); return }
        if (activeId) { setActiveId(""); return }
      }
      if (editable) return
      if (e.key === "/") {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (!displayItems.length) return
      if (e.key === "j" || e.key === "k") {
        e.preventDefault()
        const idx = displayItems.findIndex((i) => i.id === activeId)
        const next = e.key === "j"
          ? Math.min(displayItems.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx < 0 ? 0 : idx - 1)
        setActiveId(displayItems[next].id)
        return
      }
      if (e.key === "x" && activeId) {
        e.preventDefault()
        const idx = displayItems.findIndex((i) => i.id === activeId)
        toggleCheck(activeId, idx < 0 ? 0 : idx, {})
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [modal, exportOpen, activeId, displayItems, toggleCheck, checked])

  const activeKb = kbs.find((k) => k.isActive)
  const chips = []
  if (filters.collection) chips.push({ key: "collection", label: "集合", value: filters.collection === NONE ? "未归类" : filters.collection })
  if (filters.account) chips.push({ key: "account", label: "账号", value: filters.account })
  if (filters.status) chips.push({ key: "status", label: "状态", value: STATUS_META[filters.status]?.label || filters.status })
  if (filters.tag) chips.push({ key: "tag", label: "标签", value: filters.tag })
  if (filters.quality) chips.push({ key: "quality", label: "质量", value: filters.quality === "thin" ? "薄文" : filters.quality })
  if (searchQ) chips.push({ key: "query", label: "搜索", value: `「${searchQ}」` })

  const removeChip = (key) => {
    if (key === "query") { clearSearch(); return }
    applyFilters({ [key]: "" })
  }

  return (
    <div className={cn("-mx-4 flex h-[calc(100vh-8rem)] min-h-[600px] flex-col overflow-hidden rounded-lg border text-[#1A1A1A] md:-mx-6", TOKENS.bg, TOKENS.line)}>
      <header className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b px-3", TOKENS.line, TOKENS.panel)}>
        <div className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2", TOKENS.line)}>
          <Database className="h-3.5 w-3.5 text-[#6B6B6B]" />
          <select
            value={activeKb?.id || ""}
            onChange={(e) => switchKb(e.target.value)}
            className="max-w-[150px] cursor-pointer bg-transparent text-[13px] font-medium outline-none"
            aria-label="切换知识库"
          >
            {!kbs.length && <option value="">加载中…</option>}
            {kbs.map((k) => (
              <option key={k.id} value={k.id}>{k.name}（{k.articleCount}）</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { setNewKbName(""); setNewKbPath(""); setModal("createKb") }}
            className="grid h-5 w-5 place-items-center rounded text-[#6B6B6B] hover:bg-[#F5F5F3] hover:text-[#1A1A1A]"
            aria-label="新建知识库"
            title="新建知识库"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex h-8 shrink-0 items-center rounded-md bg-[#F4F4F2] p-0.5" role="tablist" aria-label="视图切换">
          {[["material", "素材"], ["topic", "主题"], ["insight", "洞察"]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                "h-7 whitespace-nowrap rounded px-3 text-[13px] transition-colors",
                view === key ? "border border-[#E7E7E4] bg-white font-medium text-[#1A1A1A]" : "text-[#6B6B6B] hover:text-[#1A1A1A]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={cn("relative flex h-8 min-w-[150px] max-w-[420px] flex-1 items-center rounded-md border bg-[#FAFAF9] pl-8 pr-8", TOKENS.line)}>
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#6B6B6B]" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") clearSearch() }}
            placeholder="搜索标题、正文、标签…  按 / 聚焦"
            className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-[#9A9A96]"
            aria-label="搜索素材"
          />
          {query ? (
            <button type="button" onClick={clearSearch} className="absolute right-2 grid h-5 w-5 place-items-center rounded text-[#6B6B6B] hover:bg-[#F5F5F3]" aria-label="清除搜索">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2 rounded-[3px] border border-[#E7E7E4] bg-white px-1.5 font-mono text-[11px] text-[#8E8E89]">/</kbd>
          )}
        </div>

        <select
          value={searchEngine}
          onChange={(e) => setSearchEngine(e.target.value)}
          title="检索模式：关键词 / 语义 / 混合（RRF）"
          className="h-8 shrink-0 rounded-md border border-[#E7E7E4] bg-white px-1.5 text-[12px] text-[#3D3D3A] outline-none focus:border-[#4F5BD5]"
        >
          <option value="hybrid">混合检索</option>
          <option value="kw">关键词</option>
          <option value="vec">语义</option>
        </select>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <KbButton
            onClick={openBasket}
            title="素材篮：划线摘录与已勾选文章"
            aria-label={`素材篮：${excerpts.length} 条摘录`}
          >
            <Quote className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">素材篮</span>
            <span className={cn("rounded-full px-1.5 font-mono text-[10px] tabular-nums", excerpts.length ? "bg-[#EEF0FB] text-[#4F5BD5]" : "bg-[#F1F1EE] text-[#8E8E89]")}>
              {excerpts.length}
            </span>
          </KbButton>
          <KbButton onClick={openImport} disabled={importing}>
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span className="hidden 2xl:inline">导入采集结果</span>
            <span className="2xl:hidden">导入</span>
          </KbButton>
          <div className="relative">
            <KbButton onClick={() => setExportOpen((v) => !v)}>
              <Download className="h-3.5 w-3.5" /> <span className="hidden xl:inline">导出</span> <ChevronDown className="h-3 w-3" />
            </KbButton>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} role="presentation" />
                <div className={cn("absolute right-0 top-9 z-50 w-36 rounded-md border bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]", TOKENS.line)}>
                  {[["md", "Markdown"], ["zip", "ZIP 打包"], ["json", "JSON"]].map(([fmt, label]) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => exportAll(fmt)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-[#F5F5F3]"
                    >
                      <Download className="h-3 w-3 text-[#6B6B6B]" /> {label}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-[#F1F1EE]" />
                  <button
                    type="button"
                    onClick={exportIncremental}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-[#F5F5F3]"
                    title="只导出最近 7 天新增（按当前筛选）"
                  >
                    <RefreshCw className="h-3 w-3 text-[#6B6B6B]" /> 增量（近 7 天）
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="hidden h-8 overflow-hidden rounded-md border border-[#E7E7E4] xl:flex" role="group" aria-label="列表密度">
            {[["compact", "紧凑"], ["comfortable", "舒适"]].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDensity(key)}
                className={cn(
                  "px-2 text-[12px] transition-colors",
                  density === key ? "bg-[#EEF0FB] font-medium text-[#4F5BD5]" : "bg-white text-[#6B6B6B] hover:bg-[#F5F5F3]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <LibrarySidebar
          stats={stats}
          collections={collections}
          views={views.length ? views : (Array.isArray(stats?.views) ? stats.views : [])}
          listTotal={list.total}
          filters={filters}
          savedId={savedId}
          onFilter={applyFilters}
          onApplyView={applyView}
          onSaveView={saveView}
          savingView={savingView}
          onManageCollections={openCollections}
        />

        <main className="min-w-0 flex-1 overflow-auto px-5 pb-24 pt-4">
          <div className="mx-auto w-full max-w-[1180px]">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.01em]">
                  {view === "material" ? "素材" : view === "topic" ? "主题" : "洞察"}
                </h1>
                <span className="font-mono text-[12px] tabular-nums text-[#6B6B6B]">
                  {view === "material"
                    ? `共 ${displayTotal} 篇`
                    : view === "topic"
                      ? `${(stats?.byTag || []).length} 个主题`
                      : `基于当前知识库 · ${Number(stats?.total) || 0} 篇`}
                </span>
                {hasAnyFilter && view === "material" && (
                  <span className="rounded-[3px] bg-[#EEF0FB] px-1.5 text-[11px] leading-[17px] text-[#4F5BD5]">已筛选</span>
                )}
              </div>
              {view === "material" && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={filters.status}
                    onChange={(e) => applyFilters({ status: e.target.value })}
                    className={cn("h-8 rounded-md border bg-white px-2 text-[12px] text-[#3D3D3A] outline-none", TOKENS.line)}
                    aria-label="按状态筛选"
                  >
                    <option value="">全部状态</option>
                    <option value="unused">未用</option>
                    <option value="cited">已引用</option>
                    <option value="drafted">已成稿</option>
                  </select>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className={cn("h-8 rounded-md border bg-white px-2 text-[12px] text-[#3D3D3A] outline-none", TOKENS.line)}
                    aria-label="排序"
                  >
                    {SORT_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  <div className="flex overflow-hidden rounded-md border border-[#E7E7E4]" role="group" aria-label="列表形态">
                    <button type="button" onClick={() => setLayout("list")} className={cn("flex h-8 items-center gap-1 px-2 text-[12px]", layout === "list" ? "bg-[#EEF0FB] font-medium text-[#4F5BD5]" : "bg-white text-[#6B6B6B] hover:bg-[#F5F5F3]")}>
                      <LayoutList className="h-3.5 w-3.5" /> 列表
                    </button>
                    <button type="button" onClick={() => setLayout("card")} className={cn("flex h-8 items-center gap-1 border-l border-[#E7E7E4] px-2 text-[12px]", layout === "card" ? "bg-[#EEF0FB] font-medium text-[#4F5BD5]" : "bg-white text-[#6B6B6B] hover:bg-[#F5F5F3]")}>
                      <LayoutGrid className="h-3.5 w-3.5" /> 卡片
                    </button>
                  </div>
                  <KbButton className="gap-1" onClick={() => { loadSide(); loadList() }}>
                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> 刷新
                  </KbButton>
                </div>
              )}
            </div>

            {view === "material" && chips.length > 0 && (
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <span key={c.key} className="inline-flex h-6 max-w-[260px] items-center gap-1 rounded bg-[#EEF0FB] pl-2 pr-1 text-[12px] text-[#4F5BD5]">
                    <span className="truncate">{c.label}：{c.value}</span>
                    <button type="button" onClick={() => removeChip(c.key)} className="grid h-4 w-4 shrink-0 place-items-center rounded hover:bg-[#DDE0F7]" aria-label={`移除筛选 ${c.label}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={clearFilters} className="px-0.5 text-[12px] text-[#6B6B6B] underline underline-offset-2 hover:text-[#1A1A1A]">
                  清除筛选
                </button>
              </div>
            )}

            {view === "material" && (
              <MaterialView
                items={displayItems}
                total={displayTotal}
                loading={loadingState}
                loadingMore={loadingMore}
                error={errorState}
                keyword={searchQ}
                layout={layout}
                density={density}
                activeId={activeId}
                checked={checked}
                onToggleCheck={toggleCheck}
                onToggleAll={toggleAll}
                selectAllRef={selectAllRef}
                onOpen={setActiveId}
                onRetry={() => { loadSide(); loadList() }}
                onLoadMore={async () => {
                  setLoadingMore(true)
                  try {
                    const res = await api.kbArticles({
                      account: filters.account || "all",
                      tag: filters.tag || "all",
                      status: filters.status || "all",
                      quality: filters.quality || "",
                      collection: filters.collection || "all",
                      sort,
                      limit: PAGE_SIZE,
                      offset: list.items.length,
                    })
                    const more = (res?.items || []).map(normalizeItem)
                    setList((prev) => ({ items: [...prev.items, ...more], total: Number(res?.total) || prev.total }))
                  } catch (err) {
                    pushToast(err?.message || "加载更多失败")
                  } finally {
                    setLoadingMore(false)
                  }
                }}
                paginated={paginated}
                page={page}
                pageCount={pageCount}
                onPage={setPage}
                onClearFilters={clearFilters}
                onImport={openImport}
                hasAnyFilter={hasAnyFilter}
                searchMode={searchMode}
              />
            )}

            {view === "topic" && (
              <TopicView
                stats={stats}
                topics={topics}
                loading={sideLoading || topicsLoading}
                onPickTopic={pickTopic}
                onOpenArticle={setActiveId}
                onImport={openImport}
              />
            )}

            {view === "insight" && (
              <InsightView
                stats={stats}
                duplicates={duplicates}
                loading={sideLoading}
                onPickAccount={(account) => applyFilters({ account })}
                onPickTag={(tag) => applyFilters({ tag })}
                onOpenArticle={setActiveId}
                onShowThin={showThin}
              />
            )}
          </div>
        </main>

        {activeId && (
          <DetailDrawer
            detail={detail}
            loading={detailLoading}
            error={detailError}
            onClose={() => setActiveId("")}
            onStatus={updateDetailStatus}
            onAddTag={addDetailTag}
            onRemoveTag={removeDetailTag}
            onCite={citeDetail}
            onCopyLink={copyDetailLink}
            onOpenRelated={(id) => setActiveId(id)}
            onExcerpt={handleExcerpt}
            busy={busy}
          />
        )}
      </div>

      {checked.size > 0 && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-[#1F1F1D] p-2 pl-3.5 text-white shadow-[0_6px_20px_rgba(0,0,0,0.16)]">
            <span className="mr-1 whitespace-nowrap text-[12.5px] text-[#E8E8E4]">已选 {checked.size} 篇</span>
            <span className="mx-0.5 h-[18px] w-px bg-[#3A3A36]" />
            <BulkBtn onClick={() => { setTagInput(""); setModal("bulkTag") }}>打标签</BulkBtn>
            <BulkBtn onClick={() => { setCollectionChoice(collections[0]?.name || "__new__"); setNewCollectionName(""); setModal("bulkCollection") }}>加入集合</BulkBtn>
            <BulkBtn onClick={exportSelected}>导出</BulkBtn>
            <BulkBtn danger onClick={() => setModal("delete")}>删除</BulkBtn>
            <span className="mx-0.5 h-[18px] w-px bg-[#3A3A36]" />
            <button type="button" onClick={() => setChecked(new Set())} className="grid h-[26px] w-[26px] place-items-center rounded text-[#A8A8A2] hover:bg-[#2C2C29] hover:text-white" aria-label="取消选择">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {modal === "bulkTag" && (
        <Overlay onClose={() => setModal(null)} label="批量打标签">
          <h3 className="text-[15px] font-semibold">打标签</h3>
          <p className="mt-1 text-[12px] text-[#6B6B6B]">为已选 {checked.size} 篇素材添加同一个标签</p>
          <KbInput
            autoFocus
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitBulkTag() }}
            placeholder="输入标签名称，回车确认"
            className="mt-3"
          />
          {Array.isArray(stats?.byTag) && stats.byTag.length > 0 && (
            <div className="mt-2.5">
              <div className="mb-1.5 text-[11px] text-[#8E8E89]">已有标签</div>
              <div className="flex max-h-[96px] flex-wrap gap-1.5 overflow-auto">
                {stats.byTag.slice(0, 14).map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => setTagInput(t.tag)}
                    className="rounded border border-[#ECECE9] bg-[#F4F4F2] px-1.5 text-[11px] leading-5 text-[#55554F] hover:border-[#DDE0F7] hover:bg-[#EEF0FB] hover:text-[#4F5BD5]"
                  >
                    {t.tag}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <KbButton onClick={() => setModal(null)} disabled={busy}>取消</KbButton>
            <KbButton variant="primary" onClick={submitBulkTag} disabled={busy || !tagInput.trim()}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />} 确认添加
            </KbButton>
          </div>
        </Overlay>
      )}

      {modal === "bulkCollection" && (
        <Overlay onClose={() => setModal(null)} label="加入集合">
          <h3 className="text-[15px] font-semibold">加入集合</h3>
          <p className="mt-1 text-[12px] text-[#6B6B6B]">把已选 {checked.size} 篇素材移动到目标集合</p>
          <div className="mt-3 max-h-[200px] space-y-1 overflow-auto">
            {collections.map((c) => (
              <label key={c.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-[13px]", collectionChoice === c.name ? "border-[#4F5BD5] bg-[#FAFBFF]" : "border-[#E7E7E4] hover:bg-[#F5F5F3]")}>
                <input type="radio" name="bulk-collection" className="accent-[#4F5BD5]" checked={collectionChoice === c.name} onChange={() => setCollectionChoice(c.name)} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="font-mono text-[11px] text-[#8E8E89]">{c.count || 0}</span>
              </label>
            ))}
            <label className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-[13px]", collectionChoice === "__new__" ? "border-[#4F5BD5] bg-[#FAFBFF]" : "border-[#E7E7E4] hover:bg-[#F5F5F3]")}>
              <input type="radio" name="bulk-collection" className="accent-[#4F5BD5]" checked={collectionChoice === "__new__"} onChange={() => setCollectionChoice("__new__")} />
              <span className="flex-1">新建集合…</span>
            </label>
          </div>
          {collectionChoice === "__new__" && (
            <KbInput
              autoFocus
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitBulkCollection() }}
              placeholder="集合名称，如：待写选题"
              className="mt-2"
            />
          )}
          <div className="mt-4 flex justify-end gap-2">
            <KbButton onClick={() => setModal(null)} disabled={busy}>取消</KbButton>
            <KbButton variant="primary" onClick={submitBulkCollection} disabled={busy || !collectionChoice || (collectionChoice === "__new__" && !newCollectionName.trim())}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />} 加入集合
            </KbButton>
          </div>
        </Overlay>
      )}

      {modal === "delete" && (
        <Overlay onClose={() => setModal(null)} width="max-w-[380px]" label="删除素材">
          <h3 className="text-[15px] font-semibold text-[#C53030]">删除素材</h3>
          <p className="mt-1.5 text-[12.5px] leading-[1.7] text-[#4A4A47]">
            确认删除已选 <span className="font-mono font-semibold">{checked.size}</span> 篇素材？删除后将从当前知识库移除，且不可撤销。
          </p>
          <p className="mt-1 text-[11px] text-[#8E8E89]">只读采集源不受影响，可重新导入。</p>
          <div className="mt-4 flex justify-end gap-2">
            <KbButton onClick={() => setModal(null)} disabled={busy}>取消</KbButton>
            <KbButton variant="danger" onClick={submitBulkDelete} disabled={busy}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />} 确认删除
            </KbButton>
          </div>
        </Overlay>
      )}

      {modal === "createKb" && (
        <Overlay onClose={() => setModal(null)} label="新建知识库">
          <h3 className="text-[15px] font-semibold">新建知识库</h3>
          <p className="mt-1 text-[12px] text-[#6B6B6B]">素材会存到独立的知识库文件，可随时切换</p>
          <label className="mt-3 block text-[12px] text-[#4A4A47]">
            名称
            <KbInput autoFocus value={newKbName} onChange={(e) => setNewKbName(e.target.value)} placeholder="如：影视选题库" className="mt-1" />
          </label>
          <label className="mt-2 block text-[12px] text-[#4A4A47]">
            文件路径（可选）
            <KbInput value={newKbPath} onChange={(e) => setNewKbPath(e.target.value)} placeholder="loop/kb/xxx.json" className="mt-1 font-mono text-[12px]" />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <KbButton onClick={() => setModal(null)} disabled={busy}>取消</KbButton>
            <KbButton variant="primary" onClick={submitCreateKb} disabled={busy || !newKbName.trim()}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" />} 创建
            </KbButton>
          </div>
        </Overlay>
      )}

      {modal === "import" && importPreview && (
        <Overlay onClose={() => (importing ? null : setModal(null))} label="导入采集结果">
          <h3 className="text-[15px] font-semibold">导入采集结果</h3>
          <p className="mt-1 text-[12px] text-[#6B6B6B]">从上游采集结果导入到当前知识库，按 URL 去重</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              ["可导入", importPreview.toImport ?? 0, "#4F5BD5"],
              ["已在库", importPreview.alreadyInKb ?? 0, "#8E8E89"],
              ["采集总数", importPreview.available ?? 0, "#1A1A1A"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-md border border-[#E7E7E4] bg-[#FCFCFB] px-2 py-2.5">
                <div className="font-mono text-[20px] font-semibold leading-6 tabular-nums" style={{ color }}>{value}</div>
                <div className="text-[11px] text-[#6B6B6B]">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-[12px] text-[#4A4A47]">
            {Array.isArray(importPreview.accounts) && importPreview.accounts.length > 0 && (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-[#8E8E89]">采集账号</span>
                <span className="truncate">{importPreview.accounts.join("、")}</span>
              </div>
            )}
            {importPreview.kb && (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-[#8E8E89]">目标知识库</span>
                <span className="truncate font-mono text-[11px]">{importPreview.kb}</span>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <KbButton onClick={() => setModal(null)} disabled={importing}>取消</KbButton>
            <KbButton variant="primary" onClick={confirmImport} disabled={importing || !importPreview.toImport}>
              {importing && <Loader2 className="h-3 w-3 animate-spin" />} 确认导入 {importPreview.toImport || 0} 篇
            </KbButton>
          </div>
        </Overlay>
      )}

      {modal === "basket" && (
        <Overlay onClose={() => setModal(null)} width="max-w-[580px]" label="素材篮">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold">素材篮</h3>
            <span className="text-[11px] text-[#8E8E89]">
              摘录 {excerpts.length} 条{checked.size ? ` · 另附已勾选 ${checked.size} 篇` : ""}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-[#6B6B6B]">
            在详情页选中正文即可摘录；组包后写入 loop/runs/&lt;日期&gt;/evidence_pack.json。发布成功后才会标记引用。
          </p>

          <div className="mt-3 max-h-[300px] space-y-1.5 overflow-auto pr-1">
            {excerpts.map((e) => (
              <div key={e.id} className="rounded-md border border-[#E7E7E4] bg-[#FCFCFB] px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <Quote className="h-3 w-3 shrink-0 text-[#8E8E89]" />
                      <button
                        type="button"
                        onClick={() => setActiveId(e.articleId)}
                        className="truncate text-[11.5px] text-[#4F5BD5] hover:underline"
                        title={e.articleTitle}
                      >
                        {e.articleTitle || e.articleId}
                      </button>
                    </div>
                    <div className="line-clamp-3 text-[12.5px] leading-[1.6] text-[#3D3D3A]">{e.text}</div>
                    {e.note && <div className="mt-0.5 text-[11px] text-[#A0A09A]">备注：{e.note}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeExcerpt(e.id)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-[#A0A09A] hover:bg-[#F5E9E9] hover:text-[#C53030]"
                    aria-label="移除摘录"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {!excerpts.length && (
              <div className="rounded-md border border-dashed border-[#E7E7E4] px-3 py-6 text-center text-[12px] text-[#A0A09A]">
                还没有摘录。打开任意素材，在正文里划一段试试。
              </div>
            )}
          </div>

          <label className="mt-3 block text-[12px] text-[#4A4A47]">
            选题标题（可选，填了会同步生成 Prompt）
            <KbInput
              value={evidenceTitle}
              onChange={(e) => setEvidenceTitle(e.target.value)}
              placeholder="如：小米为什么把门锁做成视频通话入口"
              className="mt-1"
            />
          </label>

          <div className="mt-3 text-[11px] text-[#A0A09A]">
            验收线：证据包 ≥5 条，且来源带原文链接（当前 {excerpts.length + checked.size} 条）
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#A0A09A]">
              {checked.size ? `已勾选 ${checked.size} 篇文章会一并进入证据包` : "未勾选文章时仅使用摘录"}
            </span>
            <div className="flex gap-2">
              <KbButton onClick={() => setModal(null)} disabled={evidenceBusy}>取消</KbButton>
              <KbButton
                variant="primary"
                onClick={submitEvidence}
                disabled={evidenceBusy || (!excerpts.length && !checked.size)}
              >
                {evidenceBusy && <Loader2 className="h-3 w-3 animate-spin" />} 生成证据包
              </KbButton>
            </div>
          </div>
        </Overlay>
      )}

      {modal === "manageCollections" && (
        <Overlay onClose={() => setModal(null)} width="max-w-[460px]" label="管理集合">
          <h3 className="text-[15px] font-semibold">管理集合</h3>
          <p className="mt-1 text-[12px] text-[#6B6B6B]">支持两级以上嵌套：新建时选择父集合即可成为子集合。</p>

          <div className="mt-3 max-h-[260px] space-y-1 overflow-auto pr-1">
            {(() => {
              const ids = new Set(collections.map((c) => c.id))
              const byParent = new Map()
              for (const c of collections) {
                const parent = c.parent && ids.has(c.parent) ? c.parent : ""
                if (!byParent.has(parent)) byParent.set(parent, [])
                byParent.get(parent).push(c)
              }
              const rows = []
              const seen = new Set()
              const walk = (parent, depth) => {
                for (const c of byParent.get(parent) || []) {
                  if (seen.has(c.id)) continue
                  seen.add(c.id)
                  rows.push({ c, depth })
                  walk(c.id, depth + 1)
                }
              }
              walk("", 0)
              for (const c of collections) if (!seen.has(c.id)) rows.push({ c, depth: 0 })
              if (!rows.length) {
                return <div className="rounded-md border border-dashed border-[#E7E7E4] px-3 py-5 text-center text-[12px] text-[#A0A09A]">还没有集合</div>
              }
              return rows.map(({ c, depth }) => (
                <div
                  key={c.id}
                  style={{ marginLeft: depth * 16 }}
                  className="flex items-center gap-2 rounded-md border border-[#E7E7E4] bg-[#FCFCFB] px-2 py-1.5"
                >
                  {colEdit?.id === c.id ? (
                    <>
                      <KbInput
                        autoFocus
                        value={colEdit.name}
                        onChange={(e) => setColEdit({ id: c.id, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") saveCollectionRename(); if (e.key === "Escape") setColEdit(null) }}
                        className="h-7 flex-1 text-[12px]"
                      />
                      <button type="button" onClick={saveCollectionRename} className="text-[11px] text-[#4F5BD5] hover:underline">保存</button>
                      <button type="button" onClick={() => setColEdit(null)} className="text-[11px] text-[#8E8E89] hover:underline">取消</button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#3D3D3A]">{c.name}</span>
                      <span className="font-mono text-[10px] tabular-nums text-[#A0A09A]">{c.count || 0}</span>
                      <button
                        type="button"
                        onClick={() => setColEdit({ id: c.id, name: c.name })}
                        className="grid h-6 w-6 place-items-center rounded text-[#8E8E89] hover:bg-[#EEF0FB] hover:text-[#4F5BD5]"
                        aria-label={`重命名 ${c.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCollection(c)}
                        className="grid h-6 w-6 place-items-center rounded text-[#A0A09A] hover:bg-[#F5E9E9] hover:text-[#C53030]"
                        aria-label={`删除 ${c.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))
            })()}
          </div>

          <div className="mt-3 rounded-md border border-[#E7E7E4] bg-white p-2.5">
            <div className="mb-1.5 text-[11px] text-[#8E8E89]">新建集合</div>
            <div className="flex items-center gap-1.5">
              <KbInput
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createCollection() }}
                placeholder="集合名称"
                className="h-8 flex-1 text-[12px]"
              />
              <select
                value={newColParent}
                onChange={(e) => setNewColParent(e.target.value)}
                className="h-8 max-w-[130px] rounded-md border border-[#E7E7E4] bg-white px-1.5 text-[11px] text-[#3D3D3A] outline-none"
                aria-label="父集合"
              >
                <option value="">顶级集合</option>
                {collections.map((c) => <option key={c.id} value={c.id}>放入「{c.name}」</option>)}
              </select>
              <KbButton onClick={createCollection} disabled={!newColName.trim()}>
                <FolderPlus className="h-3.5 w-3.5" /> 新建
              </KbButton>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <KbButton onClick={() => setModal(null)}>完成</KbButton>
          </div>
        </Overlay>
      )}

      <ToastStack items={toasts} />
    </div>
  )
}

export default LibraryPage
