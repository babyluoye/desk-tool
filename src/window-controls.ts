import { getCurrentWindow } from "@tauri-apps/api/window";

const currentWindow = getCurrentWindow();
const compactMedia = window.matchMedia("(width < 300px)");
let selectedTokenName: string | null = null;
let requestedTitle = "";
let titleUpdates: Promise<void> = Promise.resolve();
let reportError: (message: string) => void = () => {};
let closeToTray = false;

export function configureCloseBehavior(hideToTray: boolean): void {
  closeToTray = hideToTray;
  const closeButton = document.querySelector<HTMLButtonElement>("#window-close");
  if (!closeButton) return;
  closeButton.title = closeToTray ? "最小化到系统托盘" : "关闭应用";
  closeButton.setAttribute("aria-label", closeButton.title);
}

export function updateWindowTitle(tokenName: string | null): void {
  selectedTokenName = tokenName;
  const title = compactMedia.matches && tokenName ? tokenName : "DeskTool";
  document.title = title;
  const label = document.querySelector<HTMLElement>("#window-title");
  if (label) {
    label.textContent = title;
    label.title = title;
  }
  if (requestedTitle === title) return;
  requestedTitle = title;
  // Serialize native title updates so a slow earlier request cannot overwrite a newer selection.
  titleUpdates = titleUpdates.then(() => currentWindow.setTitle(title)).catch(() => {
    reportError("窗口标题更新失败。");
  });
}

function bindWindowButton(id: string, action: () => Promise<void>, fallback: string): void {
  const buttonElement = document.querySelector<HTMLButtonElement>(id);
  if (!buttonElement) return;
  const button = buttonElement;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
    } catch {
      reportError(fallback);
    } finally {
      button.disabled = false;
    }
  });
}

export async function initWindowControls(onError: (message: string) => void): Promise<void> {
  reportError = onError;
  const pinButton = document.querySelector<HTMLButtonElement>("#window-pin");
  let alwaysOnTop = false;
  function updatePinButton(): void {
    if (!pinButton) return;
    pinButton.setAttribute("aria-pressed", String(alwaysOnTop));
    pinButton.title = alwaysOnTop ? "取消置顶" : "置顶窗口";
    pinButton.setAttribute("aria-label", pinButton.title);
  }

  bindWindowButton("#window-pin", async () => {
    const next = !(await currentWindow.isAlwaysOnTop());
    await currentWindow.setAlwaysOnTop(next);
    alwaysOnTop = next;
    updatePinButton();
  }, "窗口置顶设置失败。");
  // Hiding directly makes tray minimization independent of native minimize event timing.
  bindWindowButton("#window-minimize", () => currentWindow.hide(), "最小化到托盘失败，窗口仍保持打开。");
  bindWindowButton("#window-maximize", () => currentWindow.toggleMaximize(), "调整窗口大小失败。");
  bindWindowButton("#window-close", () => currentWindow.close(), "关闭窗口操作失败。");
  const dragArea = document.querySelector<HTMLElement>(".titlebar-drag");
  dragArea?.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.detail !== 1) return;
    event.preventDefault();
    void currentWindow.startDragging().catch(() => reportError("拖动窗口失败。"));
  });
  dragArea?.addEventListener("dblclick", () => {
    void currentWindow.toggleMaximize().catch(() => reportError("调整窗口大小失败。"));
  });

  const onCompactChange = () => updateWindowTitle(selectedTokenName);
  compactMedia.addEventListener("change", onCompactChange);
  let unlistenResize: (() => void) | undefined;
  window.addEventListener("beforeunload", () => {
    unlistenResize?.();
    compactMedia.removeEventListener("change", onCompactChange);
  }, { once: true });

  const maximizeButton = document.querySelector<HTMLButtonElement>("#window-maximize");
  async function updateMaximizeButton(): Promise<void> {
    const maximized = await currentWindow.isMaximized();
    if (!maximizeButton) return;
    maximizeButton.textContent = maximized ? "❐" : "□";
    maximizeButton.title = maximized ? "还原窗口" : "最大化";
    maximizeButton.setAttribute("aria-label", maximizeButton.title);
  }
  if (pinButton) pinButton.disabled = true;
  try {
    alwaysOnTop = await currentWindow.isAlwaysOnTop();
    updatePinButton();
    await updateMaximizeButton();
    unlistenResize = await currentWindow.onResized(() => {
      void updateMaximizeButton().catch(() => {});
    });
  } catch {
    reportError("读取窗口状态失败，窗口控制按钮仍可使用。");
  } finally {
    if (pinButton) pinButton.disabled = false;
  }
}
