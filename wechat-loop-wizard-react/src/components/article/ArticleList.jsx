import * as React from "react"
import PropTypes from "prop-types"
import { Inbox, AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ArticleCard } from "./ArticleCard"
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton"
import { EmptyState } from "@/components/common/EmptyState"

/**
 * 文章列表容器，根据 mode 渲染不同状态
 * @param {object} props
 * @param {'loading'|'empty'|'data'|'error'} props.mode
 * @param {Array<import('@/mock/data').Article>} props.items
 * @param {string} [props.errorMessage]
 * @param {function()} [props.onRetry]
 * @param {function()} [props.onStartCollect]
 * @param {string} [props.className]
 */
export function ArticleList({
  mode,
  items,
  errorMessage,
  onRetry,
  onStartCollect,
  className,
}) {
  if (mode === "loading") {
    return <LoadingSkeleton className={className} />
  }

  if (mode === "empty") {
    return (
      <EmptyState
        icon={Inbox}
        title="还没有采集到文章"
        description="在上方输入公众号名称，点击「开始采集」就能把文章拉进知识库。"
        action={
          <Button size="lg" onClick={onStartCollect} className="active:scale-95">
            开始采集
          </Button>
        }
        className={cn("py-20", className)}
      />
    )
  }

  if (mode === "error") {
    return (
      <Alert variant="destructive" className={className}>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle className="font-serif text-base font-semibold tracking-tight">
          采集失败
        </AlertTitle>
        <AlertDescription className="mt-1 flex flex-col gap-3 text-sm leading-7">
          <span>{errorMessage || "网络或接口暂时不可用。"}</span>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="self-start gap-1 active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              重试
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  // data
  return (
    <div
      className={cn(
        "grid gap-4 md:grid-cols-2 lg:grid-cols-3",
        className
      )}
      role="list"
    >
      {items.map((a) => (
        <ArticleCard key={a.id} {...a} />
      ))}
    </div>
  )
}

ArticleList.propTypes = {
  mode: PropTypes.oneOf(["loading", "empty", "data", "error"]).isRequired,
  items: PropTypes.array.isRequired,
  errorMessage: PropTypes.string,
  onRetry: PropTypes.func,
  onStartCollect: PropTypes.func,
  className: PropTypes.string,
}
