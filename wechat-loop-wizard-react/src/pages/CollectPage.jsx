import * as React from "react"
import PropTypes from "prop-types"
import { CollectTabs } from "@/components/collect/CollectTabs"
import { WechatCollectTab } from "@/components/collect/WechatCollectTab"
import { ArticleBrowseTab } from "@/components/collect/ArticleBrowseTab"
import { LinkDownloadTab } from "@/components/collect/LinkDownloadTab"
import { RssSubscriptionTab } from "@/components/collect/RssSubscriptionTab"

/**
 * 采集向导页 —— 公众号采集 / 文章浏览 / 链接下载 / RSS 订阅 四种入口
 *
 * @param {object} props
 * @param {function(string)} [props.onNavigate] 路由跳转回调（传给文章浏览 Tab 的「去公众号管理」按钮）
 */
export function CollectPage({ onNavigate }) {
  const [tab, setTab] = React.useState("wechat")

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Page 01</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">采集向导</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          公众号采集、文章浏览、链接下载与 RSS 订阅四条入口，采集结果统一进入下载历史与知识库。
        </p>
      </header>

      <CollectTabs value={tab} onChange={setTab} />

      <div role="tabpanel">
        {tab === "wechat" && <WechatCollectTab />}
        {tab === "browse" && <ArticleBrowseTab onNavigate={onNavigate} />}
        {tab === "url" && <LinkDownloadTab />}
        {tab === "rss" && <RssSubscriptionTab />}
      </div>
    </div>
  )
}

CollectPage.propTypes = {
  onNavigate: PropTypes.func,
}
