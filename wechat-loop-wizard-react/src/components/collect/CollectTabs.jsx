import * as React from "react"
import PropTypes from "prop-types"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "wechat", label: "公众号采集", hint: "搜索并一键采集" },
  { key: "browse", label: "文章浏览", hint: "从已关注列表里挑文章" },
  { key: "url", label: "链接下载", hint: "粘贴文章链接批量下载" },
  { key: "rss", label: "RSS 订阅", hint: "定时抓取与上传" },
]

/**
 * 采集向导分段式 Tab
 * @param {object} props
 * @param {string} props.value 当前 tab key
 * @param {function(string)} props.onChange
 * @param {string} [props.className]
 */
export function CollectTabs({ value, onChange, className }) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface/60 p-1",
        className
      )}
      role="tablist"
      aria-label="采集方式"
    >
      {TABS.map((tab) => {
        const active = value === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex flex-col items-start rounded-sm px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <span className="text-xs font-medium leading-tight">{tab.label}</span>
            <span className={cn("text-[10px] leading-snug", active ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
              {tab.hint}
            </span>
          </button>
        )
      })}
    </div>
  )
}

CollectTabs.propTypes = {
  value: PropTypes.oneOf(["wechat", "browse", "url", "rss"]).isRequired,
  onChange: PropTypes.func.isRequired,
  className: PropTypes.string,
}
