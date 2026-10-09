import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import "./pinned.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Pinned image root was not found");
document.querySelector(".titlebar")?.remove();
root.innerHTML = `
  <main class="pinned-image" data-active="false" aria-label="置顶贴图">
    <img id="pinned-image" alt="截图贴图" draggable="false" hidden />
    <div class="pinned-controls">
      <span>置顶贴图</span>
      <button id="close-pinned" type="button" title="关闭贴图（Esc）" aria-label="关闭贴图">关闭</button>
    </div>
    <button id="resize-pinned" type="button" title="拖动调整贴图大小" aria-label="调整贴图大小"></button>
    <div id="pinned-error" role="alert" hidden></div>
  </main>`;

const appWindow = getCurrentWindow();
const image = document.querySelector<HTMLImageElement>("#pinned-image");
const errorNotice = document.querySelector<HTMLDivElement>("#pinned-error");
const surface = document.querySelector<HTMLElement>(".pinned-image");
if (!image || !errorNotice || !surface) throw new Error("Pinned image elements were not found");
const pinnedImage = image;
const pinnedError = errorNotice;
const pinnedSurface = surface;
let closed = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loadAttempts = 0;
let active = false;
let focusVersion = 0;
let unlistenFocus: (() => void) | null = null;
let zoomTimer: ReturnType<typeof setTimeout> | null = null;
let pendingZoom = 0;
let zoomRunning = false;
let zoomVersion = 0;

function cancelPendingZoom(): void {
  zoomVersion++;
  pendingZoom = 0;
  if (zoomTimer !== null) clearTimeout(zoomTimer);
  zoomTimer = null;
}

function setActive(focused: boolean): void {
  if (closed) return;
  focusVersion++;
  active = focused;
  pinnedSurface.dataset.active = String(focused);
  if (!focused) cancelPendingZoom();
}

