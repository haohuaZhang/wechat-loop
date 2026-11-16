import * as React from "react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * 文章列表骨架屏 — 结构与 ArticleCard 对齐
 * @param {object} [props]
 * @param {number} [props.count=6] 卡片数量
 * @param {string} [props.className]
 */
export function LoadingSkeleton({ count = 6, className }) {
  return (
    <div
      className={cn(
        "grid gap-4 md:grid-cols-2 lg:grid-cols-3",
        className
      )}
      aria-label="加载中"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-card"
        >
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-1/4" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <div className="mt-auto flex items-center justify-between pt-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-20 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  )
}
