import * as React from "react"

/**
 * Hash 路由 Hook —— 零依赖，监听 window.location.hash 变化
 * 返回当前路径（不含 #/ 前缀）
 *
 * @returns {[string, (path: string) => void]}
 */
export function useHashRoute() {
  const [path, setPath] = React.useState(() => {
    const raw = window.location.hash.replace(/^#\/?/, "")
    return raw || "collect"
  })

  React.useEffect(() => {
    const onHash = () => {
      const raw = window.location.hash.replace(/^#\/?/, "")
      setPath(raw || "collect")
    }
    window.addEventListener("hashchange", onHash)
    // 首次访问无 hash 时补一个默认值
    if (!window.location.hash) {
      window.location.hash = "#/collect"
    }
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const navigate = React.useCallback((to) => {
    const target = `#/${to.replace(/^\/?/, "")}`
    if (window.location.hash !== target) {
      window.location.hash = target
    }
  }, [])

  return [path, navigate]
}
