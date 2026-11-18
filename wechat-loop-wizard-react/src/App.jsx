import * as React from "react"
import PropTypes from "prop-types"
import { AppShell } from "@/components/layout/AppShell"
import { useHashRoute } from "@/hooks/useHashRoute"

/**
 * 路由表 —— 所有页面在一处注册
 */
const ROUTES = {
  pool: () => import("@/pages/AccountPoolPage").then((m) => m.AccountPoolPage),
  accounts: () => import("@/pages/AccountsPage").then((m) => m.AccountsPage),
  articles: () => import("@/pages/ArticlesPage").then((m) => m.ArticlesPage || m.default),
  download: () => import("@/pages/DownloadPage").then((m) => m.DownloadPage),
  history: () => import("@/pages/HistoryPage").then((m) => m.HistoryPage || m.default),
  library: () => import("@/pages/LibraryPage").then((m) => m.LibraryPage),
  settings: () => import("@/pages/SettingsPage").then((m) => m.SettingsPage),
}

const VALID_KEYS = new Set(Object.keys(ROUTES))

export default function App() {
  const [path, navigate] = useHashRoute()
  const key = VALID_KEYS.has(path) ? path : "pool"
  const [PageComponent, setPageComponent] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [animKey, setAnimKey] = React.useState(0)

  // 动态加载页面
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    ROUTES[key]()
      .then((Comp) => {
        if (!cancelled) {
          setPageComponent(() => Comp)
          setLoading(false)
          setAnimKey((k) => k + 1)
        }
      })
      .catch((err) => {
        console.error("Page load failed:", err)
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [key])

  return (
    <AppShell current={key} onNavigate={navigate}>
      {loading || !PageComponent ? (
        <PageLoading />
      ) : (
        <div
          key={animKey}
          className="page-enter"
        >
          <PageComponent onNavigate={navigate} />
        </div>
      )}
    </AppShell>
  )
}

/** 页面切换时的轻量占位 */
function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      加载中…
    </div>
  )
}
