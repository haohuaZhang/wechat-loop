import * as React from "react"
import { Search, Newspaper } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * 顶部导航栏
 * @param {object} props
 * @param {string} [props.className]
 */
export function NavBar({ className }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
      role="banner"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-6">
        <a
          href="#"
          className="flex items-center gap-2 font-serif text-lg font-semibold tracking-tight"
          aria-label="wechat-loop 首页"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Newspaper className="h-4 w-4" aria-hidden="true" />
          </span>
          wechat-loop
        </a>

        <div className="ml-auto flex flex-1 items-center justify-end gap-3 sm:flex-none sm:justify-start">
          <div className="relative w-full max-w-sm sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="搜索已采集文章…"
              className="h-9 pl-9 text-sm"
              aria-label="搜索文章"
            />
          </div>
          <Button
            size="default"
            className="h-9 shrink-0 gap-2 active:scale-95 transition-transform"
          >
            开始采集
          </Button>
        </div>
      </div>
    </header>
  )
}
