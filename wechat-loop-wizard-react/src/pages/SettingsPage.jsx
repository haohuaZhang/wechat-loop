import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { QualityGate } from "@/components/governance/QualityGate"
import { DowngradePath } from "@/components/governance/DowngradePath"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, XCircle, AlertTriangle, Trash2 } from "lucide-react"

/**
 * 设置与诊断页 —— 五项规则总览 + 系统状态 + 防作弊自检
 */
const SYSTEM_CHECKS = [
  { label: "本机采集服务 127.0.0.1:5200", status: "ok", hint: "flask app_mp.py 进程运行中" },
  { label: "统一知识库 loop/knowledge_base.json", status: "ok", hint: "可写，最近更新 10 分钟前" },
  { label: "微信读书授权", status: "warn", hint: "上次扫码 2 小时前，建议每周续期" },
  { label: "上游仓库只读", status: "ok", hint: "wechat-flow / wechat-flow-film / wechat-digest-skill 无改动" },
  { label: "凭证不入 Git", status: "ok", hint: "config.env 已 .gitignore，未进入版本" },
  { label: "fail loop-counter.json 无 ≥5 记录", status: "ok", hint: "历史停机 0 次" },
]

const STATUS_TONE = {
  ok: { Icon: CheckCircle2, cls: "text-[#385742]", badge: "bg-[#4F7A5A]/10 text-[#385742] border-[#4F7A5A]/30" },
  warn: { Icon: AlertTriangle, cls: "text-[#8a6520]", badge: "bg-[#B8862F]/10 text-[#8a6520] border-[#B8862F]/30" },
  err: { Icon: XCircle, cls: "text-[#7d2f26]", badge: "bg-[#A94438]/10 text-[#7d2f26] border-[#A94438]/30" },
}

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 04</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">设置与诊断</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          查看五项交付保护规则、系统健康状态，运行本机自检。
        </p>
      </header>

      {/* 五项规则卡片 */}
      <Card className="bg-card shadow-card transition-all duration-200 hover:shadow-card-hover">
        <CardHeader className="gap-2">
          <CardTitle className="font-serif text-xl font-semibold tracking-tight">
            五项交付保护规则
          </CardTitle>
          <CardDescription className="text-sm leading-6">
            这些规则由 v4 协议冻结，原型展示完整内容，正式版将在 verify.sh 和 loop-counter.json 中执行。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-0">
          {[
            { n: "①", title: "失败循环上限", body: "同一环节连续失败 3 次必须换假设；≥ 5 次自动停机，禁止原路径重试。" },
            { n: "②", title: "通道降级矩阵", body: "L1 微信读书 → L1.5 官方接口 → L2 链接/RSS → L3 只读 → L4 人工，逐层降级不原地重试。" },
            { n: "③", title: "L4 停机清单", body: "扫码、验证码、真实发布、填写凭证、连续失败 ≥ 5 次 —— AI 只给步骤，不代做。" },
            { n: "④", title: "证据完成", body: "说「已完成」必须附命令、exit 码和正文文件计数；空结果不算数。" },
            { n: "⑤", title: "防作弊", body: "禁止 skip/xfail/only、|| true 掩码、硬编码 exit 0 —— 自检扫出来就是 FAIL。" },
          ].map((r) => (
            <div key={r.n} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-border py-3 last:border-b-0">
              <span className="mt-0.5 font-serif text-base font-semibold text-primary">{r.n}</span>
              <div>
                <div className="text-sm font-semibold">{r.title}</div>
                <div className="text-[12px] leading-6 text-muted-foreground">{r.body}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 通道分级 */}
      <DowngradePath current="L1" onDowngrade={() => {}} />

      {/* 系统状态 */}
      <Card className="bg-card shadow-card transition-all duration-200 hover:shadow-card-hover">
        <CardHeader className="gap-2">
          <CardTitle className="font-serif text-xl font-semibold tracking-tight">系统状态</CardTitle>
          <CardDescription className="text-sm">本机采集服务、知识库、上游仓库等关键项的当前健康状态。</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {SYSTEM_CHECKS.map((c, i) => {
              const t = STATUS_TONE[c.status]
              const I = t.Icon
              return (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <I className={`h-4 w-4 ${t.cls}`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="font-mono text-[11px] text-muted-foreground tabular-nums">{c.hint}</div>
                  </div>
                  <Badge variant="outline" className={`rounded-sm text-[11px] ${t.badge}`}>
                    {c.status === "ok" ? "正常" : c.status === "warn" ? "注意" : "异常"}
                  </Badge>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {/* 防作弊自检 */}
      <QualityGate />

      {/* 危险操作区 */}
      <Card className="border-[#A94438]/30 bg-[#A94438]/[0.03] shadow-none">
        <CardHeader className="gap-2">
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-[#7d2f26]">
            危险操作区
          </CardTitle>
          <CardDescription className="text-sm text-[#7d2f26]/80">
            以下操作会批量修改本地数据或凭证，必须人工确认后执行。原型不会真实运行。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="destructive" size="sm" className="gap-2 active:scale-95 opacity-70 cursor-not-allowed" disabled>
            <Trash2 className="h-3.5 w-3.5" /> 清空知识库
          </Button>
          <Button variant="outline" size="sm" className="gap-2 active:scale-95 border-[#A94438]/40 text-[#7d2f26] hover:bg-[#A94438]/10" disabled>
            重新扫码授权
          </Button>
          <Button variant="outline" size="sm" className="gap-2 active:scale-95 border-[#A94438]/40 text-[#7d2f26] hover:bg-[#A94438]/10" disabled>
            重置 fail loop-counter.json
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
