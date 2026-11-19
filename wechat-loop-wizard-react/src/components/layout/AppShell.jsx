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
// hidden: true 的项不进导航，但路由仍然可用（直接访问 #/proxy 能打开）
// 以后要放出来，把 hidden 删掉即可
const NAV_ITEMS = [
  { key: "pool",      label: "账号池",    icon: "Users",     hint: "扫码添加账号 · 多号轮换" },
  { key: "accounts",  label: "公众号管理",icon: "BookOpen",   hint: "搜索、关注、批量采集" },
  { key: "articles",  label: "公众号文章",icon: "Newspaper",  hint: "浏览已关注公众号文章 · 批量下载" },
  { key: "download",  label: "网址下载",  icon: "Download",   hint: "粘贴文章链接 · 内容过滤" },
  { key: "history",   label: "下载历史",  icon: "History",    hint: "双栏预览 · 打开 MD/PDF · RSS" },
  { key: "library",   label: "入库文章",  icon: "Library",    hint: "知识库 · 浏览搜索筛选" },
  { key: "proxy",     label: "代理设置",  icon: "Globe",      hint: "单代理 · 代理池轮换 · 免费代理测活", hidden: true },
  { key: "settings",  label: "设置",      icon: "Settings",   hint: "通道、降级、诊断" },
]

const VISIBLE_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.hidden)

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
          {VISIBLE_NAV_ITEMS.map((item) => {
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
        <NavBar current={current} onNavigate={onNavigate} navItems={VISIBLE_NAV_ITEMS} />
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
    case "BookOpen":
      return <svg {...common}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
    case "Newspaper":
      return <svg {...common}><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" /></svg>
    case "Download":
      return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
    case "History":
      return <svg {...common}><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>
    case "Library":
      return <svg {...common}><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></svg>
    case "Globe":
      return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
    case "Settings":
      return <svg {...common}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
    default:
      return <svg {...common}><circle cx="12" cy="12" r="10" /></svg>
  }
}
