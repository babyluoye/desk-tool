import { configureCloseBehavior, initWindowControls, updateWindowTitle } from "./window-controls";
import { listen } from "@tauri-apps/api/event";
import { appApi } from "./api";
import type { ApiToken, AppSnapshot, TokenGroup, TranslationSettings, UsageLog } from "./domain";
import { languageOptions } from "./translation";
import { icon, renderIcons } from "./icons";
import "./styles.css";

const supportsRegionScreenshot = navigator.userAgent.includes("Windows");
const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("Application root was not found");
}

const app = appElement;

const state: {
  snapshot: AppSnapshot;
  selectedTokenId: string | null;
  selectedGroupId: string | null;
  notice: { type: "success" | "error" | "info"; text: string } | null;
  loading: boolean;
  showSettings: boolean;
  page: "home" | "logs" | "settings" | "tools";
  usageLogs: UsageLog[];
  usageTotal: number;
  usagePage: number;
  shortcutDraft: string | null;
  shortcutWarning: string | null;
  translationSettings: TranslationSettings;
} = {
  snapshot: { connection: null, tokens: [], groups: [], lastSyncedAt: null, closeToTray: false, screenshotShortcut: "Ctrl+Shift+S" },
  selectedTokenId: null,
  selectedGroupId: null,
  notice: null,
  loading: false,
  showSettings: false,
  page: "tools",
  usageLogs: [],
  usageTotal: 0,
  usagePage: 1,
  shortcutDraft: null,
  shortcutWarning: null,
  translationSettings: {
    provider: "google_free", sourceLanguage: "auto", targetLanguage: "zh-CN", baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini", apiKeyConfigured: false, customProxy: "", fontScale: 1, consent: false,
  },
};

let shortcutRecordingRequested = false;
let shortcutRecordingReady = false;
let shortcutRecordingVersion = 0;
let shortcutRecordingUpdates: Promise<void> = Promise.resolve();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderToken(token: ApiToken): string {
  const group = token.groupName ?? "未分组";
  return `
    <button class="token-row ${state.selectedTokenId === token.id ? "selected" : ""}" data-token-id="${escapeHtml(token.id)}" type="button" ${state.loading ? "disabled" : ""}>
      <span class="token-status ${token.enabled ? "enabled" : "disabled"}" aria-hidden="true"></span>
      <span class="token-main">
        <strong>${escapeHtml(token.name)}</strong>
        <small>${escapeHtml(token.maskedToken)}</small>
      </span>
      <span class="token-group">${escapeHtml(group)}</span>
    </button>
  `;
}

function renderUsageLog(log: UsageLog): string {
  const date = log.createdAt > 0 ? new Date(log.createdAt * 1000).toLocaleString() : "—";
  const tokenCount = log.promptTokens + log.completionTokens;
  return `<tr><td>${escapeHtml(date)}</td><td><strong>${escapeHtml(log.username || "—")}</strong><small>${escapeHtml(log.tokenName || "—")}</small></td><td>${escapeHtml(log.modelName || "—")}</td><td>${escapeHtml(log.channelName || "—")}</td><td>${escapeHtml(log.group || "—")}</td><td>${log.quota.toLocaleString()}</td><td>${tokenCount.toLocaleString()}<small>输入 ${log.promptTokens.toLocaleString()} · 输出 ${log.completionTokens.toLocaleString()}</small></td><td>${log.useTime.toLocaleString()} 秒${log.isStream ? " · 流式" : ""}</td></tr>`;
}

