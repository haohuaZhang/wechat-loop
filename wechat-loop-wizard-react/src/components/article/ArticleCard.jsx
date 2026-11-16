import * as React from "react"
import PropTypes from "prop-types"
import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * 格式化 ISO 时间为可读形式
 * @param {string} iso
 */
function formatDate(iso) {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${y}-${m}-${day} · ${hh}:${mm}`
}

/**
 * 截断文本到 N 个字符
 * @param {string} text
 * @param {number} n
 */
function truncate(text, n = 80) {
  if (!text) return ""
  return text.length > n ? text.slice(0, n - 1) + "…" : text
}

/**
 * 单张文章卡片
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.title
 * @param {string} props.account 来源公众号
 * @param {string} props.publishAt 采集时间 ISO
 * @param {string} [props.digest] 摘要
 * @param {string} [props.url] 原文链接
 * @param {string} [props.className]
 */
export function ArticleCard({
  id,
  title,
  account,
  publishAt,
  digest,
  url,
  className,
}) {
  return (
    <Card
      className={cn(
        "group flex flex-col bg-card shadow-card transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-card-hover",
        className
      )}
    >
      <CardHeader className="gap-2">
        <CardTitle
          className="line-clamp-2 font-serif text-lg font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-accent"
          title={title}
        >
          {title}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="rounded-sm font-normal">
            {account}
          </Badge>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {formatDate(publishAt)}
          </span>
        </div>
      </CardHeader>
      {digest && (
        <CardContent className="pb-2">
          <CardDescription className="line-clamp-3 text-sm leading-7">
            {truncate(digest, 110)}
          </CardDescription>
        </CardContent>
      )}
      <CardFooter className="mt-auto pt-2">
        {url ? (
          <Button
            asChild
            variant="link"
            size="sm"
            className="h-auto gap-1 px-0 text-xs font-medium text-muted-foreground hover:text-accent"
          >
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`查看《${title}》原文`}
            >
              查看原文
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </Button>
        ) : (
          <span />
        )}
      </CardFooter>
    </Card>
  )
}

ArticleCard.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  account: PropTypes.string.isRequired,
  publishAt: PropTypes.string.isRequired,
  digest: PropTypes.string,
  url: PropTypes.string,
  className: PropTypes.string,
}
