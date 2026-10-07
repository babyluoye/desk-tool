import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { appApi } from "./api";
import type { ApiToken, AppSnapshot, TokenGroup } from "./domain";

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) throw new Error("Application root was not found");

const root = rootElement;

const state: {
  snapshot: AppSnapshot;
  selectedTokenId: string | null;
  selectedGroupId: string | null;
  loading: boolean;
  notice: string | null;
} = {
  snapshot: { connection: null, tokens: [], groups: [], lastSyncedAt: null, refreshIntervalSeconds: 10, inactiveOpacityPercent: 70 },
  selectedTokenId: null,
  selectedGroupId: null,
  loading: false,
  notice: null,
};

let refreshTimer: number | undefined;
let refreshInFlight = false;
let refreshEventUnlisten: (() => void) | undefined;
let focusEventUnlisten: (() => void) | undefined;
let windowFocused = true;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tokenOption(token: ApiToken): string {
  return `<button class="floating-option ${state.selectedTokenId === token.id ? "selected" : ""}" data-token-id="${escapeHtml(token.id)}" type="button">
    <span class="token-status ${token.enabled ? "enabled" : "disabled"}"></span>
    <span><strong>${escapeHtml(token.name)}</strong><small>${escapeHtml(token.maskedToken)}</small></span>
  </button>`;
}

function groupOption(group: TokenGroup): string {
  return `<button class="floating-option ${state.selectedGroupId === group.id ? "selected" : ""}" data-group-id="${escapeHtml(group.id)}" type="button">
    <span class="group-mark"></span>
    <span><strong>${escapeHtml(group.name)}</strong><small>${group.tokenCount} 个令牌</small></span>
  </button>`;
}

function render(): void {
  const selectedToken = state.snapshot.tokens.find((token) => token.id === state.selectedTokenId);
  const ready = Boolean(selectedToken && state.selectedGroupId && !state.loading);
  root.innerHTML = `<main class="floating-shell ${windowFocused ? "" : "window-inactive"}" style="--inactive-opacity: ${state.snapshot.inactiveOpacityPercent / 100}">
    <header class="floating-header">
      <div><p class="section-kicker">快速操作</p><h1>调整令牌分组</h1><small class="refresh-status">每 ${state.snapshot.refreshIntervalSeconds} 秒刷新</small></div>
      <button class="icon-button" id="close-floating" type="button" title="关闭悬浮窗" aria-label="关闭悬浮窗">×</button>
    </header>
    ${state.notice ? `<div class="notice info">${escapeHtml(state.notice)}</div>` : ""}
    <section class="floating-step">
      <div class="step-heading"><span>1</span><div><strong>选择 API 令牌</strong><small>${selectedToken ? escapeHtml(selectedToken.name) : "选择要修改的令牌"}</small></div></div>
      <div class="floating-list">${state.snapshot.tokens.length ? state.snapshot.tokens.map(tokenOption).join("") : '<div class="empty-state">暂无已同步令牌</div>'}</div>
    </section>
    <section class="floating-step ${selectedToken ? "" : "muted-step"}">
      <div class="step-heading"><span>2</span><div><strong>选择目标分组</strong><small>${selectedToken ? "更新后将立即写回 NewAPI" : "先选择 API 令牌"}</small></div></div>
      <div class="floating-list">${selectedToken && state.snapshot.groups.length ? state.snapshot.groups.map(groupOption).join("") : '<div class="empty-state">请选择令牌</div>'}</div>
    </section>
    <button class="primary-button full-width" id="floating-submit" type="button" ${ready ? "" : "disabled"}>${state.loading ? "正在更新..." : "更新令牌分组"}</button>
  </main>`;
  bindEvents();
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
  document.querySelector<HTMLButtonElement>("#close-floating")?.addEventListener("click", () => {
    void getCurrentWindow().hide();
  });
  document.querySelector<HTMLButtonElement>("#floating-submit")?.addEventListener("click", updateGroup);
}

async function updateGroup(): Promise<void> {
  if (!state.selectedTokenId || !state.selectedGroupId) return;
  state.loading = true;
  state.notice = null;
  render();
  try {
    state.snapshot = await appApi.updateTokenGroup({
      tokenId: state.selectedTokenId,
      groupId: state.selectedGroupId,
    });
    state.selectedGroupId = null;
    state.notice = "更新成功，服务端和本地缓存已同步。";
  } catch (error) {
    state.notice = typeof error === "string" ? error : "更新失败，原数据未改变。";
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshSnapshot(): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const previousInterval = state.snapshot.refreshIntervalSeconds;
    if (state.snapshot.connection) {
      const result = await appApi.syncFromNewApi();
      state.snapshot = result.snapshot;
      state.notice = result.warning;
    } else {
      state.snapshot = await appApi.getSnapshot();
    }
    if (previousInterval !== state.snapshot.refreshIntervalSeconds) {
      scheduleRefresh(state.snapshot.refreshIntervalSeconds);
    }
    if (state.selectedTokenId && !state.snapshot.tokens.some((token) => token.id === state.selectedTokenId)) {
      state.selectedTokenId = null;
      state.selectedGroupId = null;
    }
  } catch (error) {
    state.notice = typeof error === "string" ? error : "NewAPI 刷新失败，保留已缓存数据并稍后重试。";
  } finally {
    refreshInFlight = false;
    render();
  }
}

function scheduleRefresh(seconds: number): void {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(async () => {
    await refreshSnapshot();
    scheduleRefresh(state.snapshot.refreshIntervalSeconds);
  }, seconds * 1000);
}

async function init(): Promise<void> {
  try {
    state.snapshot = await appApi.getSnapshot();
    const currentWindow = getCurrentWindow();
    windowFocused = await currentWindow.isFocused();
    focusEventUnlisten = await currentWindow.onFocusChanged(({ payload: focused }) => {
      windowFocused = focused;
      root.querySelector(".floating-shell")?.classList.toggle("window-inactive", !focused);
    });
    refreshEventUnlisten = await listen<AppSnapshot>("snapshot-updated", (event) => {
      const previousInterval = state.snapshot.refreshIntervalSeconds;
      state.snapshot = event.payload;
      if (previousInterval !== event.payload.refreshIntervalSeconds) {
        scheduleRefresh(event.payload.refreshIntervalSeconds);
        void refreshSnapshot();
      } else {
        render();
      }
    });
  } catch (error) {
    state.notice = typeof error === "string" ? error : "读取本地数据失败。";
  }
  render();
  scheduleRefresh(state.snapshot.refreshIntervalSeconds);
  window.addEventListener("beforeunload", () => {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshEventUnlisten?.();
    focusEventUnlisten?.();
  }, { once: true });
}

void init();
