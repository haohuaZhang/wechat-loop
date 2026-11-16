import * as React from "react"
import PropTypes from "prop-types"
import { CheckCircle2, AlertCircle, FileText, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

/**
 * 完成证据面板 —— 展示命令、退出码、正文文件计数和入库路径
 *
 * @param {object} props
 * @param {'done'|'partial'|'failed'} props.status 任务完成态
 * @param {string} props.command 执行的命令
 * @param {number} props.exitCode
 * @param {number} props.validArticles 有效正文文件数
 * @param {number} props.totalAttempted 总尝试数
 * @param {string} [props.kbPath] 知识库相对路径
 * @param {string} [props.errorHint] 失败时的提示
 * @param {string} [props.className]
 */
export function EvidencePanel({
  status,
  command,
  exitCode,
  validArticles,
  totalAttempted,
  kbPath,
  errorHint,
  className,
}) {
  const [open, setOpen] = React.useState(true)
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch (_) { /* file:// 或沙盒环境静默降级 */ }
  }

  const iconMap = {
    done: { icon: CheckCircle2, cls: "text-[#4F7A5A]", label: "完成证据" },
    partial: { icon: AlertCircle, cls: "text-[#B8862F]", label: "部分完成证据" },
    failed: { icon: AlertCircle, cls: "text-[#A94438]", label: "失败证据" },
  }
  const current = iconMap[status] || iconMap.done
  const Icon = current.icon

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-surface/40",
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
          <Icon className={cn("h-4 w-4", current.cls)} aria-hidden="true" />
          {current.label}
          <Badge
            variant="outline"
            className={cn(
              "rounded-sm text-[11px] font-mono tabular-nums",
              exitCode === 0
                ? "border-[#4F7A5A]/40 text-[#385742]"
                : "border-[#A94438]/40 text-[#7d2f26]"
            )}
          >
            exit {exitCode}
          </Badge>
        </span>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {validArticles}/{totalAttempted} 篇有效正文
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          {/* 执行命令 */}
          <div className="mb-3 flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <code className="flex-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
              {command}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={handleCopy}
              aria-label="复制命令"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
          {copied && (
            <p className="mb-2 font-mono text-[10px] text-[#4F7A5A]">已复制到剪贴板</p>
          )}

          {/* 证据列表 */}
          <dl className="space-y-1.5 text-[12px]">
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-muted-foreground">退出码</dt>
              <dd className={cn("font-mono tabular-nums", exitCode === 0 ? "text-[#385742]" : "text-[#7d2f26]")}>
                {exitCode === 0 ? "0（成功）" : exitCode}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-muted-foreground">有效正文</dt>
              <dd className="font-mono tabular-nums">
                {validArticles} / {totalAttempted} 篇（正文文件非空）
              </dd>
            </div>
            {kbPath && (
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-muted-foreground">知识库</dt>
                <dd className="truncate font-mono text-[11px] tabular-nums">{kbPath}</dd>
              </div>
            )}
            {status === "partial" && (
              <div className="mt-2 rounded-sm border border-[#B8862F]/30 bg-[#B8862F]/[0.06] px-3 py-2 text-[11px] leading-6 text-[#8a6520]">
                ⚠ 部分文章未拿到正文。不得声称「全部成功」，请在交付说明中如实列出。
              </div>
            )}
            {status === "failed" && errorHint && (
              <div className="mt-2 rounded-sm border border-[#A94438]/30 bg-[#A94438]/[0.06] px-3 py-2 text-[11px] leading-6 text-[#7d2f26]">
                {errorHint}
              </div>
            )}
          </dl>

          <p className="mt-3 border-t border-border pt-2 text-[10px] leading-6 text-muted-foreground">
            原型数据 · 正式版将直接读取 verify.sh 与 loop/knowledge_base.json 的真实结果。
          </p>
        </div>
      )}
    </div>
  )
}

EvidencePanel.propTypes = {
  status: PropTypes.oneOf(["done", "partial", "failed"]).isRequired,
  command: PropTypes.string.isRequired,
  exitCode: PropTypes.number.isRequired,
  validArticles: PropTypes.number.isRequired,
  totalAttempted: PropTypes.number.isRequired,
  kbPath: PropTypes.string,
  errorHint: PropTypes.string,
  className: PropTypes.string,
}
