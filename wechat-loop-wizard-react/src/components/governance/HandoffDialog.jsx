import * as React from "react"
import PropTypes from "prop-types"
import { ShieldAlert, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/**
 * L4 人工接管弹窗 —— 遇到验证码、滑块、需绕风控时自动弹出
 * 原型只读，不会执行真实操作
 *
 * @param {object} props
 * @param {React.ReactNode} props.trigger 触发元素（按钮等）
 * @param {string} [props.reason] 触发原因描述
 * @param {string} [props.className]
 */
export function HandoffDialog({ trigger, reason, className }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={cn("sm:max-w-[460px]", className)}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#A94438]/40 bg-[#A94438]/[0.06]">
              <ShieldAlert className="h-4 w-4 text-[#7d2f26]" aria-hidden="true" />
            </span>
            <DialogTitle className="font-serif text-xl font-semibold tracking-tight">
              需人工接管
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm leading-6">
            系统已触发停机保护。以下操作必须由你本人完成，AI 不会代做。
          </DialogDescription>
        </DialogHeader>

        {reason && (
          <div className="rounded-sm border border-[#A94438]/40 bg-[#A94438]/[0.06] px-3 py-2 text-[11px] leading-6 text-[#7d2f26]">
            触发原因：{reason}
          </div>
        )}

        <ol className="space-y-3 text-[12px]">
          {[
            { title: "扫码 / 验证码 / 滑块", body: "打开浏览器手动完成验证后，回到本页面点「继续采集」。" },
            { title: "真实发布 / 群发 / 删文", body: "发布环节不在自动化范围内，请在公众号后台操作。" },
            { title: "填写凭证 / AppID / 密钥", body: "凭证只保存在本机 config.env（已 .gitignore），不进入任何脚本或日志。" },
            { title: "连续失败 ≥ 5 次", body: "停机后必须换方案（如降级到 L2 链接导入），禁止原路径重试。" },
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border text-[10px] font-mono text-muted-foreground">
                {i + 1}
              </span>
              <div>
                <div className="font-medium text-foreground">{step.title}</div>
                <div className="text-[11px] leading-6 text-muted-foreground">{step.body}</div>
              </div>
            </li>
          ))}
        </ol>

        <DialogFooter>
          <Button type="button" variant="outline" className="active:scale-95">
            稍后再说
          </Button>
          <Button type="button" variant="default" className="active:scale-95">
            我已完成，继续采集
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

HandoffDialog.propTypes = {
  trigger: PropTypes.node.isRequired,
  reason: PropTypes.string,
  className: PropTypes.string,
}
