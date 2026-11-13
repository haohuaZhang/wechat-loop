// 所有演示数据集中在这里；正式接入时由本机 API 与知识库替换。
window.MockDB = {
  auth: {
    loggedIn: false,
    nickname: "内容采集小号",
    vidMasked: "VID ···· 4821"
  },
  stats: { articles: 128, month: 46, accounts: 12, pending: 3 },
  accounts: [
    { id: "acc-game-digest", name: "游戏汇总", fakeid: "MP_WXS_2381", articleCount: 34, lastCollected: "今天 09:42", enabled: true },
    { id: "acc-game-research", name: "游戏研究社", fakeid: "MP_WXS_1048", articleCount: 27, lastCollected: "昨天 18:20", enabled: true },
    { id: "acc-mobile-game", name: "手游那点事", fakeid: "MP_WXS_6720", articleCount: 19, lastCollected: "11 月 10 日", enabled: true },
    { id: "acc-esports", name: "电竞产业评论", fakeid: "MP_WXS_3916", articleCount: 16, lastCollected: "11 月 08 日", enabled: false },
    { id: "acc-indie", name: "独立游戏观察", fakeid: "MP_WXS_8255", articleCount: 12, lastCollected: "11 月 02 日", enabled: true }
  ],
  tasks: [
    {
      id: "task-demo-running",
      mode: "最近 20 篇",
      accountNames: ["游戏研究社"],
      total: 20,
      completed: 13,
      failed: 0,
      status: "running",
      progress: 68,
      createdAt: "今天 10:24",
      current: "正在下载：从一款小游戏，看内容平台的新增量",
      demo: true,
      logs: ["已匹配公众号：游戏研究社", "文章列表获取完成，共 20 篇", "已跳过 2 篇重复文章"]
    },
    {
      id: "task-demo-done",
      mode: "最近 20 篇",
      accountNames: ["游戏汇总"],
      total: 20,
      completed: 20,
      failed: 0,
      status: "done",
      progress: 100,
      createdAt: "今天 09:36",
      current: "采集完成，已生成工作台",
      logs: []
    },
    {
      id: "task-demo-failed",
      mode: "2026-09-01 至 2026-09-30",
      accountNames: ["电竞产业评论"],
      total: 12,
      completed: 8,
      failed: 4,
      status: "error",
      progress: 67,
      createdAt: "昨天 16:12",
      current: "授权已过期，请重新连接微信读书",
      logs: []
    },
    {
      id: "task-demo-links",
      mode: "批量文章链接",
      accountNames: ["手动链接"],
      total: 6,
      completed: 6,
      failed: 0,
      status: "done",
      progress: 100,
      createdAt: "11 月 11 日 14:08",
      current: "6 篇文章已入库",
      logs: []
    }
  ],
  articles: [
    {
      id: "art-001",
      title: "S15 世界赛观赛指南：赛制、赛程与值得关注的五支队伍",
      account: "游戏汇总",
      publishDate: "2026-11-12",
      link: "https://mp.weixin.qq.com/s/demo-s15-guide",
      digest: "从入围赛到淘汰赛，梳理本届世界赛的关键变化与观赛重点。",
      content: "本届世界赛在赛制上做出了几项值得注意的调整。本文按比赛阶段梳理参赛队伍、关键赛程和版本环境，并选取五支风格迥异的队伍，分析它们在当前版本中的优势与隐患。\n\n对于内容创作者而言，比单场胜负更值得关注的是队伍如何适应版本，以及赛区风格如何影响 BP 与资源分配。",
      tags: ["英雄联盟", "S15", "电竞赛事"],
      analysisStatus: "agent",
      wordCount: 2860
    },
    {
      id: "art-002",
      title: "11 月新游清单：7 款值得加入愿望单的作品",
      account: "游戏汇总",
      publishDate: "2026-11-10",
      link: "https://mp.weixin.qq.com/s/demo-nov-games",
      digest: "覆盖独立冒险、策略经营与多人合作，按平台和类型整理本月新作。",
      content: "11 月的新作并不只依赖大制作。几款小团队作品在玩法组合上颇有新意：有的把卡组构筑放进城市经营，有的用合作解谜重新组织叙事。\n\n本文按照平台、类型和预计游玩时长整理，方便读者建立自己的试玩清单。",
      tags: ["新游推荐", "独立游戏", "愿望单"],
      analysisStatus: "local",
      wordCount: 2140
    },
    {
      id: "art-003",
      title: "当小游戏开始做长线运营，买量逻辑发生了什么变化",
      account: "游戏研究社",
      publishDate: "2026-11-09",
      link: "https://mp.weixin.qq.com/s/demo-mini-game-liveops",
      digest: "从素材投放到版本节奏，拆解小游戏从流量生意转向长期经营的变化。",
      content: "小游戏行业正在从单纯追求新增用户，转向同时考察留存、付费深度与内容更新效率。这个变化迫使团队重新安排素材生产、版本计划和用户分层。\n\n长线运营不是简单增加活动数量，而是建立一套能持续验证内容价值的机制。",
      tags: ["小游戏", "长线运营", "游戏买量"],
      analysisStatus: "agent",
      wordCount: 3420
    },
    {
      id: "art-004",
      title: "一款合作派对游戏，如何把“失误”变成社交乐趣",
      account: "独立游戏观察",
      publishDate: "2026-11-08",
      link: "https://mp.weixin.qq.com/s/demo-party-design",
      digest: "从操作容错、信息共享和关卡节奏，分析合作游戏中的快乐来源。",
      content: "优秀的合作派对游戏并不要求所有玩家都足够熟练。相反，它会刻意保留一些容易失误的空间，再通过即时反馈和夸张演出，把失误转化为共同记忆。\n\n设计者需要控制的，是失误带来的挫败成本，而不是彻底消灭失误。",
      tags: ["游戏设计", "合作游戏", "派对游戏"],
      analysisStatus: "local",
      wordCount: 1980
    },
    {
      id: "art-005",
      title: "赛事赞助不再只看曝光：品牌开始追问这三项指标",
      account: "电竞产业评论",
      publishDate: "2026-11-06",
      link: "https://mp.weixin.qq.com/s/demo-esports-sponsor",
      digest: "从曝光量到受众匹配、互动质量与转化路径，电竞赞助评估正在变细。",
      content: "品牌对电竞赛事的评估正在从单一曝光数据，转向更完整的受众画像与互动质量。赞助方希望知道观众是谁、为什么互动，以及赛事内容能否承接后续转化。\n\n这要求赛事方提供更透明、更连续的数据，而不是只在赛后交付一份漂亮总结。",
      tags: ["电竞商业", "赛事赞助", "品牌营销"],
      analysisStatus: "pending",
      wordCount: 2510
    },
    {
      id: "art-006",
      title: "从版本更新看二次元产品的内容产能焦虑",
      account: "手游那点事",
      publishDate: "2026-11-04",
      link: "https://mp.weixin.qq.com/s/demo-content-capacity",
      digest: "版本周期越来越稳定，但玩家对内容密度与新鲜感的期待仍在上升。",
      content: "稳定的版本节奏曾经是内容型产品的竞争优势，如今却逐渐成为基本要求。玩家不仅关心更新是否准时，也关心新内容能否提供不同的体验。\n\n产能焦虑的真正解法，可能不是无限扩充团队，而是提高工具链、复用机制和跨职能协作的效率。",
      tags: ["二次元游戏", "版本运营", "内容产能"],
      analysisStatus: "local",
      wordCount: 3070
    },
    {
      id: "art-007",
      title: "roguelike 的随机性，怎样才不会变成重复劳动",
      account: "独立游戏观察",
      publishDate: "2026-11-02",
      link: "https://mp.weixin.qq.com/s/demo-roguelike-random",
      digest: "随机地图不等于随机体验，关键在于选择是否真正改变后续策略。",
      content: "随机的价值在于迫使玩家重新思考，而不是简单打乱房间和奖励顺序。如果每局的最优策略始终一致，再复杂的随机生成也只会带来重复感。\n\n有效的设计会让早期选择持续影响后续资源、路线和风险，使玩家能讲述属于这一局的故事。",
      tags: ["Roguelike", "游戏机制", "独立游戏"],
      analysisStatus: "agent",
      wordCount: 2260
    },
    {
      id: "art-008",
      title: "秋季转会期观察：战队阵容调整背后的预算约束",
      account: "电竞产业评论",
      publishDate: "2026-10-30",
      link: "https://mp.weixin.qq.com/s/demo-transfer-budget",
      digest: "阵容变化不仅关乎选手实力，也反映俱乐部对赛季投入与回报的判断。",
      content: "转会期的每一次阵容调整，都同时受到竞技目标和预算边界的影响。明星选手并不总是最优解，角色互补、培养周期和商业合作同样进入决策。\n\n观察这些变化，需要把俱乐部公布的阵容与整个赛季的投入计划放在一起理解。",
      tags: ["LPL", "转会期", "俱乐部经营"],
      analysisStatus: "pending",
      wordCount: 2740
    }
  ]
};
