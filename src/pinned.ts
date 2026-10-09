import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./pinned.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Pinned image root was not found");
document.querySelector(".titlebar")?.remove();
root.innerHTML = `
  <main class="pinned-image" aria-label="置顶贴图">
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
if (!image || !errorNotice) throw new Error("Pinned image elements were not found");
const pinnedImage = image;
const pinnedError = errorNotice;
let closed = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loadAttempts = 0;

function reportError(error: unknown, fallback: string): void {
  pinnedError.textContent = typeof error === "string" ? error : fallback;
  pinnedError.hidden = false;
}

async function close(): Promise<void> {
  try { await appWindow.close(); }
  catch (error) { reportError(error, "关闭贴图失败，请重试。"); }
}

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

void loadImage();