function renderLanguageOptions(selected: string, includeAuto = false): string {
  const options = includeAuto ? [["auto", "自动检测"], ["en", "英语"], ["zh-CN", "简体中文"]] : languageOptions;
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderGroup(group: TokenGroup): string {
  const selectedToken = state.snapshot.tokens.find((token) => token.id === state.selectedTokenId);
  const isCurrent = selectedToken?.groupId === group.id;
  return `
    <button class="group-option ${state.selectedGroupId === group.id ? "selected" : ""}" data-group-id="${escapeHtml(group.id)}" type="button" ${!selectedToken || state.loading ? "disabled" : ""}>
      <span class="group-mark ${isCurrent ? "current" : ""}" aria-hidden="true"></span>
      <span>
        <strong>${escapeHtml(group.name)}</strong>
        <small>${group.tokenCount} 个令牌</small>
      </span>
      ${isCurrent ? '<span class="group-current">当前归属</span>' : ""}
    </button>
  `;
}

function render(): void {
  endShortcutRecording();
  configureCloseBehavior(state.snapshot.closeToTray);
  if (state.selectedTokenId && !state.snapshot.tokens.some((token) => token.id === state.selectedTokenId)) {
    state.selectedTokenId = null;
    state.selectedGroupId = null;
  }
  if (state.selectedGroupId && !state.snapshot.groups.some((group) => group.id === state.selectedGroupId)) {
    state.selectedGroupId = null;
  }
  const connection = state.snapshot.connection;
  const selectedToken = state.snapshot.tokens.find((token) => token.id === state.selectedTokenId);
  const canUpdate = Boolean(selectedToken && state.selectedGroupId && !state.loading);
  const lastSynced = state.snapshot.lastSyncedAt
    ? new Date(state.snapshot.lastSyncedAt).toLocaleString()
    : "尚未同步";

  app.innerHTML = `
    <div class="shell ${state.showSettings ? "show-settings" : ""}">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">D</span>
          <span>
            <strong>DeskTool</strong>
            <small>桌面工具集</small>
          </span>
        </div>
        <div class="topbar-actions">
          <details class="window-menu">
            <summary class="secondary-button nav-button">菜单</summary>
            <div class="window-menu-items">
              <button data-page="home" type="button">令牌管理</button>
              <button data-page="logs" type="button">使用日志</button>
              <button data-page="settings" type="button">设置</button>
              <button data-page="tools" type="button">工具集</button>
            </div>
          </details>
          <span class="sync-label"><span class="status-dot ${connection ? "online" : "offline"}"></span>${connection ? "已配置" : "未配置"}</span>
        </div>
      </header>

      <main class="content">
        ${state.page === "tools" ? `
          <section class="compact-toolbar compact-page-toolbar"><div class="compact-actions"><button class="secondary-button" data-page="home" type="button">返回管理</button></div></section>
          <section class="intro"><div><p class="eyebrow">DeskTool 工具集</p><h1>工具集</h1><p class="intro-copy">快捷启动常用桌面工具。</p></div></section>
          ${state.notice ? `<div class="notice ${state.notice.type}">${escapeHtml(state.notice.text)}</div>` : ""}
          <section class="panel tools-panel">
            <div class="panel-heading"><div><p class="section-kicker">屏幕工具</p><h2>区域截图</h2></div><kbd>${supportsRegionScreenshot ? escapeHtml(state.snapshot.screenshotShortcut.replaceAll("+", " + ")) : "Windows 专属"}</kbd></div>
            <p class="intro-copy">${supportsRegionScreenshot ? "在主显示器上框选区域，可保存为 PNG 图片或直接复制到剪贴板。" : "区域截图目前仅支持 Windows。"}</p>
            ${state.shortcutWarning ? `<p class="shortcut-warning">${escapeHtml(state.shortcutWarning)}</p>` : ""}
            <button class="primary-button" id="start-screenshot" type="button" ${supportsRegionScreenshot ? "" : "disabled"}>开始区域截图</button>
          </section>
          <section class="translation-tool">
            <div class="panel-heading"><h2>图片翻译</h2><span class="translation-channel">${state.translationSettings.provider === "openai" ? "OpenAI" : "Google Translate（Free）"}</span></div>
            <div class="translation-tool-status"><span>${languageOptions.find(([value]) => value === state.translationSettings.targetLanguage)?.[1] ?? "简体中文"}</span><span>${state.translationSettings.consent ? "已授权文字上传" : "待确认文字上传"}</span></div>
            <div class="shortcut-setting-actions"><button id="translation-screenshot" class="primary-button icon-command" type="button" ${supportsRegionScreenshot && !state.loading ? "" : "disabled"}>${icon("scan-text")}截图</button><button class="secondary-button icon-command" data-page="settings" type="button">${icon("settings-2")}配置</button></div>
          </section>
        ` : state.page === "home" ? `
        <section class="compact-toolbar" aria-label="紧凑模式操作">
          <label for="compact-token">API 令牌</label>
          <select id="compact-token" ${state.loading ? "disabled" : ""}>
            <option value="">选择 API 令牌</option>
            ${state.snapshot.tokens.map((token) => `<option value="${escapeHtml(token.id)}" ${state.selectedTokenId === token.id ? "selected" : ""}>${escapeHtml(token.name)}</option>`).join("")}
          </select>
          <div class="compact-actions">
            <button class="secondary-button" data-page="logs" type="button">日志</button>
            <button class="secondary-button" data-page="settings" type="button">设置</button>
            <button class="secondary-button" data-page="tools" type="button">工具</button>
            <button class="secondary-button" id="compact-sync" type="button" ${state.loading ? "disabled" : ""}>${state.loading ? "处理中..." : "同步"}</button>
            <button class="secondary-button" id="toggle-settings" type="button" aria-expanded="${state.showSettings}">${state.showSettings ? "收起配置" : "连接配置"}</button>
          </div>
        </section>
        <section class="intro">
          <div>
            <p class="eyebrow">控制台</p>
            <h1>API 令牌</h1>
            <p class="intro-copy">集中查看令牌状态，并快速调整它们的分组归属。</p>
          </div>
          <button class="primary-button" id="sync" type="button" ${state.loading ? "disabled" : ""}>
            <span class="button-icon">↻</span>${state.loading ? "同步中..." : "同步数据"}
          </button>
        </section>

        ${state.notice ? `<div class="notice ${state.notice.type}">${escapeHtml(state.notice.text)}</div>` : ""}

        <section class="connection-panel panel">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">连接配置</p>
              <h2>NewAPI 服务</h2>
            </div>
            <span class="secure-label">受保护存储</span>
          </div>
          <form id="connection-form" class="connection-form">
            <label>
              <span>服务地址</span>
              <input name="baseUrl" type="url" placeholder="https://newapi.example.com" value="${escapeHtml(connection?.baseUrl ?? "")}" required />
            </label>
            <label>
              <span>管理凭证</span>
              <input name="adminCredential" type="password" placeholder="${connection?.adminCredentialConfigured ? "已配置，输入新凭证可替换" : "输入管理员凭证"}" autocomplete="off" />
            </label>
            <button class="secondary-button" type="submit" ${state.loading ? "disabled" : ""}>保存配置</button>
          </form>
        </section>

        <section class="workspace">
          <div class="list-panel panel">
            <div class="panel-heading compact">
              <div>
                <p class="section-kicker">已同步数据</p>
                <h2>API 令牌 <span class="count">${state.snapshot.tokens.length}</span></h2>
              </div>
              <span class="muted">${escapeHtml(lastSynced)}</span>
            </div>
            <div class="token-list">
              ${state.snapshot.tokens.length ? state.snapshot.tokens.map(renderToken).join("") : '<div class="empty-state">暂无令牌<br /><small>配置服务并同步数据后，令牌会显示在这里。</small></div>'}
            </div>
          </div>

          <div class="group-panel panel">
            <div class="panel-heading compact">
              <div>
                <p class="section-kicker">目标分组</p>
                <h2><span class="standard-group-title">${selectedToken ? escapeHtml(selectedToken.name) : "选择一个令牌"}</span><span class="compact-group-title">目标分组</span></h2>
              </div>
              <span class="selection-hint">${selectedToken ? "选择分组以更新归属" : "请先选择 API 令牌"}</span>
            </div>
            <div class="group-list">
              ${state.snapshot.groups.length ? state.snapshot.groups.map(renderGroup).join("") : '<div class="empty-state">暂无分组<br /><small>同步 NewAPI 数据后，分组会显示在这里。</small></div>'}
            </div>
            <button class="primary-button full-width" id="update-group" type="button" ${canUpdate ? "" : "disabled"}>
              ${state.loading ? "正在更新..." : "更新令牌分组"}
            </button>
          </div>
        </section>
        ` : state.page === "logs" ? `
          <section class="compact-toolbar compact-page-toolbar"><div class="compact-actions"><button class="secondary-button" data-page="home" type="button">返回管理</button><button class="secondary-button" data-page="settings" type="button">设置</button></div></section>
          <section class="intro">
            <div><p class="eyebrow">NewAPI 使用记录</p><h1>使用日志</h1><p class="intro-copy">显示服务器记录的消费用量，不包含令牌密钥和请求内容。</p></div>
            <button class="secondary-button" id="refresh-logs" type="button" ${state.loading ? "disabled" : ""}>${state.loading ? "加载中..." : "刷新"}</button>
          </section>
          ${state.notice ? `<div class="notice ${state.notice.type}">${escapeHtml(state.notice.text)}</div>` : ""}
          <section class="panel logs-panel">
            <div class="log-table-wrap"><table class="log-table"><thead><tr><th>时间</th><th>用户 / 令牌</th><th>模型</th><th>渠道</th><th>分组</th><th>额度</th><th>Token</th><th>耗时</th></tr></thead><tbody>
              ${state.usageLogs.length ? state.usageLogs.map(renderUsageLog).join("") : `<tr><td colspan="8" class="empty-state">${state.loading ? "正在读取使用日志..." : "暂无使用日志"}</td></tr>`}
            </tbody></table></div>
            <div class="log-pagination"><span>共 ${state.usageTotal} 条 · 第 ${state.usagePage} 页</span><div><button class="secondary-button" id="logs-prev" type="button" ${state.loading || state.usagePage <= 1 ? "disabled" : ""}>上一页</button><button class="secondary-button" id="logs-next" type="button" ${state.loading || state.usagePage * 50 >= state.usageTotal ? "disabled" : ""}>下一页</button></div></div>
          </section>
        ` : `
          <section class="compact-toolbar compact-page-toolbar"><div class="compact-actions"><button class="secondary-button" data-page="home" type="button">返回管理</button><button class="secondary-button" data-page="logs" type="button">日志</button></div></section>
          <section class="intro"><div><p class="eyebrow">偏好设置</p><h1>设置</h1><p class="intro-copy">调整窗口行为和截图快捷键。</p></div></section>
          ${state.notice ? `<div class="notice ${state.notice.type}">${escapeHtml(state.notice.text)}</div>` : ""}
          <section class="panel settings-panel">
            <p class="section-kicker">窗口行为</p><h2>关闭按钮</h2>
            <label class="setting-option"><input type="radio" name="close-behavior" value="tray" ${state.snapshot.closeToTray ? "checked" : ""} ${state.loading ? "disabled" : ""}/><span><strong>最小化到系统托盘</strong><small>关闭窗口时隐藏主窗口，应用继续在后台运行。</small></span></label>
            <label class="setting-option"><input type="radio" name="close-behavior" value="exit" ${state.snapshot.closeToTray ? "" : "checked"} ${state.loading ? "disabled" : ""}/><span><strong>直接关闭应用</strong><small>关闭窗口时退出 DeskTool。</small></span></label>
          </section>
          <section class="panel settings-panel shortcut-panel">
            <p class="section-kicker">截图工具</p><h2>全局快捷键</h2>
            <form id="screenshot-shortcut-form">
              <label for="screenshot-shortcut"><span>截图快捷键</span></label>
              <input id="screenshot-shortcut" type="text" value="${escapeHtml(state.shortcutDraft ?? state.snapshot.screenshotShortcut)}" readonly autocomplete="off" aria-describedby="shortcut-help" ${!supportsRegionScreenshot || state.loading ? "disabled" : ""} />
              <p id="shortcut-help" class="intro-copy">${supportsRegionScreenshot ? "点击输入框后按下组合键。需包含 Ctrl 或 Alt，加字母、数字或 F1–F12。Esc 恢复已保存的组合键。" : "区域截图目前仅支持 Windows。"}</p>
              ${state.shortcutWarning ? `<p class="shortcut-warning">${escapeHtml(state.shortcutWarning)}</p>` : ""}
              <div class="shortcut-setting-actions">
                <button class="primary-button" type="submit" ${!supportsRegionScreenshot || state.loading ? "disabled" : ""}>保存快捷键</button>
                <button class="secondary-button" id="reset-screenshot-shortcut" type="button" ${!supportsRegionScreenshot || state.loading ? "disabled" : ""}>恢复默认</button>
              </div>
            </form>
          </section>
          <section class="translation-settings-panel">
            <p class="section-kicker">图片翻译</p><h2>翻译渠道</h2>
            <form id="translation-form" class="translation-form">
              <label><span>渠道</span><select name="provider" ${state.loading ? "disabled" : ""}>
                <option value="google_free" ${state.translationSettings.provider === "google_free" ? "selected" : ""}>Google Translate（Free）</option>
                <option value="openai" ${state.translationSettings.provider === "openai" ? "selected" : ""}>OpenAI 协议</option>
              </select></label>
              <div class="translation-fields">
                <label><span>识别语言</span><select name="sourceLanguage" ${state.loading ? "disabled" : ""}>${renderLanguageOptions(state.translationSettings.sourceLanguage, true)}</select></label>
                <label><span>目标语言</span><select name="targetLanguage" ${state.loading ? "disabled" : ""}>${renderLanguageOptions(state.translationSettings.targetLanguage)}</select></label>
              </div>
              <div id="openai-fields" class="translation-form" ${state.translationSettings.provider === "openai" ? "" : "hidden"}>
                <label><span>OpenAI Base URL</span><input name="baseUrl" type="url" value="${escapeHtml(state.translationSettings.baseUrl)}" placeholder="https://api.openai.com/v1" ${state.loading || state.translationSettings.provider !== "openai" ? "disabled" : ""}/></label>
                <label><span>模型名称</span><input name="model" value="${escapeHtml(state.translationSettings.model)}" placeholder="gpt-4o-mini" ${state.loading || state.translationSettings.provider !== "openai" ? "disabled" : ""}/></label>
                <label><span>OpenAI API Key</span><input name="apiKey" type="password" placeholder="${state.translationSettings.apiKeyConfigured ? "已配置，输入新 Key 可替换" : "输入独立 API Key"}" autocomplete="off" ${state.loading || state.translationSettings.provider !== "openai" ? "disabled" : ""}/></label>
              </div>
              <label><span>HTTP 代理（可选）</span><input name="customProxy" value="${escapeHtml(state.translationSettings.customProxy)}" placeholder="http://127.0.0.1:7890" ${state.loading ? "disabled" : ""}/></label>
              <label><span>默认译文字号</span><input name="fontScale" type="range" min="0.6" max="2" step="0.1" value="${state.translationSettings.fontScale}" aria-label="默认译文字号" ${state.loading ? "disabled" : ""}/></label>
              <label class="setting-option translation-consent"><input name="consent" type="checkbox" ${state.translationSettings.consent ? "checked" : ""} ${state.loading ? "disabled" : ""}/><span><strong>允许发送识别文字</strong><small>图片只在本地 OCR；译文渠道会收到 OCR 原文，不会收到图片。</small></span></label>
              <p class="translation-security-note">Key 使用系统安全存储，不会显示完整内容。Google Free 接口可能限流或变化。</p>
              <div class="shortcut-setting-actions"><button class="primary-button" type="submit" ${state.loading ? "disabled" : ""}>保存翻译配置</button><button class="secondary-button" id="clear-translation-key" type="button" ${state.loading || !state.translationSettings.apiKeyConfigured ? "disabled" : ""}>清除 OpenAI Key</button></div>
            </form>
          </section>
        `}
      </main>
      ${state.page === "home" ? '<footer class="footer">令牌分组更新将先写入 NewAPI，成功后才更新本地缓存。</footer>' : ""}
    </div>
  `;

  bindEvents();
  renderIcons();
  updateWindowTitle(selectedToken?.name ?? null);
}

function setNotice(type: "success" | "error" | "info", text: string): void {
  state.notice = { type, text };
  render();
}

function selectToken(tokenId: string | null): void {
  if (state.loading) return;
  state.selectedTokenId = tokenId;
  state.selectedGroupId = null;
  state.notice = null;
  render();
}

function beginShortcutRecording(input: HTMLInputElement): void {
  shortcutRecordingRequested = true;
  shortcutRecordingReady = false;
  const version = ++shortcutRecordingVersion;
  const help = document.querySelector<HTMLElement>("#shortcut-help");
  if (help) help.textContent = "正在准备快捷键录入...";
  shortcutRecordingUpdates = shortcutRecordingUpdates.then(async () => {
    await appApi.setScreenshotShortcutRecording(true);
    if (version === shortcutRecordingVersion && shortcutRecordingRequested && document.activeElement === input) {
      shortcutRecordingReady = true;
      if (help) help.textContent = "请按下组合键，需包含 Ctrl 或 Alt，加字母、数字或 F1–F12。";
    }
  }).catch(() => {
    if (version === shortcutRecordingVersion) setNotice("error", "快捷键录入初始化失败，请重新点击输入框。");
  });
}

function endShortcutRecording(): void {
  if (!shortcutRecordingRequested) return;
  shortcutRecordingRequested = false;
  shortcutRecordingReady = false;
  const version = ++shortcutRecordingVersion;
  shortcutRecordingUpdates = shortcutRecordingUpdates
    .then(() => appApi.setScreenshotShortcutRecording(false))
    .catch((error) => {
      if (version === shortcutRecordingVersion) {
        state.shortcutWarning = getErrorMessage(error, "截图快捷键恢复失败，请重新保存组合键。");
        setNotice("error", state.shortcutWarning);
      }
    });
}

function recordShortcut(event: KeyboardEvent, input: HTMLInputElement): void {
  if (event.key === "Tab") return;
  event.preventDefault();
  if (event.key === "Escape") {
    state.shortcutDraft = null;
    input.value = state.snapshot.screenshotShortcut;
    input.blur();
    return;
  }
  if (event.repeat || event.isComposing || !shortcutRecordingReady) return;
  if (event.key === "Control" || event.key === "Alt" || event.key === "Shift" || event.key === "Meta") return;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
    : /^F([1-9]|1[0-2])$/.test(event.code) ? event.code : null;
  const help = document.querySelector<HTMLElement>("#shortcut-help");
  if ((!event.ctrlKey && !event.altKey) || event.metaKey || !key) {
    if (help) help.textContent = "请按 Ctrl 或 Alt，加字母、数字或 F1–F12；可同时使用 Shift。";
    return;
  }
  const modifiers = [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
  state.shortcutDraft = [...modifiers, key].join("+");
  input.value = state.shortcutDraft;
  if (help) help.textContent = "组合键已录入，点击“保存快捷键”立即生效。";
}

function bindEvents(): void {
  const shortcutInput = document.querySelector<HTMLInputElement>("#screenshot-shortcut");
  if (shortcutInput) {
    shortcutInput.addEventListener("focus", () => beginShortcutRecording(shortcutInput));
    shortcutInput.addEventListener("blur", endShortcutRecording);
    shortcutInput.addEventListener("keydown", (event) => recordShortcut(event, shortcutInput));
  }
  document.querySelector<HTMLFormElement>("#screenshot-shortcut-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveScreenshotShortcut(state.shortcutDraft ?? state.snapshot.screenshotShortcut);
  });
  document.querySelector<HTMLButtonElement>("#reset-screenshot-shortcut")?.addEventListener("click", () => {
    void saveScreenshotShortcut("Ctrl+Shift+S");
  });
  document.querySelector<HTMLSelectElement>('#translation-form select[name="provider"]')?.addEventListener("change", (event) => {
    const fields = document.querySelector<HTMLElement>("#openai-fields");
    if (fields) {
      fields.hidden = (event.currentTarget as HTMLSelectElement).value !== "openai";
      fields.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.disabled = fields.hidden || state.loading; });
    }
  });
  document.querySelector<HTMLFormElement>("#translation-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveTranslationSettings(event.currentTarget as HTMLFormElement, false);
  });
  document.querySelector<HTMLButtonElement>("#clear-translation-key")?.addEventListener("click", () => {
    const form = document.querySelector<HTMLFormElement>("#translation-form");
    if (form) void saveTranslationSettings(form, true);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const menu = button.closest(".window-menu") as HTMLDetailsElement | null;
      if (menu) menu.open = false;
      const page = button.dataset.page;
      if (page === "logs") void openUsageLogs(1);
      else if (page === "settings") {
        state.page = "settings";
        state.notice = null;
        render();
      } else if (page === "tools") {
        state.page = "tools";
        state.notice = null;
        render();
      } else if (page === "home") {
        state.page = "home";
        state.notice = null;
        render();
      }
    });
  });
  document.querySelector<HTMLButtonElement>("#refresh-logs")?.addEventListener("click", () => void openUsageLogs(state.usagePage));
  document.querySelector<HTMLButtonElement>("#translation-screenshot")?.addEventListener("click", () => {
    if (!state.translationSettings.consent || state.translationSettings.provider === "openai" && !state.translationSettings.apiKeyConfigured) {
      state.page = "settings";
      setNotice("info", "请先保存翻译渠道并确认文字上传授权。");
      document.querySelector("#translation-form")?.scrollIntoView({ block: "start" });
      return;
    }
    void appApi.startScreenshot().catch((error) => setNotice("error", getErrorMessage(error, "启动区域截图失败。")));
  });
  document.querySelector<HTMLButtonElement>("#start-screenshot")?.addEventListener("click", () => {
    void appApi.startScreenshot().catch((error) => setNotice("error", getErrorMessage(error, "启动区域截图失败。")));
  });
  document.querySelector<HTMLButtonElement>("#logs-prev")?.addEventListener("click", () => void openUsageLogs(state.usagePage - 1));
  document.querySelector<HTMLButtonElement>("#logs-next")?.addEventListener("click", () => void openUsageLogs(state.usagePage + 1));
  document.querySelectorAll<HTMLInputElement>('input[name="close-behavior"]').forEach((input) => {
    input.addEventListener("change", () => void saveCloseBehavior(input.value === "tray"));
  });
  document.querySelector<HTMLSelectElement>("#compact-token")?.addEventListener("change", (event) => {
    selectToken((event.currentTarget as HTMLSelectElement).value || null);
  });
  document.querySelector<HTMLButtonElement>("#toggle-settings")?.addEventListener("click", () => {
    state.showSettings = !state.showSettings;
    render();
  });
  document.querySelector<HTMLButtonElement>("#compact-sync")?.addEventListener("click", sync);
  document.querySelectorAll<HTMLButtonElement>("[data-token-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectToken(button.dataset.tokenId ?? null);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-group-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.loading || !state.selectedTokenId) return;
      state.selectedGroupId = button.dataset.groupId ?? null;
      state.notice = null;
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#sync")?.addEventListener("click", sync);
  document.querySelector<HTMLButtonElement>("#update-group")?.addEventListener("click", updateGroup);
  document.querySelector<HTMLFormElement>("#connection-form")?.addEventListener("submit", saveConnection);
}

