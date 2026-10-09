import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import type { TranslationJob, TranslationSettings } from "./domain";
import { icon, renderIcons } from "./icons";
import { fitImage, translationApi } from "./translation";
import "./pinned.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Pinned image root was not found");
document.querySelector(".titlebar")?.remove();
root.innerHTML = `
  <main class="pinned-image" data-active="false" data-view="translated" aria-label="置顶贴图">
    <img id="pinned-image" alt="截图贴图" draggable="false" hidden />
    <div id="translation-layer" class="translation-layer" hidden></div>
    <div class="pinned-controls" role="toolbar" aria-label="贴图工具">
      <button id="translate-pinned" type="button" title="翻译图片" aria-label="翻译图片">${icon("languages")}</button>
      <button id="toggle-translation" type="button" title="显示原图" aria-label="显示原图" aria-pressed="false">${icon("scan-eye")}</button>
      <button id="select-text-mode" type="button" title="选择文字" aria-label="选择文字" aria-pressed="false">${icon("text-cursor")}</button>
      <button id="toggle-text-panel" type="button" title="原文与译文" aria-label="原文与译文" aria-pressed="false">${icon("panel-bottom")}</button>
      <button id="close-pinned" type="button" title="关闭贴图" aria-label="关闭贴图">${icon("x")}</button>
    </div>
    <section id="translation-panel" class="translation-panel translation-interaction" hidden aria-label="原文和译文">
      <div class="translation-text-toolbar">
        <span id="translation-status" role="status"></span>
        <button id="copy-source" type="button" title="复制原文" aria-label="复制原文">${icon("copy")}</button>
        <button id="copy-translation" type="button" title="复制译文" aria-label="复制译文">${icon("clipboard-check")}</button>
        <label class="translation-font-label"><span>字号</span><input id="translation-font" type="range" min="0.6" max="2" step="0.1" value="1" aria-label="译文字号" /></label>
      </div>
      <div class="translation-text-heading"><span>原文</span><span>译文</span></div>
      <div id="translation-rows"></div>
    </section>
    <button id="resize-pinned" type="button" title="拖动调整贴图大小" aria-label="调整贴图大小"></button>
    <div id="pinned-error" role="alert" hidden></div>
  </main>`;

const appWindow = getCurrentWindow();
const image = document.querySelector<HTMLImageElement>("#pinned-image");
const errorNotice = document.querySelector<HTMLDivElement>("#pinned-error");
const surface = document.querySelector<HTMLElement>(".pinned-image");
const layer = document.querySelector<HTMLDivElement>("#translation-layer");
const panel = document.querySelector<HTMLElement>("#translation-panel");
const translateButton = document.querySelector<HTMLButtonElement>("#translate-pinned");
const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-translation");
const copyButtonElement = document.querySelector<HTMLButtonElement>("#copy-translation");
if (!image || !errorNotice || !surface || !layer || !panel || !translateButton || !toggleButton || !copyButtonElement) {
  throw new Error("Pinned image elements were not found");
}
const pinnedImage = image;
const pinnedError = errorNotice;
const pinnedSurface = surface;
const translationLayer = layer;
const translationPanel = panel;
const translateControl = translateButton;
const toggleControl = toggleButton;
const copyButton = copyButtonElement;
const rows = document.querySelector<HTMLDivElement>("#translation-rows")!;
const modeButton = document.querySelector<HTMLButtonElement>("#select-text-mode")!;
const textPanelButton = document.querySelector<HTMLButtonElement>("#toggle-text-panel")!;
const sourceCopyButton = document.querySelector<HTMLButtonElement>("#copy-source")!;
const fontInput = document.querySelector<HTMLInputElement>("#translation-font")!;
const statusLabel = document.querySelector<HTMLElement>("#translation-status")!;
let closed = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loadAttempts = 0;
let active = false;
let focusVersion = 0;
let unlistenFocus: (() => void) | null = null;
let unlistenTranslation: (() => void) | null = null;
let zoomTimer: ReturnType<typeof setTimeout> | null = null;
let pendingZoom = 0;
let zoomRunning = false;
let zoomVersion = 0;
let job: TranslationJob | null = null;
let showTranslation = true;
let textMode = false;
let panelOpen = false;
let fontScale = 1;
let requesting = false;
let translationVersion = 0;
let lastRenderedJob: TranslationJob | null = null;
renderIcons();

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
  } finally { zoomRunning = false; }
}

function reportError(error: unknown, fallback: string): void {
  pinnedError.textContent = typeof error === "string" ? error : error instanceof Error ? error.message : fallback;
  pinnedError.hidden = false;
}

function translationText(separator: "source" | "target"): string {
  if (separator === "source") return (job?.document ?? job?.output?.document)?.regions.map((region) => region.text).join("\n") ?? "";
  return job?.output?.translations.join("\n").trim() ?? "";
}

