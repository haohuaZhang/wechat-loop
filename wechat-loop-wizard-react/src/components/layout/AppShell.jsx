import * as React from "react"
import PropTypes from "prop-types"
import { NavBar } from "@/components/layout/NavBar"
import { cn } from "@/lib/utils"

/**
 * App Shell —— 顶部导航 + 侧栏 + 主内容区
 *
 * @param {object} props
 * @param {string} props.current 当前路由 key
 * @param {function(string)} props.onNavigate 点击导航项时触发
 * @param {React.ReactNode} props.children 主内容区
 */
const NAV_ITEMS = [
  { key: "pool", label: "账号池", icon: "Users", hint: "扫码登录 · 多号轮换" },
  { key: "collect", label: "采集向导", icon: "Compass", hint: "输入公众号，自动发现文章" },
  { key: "tasks", label: "采集任务", icon: "ListTodo", hint: "进度、失败、停机、重试" },
  { key: "library", label: "入库文章", icon: "Library", hint: "浏览、搜索、筛选" },
  { key: "settings", label: "设置与诊断", icon: "Settings", hint: "通道降级、防作弊自检" },
]

export function AppShell({ current, onNavigate, children }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* 侧栏 —— 桌面端固定，移动端隐藏 */}
      <aside
        className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-border bg-[#12372e] px-4 py-6 lg:flex"
        aria-label="主导航"
      >
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/20 text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
              <path d="M18 14h-8" />
              <path d="M15 18h-5" />
              <path d="M10 6h8v4h-8V6Z" />
            </svg>
          </span>
          <div>
            <div className="font-serif text-sm font-semibold text-white">wechat-loop</div>
            <div className="text-[10px] text-white/40">本地采集 · 离线优先</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = current === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
                aria-current={active ? "page" : undefined}
              >
                <NavIcon name={item.icon} className="h-4 w-4 shrink-0" active={active} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium leading-tight">{item.label}</span>
                  <span className={cn(
                    "block text-[10px] leading-snug",
                    active ? "text-white/50" : "text-white/35 group-hover:text-white/50"
                  )}>
                    {item.hint}
                  </span>
                </span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
              </button>
            )
          })}
        </nav>

        <div className="mt-auto rounded-md border border-white/10 bg-white/5 px-3 py-2.5 text-[10px] leading-5 text-white/40">
          本机服务 <span className="font-mono text-white/60 tabular-nums">127.0.0.1:5200</span>
          <br />
          原型演示 · 不会真实采集
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <NavBar current={current} onNavigate={onNavigate} navItems={NAV_ITEMS} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6">
          {children}
        </main>
      </div>
    </div>
  )
}

AppShell.propTypes = {
  current: PropTypes.string.isRequired,
  onNavigate: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
}

/** 侧栏导航图标 —— 用内联 SVG 避免 lucide-react 的 tree-shaking 问题 */
function NavIcon({ name, className, active }) {
  const stroke = active ? "currentColor" : "currentColor"
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className }
  switch (name) {
    case "Users":
      return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    case "Compass":
      return <svg {...common}><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
    case "ListTodo":
      return <svg {...common}><path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" /><path d="m15 5 3 3" /></svg>
    case "Library":
      return <svg {...common}><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></svg>
    case "Settings":
      return <svg {...common}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
    default:
      return <svg {...common}><circle cx="12" cy="12" r="10" /></svg>
  }
}
