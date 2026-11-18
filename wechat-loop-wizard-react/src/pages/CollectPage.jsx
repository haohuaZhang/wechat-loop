import * as React from "react"
import { CollectTabs } from "@/components/collect/CollectTabs"
import { WechatCollectTab } from "@/components/collect/WechatCollectTab"
import { LinkDownloadTab } from "@/components/collect/LinkDownloadTab"
import { RssSubscriptionTab } from "@/components/collect/RssSubscriptionTab"

/**
 * 采集向导页 —— 公众号采集 / 链接下载 / RSS 订阅 三种入口
 */
export function CollectPage() {
  const [tab, setTab] = React.useState("wechat")

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 01</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">采集向导</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          公众号采集、链接下载与 RSS 订阅三条入口，采集结果统一进入下载历史与知识库。
        </p>
      </header>

      <CollectTabs value={tab} onChange={setTab} />

      <div role="tabpanel">
        {tab === "wechat" && <WechatCollectTab />}
        {tab === "url" && <LinkDownloadTab />}
        {tab === "rss" && <RssSubscriptionTab />}
      </div>
    </div>
  )
}