async function openUsageLogs(page: number): Promise<void> {
  if (state.loading || page < 1) return;
  state.page = "logs";
  state.loading = true;
  state.notice = null;
  render();
  try {
    const result = await appApi.getUsageLogs(page);
    state.usageLogs = result.items;
    state.usageTotal = result.total;
    state.usagePage = result.page;
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "读取使用日志失败。") };
  } finally {
    state.loading = false;
    render();
  }
}

async function saveTranslationSettings(form: HTMLFormElement, clearApiKey: boolean): Promise<void> {
  if (state.loading) return;
  const data = new FormData(form);
  const settings: TranslationSettings = {
    ...state.translationSettings,
    provider: String(data.get("provider")) as TranslationSettings["provider"],
    sourceLanguage: String(data.get("sourceLanguage")),
    targetLanguage: String(data.get("targetLanguage")),
    baseUrl: String(data.get("baseUrl") ?? state.translationSettings.baseUrl).trim(),
    model: String(data.get("model") ?? state.translationSettings.model).trim(),
    customProxy: String(data.get("customProxy")).trim(),
    consent: data.get("consent") === "on",
    fontScale: Number(data.get("fontScale")),
  };
  state.loading = true;
  state.notice = null;
  render();
  try {
    state.translationSettings = await appApi.saveTranslationSettings(settings, clearApiKey ? "" : String(data.get("apiKey") ?? ""), clearApiKey);
    state.notice = { type: "success", text: "图片翻译配置已保存。" };
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "保存图片翻译配置失败，原设置未改变。") };
  } finally { state.loading = false; render(); }
}

