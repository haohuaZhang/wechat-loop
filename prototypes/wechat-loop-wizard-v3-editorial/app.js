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
    loading: false,
    handoffTaskId: null
  };

  const statusMap = {
    running: { label: "进行中", className: "info" },
    done: { label: "已完成", className: "success" },
    error: { label: "需处理", className: "danger" },
    verifying: { label: "需人工验证", className: "warning" },
    partial: { label: "部分完成", className: "info" },
    blocked: { label: "已停机", className: "danger" },
    cancelled: { label: "已取消", className: "neutral" }
  };
  const VIEW_TITLES = { collect: "新建采集", tasks: "任务记录", library: "文章库", settings: "系统设置" };
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

  function currentView() {
    const name = location.hash.replace(/^#\/?/, "");
    return VIEW_TITLES[name] ? name : "collect";
  }

  function switchView(name, options = {}) {
    const view = VIEW_TITLES[name] ? name : "collect";
    $$(".view").forEach((node) => node.classList.toggle("is-active", node.dataset.view === view));
    $$(".nav-item").forEach((link) => {
      const active = link.dataset.view === view;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $("#pageTitle").textContent = VIEW_TITLES[view];
    document.title = `${VIEW_TITLES[view]} · wechat-loop`;
    if (options.updateHash !== false && location.hash !== `#/${view}`) location.hash = `#/${view}`;
    window.scrollTo({ top: 0, behavior: "auto" });
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
    const running = DB.tasks.some((task) => task.status === "running");
    button.disabled = Boolean(running);
    const label = running ? "已有任务进行中" : state.sourceType === "fallback" ? "开始导入" : "开始采集";
    button.innerHTML = `${icon(running ? "clock" : "play")}<span>${label}</span>${running ? "" : icon("arrow")}`;
    if (!running) button.querySelector("svg:last-child")?.classList.add("end-icon");
  }

  function validateAndBuildConfig() {
    clearError();
    if (DB.tasks.some((task) => task.status === "running")) {
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

  function taskIcon(status) {
    return { running: "refresh", done: "check", error: "alert", verifying: "shield", partial: "alert", cancelled: "clock" }[status] || "clock";
  }

  function renderQueueBar() {
    const running = DB.tasks.filter((task) => task.status === "running");
    const current = running[0];
    $("#queueCurrent").textContent = current ? `${current.accountNames.join("、")} · ${current.mode}` : "无进行中任务";
    $("#queuePending").textContent = Math.max(Number(DB.queue && DB.queue.pending) || 0, Math.max(0, running.length - 1));
  }

  function renderStages(task) {
    if (!Array.isArray(task.stages) || !task.stages.length) return "";
    return `<div class="stage-bar">${task.stages.map((stage) => {
      const skipped = !stage.total;
      const ratio = stage.total > 0 ? Math.min(1, stage.done / stage.total) : 0;
      const cls = skipped || ratio >= 1 ? "done" : ratio > 0 ? "active" : "";
      return `<div class="stage ${cls}">
        <span class="stage-icon">${icon(skipped || ratio >= 1 ? "check" : ratio > 0 ? "refresh" : "clock")}</span>
        <div class="stage-copy"><strong>${esc(stage.name)}</strong><small>${skipped ? "跳过" : `${stage.done}/${stage.total}`}</small></div>
      </div>`;
    }).join("")}</div>`;
  }

  function renderFailure(task) {
    if (!task.errorCode) return "";
    const label = task.status === "blocked" ? "循环停机" : task.status === "error" ? "采集失败" : task.status === "verifying" ? "人工接管" : "部分完成";
    return `<div class="failure-box">
      <div class="failure-head">${icon("alert")}<strong>失败归因</strong><span class="status-pill ${task.status === "error" || task.status === "blocked" ? "danger" : "warning"}">${label}</span></div>
      <dl class="failure-list">
        <div><dt>错误码</dt><dd class="mono">${esc(task.errorCode)}</dd></div>
        <div><dt>原因</dt><dd>${esc(task.current)}</dd></div>
        <div><dt>下一步</dt><dd>${esc(task.errorHint || "降低采集数量，等待冷却后重试。")}</dd></div>
      </dl>
    </div>`;
  }

  function renderAttemptGuard(task) {
    if (!["error", "blocked"].includes(task.status)) return "";
    const attempts = Math.max(0, Number(task.attempts) || 0);
    const stopped = task.status === "blocked" || attempts >= 5;
    const rule = stopped ? "已停机：禁止原路径重试" : attempts >= 3 ? "必须更换假设，不得重复上一次操作" : "可自主修复，但必须记录本次假设";
    return `<div class="attempt-guard${stopped ? " stopped" : ""}">
      <div class="attempt-copy"><strong>同一问题连续失败 ${attempts}/5</strong><span>${rule}</span></div>
      <div class="attempt-dots" aria-label="失败 ${attempts} 次，上限 5 次">${Array.from({ length: 5 }, (_, index) => `<i class="${index < attempts ? "filled" : ""}"></i>`).join("")}</div>
    </div>`;
  }

  function renderEvidence(task) {
    if (!["done", "partial"].includes(task.status)) return "";
    const partial = task.status === "partial";
    const command = `python3 scripts/verify_ingest.py --task ${task.id}`;
    return `<details class="evidence-box" open>
      <summary><span>${icon(partial ? "alert" : "check")}完成证据</span><span class="status-pill ${partial ? "warning" : "success"}">${partial ? "证据未完整" : "证据通过"}</span></summary>
      <div class="evidence-body">
        <div class="evidence-command"><code>$ ${esc(command)}</code><span class="mono">exit ${partial ? 1 : 0}</span></div>
        <dl class="evidence-list">
          <div><dt>非空正文</dt><dd>${task.completed}/${task.total} 个 .md 文件${partial ? `，${task.failed} 个缺失` : "，全部校验通过"}</dd></div>
          <div><dt>入库路径</dt><dd class="mono">loop/kb/${esc(task.accountNames[0])}/</dd></div>
          <div><dt>知识库记录</dt><dd class="mono">loop/knowledge_base.json · ${task.completed} 条</dd></div>
          <div><dt>结论</dt><dd>${partial ? "只能标记部分完成，不得声称全部成功" : "正文文件真实存在且非空，允许标记完成"}</dd></div>
        </dl>
        <p class="evidence-demo">演示证据；正式版由本机校验命令生成，不采用 mock 结果。</p>
      </div>
    </details>`;
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
      : task.status === "verifying"
        ? `<button class="btn btn-secondary btn-sm" data-task-action="verify">${icon("shield")}去处理验证</button>`
        : task.status === "error"
          ? `<button class="btn btn-secondary btn-sm" data-task-action="auth">重新授权</button>`
          : `<button class="btn btn-secondary btn-sm" data-task-action="repeat">${icon("refresh")}再次采集</button>`;
    const attemptNote = Number(task.attempts) >= 3
      ? `<p class="attempt-note">${icon("alert")}<span>连续失败 ${Number(task.attempts)} 次，建议改用手动链接导入，避免继续重试触发更严格限流。</span></p>`
      : "";
    container.innerHTML = `<article class="active-task ${esc(task.status)}">
      <div class="task-top">
        <div><div class="task-title-line"><strong>${esc(task.accountNames.join("、"))} · ${esc(task.mode)}</strong><span class="status-pill ${status.className}">${status.label}</span>${task.demo ? `<span class="status-pill neutral">演示任务</span>` : ""}</div><p class="task-subtitle">任务 ${esc(task.id)} · ${esc(task.createdAt)}</p></div>
        <div class="task-actions">${action}</div>
      </div>
      <div class="progress-meta"><span>任务进度</span><strong>${Math.round(task.progress)}%</strong></div>
      <div class="progress-track"><div class="progress-bar${running ? " indeterminate" : ""}" style="width:${Math.max(0, Math.min(100, task.progress))}%"></div></div>
      ${renderStages(task)}
      <p class="task-current">${icon(taskIcon(task.status))}<span>${esc(task.current)}</span></p>
      <div class="task-counts"><span>总数 <strong>${task.total}</strong></span><span>已完成 <strong>${task.completed}</strong></span><span>失败 <strong>${task.failed}</strong></span><span>状态 <strong>${status.label}</strong></span></div>
      ${attemptNote}
      ${renderFailure(task)}
    </article>`;
  }

  function renderTaskHistory() {
    const tasks = DB.tasks.filter((task) => !state.activeTask || task.id !== state.activeTask.id).slice(0, 5);
    $("#taskHistory").innerHTML = tasks.map((task) => {
      const status = taskStatus(task);
      const retryLabel = task.status === "error" ? "带回参数重试" : "再次采集";
      const canRepeat = task.status === "error" || task.status === "partial";
      return `<div class="task-history-row" data-select-task="${esc(task.id)}">
        <div><strong>${esc(task.accountNames.join("、"))} · ${esc(task.mode)}</strong><small>${task.completed}/${task.total} 篇完成${task.failed ? ` · ${task.failed} 篇失败` : " · 已自动去重"}${Number(task.attempts) >= 3 ? " · 连续失败 3 次" : ""}</small></div>
        <div class="history-time">${esc(task.createdAt)}</div>
        <span class="status-pill ${status.className}">${status.label}</span>
        ${canRepeat ? `<button class="text-btn" data-retry="${esc(task.id)}">${retryLabel}</button>` : `<span></span>`}
      </div>`;
    }).join("");
  }

  function renderTasks() {
    renderQueueBar();
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
    (task.stages || []).forEach((stage) => { stage.done = stage.total; });
    task.current = task.autoAnalyze === false ? "采集完成，文章已入库，等待后续拆解" : "采集完成，文章已入库并完成本地拆解";
    ingestTask(task);
    renderTasks();
    toast(task.demo ? "演示任务已完成" : "采集任务已完成", `${task.completed} 篇文章已处理，结果已写入本地知识库。`);
  }

  function syncStages(task) {
    if (!Array.isArray(task.stages) || task.stages.length < 4) return;
    const progress = task.progress;
    const total = task.total || 0;
    const ramp = (from, span) => Math.max(0, Math.min(1, (progress - from) / span));
    task.stages[0].done = Math.min(task.stages[0].total, Math.round(ramp(0, 15) * total));
    task.stages[1].done = Math.min(task.stages[1].total, Math.round(ramp(15, 45) * total));
    task.stages[2].done = Math.min(task.stages[2].total, Math.round(ramp(60, 20) * total));
    if (task.stages[3].total > 0) task.stages[3].done = Math.min(task.stages[3].total, Math.round(ramp(80, 20) * total));
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
      syncStages(task);
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
      switchView("tasks");
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
      const tags = (article.tags || []).slice(0, 2);
      return `<div class="article-row" role="row">
        <div><button class="article-title-btn" data-article="${esc(article.id)}"><strong>${esc(article.title)}</strong><small>${esc(article.digest)}</small></button></div>
        <span class="article-account">${esc(article.account)}</span>
        <span class="article-date">${esc(article.publishDate)}</span>
        <div class="article-analysis"><span class="status-pill ${analysis.className}">${analysis.label}</span><div class="mini-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div></div>
        <button class="row-action" data-article="${esc(article.id)}" aria-label="查看文章详情">${icon("arrow")}</button>
      </div>`;
    }).join("");
  }

  function renderKbNotice() {
    const notice = $("#kbNotice");
    if (!notice) return;
    const merged = DB.kb.merged === true;
    notice.classList.toggle("success", merged);
    notice.classList.toggle("warning", !merged);
    if (merged) {
      notice.innerHTML = `${icon("check")}<div><strong>知识库已统一</strong><p>待合并库已汇入 loop/knowledge_base.json，文章统计保持不变。</p></div><span class="status-pill success">已合并</span>`;
      return;
    }
    notice.innerHTML = `${icon("alert")}<div><strong>检测到 2 个知识库</strong><p>loop/knowledge_base.json（主库）与 wechat-digest-skill/output/knowledge_base.json（待合并）。</p></div><button class="btn btn-secondary btn-sm" data-merge-kb>${icon("merge")}合并到主库</button>`;
  }

  async function mergeKnowledgeBase() {
    const button = $("[data-merge-kb]");
    if (button) {
      button.disabled = true;
      button.innerHTML = `${icon("refresh")}正在合并…`;
    }
    try {
      const response = await api.mergeKnowledgeBase();
      if (!response.ok) throw new Error("merge failed");
      DB.kb.merged = true;
      safeStorage("set", "wechat-loop-proto-kb-merged", "1");
      renderKbNotice();
      renderDiagnostics();
      toast("知识库已合并", "演示中不会移动真实文件；正式版会先备份再合并。统计数字保持不变。");
    } catch (_) {
      toast("合并失败", "请稍后重试。", "error");
      if (button) button.disabled = false;
    }
  }

  async function renderDiagnostics() {
    const grid = $("#settingsGrid");
    if (!grid) return;
    let response;
    try {
      response = await api.getDiagnostics();
    } catch (_) {
      grid.innerHTML = `<p class="diag-loading">诊断信息读取失败，请稍后重试。</p>`;
      return;
    }
    if (!response.ok) return;
    const d = response.data;
    const kb = d.kb || DB.kb;
    const service = d.service || {};
    const rate = d.rate || {};
    const upstream = (d.upstream || []).map((item) => {
      const ready = item.status === "ready";
      return `<div class="upstream-row${ready ? "" : " warn"}"><strong>${esc(item.name)}</strong><span class="status-pill ${ready ? "success" : "warning"}">${ready ? "只读 · 已就绪" : "只读 · 未发现"}</span></div>`;
    }).join("");
    grid.innerHTML = `
      <article class="diag-card">
        <div class="diag-head"><div class="diag-icon">${icon("server")}</div><div><h3>本机采集服务</h3><p>${esc(service.name)} · ${esc(service.version)}</p></div><span class="status-pill success">${esc(service.status)}</span></div>
        <dl class="diag-list">
          <div><dt>地址</dt><dd class="mono">${esc(service.address)}</dd></div>
          <div><dt>最近心跳</dt><dd>${esc(service.heartbeat)}</dd></div>
          <div><dt>采集方式</dt><dd>微信读书 L1 · 串行</dd></div>
        </dl>
        <div class="diag-actions"><button class="btn btn-secondary btn-sm" data-diag-action="restart">${icon("refresh")}重启服务</button><span class="diag-note">原型不执行真实重启</span></div>
      </article>
      <article class="diag-card">
        <div class="diag-head"><div class="diag-icon">${icon("database")}</div><div><h3>知识库</h3><p>knowledge_base.json</p></div>${kb.merged ? `<span class="status-pill success">已合并</span>` : `<span class="status-pill warning">待合并</span>`}</div>
        <dl class="diag-list">
          <div><dt>主库路径</dt><dd class="path">${esc(kb.primary.path)}</dd></div>
          <div><dt>文章数</dt><dd>${esc(kb.primary.articles)} 篇</dd></div>
          <div><dt>最后写入</dt><dd>${esc(kb.primary.lastWrite)}</dd></div>
          <div><dt>待合并库</dt><dd class="path">${esc(kb.legacy.path)}</dd></div>
          <div><dt>待合并文章</dt><dd>${esc(kb.legacy.articles)} 篇</dd></div>
        </dl>
      </article>
      <article class="diag-card">
        <div class="diag-head"><div class="diag-icon">${icon("clock")}</div><div><h3>频控与风控</h3><p>request throttle</p></div><span class="status-pill success">未冷却</span></div>
        <dl class="diag-list">
          <div><dt>最近请求间隔</dt><dd>${esc(rate.lastInterval)}</dd></div>
          <div><dt>冷却剩余</dt><dd>${esc(rate.cooldownMinutes)} 分钟</dd></div>
          <div><dt>自动冷却</dt><dd>${esc(rate.note)}</dd></div>
          <div><dt>L4 提醒</dt><dd>${esc(rate.l4)}</dd></div>
        </dl>
      </article>
      <article class="diag-card">
        <div class="diag-head"><div class="diag-icon">${icon("layers")}</div><div><h3>上游依赖</h3><p>read-only repos</p></div></div>
        <div class="upstream-list">${upstream}</div>
        <p class="diag-note">三个仓库仅作只读依赖，wechat-loop 不修改它们。</p>
      </article>
      <article class="diag-card danger-zone">
        <div class="diag-head"><div class="diag-icon">${icon("trash")}</div><div><h3>危险操作</h3><p>danger zone</p></div><span class="status-pill danger">谨慎</span></div>
        <p class="diag-danger-note">${icon("alert")}<span>以下操作在原型中不会执行，仅演示确认流程。</span></p>
        <div class="diag-actions">
          <button class="btn btn-danger-ghost btn-sm" data-diag-action="clear">${icon("trash")}清空演示数据</button>
          <button class="btn btn-danger-ghost btn-sm" data-diag-action="rebuild">${icon("refresh")}重建索引</button>
        </div>
      </article>`;
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
      <div class="drawer-footer"><button class="btn btn-secondary js-copy-link">${icon("copy")}复制原文链接</button>${article.analysisStatus === "pending" ? `<button class="btn btn-primary js-export-article">加入 Trae 批次</button>` : ""}</div>`;
    $(".js-copy-link", $("#drawerContent")).addEventListener("click", () => copyText(article.link));
    $(".js-export-article", $("#drawerContent"))?.addEventListener("click", () => {
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
      switchView("collect");
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
    switchView("collect");
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
      } else if (action === "verify") {
        toast("需要人工完成验证", "扫码 / 滑块属于 L4 操作，请在本机浏览器完成后再继续。", "error");
      } else if (action === "repeat") {
        restoreTask(state.activeTask);
      }
    });
    $("#taskHistory").addEventListener("click", (event) => {
      const button = event.target.closest("[data-retry]");
      if (button) {
        const retryTask = DB.tasks.find((item) => item.id === button.dataset.retry);
        if (retryTask) restoreTask(retryTask);
        return;
      }
      const row = event.target.closest("[data-select-task]");
      if (!row) return;
      const task = DB.tasks.find((item) => item.id === row.dataset.selectTask);
      if (!task) return;
      state.activeTask = task;
      renderTasks();
      toast("已打开历史任务", `${task.accountNames.join("、")} · ${task.mode}`);
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

    $("#kbNotice").addEventListener("click", (event) => {
      if (event.target.closest("[data-merge-kb]")) mergeKnowledgeBase();
    });
    $("#settingsGrid").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-diag-action]");
      if (!button) return;
      const action = button.dataset.diagAction;
      if (action === "restart") {
        button.disabled = true;
        await api.restartService();
        toast("原型不执行真实重启", "正式版会重启 127.0.0.1:5200 的 wechat-mp-tools。");
        renderDiagnostics();
      } else if (action === "clear") {
        if (window.confirm("清空演示数据？原型中不会执行该操作。")) {
          toast("原型中不会执行", "清空演示数据仅在正式版中可用。");
        }
      } else if (action === "rebuild") {
        if (window.confirm("重建知识库索引？原型中不会执行该操作。")) {
          toast("原型中不会执行", "重建索引仅在正式版中可用。");
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      $$(".modal-backdrop:not(.hidden)").forEach((modal) => closeModal(modal.id));
      if (!$("#articleDrawer").classList.contains("hidden")) closeDrawer();
    });
    $$(".nav-item").forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault();
      switchView(link.dataset.view);
    }));
    window.addEventListener("hashchange", () => switchView(currentView(), { updateHash: false }));
  }

  function init() {
    if (safeStorage("get", "wechat-loop-proto-auth") === "1") DB.auth.loggedIn = true;
    if (safeStorage("get", "wechat-loop-proto-kb-merged") === "1") DB.kb.merged = true;
    renderAuth();
    renderStats();
    renderAccountPicker();
    renderTasks();
    renderLibrary();
    renderKbNotice();
    renderDiagnostics();
    updateFallbackPanel();
    updateSummary();
    bindEvents();
    switchView(currentView(), { updateHash: false });
    if (state.activeTask) runTask(state.activeTask);
  }

  init();
})();
