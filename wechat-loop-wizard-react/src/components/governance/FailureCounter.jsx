import * as React from "react"
import PropTypes from "prop-types"
import { AlertTriangle, ShieldAlert, Circle } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 失败循环计数条 —— 展示当前任务的连续失败次数
 * - 0-2 正常
 * - 3：警告（必须换假设）
 * - ≥5：停机（禁止原路径重试）
 *
 * @param {object} props
 * @param {number} props.attempts 连续失败次数
 * @param {number} [props.thresholdWarn=3] 警告阈值
 * @param {number} [props.thresholdStop=5] 停机阈值
 * @param {string} [props.currentError] 当前错误简述
 * @param {string} [props.className]
 */
export function FailureCounter({
  attempts,
  thresholdWarn = 3,
  thresholdStop = 5,
  currentError,
  className,
}) {
  const stopped = attempts >= thresholdStop
  const warned = attempts >= thresholdWarn && !stopped
  const dots = Math.max(attempts, thresholdStop) // 始终渲染 5 个位点

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-md border p-3 text-sm transition-colors",
        stopped
          ? "border-[#A94438]/40 bg-[#A94438]/[0.06]"
          : warned
          ? "border-[#B8862F]/40 bg-[#B8862F]/[0.06]"
          : "border-border bg-surface/50",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        {stopped ? (
          <ShieldAlert className="h-4 w-4 text-[#A94438]" aria-hidden="true" />
        ) : warned ? (
          <AlertTriangle className="h-4 w-4 text-[#B8862F]" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}

        <div className="leading-tight">
          {stopped ? (
            <span className="font-semibold text-[#A94438]">
              已停机：连续失败 {attempts} 次，禁止原路径重试
            </span>
          ) : warned ? (
            <span className="font-semibold text-[#B8862F]">
              警告：连续失败 {attempts} 次，下次必须更换修复假设
            </span>
          ) : (
            <span className="font-medium text-muted-foreground">
              失败计数 {attempts}/{thresholdStop} · 正常范围内
            </span>
          )}
          {currentError && (
            <span className="ml-2 font-mono text-[11px] text-muted-foreground tabular-nums">
              {currentError}
            </span>
          )}
        </div>
      </div>

      <div
        className="flex gap-1"
        aria-label={`失败计数位点 ${attempts}/${thresholdStop}`}
      >
        {Array.from({ length: dots }).map((_, i) => {
          const filled = i < attempts
          return (
            <span
              key={i}
              className={cn(
                "h-1.5 w-3 rounded-sm transition-colors",
                filled
                  ? stopped
                    ? "bg-[#A94438]"
                    : warned
                    ? "bg-[#B8862F]"
                    : "bg-muted-foreground/50"
                  : "bg-border"
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

FailureCounter.propTypes = {
  attempts: PropTypes.number.isRequired,
  thresholdWarn: PropTypes.number,
  thresholdStop: PropTypes.number,
  currentError: PropTypes.string,
  className: PropTypes.string,
}
