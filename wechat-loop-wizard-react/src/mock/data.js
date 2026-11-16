/**
 * 设计令牌 → 语义化 token
 * 颜色映射到 tailwind.config.js 中定义的 CSS 变量
 */
export const designTokens = {
  colors: {
    bg: "#F5F3EF",
    surface: "#FBF9F6",
    card: "#FFFFFF",
    text: "#1A1A1A",
    muted: "#6B6560",
    accent: "#C87137",
    border: "#E4DED6",
    success: "#4F7A5A",
    warning: "#B8862F",
    error: "#A94438",
  },
  radius: { lg: "0.5rem", md: "0.375rem", sm: "0.25rem" },
  shadow: {
    card: "0 2px 12px rgba(0,0,0,0.06)",
    cardHover: "0 6px 20px rgba(0,0,0,0.08)",
  },
}

/**
 * @typedef {Object} Article
 * @property {string} id
 * @property {string} title
 * @property {string} account
 * @property {string} publishAt ISO 时间字符串
 * @property {string} [digest]
 * @property {string} [url]
 */

/** @type {Article[]} */
export const mockArticles = [
  {
    id: "a1",
    title: "S15 世界赛复盘：两支 LPL 队伍的 BP 思路差异",
    account: "游戏汇总",
    publishAt: "2026-11-14T09:20:00Z",
    digest:
      "本届世界赛四强战中，两支 LPL 队伍在面对相同对手时拿出了截然不同的英雄选择。本文从版本理解、选手池深度和教练组风格三个维度拆解这两条路径的优劣。",
    url: "https://mp.weixin.qq.com/s/demo-s15",
  },
  {
    id: "a2",
    title: "11 月新游观察：三款独立作品在 Switch 上的表现",
    account: "游戏研究社",
    publishAt: "2026-11-12T15:42:00Z",
    digest:
      "十一月任天堂 eShop 迎来一波独立游戏小高峰。我们选取三款体量接近的作品，从首日销量、媒体评分到玩家社区反馈进行横向对比。",
    url: "https://mp.weixin.qq.com/s/demo-indie",
  },
  {
    id: "a3",
    title: "小游戏长线运营的三条路径",
    account: "手游那点事",
    publishAt: "2026-11-10T07:30:00Z",
    digest:
      "从《羊了个羊》到今年的几款黑马，小游戏的生命周期正在被拉长。本文拆解三种已被验证的长线玩法：内容季更、UGC 生态和跨端联动。",
    url: "https://mp.weixin.qq.com/s/demo-mini",
  },
  {
    id: "a4",
    title: "合作派对游戏的设计原则",
    account: "独立游戏观察",
    publishAt: "2026-11-08T11:05:00Z",
    digest:
      "派对游戏看似门槛低，真正做好却需要在「协作感」和「挫败感」之间找到微妙的平衡。我们采访了三款爆款派对游戏的核心设计师。",
    url: "https://mp.weixin.qq.com/s/demo-party",
  },
  {
    id: "a5",
    title: "电竞赞助的 ROI 到底怎么算",
    account: "电竞产业评论",
    publishAt: "2026-11-05T18:00:00Z",
    digest:
      "品牌方在电竞领域的投入逐年上涨，但很少有人能清晰回答「这笔钱换来了什么」。本文梳理行业内三种主流的 ROI 评估模型。",
    url: "https://mp.weixin.qq.com/s/demo-sponsor",
  },
  {
    id: "a6",
    title: "二次元内容产能的瓶颈在哪里",
    account: "游戏研究社",
    publishAt: "2026-11-03T10:15:00Z",
    digest:
      "过去两年二次元赛道内容量翻了三倍，但玩家体感上的「精品感」却没有同步增长。本文从 IP 孵化、美术产能和剧本管线三个环节分析瓶颈所在。",
    url: "https://mp.weixin.qq.com/s/demo-anime",
  },
]

/** 状态枚举 */
export const COLLECT_STATUS = {
  IDLE: "idle",
  COLLECTING: "collecting",
  COMPLETED: "completed",
  ERROR: "error",
}

/** 空状态示例 */
export const emptyArticle = {
  id: null,
  title: null,
  account: null,
  publishAt: null,
  digest: null,
  url: null,
}
