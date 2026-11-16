import * as React from "react"
import PropTypes from "prop-types"
import { Search, PlayCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CollectProgress } from "./CollectProgress"
import { StatusBadge } from "@/components/common/StatusBadge"

/**
 * 采集控制面板
 * @param {object} props
 * @param {string} props.accountValue 输入框受控值
 * @param {function(string)} props.onAccountChange
 * @param {function()} props.onStart 点击采集按钮
 * @param {boolean} props.loading
 * @param {'idle'|'collecting'|'completed'|'error'} props.status
 * @param {number} props.progress 0-100
 * @param {string} [props.current]
 * @param {string} [props.className]
 */
export function CollectPanel({
  accountValue,
  onAccountChange,
  onStart,
  loading,
  status,
  progress,
  current,
  errorMessage,
  className,
}) {
  const disabled = loading || status === "collecting" || !accountValue.trim()

  return (
    <Card
      className={cn(
        "bg-card shadow-card transition-all duration-200 hover:shadow-card-hover",
        className
      )}
    >
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-serif text-2xl font-semibold tracking-tight">
              采集公众号文章
            </CardTitle>
            <CardDescription className="mt-1 text-sm leading-6">
              输入公众号名称，系统自动拉取最近的文章并入库。
            </CardDescription>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!disabled) onStart()
          }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="text"
              value={accountValue}
              onChange={(e) => onAccountChange(e.target.value)}
              placeholder="例如：游戏汇总"
              className="h-10 pl-9 text-sm"
              aria-label="公众号名称"
              disabled={loading || status === "collecting"}
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={disabled}
            className="h-10 gap-2 active:scale-95 transition-transform"
          >
            {loading || status === "collecting" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{status === "collecting" ? "采集中…" : "开始采集"}</span>
          </Button>
        </form>

        {(status === "collecting" || status === "completed") && (
          <CollectProgress
            value={progress}
            running={status === "collecting"}
            current={current}
          />
        )}

        {status === "error" && errorMessage && (
          <div className="rounded-md border border-[#A94438]/40 bg-[#A94438]/[0.06] px-4 py-2.5 text-sm leading-6 text-[#7d2f26]">
            <strong className="mr-1">采集失败：</strong>{errorMessage}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

CollectPanel.propTypes = {
  accountValue: PropTypes.string.isRequired,
  onAccountChange: PropTypes.func.isRequired,
  onStart: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
  status: PropTypes.oneOf(["idle", "collecting", "completed", "error"]).isRequired,
  progress: PropTypes.number.isRequired,
  current: PropTypes.string,
  errorMessage: PropTypes.string,
  className: PropTypes.string,
}
