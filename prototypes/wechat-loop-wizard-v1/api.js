// 原型 API stub：只返回 mock，不发起真实网络请求。
// 后续对接时保留函数签名，将内部实现替换为本机 127.0.0.1 服务。
(function () {
  const delay = (ms = 450) => new Promise((resolve) => setTimeout(resolve, ms));

  window.PrototypeAPI = {
    // TODO: POST /api/login/start → 微信读书真实二维码与轮询会话。
    async login() {
      await delay(850);
      window.MockDB.auth.loggedIn = true;
      return { ok: true, data: window.MockDB.auth };
    },

    // TODO: POST /api/login/logout → 仅清除本机会话，不记录 token。
    async logout() {
      await delay(350);
      window.MockDB.auth.loggedIn = false;
      return { ok: true };
    },

    // TODO: POST /api/collect → { sourceType, mode, accountIds, count, startDate, endDate }。
    // TODO: POST /api/collect-urls → { sourceType, text }。
    async createTask(config) {
      await delay(650);
      const id = `task-${Date.now()}`;
      const isFallback = config.sourceType === "fallback";
      const total = isFallback
        ? Math.max(1, config.recognizedCount || 1)
        : config.mode === "multi"
          ? config.accountIds.length * Number(config.count)
          : config.mode === "range"
            ? 12
            : Number(config.count);
      const accountNames = isFallback
        ? [config.fallbackType === "links" ? "手动链接" : "订阅源"]
        : config.mode === "multi"
          ? window.MockDB.accounts.filter((item) => config.accountIds.includes(item.id)).map((item) => item.name)
          : [config.accountName];
      const mode = isFallback
        ? config.fallbackType === "links" ? "批量文章链接" : config.fallbackType === "rss" ? "RSS / Atom" : "OPML 订阅"
        : config.mode === "recent" ? `最近 ${config.count} 篇` : config.mode === "range" ? `${config.startDate} 至 ${config.endDate}` : `多公众号 · 各 ${config.count} 篇`;
      return {
        ok: true,
        data: {
          id,
          mode,
          accountNames,
          total,
          completed: 0,
          failed: 0,
          status: "running",
          progress: 0,
          createdAt: "刚刚",
          current: "正在创建本地采集任务…",
          autoAnalyze: config.autoAnalyze,
          config: { ...config },
          logs: ["任务参数校验通过", "已加入串行任务队列"]
        }
      };
    },

    // TODO: GET /api/articles?query=&account= → 统一知识库文章列表。
    async getArticle(id) {
      await delay(250);
      const article = window.MockDB.articles.find((item) => item.id === id);
      return article ? { ok: true, data: article } : { ok: false, message: "文章不存在" };
    }
  };
})();
