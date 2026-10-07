import { listen } from "@tauri-apps/api/event";
import { appApi } from "./api";
import type { ApiToken, AppSnapshot, TokenGroup } from "./domain";
import "./styles.css";

const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("Application root was not found");
}

const app = appElement;

let refreshSaveTimer: number | undefined;

const state: {
  snapshot: AppSnapshot;
  selectedTokenId: string | null;
  selectedGroupId: string | null;
  notice: { type: "success" | "error" | "info"; text: string } | null;
  loading: boolean;
} = {
  snapshot: { connection: null, tokens: [], groups: [], lastSyncedAt: null, refreshIntervalSeconds: 10, inactiveOpacityPercent: 70 },
  selectedTokenId: null,
  selectedGroupId: null,
  notice: null,
  loading: false,
};

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
    <button class="token-row ${state.selectedTokenId === token.id ? "selected" : ""}" data-token-id="${escapeHtml(token.id)}" type="button">
      <span class="token-status ${token.enabled ? "enabled" : "disabled"}" aria-hidden="true"></span>
      <span class="token-main">
        <strong>${escapeHtml(token.name)}</strong>
        <small>${escapeHtml(token.maskedToken)}</small>
      </span>
      <span class="token-group">${escapeHtml(group)}</span>
    </button>
  `;
}

function renderGroup(group: TokenGroup): string {
  const selectedToken = state.snapshot.tokens.find((token) => token.id === state.selectedTokenId);
  const isCurrent = selectedToken?.groupId === group.id;
  return `
    <button class="group-option ${state.selectedGroupId === group.id ? "selected" : ""}" data-group-id="${escapeHtml(group.id)}" type="button">
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
  const connection = state.snapshot.connection;
  const selectedToken = state.snapshot.tokens.find((token) => token.id === state.selectedTokenId);
  const canUpdate = Boolean(selectedToken && state.selectedGroupId && !state.loading);
  const lastSynced = state.snapshot.lastSyncedAt
    ? new Date(state.snapshot.lastSyncedAt).toLocaleString()
    : "尚未同步";

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">N</span>
          <span>
            <strong>NewAPI Desk</strong>
            <small>令牌分组管理</small>
          </span>
        </div>
        <div class="topbar-actions">
          <span class="sync-label"><span class="status-dot ${connection ? "online" : "offline"}"></span>${connection ? "已配置" : "未配置"}</span>
          <button class="icon-button" id="open-float" type="button" title="打开悬浮窗" aria-label="打开悬浮窗">↗</button>
        </div>
      </header>

      <main class="content">
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
            <button class="secondary-button" type="submit">保存配置</button>
          </form>
        </section>

        <section class="refresh-settings panel">
          <label for="refresh-interval">
            <span>悬浮窗刷新间隔</span>
            <span class="refresh-control"><input id="refresh-interval" type="number" min="1" max="3600" step="1" value="${state.snapshot.refreshIntervalSeconds}" /> <small>秒</small></span>
          </label>
          <small class="settings-hint">修改后立即生效，允许范围 1–3600 秒。</small>
        </section>

        <section class="floating-opacity-settings panel">
          <label for="inactive-opacity">
            <span>悬浮窗未激活透明度</span>
            <span class="opacity-control"><input id="inactive-opacity" type="range" min="20" max="100" step="1" value="${state.snapshot.inactiveOpacityPercent}" /><output id="opacity-value">${state.snapshot.inactiveOpacityPercent}%</output></span>
          </label>
          <small class="settings-hint">悬浮窗失去焦点时应用，获得焦点后恢复不透明。</small>
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
                <h2>${selectedToken ? escapeHtml(selectedToken.name) : "选择一个令牌"}</h2>
              </div>
              <span class="selection-hint">${selectedToken ? "选择分组以更新归属" : "先从左侧选择令牌"}</span>
            </div>
            <div class="group-list">
              ${state.snapshot.groups.length ? state.snapshot.groups.map(renderGroup).join("") : '<div class="empty-state">暂无分组<br /><small>同步 NewAPI 数据后，分组会显示在这里。</small></div>'}
            </div>
            <button class="primary-button full-width" id="update-group" type="button" ${canUpdate ? "" : "disabled"}>
              ${state.loading ? "正在更新..." : "更新令牌分组"}
            </button>
          </div>
        </section>
      </main>
      <footer class="footer">令牌分组更新将先写入 NewAPI，成功后才更新本地缓存。</footer>
    </div>
  `;

  bindEvents();
}

function setNotice(type: "success" | "error" | "info", text: string): void {
  state.notice = { type, text };
  render();
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-token-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTokenId = button.dataset.tokenId ?? null;
      state.selectedGroupId = null;
      state.notice = null;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-group-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedGroupId = button.dataset.groupId ?? null;
      state.notice = null;
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#sync")?.addEventListener("click", sync);
  document.querySelector<HTMLButtonElement>("#open-float")?.addEventListener("click", () => {
    setNotice("info", "悬浮窗将在系统托盘菜单中打开。基础窗口入口已预留。\n");
  });
  document.querySelector<HTMLButtonElement>("#update-group")?.addEventListener("click", updateGroup);
  document.querySelector<HTMLFormElement>("#connection-form")?.addEventListener("submit", saveConnection);
  const refreshInput = document.querySelector<HTMLInputElement>("#refresh-interval");
  refreshInput?.addEventListener("input", scheduleRefreshIntervalSave);
  refreshInput?.addEventListener("change", saveRefreshInterval);
  const opacityInput = document.querySelector<HTMLInputElement>("#inactive-opacity");
  opacityInput?.addEventListener("input", () => {
    const output = document.querySelector<HTMLOutputElement>("#opacity-value");
    if (output) output.value = `${opacityInput.value}%`;
    scheduleInactiveOpacitySave(opacityInput);
  });
  opacityInput?.addEventListener("change", () => void persistInactiveOpacity(opacityInput));
}

async function saveConnection(event: SubmitEvent): Promise<void> {
  event.preventDefault();
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
      adminCredentialConfigured: true,
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
  if (!state.selectedTokenId || !state.selectedGroupId) return;
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

function scheduleRefreshIntervalSave(event: Event): void {
  if (refreshSaveTimer !== undefined) window.clearTimeout(refreshSaveTimer);
  const input = event.currentTarget as HTMLInputElement;
  refreshSaveTimer = window.setTimeout(() => {
    void persistRefreshInterval(input);
  }, 300);
}

let opacitySaveTimer: number | undefined;

function scheduleInactiveOpacitySave(input: HTMLInputElement): void {
  if (opacitySaveTimer !== undefined) window.clearTimeout(opacitySaveTimer);
  opacitySaveTimer = window.setTimeout(() => {
    void persistInactiveOpacity(input);
  }, 120);
}

async function persistInactiveOpacity(input: HTMLInputElement): Promise<void> {
  if (opacitySaveTimer !== undefined) window.clearTimeout(opacitySaveTimer);
  const percent = Number(input.value);
  if (!Number.isInteger(percent) || percent < 20 || percent > 100) return;
  try {
    state.snapshot = await appApi.updateInactiveOpacity(percent);
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "透明度设置保存失败。") };
    render();
  }
}

async function saveRefreshInterval(event: Event): Promise<void> {
  if (refreshSaveTimer !== undefined) window.clearTimeout(refreshSaveTimer);
  await persistRefreshInterval(event.currentTarget as HTMLInputElement);
}

async function persistRefreshInterval(input: HTMLInputElement): Promise<void> {
  const seconds = Number(input.value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    state.notice = { type: "error", text: "刷新间隔必须是 1 到 3600 秒之间的整数。" };
    render();
    return;
  }

  try {
    state.snapshot = await appApi.updateRefreshInterval(seconds);
    state.notice = { type: "success", text: `悬浮窗刷新间隔已更新为 ${seconds} 秒。` };
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "刷新间隔保存失败。") };
  }
  render();
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}

async function init(): Promise<void> {
  try {
    state.snapshot = await appApi.getSnapshot();
    await listen<AppSnapshot>("snapshot-updated", (event) => {
      state.snapshot = event.payload;
      const refreshInput = document.querySelector<HTMLInputElement>("#refresh-interval");
      const opacityInput = document.querySelector<HTMLInputElement>("#inactive-opacity");
      if (document.activeElement === refreshInput || document.activeElement === opacityInput) return;
      render();
    });
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "读取本地数据失败。") };
  }
  render();
}

void init();
