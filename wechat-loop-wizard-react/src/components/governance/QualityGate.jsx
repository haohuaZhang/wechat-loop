import * as React from "react"
import PropTypes from "prop-types"
import { CheckCircle2, XCircle, PlayCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

/**
 * 防作弊自检 —— 模拟执行 verify.sh 并返回结构化结果
 *
 * @typedef {Object} QualityCheck
 * @property {string} label
 * @property {'pass'|'fail'} status
 * @property {string} detail
 *
 * @param {object} props
 * @param {string} [props.className]
 */

const MOCK_CHECKS = [
  { label: "无 skip / xfail / only", status: "pass", detail: "扫描 scripts 与 tests，共 0 处" },
  { label: "无 || true 掩码", status: "pass", detail: "未用掩码隐藏脚本失败" },
  { label: "无硬编码 exit 0", status: "pass", detail: "汇总退出码来自真实检查结果" },
  { label: "失败循环未超限", status: "pass", detail: "活动任务计数均小于 5；历史停机任务不计入" },
  { label: "完成证据可追溯", status: "pass", detail: "完成任务均附正文文件计数与本地路径" },
]

export function QualityGate({ className }) {
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState(null)

  const handleRun = () => {
    setRunning(true)
    setResult(null)
    setTimeout(() => {
      setResult({
        command: "bash verify.sh --scripts",
        exitCode: 0,
        duration: "0.8s",
        checks: MOCK_CHECKS,
      })
      setRunning(false)
    }, 850)
  }

  const allPass = result?.checks.every((c) => c.status === "pass")
  const iconCls = "h-3.5 w-3.5 shrink-0 mt-0.5"

  return (
    <Card
      className={cn(
        "bg-card shadow-card transition-all duration-200 hover:shadow-card-hover",
        className
      )}
    >
      <CardHeader className="gap-3">
        <CardTitle className="font-serif text-xl font-semibold tracking-tight">
          交付保护 · 本机自检
        </CardTitle>
        <CardDescription className="text-sm leading-6">
          扫描脚本、任务与证据，防止跳过失败、掩盖错误或硬编码成功。
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="gap-2 active:scale-95 transition-transform"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              正在执行 verify.sh…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              运行本机自检
            </>
          )}
        </Button>

        {!result && !running && (
          <p className="text-xs leading-6 text-muted-foreground">
            点击按钮执行。原型返回模拟结果；正式版将直接调用本机 verify.sh。
          </p>
        )}

        {result && (
          <>
            {/* 摘要 */}
            <div className="flex items-center justify-between rounded-sm border border-border bg-surface/60 px-3 py-2 text-xs">
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {result.command}
              </span>
              <span
                className={cn(
                  "font-mono text-[11px] font-semibold tabular-nums",
                  result.exitCode === 0 ? "text-[#385742]" : "text-[#7d2f26]"
                )}
              >
                exit {result.exitCode} · {result.duration}
              </span>
            </div>

            {/* 检查项列表 */}
            <ul className="divide-y divide-border text-[12px]">
              {result.checks.map((c, i) => {
                const pass = c.status === "pass"
                return (
                  <li
                    key={i}
                    className={cn(
                      "flex gap-2.5 py-2",
                      !pass && "bg-[#A94438]/[0.04]"
                    )}
                  >
                    {pass ? (
                      <CheckCircle2 className={cn(iconCls, "text-[#4F7A5A]")} aria-hidden="true" />
                    ) : (
                      <XCircle className={cn(iconCls, "text-[#A94438]")} aria-hidden="true" />
                    )}
                    <div>
                      <div className="font-medium text-foreground">{c.label}</div>
                      <div className="font-mono text-[10px] leading-5 text-muted-foreground tabular-nums">
                        {c.detail}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            {allPass && (
              <p className="rounded-sm border border-[#4F7A5A]/30 bg-[#4F7A5A]/[0.06] px-3 py-2 text-[11px] leading-6 text-[#385742]">
                ✓ 五项规则全部通过，可以安全交付。
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

QualityGate.propTypes = {
  className: PropTypes.string,
}