async function saveCloseBehavior(closeToTray: boolean): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  state.notice = null;
  render();
  try {
    state.snapshot = await appApi.setCloseToTray(closeToTray);
    state.notice = { type: "success", text: "关闭按钮设置已保存。" };
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "保存设置失败。") };
  } finally {
    state.loading = false;
    render();
  }
}

async function saveScreenshotShortcut(shortcut: string): Promise<void> {
  if (!supportsRegionScreenshot || state.loading) return;
  state.loading = true;
  state.notice = null;
  endShortcutRecording();
  render();
  try {
    await shortcutRecordingUpdates;
    state.snapshot = await appApi.setScreenshotShortcut(shortcut);
    state.shortcutDraft = null;
    state.shortcutWarning = null;
    state.notice = { type: "success", text: "截图快捷键已保存并立即生效。" };
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "保存截图快捷键失败，原设置保留。") };
  } finally {
    state.loading = false;
    render();
  }
}

async function saveConnection(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (state.loading) return;
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const baseUrl = String(form.get("baseUrl") ?? "").trim();
  const adminCredential = String(form.get("adminCredential") ?? "");

  if (!baseUrl || (!state.snapshot.connection?.adminCredentialConfigured && !adminCredential)) {
    setNotice("error", "请填写服务地址和管理凭证。");
    return;
  }

  state.loading = true;
  state.notice = null;
  render();
  try {
    state.snapshot = await appApi.saveConnection({
      baseUrl,
      adminCredential,
    });
    state.notice = { type: "success", text: "连接配置已保存。" };
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "保存配置失败。") };
  } finally {
    state.loading = false;
    render();
  }
}

