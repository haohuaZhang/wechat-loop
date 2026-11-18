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
        "inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium tracking-wide leading-4",
        current.cls,
        className
      )}
      aria-label={`状态：${current.text}`}
    >
      {label || current.text}
    </span>
  )
}

StatusBadge.propTypes = {
  status: PropTypes.oneOf(["idle", "collecting", "completed", "error"]).isRequired,
  label: PropTypes.string,
  className: PropTypes.string,
}
