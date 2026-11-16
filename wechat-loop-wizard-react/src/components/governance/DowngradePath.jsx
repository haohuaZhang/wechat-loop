import * as React from "react"
import PropTypes from "prop-types"
import { ChevronDown, ArrowRight, Lock, Zap, Link2, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * 通道分级与降级路径（Collapsible）
 * @param {object} props
 * @param {'L1'|'L1.5'|'L2'|'L3'|'L4'} [props.current='L1'] 当前通道级别
 * @param {boolean} [props.open=true] 默认展开
 * @param {function()} [props.onDowngrade] 点击降级到 L2 的回调
 * @param {string} [props.className]
 */
const GRADES = [
  {
    key: "L1",
    tone: "primary",
    label: "微信读书 / 官方接口",
    currentNote: "当前通道",
    desc: "受控接口自动发现文章。授权或接口失效时降到 L2，不在原通道反复重试。",
    icon: Zap,
  },
  {
    key: "L1.5",
    tone: "primary",
    label: "官方接口 + 人工确认",
    desc: "用于发布前确认等必须保留人工决策的环节。",
    icon: Zap,
  },
  {
    key: "L2",
    tone: "secondary",
    label: "文章链接 / RSS / OPML",
    currentNote: "可用兜底",
    desc: "由你提供链接或订阅源，读取公开内容并按链接去重。",
    icon: Link2,
  },
  {
    key: "L3",
    tone: "secondary",
    label: "公开文章页只读采集",
    desc: "只读取无需突破访问限制的公开页面，不自动发现更多文章。",
    icon: Eye,
  },
  {
    key: "L4",
    tone: "blocked",
    label: "验证码、滑块、绕过风控",
    currentNote: "转人工",
    desc: "不自动绕过，不伪装成普通接口成功。遇到时立即停机并弹出人工接管弹窗。",
    icon: Lock,
  },
]

const toneMap = {
  primary:
    "bg-[#4F7A5A]/10 text-[#385742] border-[#4F7A5A]/30",
  secondary:
    "bg-muted text-muted-foreground border-border",
  blocked:
    "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/40",
}

export function DowngradePath({
  current = "L1",
  open: defaultOpen = true,
  onDowngrade,
  className,
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const currentGrade = GRADES.find((g) => g.key === current) || GRADES[0]
  const nextGrade = GRADES[Math.min(GRADES.findIndex((g) => g.key === current) + 2, GRADES.length - 1)] // 跳过 L1.5 降到 L2

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-surface/50",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            className={cn(
              "inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-semibold tracking-wide",
              toneMap[currentGrade.tone]
            )}
          >
            {currentGrade.key}
          </span>
          通道分级与降级路径
          {open && <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "-rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-border">
          {GRADES.map((g, i) => {
            const Icon = g.icon
            const isCurrent = g.key === current
            const isBlocked = g.tone === "blocked"
            return (
              <div
                key={g.key}
                className={cn(
                  "grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-3 border-b border-border/60 px-4 py-3 text-sm last:border-b-0 transition-colors",
                  isCurrent && "bg-primary/5",
                  isBlocked && "bg-[#A94438]/[0.04]"
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-7 shrink-0 items-center justify-center rounded-sm border text-[11px] font-semibold tracking-wide",
                    toneMap[g.tone]
                  )}
                >
                  {g.key}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-semibold text-foreground">{g.label}</strong>
                    {g.currentNote && (
                      <span
                        className={cn(
                          "rounded-sm border px-1.5 py-0.5 text-[10px] font-medium",
                          isBlocked
                            ? "border-[#A94438]/40 text-[#7d2f26]"
                            : "border-border text-muted-foreground"
                        )}
                      >
                        {g.currentNote}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        当前通道
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-6 text-muted-foreground">
                    {g.desc}
                  </p>
                </div>
                {/* 降级箭头 */}
                {i < GRADES.length - 1 && (
                  <div className="col-span-2 ml-3 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    <span>失败时可降级到 {GRADES[i + 1].key}</span>
                  </div>
                )}
              </div>
            )
          })}

          {onDowngrade && (
            <div className="border-t border-border px-4 py-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full gap-2 active:scale-[0.98]"
                onClick={onDowngrade}
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                L1 不可用时，改用 {nextGrade.key} {nextGrade.label}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

DowngradePath.propTypes = {
  current: PropTypes.oneOf(["L1", "L1.5", "L2", "L3", "L4"]),
  open: PropTypes.bool,
  onDowngrade: PropTypes.func,
  className: PropTypes.string,
}
