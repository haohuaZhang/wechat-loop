import * as React from "react"

/**
 * 解析 hash 路径：`#/articles?fakeid=x` → { path: "articles", query: "fakeid=x" }
 * @param {string} raw
 */
function splitRoute(raw) {
  const clean = raw.replace(/^#\/?/, "")
  const idx = clean.indexOf("?")
  if (idx === -1) return { path: clean || "pool", query: "" }
  return { path: clean.slice(0, idx) || "pool", query: clean.slice(idx + 1) }
}

/**
 * 极简 hash 路由 —— 只做「路径 + query」两件事，不引入 react-router
 * 支持 `navigate("articles?fakeid=xxx&name=yyy")`
 */
export function useHashRoute() {
  const [path, setPath] = React.useState(() => splitRoute(window.location.hash).path)
  const [query, setQuery] = React.useState(() => splitRoute(window.location.hash).query)

  React.useEffect(() => {
    const onHash = () => {
      const next = splitRoute(window.location.hash)
      setPath(next.path)
      setQuery(next.query)
    }
    window.addEventListener("hashchange", onHash)
    // 首次访问无 hash 时补一个默认值
    if (!window.location.hash) {
      window.location.hash = "#/pool"
    }
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const navigate = React.useCallback((to) => {
    const target = `#/${to.replace(/^\/?/, "")}`
    if (window.location.hash !== target) {
      window.location.hash = target
    }
  }, [])

  return [path, navigate, query]
}
