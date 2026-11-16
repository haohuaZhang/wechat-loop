import * as React from "react"
import PropTypes from "prop-types"
import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"

/**
 * 采集进度条
 * @param {object} props
 * @param {number} props.value 0-100
 * @param {boolean} [props.running] 是否进行中（加 animate-pulse）
 * @param {string} [props.current] 当前采集到的公众号/文章提示
 * @param {string} [props.className]
 */
export function CollectProgress({ value, running, current, className }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">
          采集进度
        </span>
        <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
          {pct}%
        </span>
      </div>
      <Progress
        value={pct}
        className={cn("h-1 w-full", running && "[&>div]:animate-pulse")}
      />
      {current && (
        <p className="text-[11px] leading-6 text-muted-foreground">{current}</p>
      )}
    </div>
  )
}

CollectProgress.propTypes = {
  value: PropTypes.number.isRequired,
  running: PropTypes.bool,
  current: PropTypes.string,
  className: PropTypes.string,
}
