(function () {
  "use strict";

  const DB = window.MockDB;
  const api = window.PrototypeAPI;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    sourceType: "auto",
    mode: "recent",
    fallbackType: "links",
    selectedAccountIds: DB.accounts.filter((item) => item.enabled).map((item) => item.id),
    activeTask: DB.tasks.find((item) => item.status === "running") || null,
    timer: null,
    recognizedCount: 0,
    loading: false
  };

  const statusMap = {
    running: { label: "进行中", className: "info" },
    done: { label: "已完成", className: "success" },
    error: { label: "需处理", className: "danger" },
    cancelled: { label: "已取消", className: "neutral" }
  };
  const analysisMap = {
    agent: { label: "Trae 已拆解", className: "success" },
    local: { label: "本地已拆解", className: "info" },
    pending: { label: "待拆解", className: "warning" }
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function safeStorage(action, key, value) {
    try {
      if (action === "get") return localStorage.getItem(key);
      if (action === "set") localStorage.setItem(key, value);
      if (action === "remove") localStorage.removeItem(key);
    } catch (_) { /* file:// 下存储不可用时仅失去状态记忆，不影响原型。 */ }
    return null;
  }

  function toast(title, message = "", type = "success") {
    const item = document.createElement("div");
    item.className = `toast${type === "error" ? " error" : ""}`;
    item.innerHTML = `${icon(type === "error" ? "alert" : "check")}<div><strong>${esc(title)}</strong>${message ? `<p>${esc(message)}</p>` : ""}</div>`;
    $("#toastRegion").appendChild(item);
    setTimeout(() => item.remove(), 3600);
  }

  function showError(message) {
    const node = $("#formError");
    node.textContent = message;
    node.classList.remove("hidden");
  }

  function clearError() {
    $("#formError").classList.add("hidden");
  }

  function openModal(id) {
    if (id === "loginModal") {
      const loggedIn = DB.auth.loggedIn;
      $("#loginView").classList.toggle("hidden", loggedIn);
      $("#accountView").classList.toggle("hidden", !loggedIn);
      $("#modalNickname").textContent = DB.auth.nickname;
      $("#modalVid").textContent = DB.auth.vidMasked;
    }
    $(`#${id}`).classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    $(`#${id}`).classList.add("hidden");
    if ($$(".modal-backdrop:not(.hidden)").length === 0 && $("#articleDrawer").classList.contains("hidden")) {
      document.body.style.overflow = "";
    }
  }

  function renderAuth() {
    const loggedIn = DB.auth.loggedIn;
    $("#authCard").classList.toggle("connected", loggedIn);
    $("#authTitle").textContent = loggedIn ? DB.auth.nickname : "尚未连接";
    $("#authDescription").textContent = loggedIn ? `${DB.auth.vidMasked} · 授权有效` : "扫码授权后即可自动采集";
    $("#authBtn").textContent = loggedIn ? "管理账号" : "扫码登录";
    $("#authCheckText").textContent = loggedIn ? "授权有效，可开始自动采集" : "等待扫码登录";
    const checkIcon = $("#authCheck .check-icon");
    checkIcon.classList.toggle("pending", !loggedIn);
    checkIcon.innerHTML = icon(loggedIn ? "check" : "clock");
  }

  function renderStats() {
    $("#statArticles").textContent = DB.stats.articles;
    $("#statMonth").textContent = DB.stats.month;
    $("#statAccounts").textContent = DB.stats.accounts;
    $("#statPending").textContent = DB.stats.pending;
  }

  function renderAccountPicker() {
    $("#accountPicker").innerHTML = DB.accounts.map((account) => {
      const selected = state.selectedAccountIds.includes(account.id);
      return `<label class="account-option${selected ? " selected" : ""}" data-account-option="${esc(account.id)}">
        <input type="checkbox" value="${esc(account.id)}"${selected ? " checked" : ""}>
        <span class="account-check">${icon("check")}</span>
        <span><strong>${esc(account.name)}</strong><small>已入库 ${account.articleCount} 篇 · ${esc(account.lastCollected)}</small></span>
      </label>`;
    }).join("");
    $("#accountSuggestions").innerHTML = DB.accounts.map((account) => `<option value="${esc(account.name)}"></option>`).join("");
    updateToggleAccountsLabel();
  }

  function updateToggleAccountsLabel() {
    const allSelected = state.selectedAccountIds.length === DB.accounts.length;
    $("#toggleAccounts").textContent = allSelected ? "清空选择" : "全选";
  }

  function clampNumber(input, fallback = 1) {
    const min = Number(input.min || 1);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function parseFallbackContent() {
    const text = $("#fallbackText").value.trim();
    let count = 0;
    let description = "等待粘贴内容";
    if (text) {
      if (state.fallbackType === "links") {
        count = (text.match(/https?:\/\/mp\.weixin\.qq\.com\/[^\s]+/g) || []).length;
        description = count ? `已识别 ${count} 篇公众号文章` : "暂未识别到公众号文章链接";
      } else if (state.fallbackType === "rss") {
        count = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^https?:\/\//.test(line)).length;
        description = count ? `已识别 ${count} 个订阅源` : "暂未识别到订阅地址";
      } else {
        count = (text.match(/<outline\b/gi) || []).length;
        description = count ? `已识别 OPML 中的 ${count} 个订阅条目` : "请粘贴完整的 OPML XML 内容";
      }
    }
    state.recognizedCount = count;
    $("#recognitionText").textContent = description;
    updateSummary();
  }

  function updateFallbackPanel() {
    const copy = {
      links: {
        label: "公众号文章链接",
        placeholder: "一行一个链接，例如：\nhttps://mp.weixin.qq.com/s/...",
        hint: "支持批量粘贴，公开文章页采集，不自动发现其他文章。"
      },
      rss: {
        label: "RSS / Atom 订阅地址",
        placeholder: "一行一个订阅地址，例如：\nhttps://example.com/feed.xml",
        hint: "重复导入会按文章链接去重，只新增此前未入库的内容。"
      },
      opml: {
        label: "OPML 文件内容",
        placeholder: "用文本编辑器打开 .opml 文件，全选并粘贴到这里",
        hint: "程序会读取其中的订阅条目，不需要安装 RSS 阅读器。"
      }
    }[state.fallbackType];
    $("#fallbackLabel").textContent = copy.label;
    $("#fallbackText").placeholder = copy.placeholder;
    $("#fallbackHint").textContent = copy.hint;
    parseFallbackContent();
  }

  function updateSummary() {
    let mode;
    let target;
    let count;
    if (state.sourceType === "fallback") {
      mode = { links: "批量文章链接", rss: "RSS / Atom", opml: "OPML 订阅" }[state.fallbackType];
      target = state.fallbackType === "links" ? "手动粘贴的公开文章页" : "用户提供的订阅源";
      count = state.recognizedCount ? `${state.recognizedCount} ${state.fallbackType === "links" ? "篇文章" : "个来源"}` : "等待识别内容";
    } else if (state.mode === "recent") {
      mode = "最近 N 篇";
      target = $("#recentAccount").value.trim() || "待选择公众号";
      count = `${clampNumber($("#recentCount"), 20)} 篇文章`;
    } else if (state.mode === "range") {
      mode = "按日期范围";
      target = $("#rangeAccount").value.trim() || "待选择公众号";
      count = `${$("#startDate").value || "开始日期"} 至 ${$("#endDate").value || "结束日期"}`;
    } else {
      mode = "多个公众号";
      target = state.selectedAccountIds.length ? `已选 ${state.selectedAccountIds.length} 个公众号` : "待选择公众号";
      count = `每个号 ${clampNumber($("#multiCount"), 10)} 篇`;
    }
    $("#summaryMode").textContent = mode;
    $("#summaryTarget").textContent = target;
    $("#summaryCount").textContent = count;
    $("#summaryAfter").textContent = $("#autoAnalyze").checked ? "下载 → 入库 → 本地拆解" : "下载 → 入库";
  }

  function setSource(sourceType) {
    state.sourceType = sourceType;
    $$("[data-source]").forEach((button) => {
      const active = button.dataset.source === sourceType;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("#autoPanel").classList.toggle("hidden", sourceType !== "auto");
    $("#fallbackPanel").classList.toggle("hidden", sourceType !== "fallback");
    clearError();
    updateSummary();
    renderStartButton();
  }

  function setMode(mode) {
    state.mode = mode;
    $$("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    ["recent", "range", "multi"].forEach((name) => $(`#${name}Panel`).classList.toggle("hidden", name !== mode));
    clearError();
    updateSummary();
  }

  function setFallbackType(type) {
    state.fallbackType = type;
    $$("[data-fallback]").forEach((button) => {
      const active = button.dataset.fallback === type;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    clearError();
    updateFallbackPanel();
  }

  function renderStartButton() {
    const button = $("#startBtn");
    if (state.loading) return;
    const running = state.activeTask && state.activeTask.status === "running";
    button.disabled = Boolean(running);
    const label = running ? "已有任务进行中" : state.sourceType === "fallback" ? "开始导入" : "开始采集";
    button.innerHTML = `${icon(running ? "clock" : "play")}<span>${label}</span>${running ? "" : icon("arrow")}`;
    if (!running) button.querySelector("svg:last-child")?.classList.add("end-icon");
  }

  function validateAndBuildConfig() {
    clearError();
    if (state.activeTask && state.activeTask.status === "running") {
      showError("当前已有任务正在运行，请等待完成或先取消任务。");
      return null;
    }
    if (state.sourceType === "auto" && !DB.auth.loggedIn) {
      showError("自动采集需要先连接微信读书账号。链接 / 订阅导入可以不登录。 ");
      openModal("loginModal");
      return null;
    }

    const base = { sourceType: state.sourceType, autoAnalyze: $("#autoAnalyze").checked };
    if (state.sourceType === "fallback") {
      if (!$("#fallbackText").value.trim()) {
        showError("请先粘贴需要导入的内容。 ");
        return null;
      }
      if (!state.recognizedCount) {
        showError(state.fallbackType === "opml" ? "没有识别到 OPML 订阅条目，请检查 XML 内容。" : "没有识别到有效内容，请检查格式。 ");
        return null;
      }
      return { ...base, fallbackType: state.fallbackType, text: $("#fallbackText").value.trim(), recognizedCount: state.recognizedCount };
    }

    if (state.mode === "recent") {
      const accountName = $("#recentAccount").value.trim();
      if (!accountName) {
        showError("请输入公众号名称或该公众号的任意文章链接。 ");
        $("#recentAccount").focus();
        return null;
      }
      return { ...base, mode: "recent", accountName, count: clampNumber($("#recentCount"), 20) };
    }
    if (state.mode === "range") {
      const accountName = $("#rangeAccount").value.trim();
      const startDate = $("#startDate").value;
      const endDate = $("#endDate").value;
      if (!accountName) {
        showError("请输入需要按日期采集的公众号。 ");
        return null;
      }
      if (!startDate || !endDate || startDate > endDate) {
        showError("请选择完整的日期范围，开始日期不能晚于结束日期。 ");
        return null;
      }
      return { ...base, mode: "range", accountName, startDate, endDate };
    }
    if (!state.selectedAccountIds.length) {
      showError("请至少选择一个公众号。 ");
      return null;
    }
    return { ...base, mode: "multi", accountIds: [...state.selectedAccountIds], count: clampNumber($("#multiCount"), 10) };
  }

  function taskStatus(task) {
    return statusMap[task.status] || statusMap.cancelled;
  }

  function renderActiveTask() {
    const task = state.activeTask;
    const container = $("#activeTask");
    if (!task) {
      container.innerHTML = `<div class="empty-task">${icon("tasks")}<div><strong>还没有采集任务</strong><p>选择一种方式并开始采集后，进度会显示在这里。</p></div></div>`;
      return;
    }
    const status = taskStatus(task);
    const running = task.status === "running";
    const action = running
      ? `<button class="btn btn-secondary btn-sm" data-task-action="cancel">取消任务</button>`
      : task.status === "error"
        ? `<button class="btn btn-secondary btn-sm" data-task-action="auth">重新授权</button>`
        : `<button class="btn btn-secondary btn-sm" data-task-action="repeat">${icon("refresh")}再次采集</button>`;
    container.innerHTML = `<article class="active-task ${esc(task.status)}">
      <div class="task-top">
        <div><div class="task-title-line"><strong>${esc(task.accountNames.join("、"))} · ${esc(task.mode)}</strong><span class="status-pill ${status.className}">${status.label}</span>${task.demo ? `<span class="status-pill neutral">演示任务</span>` : ""}</div><p class="task-subtitle">任务 ${esc(task.id)} · ${esc(task.createdAt)}</p></div>
        <div class="task-actions">${action}</div>
      </div>
      <div class="progress-meta"><span>任务进度</span><strong>${Math.round(task.progress)}%</strong></div>
      <div class="progress-track"><div class="progress-bar${running ? " indeterminate" : ""}" style="width:${Math.max(0, Math.min(100, task.progress))}%"></div></div>
      <p class="task-current">${icon(running ? "refresh" : task.status === "done" ? "check" : task.status === "error" ? "alert" : "clock")}<span>${esc(task.current)}</span></p>
      <div class="task-counts"><span>总数 <strong>${task.total}</strong></span><span>已完成 <strong>${task.completed}</strong></span><span>失败 <strong>${task.failed}</strong></span><span>状态 <strong>${status.label}</strong></span></div>
    </article>`;
  }

  function renderTaskHistory() {
    const tasks = DB.tasks.filter((task) => !state.activeTask || task.id !== state.activeTask.id).slice(0, 5);
    $("#taskHistory").innerHTML = tasks.map((task) => {
      const status = taskStatus(task);
      return `<div class="task-history-row">
        <div><strong>${esc(task.accountNames.join("、"))} · ${esc(task.mode)}</strong><small>${task.completed}/${task.total} 篇完成${task.failed ? ` · ${task.failed} 篇失败` : " · 已自动去重"}</small></div>
        <div class="history-time">${esc(task.createdAt)}</div>
        <span class="status-pill ${status.className}">${status.label}</span>
        ${task.status === "error" ? `<button class="text-btn" data-retry="${esc(task.id)}">带回参数重试</button>` : `<span></span>`}
      </div>`;
    }).join("");
  }

  function renderTasks() {
    renderActiveTask();
    renderTaskHistory();
    const runningCount = DB.tasks.filter((task) => task.status === "running").length;
    $("#navTaskCount").textContent = runningCount;
    $("#taskMeta").textContent = runningCount ? `${runningCount} 个进行中的任务` : "当前没有运行中的任务";
    renderStartButton();
  }

  function ingestTask(task) {
    if (task.ingested || task.status !== "done") return;
    task.ingested = true;
    const imported = Math.max(0, task.total - task.failed);
    DB.stats.articles += imported;
    DB.stats.month += imported;
    if (task.autoAnalyze === false) DB.stats.pending += imported;
    const account = DB.accounts.find((item) => item.name === task.accountNames[0])?.name || "游戏汇总";
    const samples = Math.min(2, imported);
    for (let index = 0; index < samples; index += 1) {
      const id = `art-${Date.now()}-${index}`;
      DB.articles.unshift({
        id,
        title: index === 0 ? `${account}近期内容观察：产品、赛事与行业变化` : `${account}新采文章：值得关注的内容与观点`,
        account,
        publishDate: "2026-11-13",
        link: `https://mp.weixin.qq.com/s/demo-${Date.now()}-${index}`,
        digest: "通过本次本地采集任务入库的演示文章，正文、标签与拆解状态均可交互查看。",
        content: "这是由原型采集任务生成的演示正文。正式版本中，这里会展示从实际下载结果读取的文章内容。\n\n任务只有在正文文件写入成功后才会被标记为完成；重复链接会在入库前自动跳过。",
        tags: ["新采集", "公众号", account],
        analysisStatus: task.autoAnalyze === false ? "pending" : "local",
        wordCount: 1860 + index * 420
      });
    }
    renderStats();
    renderLibrary();
  }

  function completeTask(task) {
    clearInterval(state.timer);
    state.timer = null;
    task.status = "done";
    task.progress = 100;
    task.completed = task.total;
    task.current = task.autoAnalyze === false ? "采集完成，文章已入库，等待后续拆解" : "采集完成，文章已入库并完成本地拆解";
    ingestTask(task);
    renderTasks();
    toast(task.demo ? "演示任务已完成" : "采集任务已完成", `${task.completed} 篇文章已处理，结果已写入本地知识库。`);
  }

  function runTask(task) {
    clearInterval(state.timer);
    if (!task || task.status !== "running") return;
    state.timer = setInterval(() => {
      if (task.status !== "running") {
        clearInterval(state.timer);
        return;
      }
      task.progress = Math.min(100, task.progress + 4 + Math.random() * 7);
      task.completed = Math.min(task.total, Math.floor((task.progress / 100) * task.total));
      if (task.progress < 18) task.current = "正在获取文章列表并检查重复内容…";
      else if (task.progress < 82) task.current = `正在下载正文与图片：第 ${Math.max(1, task.completed + 1)} 篇`;
      else task.current = task.autoAnalyze === false ? "正在校验下载结果并写入知识库…" : "正在写入知识库并生成本地拆解…";
      if (task.progress >= 100) completeTask(task);
      else {
        renderActiveTask();
        $("#navTaskCount").textContent = DB.tasks.filter((item) => item.status === "running").length;
      }
    }, 520);
  }

  async function startCollection() {
    const config = validateAndBuildConfig();
    if (!config) return;
    state.loading = true;
    const button = $("#startBtn");
    button.disabled = true;
    button.innerHTML = `${icon("refresh")}<span>正在创建任务…</span>`;
    try {
      const response = await api.createTask(config);
      state.activeTask = response.data;
      DB.tasks.unshift(response.data);
      renderTasks();
      runTask(response.data);
      toast(state.sourceType === "fallback" ? "导入任务已创建" : "采集任务已创建", "可以继续在页面中查看进度，不需要重复点击。 ");
      $("#tasks").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_) {
      toast("任务创建失败", "请检查输入后重试。", "error");
    } finally {
      state.loading = false;
      renderStartButton();
    }
  }

  function populateAccountFilter() {
    const select = $("#accountFilter");
    const current = select.value || "all";
    const names = [...new Set(DB.articles.map((article) => article.account))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    select.innerHTML = `<option value="all">全部公众号</option>${names.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
    select.value = names.includes(current) ? current : "all";
  }

  function renderLibrary() {
    populateAccountFilter();
    const query = $("#articleSearch").value.trim().toLowerCase();
    const account = $("#accountFilter").value;
    const articles = DB.articles.filter((article) => {
      const matchesAccount = account === "all" || article.account === account;
      const haystack = `${article.title} ${article.digest} ${article.tags.join(" ")}`.toLowerCase();
      return matchesAccount && (!query || haystack.includes(query));
    });
    $("#filterResult").textContent = `${articles.length} 篇文章`;
    $("#articleEmpty").classList.toggle("hidden", articles.length > 0);
    $(".article-table").classList.toggle("hidden", articles.length === 0);
    $("#articleRows").innerHTML = articles.map((article) => {
      const analysis = analysisMap[article.analysisStatus] || analysisMap.pending;
      return `<div class="article-row" role="row">
        <div><button class="article-title-btn" data-article="${esc(article.id)}"><strong>${esc(article.title)}</strong><small>${esc(article.digest)}</small></button></div>
        <span class="article-account">${esc(article.account)}</span>
        <span class="article-date">${esc(article.publishDate)}</span>
        <span class="status-pill ${analysis.className}">${analysis.label}</span>
        <button class="row-action" data-article="${esc(article.id)}" aria-label="查看文章详情">${icon("arrow")}</button>
      </div>`;
    }).join("");
  }

  async function openArticle(id) {
    const drawer = $("#articleDrawer");
    const backdrop = $("#drawerBackdrop");
    $("#drawerContent").innerHTML = `<p class="drawer-meta">正在读取本地文章…</p>`;
    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    const response = await api.getArticle(id);
    if (!response.ok) {
      $("#drawerContent").innerHTML = `<p class="form-error">${esc(response.message)}</p>`;
      return;
    }
    const article = response.data;
    const analysis = analysisMap[article.analysisStatus] || analysisMap.pending;
    $("#drawerContent").innerHTML = `
      <span class="drawer-kicker">${esc(article.account)} / ${esc(article.publishDate)}</span>
      <h2>${esc(article.title)}</h2>
      <div class="drawer-meta"><span>${article.wordCount} 字</span><span>${analysis.label}</span><span>本地正文已保存</span></div>
      <div class="tag-list">${article.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</div>
      <section class="analysis-box"><h3>${article.analysisStatus === "pending" ? "拆解状态" : "内容摘要"}</h3><p>${esc(article.analysisStatus === "pending" ? "正文已入库，可加入下一批 Trae 拆解任务。当前摘要来自文章自身导语。" : article.digest)}</p></section>
      <section class="drawer-section"><h3>正文预览</h3><p>${esc(article.content)}</p></section>
      <div class="drawer-footer"><button class="btn btn-secondary" id="copyArticleLink">${icon("copy")}复制原文链接</button>${article.analysisStatus === "pending" ? `<button class="btn btn-primary" id="exportArticle">加入 Trae 批次</button>` : ""}</div>`;
    $("#copyArticleLink").addEventListener("click", () => copyText(article.link));
    $("#exportArticle")?.addEventListener("click", () => {
      toast("已加入演示批次", "正式版会导出到 loop/trae/outbox/wechat-batch.json。 ");
    });
  }

  function closeDrawer() {
    $("#articleDrawer").classList.add("hidden");
    $("#drawerBackdrop").classList.add("hidden");
    document.body.style.overflow = "";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("链接已复制");
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      toast(copied ? "链接已复制" : "请手动复制链接", copied ? "" : text, copied ? "success" : "error");
    }
  }

  function restoreTask(task) {
    const config = task.config || {};
    const fallbackTypes = { "批量文章链接": "links", "RSS / Atom": "rss", "OPML 订阅": "opml" };
    const sourceType = config.sourceType || (fallbackTypes[task.mode] ? "fallback" : "auto");
    if (typeof config.autoAnalyze === "boolean") $("#autoAnalyze").checked = config.autoAnalyze;

    if (sourceType === "fallback") {
      setSource("fallback");
      setFallbackType(config.fallbackType || fallbackTypes[task.mode] || "links");
      $("#fallbackText").value = "";
      parseFallbackContent();
      $("#collect").scrollIntoView({ behavior: "smooth" });
      toast("已切换回上次导入方式", "请重新粘贴文章链接或订阅内容。 ");
      return;
    }

    setSource("auto");
    const inferredMode = task.mode.includes("至") ? "range" : task.mode.startsWith("多公众号") ? "multi" : "recent";
    const mode = config.mode || inferredMode;
    const accountName = config.accountName || task.accountNames[0] || "";
    setMode(mode);
    if (mode === "range") {
      const [startDate, endDate] = task.mode.split(" 至 ");
      $("#rangeAccount").value = accountName;
      $("#startDate").value = config.startDate || startDate || "";
      $("#endDate").value = config.endDate || endDate || "";
    } else if (mode === "multi") {
      state.selectedAccountIds = config.accountIds
        ? [...config.accountIds]
        : DB.accounts.filter((account) => task.accountNames.includes(account.name)).map((account) => account.id);
      $("#multiCount").value = config.count || Number(task.mode.match(/各\s*(\d+)\s*篇/)?.[1]) || 10;
      renderAccountPicker();
    } else {
      $("#recentAccount").value = accountName;
      $("#recentCount").value = config.count || Number(task.mode.match(/最近\s*(\d+)\s*篇/)?.[1]) || 20;
    }
    $("#collect").scrollIntoView({ behavior: "smooth" });
    updateSummary();
    toast("已带回上次任务参数", task.status === "error" ? "重新授权后即可开始。 " : "确认参数后可创建新任务。 ");
  }

  function bindEvents() {
    $$("[data-source]").forEach((button) => button.addEventListener("click", () => setSource(button.dataset.source)));
    $$("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
    $$("[data-fallback]").forEach((button) => button.addEventListener("click", () => setFallbackType(button.dataset.fallback)));
    ["#recentAccount", "#recentCount", "#rangeAccount", "#startDate", "#endDate", "#multiCount"].forEach((selector) => {
      $(selector).addEventListener("input", () => { clearError(); updateSummary(); });
      $(selector).addEventListener("change", updateSummary);
    });
    $$("[data-step-target]").forEach((button) => button.addEventListener("click", () => {
      const input = $(`#${button.dataset.stepTarget}`);
      input.value = clampNumber({ value: Number(input.value) + Number(button.dataset.step), min: input.min, max: input.max }, 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }));
    $("#autoAnalyze").addEventListener("change", updateSummary);
    $("#fallbackText").addEventListener("input", () => { clearError(); parseFallbackContent(); });
    $("#accountPicker").addEventListener("change", (event) => {
      const input = event.target.closest("input[type=checkbox]");
      if (!input) return;
      state.selectedAccountIds = input.checked
        ? [...new Set([...state.selectedAccountIds, input.value])]
        : state.selectedAccountIds.filter((id) => id !== input.value);
      renderAccountPicker();
      updateSummary();
    });
    $("#toggleAccounts").addEventListener("click", () => {
      state.selectedAccountIds = state.selectedAccountIds.length === DB.accounts.length ? [] : DB.accounts.map((item) => item.id);
      renderAccountPicker();
      updateSummary();
    });
    $("#startBtn").addEventListener("click", startCollection);

    $("#authBtn").addEventListener("click", () => openModal("loginModal"));
    $("#guideBtn").addEventListener("click", () => openModal("guideModal"));
    $$("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
    $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    }));
    $("#simulateLogin").addEventListener("click", async () => {
      const button = $("#simulateLogin");
      button.disabled = true;
      button.innerHTML = `${icon("refresh")}<span>正在完成模拟授权…</span>`;
      await api.login();
      safeStorage("set", "wechat-loop-proto-auth", "1");
      renderAuth();
      closeModal("loginModal");
      button.disabled = false;
      button.innerHTML = `${icon("check")}<span>模拟扫码并完成授权</span>`;
      toast("微信读书已连接", "现在可以使用自动采集。 ");
    });
    $("#logoutBtn").addEventListener("click", async () => {
      await api.logout();
      safeStorage("remove", "wechat-loop-proto-auth");
      renderAuth();
      closeModal("loginModal");
      toast("已退出演示账号", "链接 / 订阅导入仍可使用。 ");
    });

    $("#activeTask").addEventListener("click", (event) => {
      const button = event.target.closest("[data-task-action]");
      if (!button || !state.activeTask) return;
      const action = button.dataset.taskAction;
      if (action === "cancel" && state.activeTask.status === "running") {
        clearInterval(state.timer);
        state.activeTask.status = "cancelled";
        state.activeTask.current = "任务已取消，已下载的演示结果保留在本机";
        renderTasks();
        toast("任务已取消", "再次点击开始采集可创建新任务。 ");
      } else if (action === "auth") {
        openModal("loginModal");
      } else if (action === "repeat") {
        restoreTask(state.activeTask);
      }
    });
    $("#taskHistory").addEventListener("click", (event) => {
      const button = event.target.closest("[data-retry]");
      if (!button) return;
      const task = DB.tasks.find((item) => item.id === button.dataset.retry);
      if (task) restoreTask(task);
    });

    $("#articleSearch").addEventListener("input", renderLibrary);
    $("#accountFilter").addEventListener("change", renderLibrary);
    $("#clearFilters").addEventListener("click", () => {
      $("#articleSearch").value = "";
      $("#accountFilter").value = "all";
      renderLibrary();
    });
    $("#articleRows").addEventListener("click", (event) => {
      const button = event.target.closest("[data-article]");
      if (button) openArticle(button.dataset.article);
    });
    $("#closeDrawer").addEventListener("click", closeDrawer);
    $("#drawerBackdrop").addEventListener("click", closeDrawer);
    $("#workbenchBtn").addEventListener("click", () => toast("工作台入口已就绪", "正式版会打开本机 digest.html；当前为单页交互原型。 "));

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      $$(".modal-backdrop:not(.hidden)").forEach((modal) => closeModal(modal.id));
      if (!$("#articleDrawer").classList.contains("hidden")) closeDrawer();
    });
    $$(".nav-item").forEach((link) => link.addEventListener("click", () => {
      $$(".nav-item").forEach((item) => item.classList.toggle("active", item === link));
    }));
  }

  function initNavObserver() {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      $$(".nav-item").forEach((link) => link.classList.toggle("active", link.dataset.nav === visible.target.id));
    }, { rootMargin: "-15% 0px -55% 0px", threshold: [0, .2, .5] });
    ["collect", "tasks", "library"].forEach((id) => observer.observe($(`#${id}`)));
  }

  function init() {
    if (safeStorage("get", "wechat-loop-proto-auth") === "1") DB.auth.loggedIn = true;
    renderAuth();
    renderStats();
    renderAccountPicker();
    renderTasks();
    renderLibrary();
    updateFallbackPanel();
    updateSummary();
    bindEvents();
    initNavObserver();
    if (state.activeTask) runTask(state.activeTask);
  }

  init();
})();
