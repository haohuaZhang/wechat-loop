import * as React from "react"
import PropTypes from "prop-types"
import { cn } from "@/lib/utils"

/**
 * 采集状态标签
 * @param {object} props
 * @param {'idle'|'collecting'|'completed'|'error'} props.status
 * @param {string} [props.label] 覆盖默认状态文字
 * @param {string} [props.className]
 */
export function StatusBadge({ status, label, className }) {
  const map = {
    idle: { text: "待采集", cls: "bg-muted text-muted-foreground" },
    collecting: {
      text: "采集中",
      cls: "bg-[#B8862F]/12 text-[#8a6520] border border-[#B8862F]/30",
    },
    completed: {
      text: "已完成",
      cls: "bg-[#4F7A5A]/12 text-[#385742] border border-[#4F7A5A]/30",
    },
    error: {
      text: "出错",
      cls: "bg-[#A94438]/12 text-[#7d2f26] border border-[#A94438]/30",
    },
  }
  const current = map[status] || map.idle
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] font-medium tracking-wide",
        current.cls,
        className
      )}
      aria-label={`状态：${current.text}`}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          status === "collecting" && "animate-pulse bg-[#B8862F]",
          status === "completed" && "bg-[#4F7A5A]",
          status === "error" && "bg-[#A94438]",
          status === "idle" && "bg-muted-foreground"
        )}
      />
      {label || current.text}
    </span>
  )
}

StatusBadge.propTypes = {
  status: PropTypes.oneOf(["idle", "collecting", "completed", "error"]).isRequired,
  label: PropTypes.string,
  className: PropTypes.string,
}