async function sync(): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  state.notice = null;
  render();
  try {
    const result = await appApi.syncFromNewApi();
    state.snapshot = result.snapshot;
    state.notice = result.warning
      ? { type: "info", text: result.warning }
      : { type: "success", text: "令牌和分组已同步。" };
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "同步失败。") };
  } finally {
    state.loading = false;
    render();
  }
}

async function updateGroup(): Promise<void> {
  if (state.loading || !state.selectedTokenId || !state.selectedGroupId) return;
  const selectedTokenId = state.selectedTokenId;
  const selectedGroupId = state.selectedGroupId;
  state.loading = true;
  state.notice = null;
  render();
  try {
    state.snapshot = await appApi.updateTokenGroup({ tokenId: selectedTokenId, groupId: selectedGroupId });
    state.selectedGroupId = null;
    state.notice = { type: "success", text: "令牌分组已更新。" };
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "令牌分组更新失败，原数据未改变。") };
  } finally {
    state.loading = false;
    render();
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}

async function init(): Promise<void> {
  window.addEventListener("blur", endShortcutRecording);
  window.addEventListener("focus", () => {
    const input = document.querySelector<HTMLInputElement>("#screenshot-shortcut");
    if (input && !input.disabled && document.activeElement === input && !shortcutRecordingRequested) beginShortcutRecording(input);
  });
  state.loading = true;
  render();
  void initWindowControls((message) => setNotice("error", message));
  void listen<string>("navigate", (event) => {
    if (event.payload === "logs") void openUsageLogs(1);
  }).catch(() => setNotice("error", "系统托盘导航初始化失败。"));
  void listen<string>("screenshot-error", (event) => {
    setNotice("error", event.payload || "区域截图启动失败。");
  }).catch(() => setNotice("error", "截图快捷键监听初始化失败。"));
  try {
    state.snapshot = await appApi.getSnapshot();
    state.translationSettings = await appApi.getTranslationSettings();
    if (supportsRegionScreenshot) state.shortcutWarning = await appApi.getScreenshotShortcutWarning();
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "读取本地数据失败。") };
  } finally {
    state.loading = false;
  }
  render();
}

void init();