function renderTranslation(): void {
  const output = job?.output;
  const ocrDocument = output?.document ?? job?.document;
  const displayDocument = showTranslation && output ? output.document : ocrDocument;
  if (!displayDocument) { translationLayer.hidden = true; }
  else {
    const fitted = fitImage(pinnedSurface.clientWidth, pinnedSurface.clientHeight, displayDocument.width, displayDocument.height);
    translationLayer.hidden = false;
    translationLayer.replaceChildren();
    displayDocument.regions.forEach((region, index) => {
      const item = document.createElement("div");
      item.className = "translation-region";
      item.dataset.source = String(!showTranslation || !output);
      item.textContent = showTranslation && output ? output.translations[index] ?? "" : region.text;
      item.style.left = `${fitted.x + region.x * fitted.width}px`;
      item.style.top = `${fitted.y + region.y * fitted.height}px`;
      item.style.width = `${region.width * fitted.width}px`;
      item.style.height = `${region.height * fitted.height}px`;
      item.style.fontSize = `${Math.max(1, region.height * fitted.height * 0.8 * fontScale)}px`;
      item.title = `原文：${region.text}\n译文：${output?.translations[index] ?? ""}`;
      translationLayer.append(item);
      // Fit long translations inside their own OCR box instead of covering adjacent regions.
      let low = 1;
      let high = parseFloat(item.style.fontSize);
      for (let attempt = 0; attempt < 10 && high - low > 0.25; attempt++) {
        const size = (low + high) / 2;
        item.style.fontSize = `${size}px`;
        if (item.scrollHeight > item.clientHeight || item.scrollWidth > item.clientWidth) high = size;
        else low = size;
      }
      item.style.fontSize = `${low}px`;
    });
    translationLayer.hidden = !(showTranslation && output) && !textMode;
  }
  pinnedSurface.dataset.textMode = String(textMode);
  pinnedSurface.dataset.textPanel = String(panelOpen);
  translationPanel.hidden = !panelOpen;
  if (lastRenderedJob !== job) {
    rows.replaceChildren();
    const doc = output?.document ?? job?.document;
    doc?.regions.forEach((region, index) => {
      const row = document.createElement("div");
      row.className = "translation-row";
      const source = document.createElement("span"); source.textContent = region.text;
      const target = document.createElement("span"); target.textContent = output?.translations[index] ?? "";
      row.append(source, target); rows.append(row);
    });
    lastRenderedJob = job;
  }
  toggleControl.disabled = !output;
  toggleControl.setAttribute("aria-pressed", String(!showTranslation));
  toggleControl.title = showTranslation ? "显示原图" : "显示译文覆盖";
  modeButton.disabled = !ocrDocument;
  modeButton.setAttribute("aria-pressed", String(textMode));
  textPanelButton.setAttribute("aria-pressed", String(panelOpen));
}

function renderJob(): void {
  const running = isRunning();
  translateControl.disabled = requesting;
  translateControl.innerHTML = icon(running ? "square" : "languages");
  translateControl.title = running ? "取消图片翻译" : job?.output ? "重新翻译" : "翻译图片";
  translateControl.setAttribute("aria-label", translateControl.title);
  pinnedSurface.dataset.busy = String(running);
  const statuses: Record<string, string> = { queued: "等待识别", recognizing: "识别中", translating: "翻译中",
    success: "已完成", error: "失败", cancelled: "已取消" };
  statusLabel.textContent = job ? statuses[job.status] : "";
  copyButton.disabled = !job?.output;
  sourceCopyButton.disabled = !(job?.document || job?.output);
  if (job?.status === "error") reportError(job.error ?? "图片翻译失败，请重试。", "图片翻译失败，请重试。");
  else pinnedError.hidden = true;
  renderTranslation();
  renderIcons();
}

function isRunning(): boolean {
  return Boolean(job && ["queued", "recognizing", "translating"].includes(job.status));
}

async function startTranslation(): Promise<void> {
  if (closed || requesting) return;
  requesting = true;
  translateControl.disabled = true;
  pinnedError.hidden = true;
  const version = translationVersion;
  let failure: unknown = null;
  try {
    const snapshot = await translationApi.start();
    if (!closed && version === translationVersion) job = snapshot;
  } catch (error) { failure = error; }
  finally {
    requesting = false;
    if (!closed) {
      renderJob();
      if (failure) reportError(failure, "无法启动图片翻译，请先检查翻译设置。");
    }
  }
}

async function copyText(text: string, emptyMessage: string): Promise<void> {
  if (!text) { reportError(emptyMessage, emptyMessage); return; }
  try { await translationApi.copy(text); }
  catch (error) { reportError(error, "复制文字失败，请重试。"); }
}

async function close(): Promise<void> {
  cancelPendingZoom();
  if (job && (job.status === "queued" || job.status === "recognizing" || job.status === "translating")) {
    await translationApi.cancel().catch(() => {});
  }
  try { await appWindow.close(); }
  catch (error) { reportError(error, "关闭贴图失败，请重试。"); }
}

