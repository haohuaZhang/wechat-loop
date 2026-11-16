import * as React from "react"
import PropTypes from "prop-types"
import { NavBar } from "@/components/layout/NavBar"
import { AppShell } from "@/components/layout/AppShell"
import { useHashRoute } from "@/hooks/useHashRoute"

/**
 * 路由表 —— 所有页面在一处注册
 */
const ROUTES = {
  collect: () => import("@/pages/CollectPage").then((m) => m.CollectPage),
  tasks: () => import("@/pages/TasksPage").then((m) => m.TasksPage),
  library: () => import("@/pages/LibraryPage").then((m) => m.LibraryPage),
  settings: () => import("@/pages/SettingsPage").then((m) => m.SettingsPage),
}

const VALID_KEYS = new Set(Object.keys(ROUTES))

export default function App() {
  const [path, navigate] = useHashRoute()
  const key = VALID_KEYS.has(path) ? path : "collect"
  const [PageComponent, setPageComponent] = React.useState(null)
  const [loading, setLoading] = React.useState(true)

  // 动态加载页面（纯 React.lazy 风格但保持同步可控）
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    ROUTES[key]()
      .then((Comp) => {
        if (!cancelled) {
          setPageComponent(() => Comp)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error("Page load failed:", err)
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [key])

  // 移动端隐藏侧栏，桌面端显示
  return (
    <AppShell current={key} onNavigate={navigate}>
      {loading || !PageComponent ? (
        <PageLoading />
      ) : (
        <PageComponent />
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
