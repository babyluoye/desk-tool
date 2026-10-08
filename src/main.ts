import { initWindowControls, updateWindowTitle } from "./window-controls";
import { appApi } from "./api";
import type { ApiToken, AppSnapshot, TokenGroup } from "./domain";
import "./styles.css";

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
} = {
  snapshot: { connection: null, tokens: [], groups: [], lastSyncedAt: null },
  selectedTokenId: null,
  selectedGroupId: null,
  notice: null,
  loading: false,
  showSettings: false,
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
          <span class="brand-mark">N</span>
          <span>
            <strong>NewAPI Desk</strong>
            <small>令牌分组管理</small>
          </span>
        </div>
        <div class="topbar-actions">
          <span class="sync-label"><span class="status-dot ${connection ? "online" : "offline"}"></span>${connection ? "已配置" : "未配置"}</span>
        </div>
      </header>

      <main class="content">
        <section class="compact-toolbar" aria-label="紧凑模式操作">
          <label for="compact-token">API 令牌</label>
          <select id="compact-token" ${state.loading ? "disabled" : ""}>
            <option value="">选择 API 令牌</option>
            ${state.snapshot.tokens.map((token) => `<option value="${escapeHtml(token.id)}" ${state.selectedTokenId === token.id ? "selected" : ""}>${escapeHtml(token.name)}</option>`).join("")}
          </select>
          <div class="compact-actions">
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
      </main>
      <footer class="footer">令牌分组更新将先写入 NewAPI，成功后才更新本地缓存。</footer>
    </div>
  `;

  bindEvents();
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

function bindEvents(): void {
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
  state.loading = true;
  render();
  void initWindowControls((message) => setNotice("error", message));
  try {
    state.snapshot = await appApi.getSnapshot();
  } catch (error) {
    state.notice = { type: "error", text: getErrorMessage(error, "读取本地数据失败。") };
  } finally {
    state.loading = false;
  }
  render();
}

void init();