pinnedSurface.addEventListener("wheel", (event) => {
  if (panelOpen || textMode || event.target instanceof Element && event.target.closest(".pinned-controls, #pinned-error")) return;
  event.preventDefault();
  if (!active || closed || !pinnedImage.naturalWidth || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
  const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? window.innerHeight : 1;
  pendingZoom = clamp(pendingZoom + clamp(event.deltaY * unit, -300, 300), -600, 600);
  if (zoomTimer !== null || zoomRunning) return;
  zoomTimer = setTimeout(() => { zoomTimer = null; void flushZoom(); }, 32);
}, { passive: false });
pinnedSurface.addEventListener("pointerdown", cancelPendingZoom, { capture: true });
document.querySelector("#close-pinned")?.addEventListener("click", () => { void close(); });
translateControl.addEventListener("click", () => {
  if (isRunning()) void translationApi.cancel().catch((error) => reportError(error, "取消翻译失败。"));
  else void startTranslation();
});
toggleControl.addEventListener("click", () => { showTranslation = !showTranslation; renderTranslation(); });
modeButton.addEventListener("click", () => { textMode = !textMode; cancelPendingZoom(); renderTranslation(); });
textPanelButton.addEventListener("click", () => { panelOpen = !panelOpen; cancelPendingZoom(); renderTranslation(); });
sourceCopyButton.addEventListener("click", () => { void copyText(translationText("source"), "暂无可复制的原文。"); });
copyButton.addEventListener("click", () => { void copyText(translationText("target"), "暂无可复制的译文。"); });
fontInput.addEventListener("input", () => { fontScale = Number(fontInput.value); renderTranslation(); });
document.querySelector("#resize-pinned")?.addEventListener("pointerdown", (event) => {
  if (!(event instanceof PointerEvent) || event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  void appWindow.startResizeDragging("SouthEast").catch((error) => reportError(error, "调整贴图大小失败，请重试。"));
});
root.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || panelOpen || textMode || event.target instanceof Element && event.target.closest("button, input, .translation-interaction, #pinned-error")) return;
  event.preventDefault();
  void appWindow.startDragging().catch((error) => reportError(error, "移动贴图失败，请重试。"));
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    if (isRunning()) void translationApi.cancel().catch((error) => reportError(error, "取消翻译失败。"));
    else if (panelOpen) { panelOpen = false; renderTranslation(); }
    else if (textMode) { textMode = false; renderTranslation(); }
    else void close();
  } else if (event.ctrlKey && event.key.toLowerCase() === "c") {
    const selected = window.getSelection()?.toString();
    if (selected) { event.preventDefault(); void copyText(selected, "没有选中文字。"); }
  }
});
window.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", () => { if (job?.output || job?.document) renderTranslation(); });
window.addEventListener("beforeunload", () => {
  closed = true; cancelPendingZoom(); unlistenFocus?.(); unlistenFocus = null; unlistenTranslation?.(); unlistenTranslation = null;
  if (retryTimer !== null) clearTimeout(retryTimer);
  pinnedImage.onload = null; pinnedImage.onerror = null; pinnedImage.removeAttribute("src");
  job = null; lastRenderedJob = null; rows.replaceChildren(); translationLayer.replaceChildren();
}, { once: true });

async function loadImage(): Promise<void> {
  try {
    const data = await invoke<string | null>("get_pinned_screenshot");
    if (closed) return;
    if (data === null) {
      if (++loadAttempts >= 100) throw new Error("贴图加载超时。");
      retryTimer = setTimeout(() => { retryTimer = null; void loadImage(); }, 100);
      return;
    }
    pinnedImage.onload = async () => {
      if (closed) return;
      pinnedImage.hidden = false;
      void invoke("show_pinned_screenshot").catch((error) => reportError(error, "显示置顶贴图失败，请关闭后重试。"));
      try {
        const settings = await invoke<TranslationSettings>("get_translation_settings");
        if (closed) return;
        fontScale = settings.fontScale; fontInput.value = String(fontScale);
        const version = translationVersion;
        const initial = await translationApi.snapshot();
        if (closed) return;
        if (initial && version === translationVersion) job = initial;
        renderJob();
        if (await invoke<boolean>("take_pinned_auto_translate") && !closed) await startTranslation();
      } catch (error) { reportError(error, "读取贴图翻译状态失败，请重试。"); }
    };
    pinnedImage.onerror = () => { reportError("加载贴图失败，请关闭后重新截图。", "加载贴图失败。"); void appWindow.show().catch(() => {}); };
    pinnedImage.src = data;
  } catch (error) { if (!closed) { reportError(error, "读取贴图失败，请关闭后重新截图。"); void appWindow.show().catch(() => {}); } }
}

async function initPinned(): Promise<void> {
  try {
    const unlisten = await listen<TranslationJob>("translation-updated", (event) => {
      if (closed) return;
      translationVersion++; job = event.payload; renderJob();
    });
    if (closed) { unlisten(); return; }
    unlistenTranslation = unlisten;
  } catch { if (!closed) reportError("翻译状态监听失败，请关闭后重试。", "翻译状态监听失败。"); }
  try { await initFocus(); }
  catch (error) { if (!closed) reportError(error, "读取贴图焦点失败，请关闭后重试。"); }
  if (!closed) await loadImage();
}
void initPinned();
