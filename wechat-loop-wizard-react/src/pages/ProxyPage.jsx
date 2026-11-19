import * as React from "react"
import PropTypes from "prop-types"
import { Globe, Plus, RefreshCw, Trash2, CheckCircle2, XCircle, Loader2, ShieldAlert } from "lucide-react"
import { api } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

const PROXY_TYPES = ["http", "https", "socks5"]

/**
 * 代理设置页 —— 对齐 wechat-mp-tools 的「代理设置 + 多代理池管理」
 *
 * @param {{onNavigate?: (to: string) => void}} props
 */
export function ProxyPage({ onNavigate }) {
  // 单代理配置
  const [config, setConfig] = React.useState({
    enabled: false,
    type: "http",
    host: "",
    port: "",
    username: "",
    password: "",
    rotation: false,
  })
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState(null)
  const [error, setError] = React.useState("")

  // 代理池
  const [pool, setPool] = React.useState([])
  const [draft, setDraft] = React.useState({ type: "http", host: "", port: "" })
  const [adding, setAdding] = React.useState(false)
  const [fetching, setFetching] = React.useState(false)
  const [fetchNote, setFetchNote] = React.useState("")

  // 后端自检（是否已重启到最新代码）
  const [health, setHealth] = React.useState(null)

  React.useEffect(() => {
    let alive = true
    api
      .getBridgeHealth()
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth(null))
    return () => {
      alive = false
    }
  }, [])

  const loadAll = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [cfg, poolRes] = await Promise.all([api.getProxyConfig(), api.getProxyPool()])
      setConfig((prev) => ({ ...prev, ...cfg }))
      setPool(poolRes.pool || [])
    } catch (err) {
      setError(err.message || "读取代理配置失败")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadAll()
  }, [loadAll])

  const patch = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }))

  const handleSave = async () => {
    setSaving(true)
    setError("")
    try {
      await api.saveProxyConfig(config)
      setTestResult(null)
    } catch (err) {
      setError(err.message || "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.testProxy(config)
      setTestResult(res)
    } catch (err) {
      setTestResult({ success: false, message: err.message || "测试失败" })
    } finally {
      setTesting(false)
    }
  }

  const handleAdd = async () => {
    if (!draft.host.trim()) {
      setError("代理地址不能为空")
      return
    }
    setAdding(true)
    setError("")
    try {
      // 支持直接粘贴 user:pass@host:port 或 host:port
      const parsed = parseProxyInput(draft.host.trim(), draft.port)
      await api.addProxyToPool({ type: draft.type, ...parsed })
      setDraft({ type: draft.type, host: "", port: "" })
      const res = await api.getProxyPool()
      setPool(res.pool || [])
    } catch (err) {
      setError(err.message || "添加失败")
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (index) => {
    try {
      await api.removeProxyFromPool(index)
      const res = await api.getProxyPool()
      setPool(res.pool || [])
    } catch (err) {
      setError(err.message || "移除失败")
    }
  }

  const handleFetchFree = async () => {
    setFetching(true)
    setFetchNote("")
    setError("")
    try {
      const res = await api.fetchFreeProxies(40)
      if (!res.alive?.length) {
        setFetchNote(res.message || "没抓到可用代理，免费代理波动很大，稍后再试")
        return
      }
      for (const item of res.alive.slice(0, 10)) {
        await api.addProxyToPool({
          type: "http",
          host: item.host,
          port: item.port,
          label: `免费 ${item.latency}ms`,
        })
      }
      const poolRes = await api.getProxyPool()
      setPool(poolRes.pool || [])
      setFetchNote(`${res.message}，已加入最快的 ${Math.min(10, res.alive.length)} 个`)
    } catch (err) {
      setError(err.message || "抓取免费代理失败")
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Page 05</p>
        <h1 className="font-serif text-3xl font-bold tracking-tight">代理设置</h1>
        <p className="text-sm text-muted-foreground">给采集请求挂代理，降低微信读书 / 公众号接口的风控概率</p>
      </header>

      {health && !health.ok && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          <AlertTitle className="font-serif text-sm font-semibold">后端没重启到最新代码</AlertTitle>
          <AlertDescription className="mt-1 text-[12px] leading-6">
            缺少路由：{health.missing.join("、")}。请在终端重启后端（python3 backend/bridge.py）。
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle className="font-serif text-sm font-semibold">操作失败</AlertTitle>
          <AlertDescription className="mt-1 text-[12px] leading-6">{error}</AlertDescription>
        </Alert>
      )}

      {/* 单代理配置 */}
      <Card className="rounded-md shadow-card">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="font-serif text-lg font-semibold">代理配置</CardTitle>
          <CardDescription className="mt-0.5 text-xs leading-6">
            单个代理即可，留空表示直连。密码保存后回显为 ***。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-2">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Switch checked={!!config.enabled} onChange={(v) => patch("enabled", v)} />
                <span className="text-sm">{config.enabled ? "已启用代理" : "未启用（直连）"}</span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="协议">
                  <select
                    value={config.type || "http"}
                    onChange={(e) => patch("type", e.target.value)}
                    className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-sm"
                  >
                    {PROXY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="服务器主机（IP / 域名）">
                  <Input
                    value={config.host || ""}
                    onChange={(e) => patch("host", e.target.value)}
                    placeholder="127.0.0.1 或 proxy.com"
                    className="h-9"
                  />
                </Field>
                <Field label="端口">
                  <Input
                    value={config.port || ""}
                    onChange={(e) => patch("port", e.target.value)}
                    placeholder="例如 8080"
                    className="h-9"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="用户名（可选）">
                  <Input
                    value={config.username || ""}
                    onChange={(e) => patch("username", e.target.value)}
                    placeholder="留空则无"
                    className="h-9"
                  />
                </Field>
                <Field label="密码（可选）">
                  <Input
                    type="password"
                    value={config.password || ""}
                    onChange={(e) => patch("password", e.target.value)}
                    placeholder="留空则无"
                    className="h-9"
                  />
                </Field>
              </div>

              {testResult && (
                <div
                  className={
                    testResult.success
                      ? "flex items-start gap-2 rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800"
                      : "flex items-start gap-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800"
                  }
                >
                  {testResult.success ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {testResult.message}
                    {testResult.latency ? `（${testResult.latency}ms）` : ""}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing}
                  className="h-9 flex-1 gap-1.5 text-[13px] active:scale-95"
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {testing ? "测试中…" : "测试连接"}
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-9 flex-1 gap-1.5 text-[13px] active:scale-95"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                  {saving ? "保存中…" : "保存配置"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 多代理池 */}
      <Card className="rounded-md shadow-card">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2 pt-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="font-serif text-lg font-semibold">多代理池管理</CardTitle>
            <CardDescription className="mt-0.5 text-xs leading-6">
              采集时按顺序轮换，单个代理被限流可换下一个
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] text-muted-foreground">启用轮换</span>
            <Switch checked={!!config.rotation} onChange={(v) => patch("rotation", v)} />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <p className="text-[12px] font-medium">快速添加代理 IP</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={draft.type}
                onChange={(e) => setDraft((p) => ({ ...p, type: e.target.value }))}
                className="h-9 w-[92px] rounded-sm border border-border bg-surface px-2 text-[12px]"
              >
                {PROXY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
              <Input
                value={draft.host}
                onChange={(e) => setDraft((p) => ({ ...p, host: e.target.value }))}
                placeholder="格式：host:port 或 user:pass@host:port"
                className="h-9 min-w-[240px] flex-1 text-[12px]"
              />
              <Button
                type="button"
                size="sm"
                onClick={handleAdd}
                disabled={adding}
                className="h-9 gap-1 text-[12px] active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                添加
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleFetchFree}
                disabled={fetching}
                className="h-9 gap-1 text-[12px] active:scale-95"
              >
                {fetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {fetching ? "抓取测活中…" : "拉取免费代理并测活"}
              </Button>
            </div>
            {fetchNote && <p className="text-[12px] text-muted-foreground">{fetchNote}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[12px] font-medium">代理池列表（{pool.length}）</p>
            {pool.length === 0 ? (
              <p className="rounded-sm border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted-foreground">
                还没有代理。免费代理建议用上面的「拉取免费代理并测活」，能自动筛掉失效的
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-sm border border-border">
                {pool.map((item, idx) => (
                  <li key={`${item.host}-${item.port}-${idx}`} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-6 shrink-0 text-[12px] text-muted-foreground">{idx + 1}.</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {item.type || "http"}://{item.host}:{item.port}
                      {item.username ? `（${item.username}）` : ""}
                      {item.label ? ` · ${item.label}` : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemove(idx)}
                      className="h-7 gap-1 text-[12px] text-red-600 active:scale-95"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      删除
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

ProxyPage.propTypes = {
  onNavigate: PropTypes.func,
}

/**
 * 极简开关（不引额外依赖）
 * @param {{checked: boolean, onChange: (v: boolean) => void}} props
 */
function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        checked
          ? "relative h-5 w-9 shrink-0 rounded-full bg-emerald-500 transition-colors"
          : "relative h-5 w-9 shrink-0 rounded-full bg-border transition-colors"
      }
    >
      <span
        className={
          checked
            ? "absolute left-[18px] top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
            : "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
        }
      />
    </button>
  )
}

Switch.propTypes = {
  checked: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
}

/**
 * @param {{label: string, children: React.ReactNode}} props
 */
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

Field.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.node,
}

/**
 * 把 "user:pass@host:port" / "host:port" / "host" + port 解析成代理字段
 * @param {string} raw
 * @param {string} fallbackPort
 */
function parseProxyInput(raw, fallbackPort) {
  let rest = raw.trim()
  let username = ""
  let password = ""
  const at = rest.lastIndexOf("@")
  if (at !== -1) {
    const auth = rest.slice(0, at)
    rest = rest.slice(at + 1)
    const colon = auth.indexOf(":")
    if (colon === -1) {
      username = auth
    } else {
      username = auth.slice(0, colon)
      password = auth.slice(colon + 1)
    }
  }
  let host = rest
  let port = fallbackPort
  const colon = rest.lastIndexOf(":")
  if (colon !== -1) {
    host = rest.slice(0, colon)
    port = rest.slice(colon + 1)
  }
  return { host, port, username, password }
}
