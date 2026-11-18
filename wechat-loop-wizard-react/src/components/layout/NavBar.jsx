import * as React from "react"
import PropTypes from "prop-types"
import { Search, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const PAGE_TITLES = {
  pool: "账号池",
  accounts: "公众号管理",
  articles: "公众号文章",
  collect: "采集向导",
  download: "网址下载",
  history: "下载历史",
  tasks: "采集任务",
  library: "入库文章",
  settings: "设置与诊断",
}

// 「开始采集」按钮只在需要的页面出现
const ACTION_BUTTON_PAGES = new Set(["articles"])

/**
 * 顶部导航栏 —— 接收 App Shell 传入的 current / onNavigate
 * 移动端展示横向 tab + Hamburger 菜单
 *
 * @param {object} props
 * @param {string} props.current
 * @param {function(string)} props.onNavigate
 * @param {Array<{key:string,label:string,icon:string,hint:string}>} props.navItems
 * @param {string} [props.className]
 */
export function NavBar({ current, onNavigate, navItems, className }) {
  const [mobileOpen, setMobileOpen] = React.useState(false)

  return (
    <header
      className={cn(
        "sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
      role="banner"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-6">
        {/* 移动端菜单按钮 */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>

        {/* 页面标题 —— 移动端显示，桌面端被侧栏替代 */}
        <h1 className="font-serif text-lg font-semibold tracking-tight text-foreground lg:hidden">
          {PAGE_TITLES[current] || "采集向导"}
        </h1>

        {/* 搜索框 */}
        <div className="ml-auto flex items-center gap-3">
          <div className="relative hidden sm:block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="搜索已采集文章…"
              className="h-9 w-56 pl-9 text-sm"
              aria-label="搜索文章"
            />
          </div>
          {ACTION_BUTTON_PAGES.has(current) && (
            <Button
              type="button"
              size="default"
              onClick={() => onNavigate("collect")}
              className="h-9 shrink-0 gap-2 active:scale-95 transition-transform"
            >
              开始采集
            </Button>
          )}
        </div>
      </div>

      {/* 移动端下拉导航 */}
      {mobileOpen && (
        <nav className="border-t border-border bg-background lg:hidden" aria-label="移动端导航">
          <ul className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2 md:px-6">
            {navItems.map((item) => {
              const active = current === item.key
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(item.key)
                      setMobileOpen(false)
                    }}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
    </header>
  )
}

NavBar.propTypes = {
  current: PropTypes.string.isRequired,
  onNavigate: PropTypes.func.isRequired,
  navItems: PropTypes.array.isRequired,
  className: PropTypes.string,
}