async function initFocus(): Promise<void> {
  const unlisten = await appWindow.onFocusChanged(({ payload }) => setActive(payload));
  if (closed) { unlisten(); return; }
  unlistenFocus = unlisten;
  const version = focusVersion;
  const focused = await appWindow.isFocused();
  if (!closed && version === focusVersion) setActive(focused);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function resizeByWheel(delta: number, version: number): Promise<void> {
  const [size, outerSize, position, monitor, scale] = await Promise.all([
    appWindow.innerSize(), appWindow.outerSize(), appWindow.outerPosition(), currentMonitor(), appWindow.scaleFactor(),
  ]);
  if (closed || !active || version !== zoomVersion) return;
  if (!monitor) throw new Error("无法读取贴图所在显示器，请重试。");
  const ratio = pinnedImage.naturalWidth / pinnedImage.naturalHeight;
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const area = monitor.workArea;
  const margin = Math.ceil(8 * scale);
  const extraWidth = Math.max(0, outerSize.width - size.width);
  const extraHeight = Math.max(0, outerSize.height - size.height);
  const minWidth = Math.ceil(120 * scale);
  const minHeight = Math.ceil(72 * scale);
  const availableWidth = area.size.width - margin * 2 - extraWidth;
  const availableHeight = area.size.height - margin * 2 - extraHeight;
  if (availableWidth < minWidth || availableHeight < minHeight) return;
  // Scale the fitted image, not the last requested window size; manual resize and DPI changes stay in sync.
  const currentImageWidth = Math.min(size.width, size.height * ratio);
  const minImageWidth = Math.min(minWidth, minHeight * ratio);
  const maxImageWidth = Math.min(availableWidth, availableHeight * ratio);
  const imageWidth = clamp(currentImageWidth * Math.exp(-delta * Math.log(1.1) / 100), minImageWidth, maxImageWidth);
  const width = clamp(Math.round(imageWidth), minWidth, availableWidth);
  const height = clamp(Math.round(imageWidth / ratio), minHeight, availableHeight);
  const outerWidth = width + extraWidth;
  const outerHeight = height + extraHeight;
  const x = clamp(position.x + (outerSize.width - outerWidth) / 2,
    area.position.x + margin, area.position.x + area.size.width - margin - outerWidth);
  const y = clamp(position.y + (outerSize.height - outerHeight) / 2,
    area.position.y + margin, area.position.y + area.size.height - margin - outerHeight);
  const focused = await appWindow.isFocused();
  if (closed || !active || !focused || version !== zoomVersion) return;
  await appWindow.setSize(new PhysicalSize(width, height));
  if (closed || !active || version !== zoomVersion) return;
  await appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
}

async function flushZoom(): Promise<void> {
  if (zoomRunning || closed || !active) return;
  zoomRunning = true;
  try {
    while (!closed && active && pendingZoom !== 0) {
      const delta = pendingZoom;
      pendingZoom = 0;
      await resizeByWheel(delta, zoomVersion);
    }
  } catch (error) {
    cancelPendingZoom();
    if (!closed) reportError(error, "滚轮缩放贴图失败，请重试。");
  } finally {
    zoomRunning = false;
  }
}

function reportError(error: unknown, fallback: string): void {
  pinnedError.textContent = typeof error === "string" ? error : error instanceof Error ? error.message : fallback;
  pinnedError.hidden = false;
}

async function close(): Promise<void> {
  cancelPendingZoom();
  try { await appWindow.close(); }
  catch (error) { reportError(error, "关闭贴图失败，请重试。"); }
}

pinnedSurface.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (!active || closed || !pinnedImage.naturalWidth || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
  const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? window.innerHeight : 1;
  pendingZoom = clamp(pendingZoom + clamp(event.deltaY * unit, -300, 300), -600, 600);
  if (zoomTimer !== null || zoomRunning) return;
  zoomTimer = setTimeout(() => { zoomTimer = null; void flushZoom(); }, 32);
}, { passive: false });
pinnedSurface.addEventListener("pointerdown", cancelPendingZoom, { capture: true });
document.querySelector("#close-pinned")?.addEventListener("click", () => { void close(); });
document.querySelector("#resize-pinned")?.addEventListener("pointerdown", (event) => {
  if (!(event instanceof PointerEvent) || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  void appWindow.startResizeDragging("SouthEast")
    .catch((error) => reportError(error, "调整贴图大小失败，请重试。"));
});
root.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target instanceof Element && event.target.closest("button")) return;
  event.preventDefault();
  void appWindow.startDragging().catch((error) => reportError(error, "移动贴图失败，请重试。"));
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); void close(); }
});
window.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("beforeunload", () => {
  closed = true;
  cancelPendingZoom();
  unlistenFocus?.();
  unlistenFocus = null;
  if (retryTimer !== null) clearTimeout(retryTimer);
  pinnedImage.onload = null;
  pinnedImage.onerror = null;
  pinnedImage.removeAttribute("src");
}, { once: true });

async function loadImage(): Promise<void> {
  try {
    const data = await invoke<string | null>("get_pinned_screenshot");
    if (closed) return;
    // The backend reserves the window label before creating the WebView and then sets its size/position.
    if (data === null) {
      if (++loadAttempts >= 100) throw new Error("贴图加载超时。");
      retryTimer = setTimeout(() => { retryTimer = null; void loadImage(); }, 100);
      return;
    }
    pinnedImage.onload = () => {
      if (closed) return;
      pinnedImage.hidden = false;
      void invoke("show_pinned_screenshot").catch((error) => {
        reportError(error, "显示置顶贴图失败，请关闭后重试。");
        void appWindow.show().catch(() => {});
      });
    };
    pinnedImage.onerror = () => {
      reportError("加载贴图失败，请关闭后重新截图。", "加载贴图失败。");
      void appWindow.show().catch(() => {});
    };
    pinnedImage.src = data;
  } catch (error) {
    if (closed) return;
    reportError(error, "读取贴图失败，请关闭后重新截图。");
    void appWindow.show().catch(() => {});
  }
}

void initFocus().catch((error) => {
  if (!closed) reportError(error, "读取贴图焦点失败，请关闭后重试。");
}).then(() => { if (!closed) void loadImage(); });
