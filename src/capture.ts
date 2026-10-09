import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./capture.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Capture root was not found");

root.innerHTML = `
  <main class="capture" data-selected="false" data-tool="move">
    <div class="capture-hint">拖动选择区域；使用“移动”调整选区，或选择红框、马赛克后在选区内拖动标注 · Esc / 右键取消</div>
    <div class="selection-box" hidden>
      <canvas class="annotation-canvas" aria-hidden="true" hidden></canvas>
      <span class="resize-edge edge-n" data-edge="n"></span>
      <span class="resize-edge edge-e" data-edge="e"></span>
      <span class="resize-edge edge-s" data-edge="s"></span>
      <span class="resize-edge edge-w" data-edge="w"></span>
      <span class="resize-corner corner-nw" data-edge="nw"></span>
      <span class="resize-corner corner-ne" data-edge="ne"></span>
      <span class="resize-corner corner-sw" data-edge="sw"></span>
      <span class="resize-corner corner-se" data-edge="se"></span>
    </div>
    <div class="selection-actions" role="group" aria-label="截图编辑工具" hidden>
      <button class="tool-button" data-tool="move" type="button" title="移动或缩放选区" aria-pressed="true">移动</button>
      <button class="tool-button" data-tool="redBox" type="button" title="在选区内拖动绘制红框" aria-pressed="false">红框</button>
      <button class="tool-button" data-tool="mosaic" type="button" title="在选区内拖动绘制马赛克" aria-pressed="false">马赛克</button>
      <button id="undo-annotation" type="button" title="撤销最近的标注（Ctrl+Z）">撤销</button>
      <button id="clear-annotations" type="button" title="清除全部标注">清除</button>
      <button id="save-selection" type="button">保存图片</button>
      <button id="copy-selection" type="button">复制</button>
    </div>
    <div class="capture-error" role="alert" hidden></div>
  </main>`;

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Capture element was not found: ${selector}`);
  return element;
}

const surface = requiredElement<HTMLElement>(".capture");
const box = requiredElement<HTMLDivElement>(".selection-box");
const annotationCanvas = requiredElement<HTMLCanvasElement>(".annotation-canvas");
const actions = requiredElement<HTMLDivElement>(".selection-actions");
const errorNotice = requiredElement<HTMLDivElement>(".capture-error");
const actionButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>("button"));
const toolButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>("[data-tool]"));
const undoButton = requiredElement<HTMLButtonElement>("#undo-annotation");
const clearAnnotationsButton = requiredElement<HTMLButtonElement>("#clear-annotations");

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Edge = "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";
type AnnotationTool = "redBox" | "mosaic";
type Tool = "move" | AnnotationTool;
// Annotation rectangles are relative to the selection, so moving/resizing keeps them attached.
type Annotation = Rect & { tool: AnnotationTool };
type Selection = Rect & { viewportWidth: number; viewportHeight: number; annotations: Annotation[] };
type Drag = {
  pointerId: number;
  mode: "create" | "move" | "resize" | "annotate";
  start: Point;
  original: Rect | null;
  originalAnnotations: Annotation[];
  edge?: Edge;
  annotationTool?: AnnotationTool;
};

let selection: Rect | null = null;
let drag: Drag | null = null;
let annotationDraft: Annotation | null = null;
let annotations: Annotation[] = [];
let activeTool: Tool = "move";
let screenshotImage: HTMLImageElement | null = null;
let previewFrame: number | null = null;
let ready = false;
let busy = false;
const minimumSize = 2;
const annotationMinimumSize = 4;
const maximumAnnotations = 128;
const edges: Edge[] = ["n", "e", "s", "w", "nw", "ne", "sw", "se"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function pointerPoint(event: PointerEvent): Point {
  return { x: clamp(event.clientX, 0, window.innerWidth), y: clamp(event.clientY, 0, window.innerHeight) };
}

function renderAnnotations(): void {
  const area = selection;
  const image = screenshotImage;
  annotationCanvas.hidden = !area || !image || (annotations.length === 0 && !annotationDraft);
  if (annotationCanvas.hidden || !area || !image) return;
  const scaleX = image.naturalWidth / window.innerWidth;
  const scaleY = image.naturalHeight / window.innerHeight;
  const left = Math.floor(area.x * scaleX);
  const top = Math.floor(area.y * scaleY);
  const right = Math.min(image.naturalWidth, Math.ceil((area.x + area.width) * scaleX));
  const bottom = Math.min(image.naturalHeight, Math.ceil((area.y + area.height) * scaleY));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    annotationCanvas.hidden = true;
    return;
  }
  if (annotationCanvas.width !== width) annotationCanvas.width = width;
  if (annotationCanvas.height !== height) annotationCanvas.height = height;
  const context = annotationCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法显示截图标注，请重试。");
  context.clearRect(0, 0, width, height);
  context.drawImage(image, left, top, width, height, 0, 0, width, height);
  const pixelScaleX = width / area.width;
  const pixelScaleY = height / area.height;
  const drawAnnotation = (annotation: Annotation) => {
    if (annotation.width <= 0 || annotation.height <= 0) return;
    const x = Math.min(width - 1, Math.floor(annotation.x * width));
    const y = Math.min(height - 1, Math.floor(annotation.y * height));
    const endX = Math.min(width, Math.ceil((annotation.x + annotation.width) * width));
    const endY = Math.min(height, Math.ceil((annotation.y + annotation.height) * height));
    const w = endX - x;
    const h = endY - y;
    if (w <= 0 || h <= 0) return;
    if (annotation.tool === "redBox") {
      const lineX = Math.min(w, Math.max(1, Math.ceil(3 * pixelScaleX)));
      const lineY = Math.min(h, Math.max(1, Math.ceil(3 * pixelScaleY)));
      context.fillStyle = "#e31b23";
      context.fillRect(x, y, w, lineY);
      context.fillRect(x, endY - lineY, w, lineY);
      context.fillRect(x, y, lineX, h);
      context.fillRect(endX - lineX, y, lineX, h);
      return;
    }
    const pixels = context.getImageData(x, y, w, h);
    const blockX = Math.max(1, Math.round(12 * pixelScaleX));
    const blockY = Math.max(1, Math.round(12 * pixelScaleY));
    for (let by = 0; by < h; by += blockY) {
      for (let bx = 0; bx < w; bx += blockX) {
        const ex = Math.min(w, bx + blockX);
        const ey = Math.min(h, by + blockY);
        const totals = [0, 0, 0, 0];
        const count = (ex - bx) * (ey - by);
        for (let py = by; py < ey; py++) {
          for (let px = bx; px < ex; px++) {
            const offset = (py * w + px) * 4;
            for (let channel = 0; channel < 4; channel++) totals[channel] += pixels.data[offset + channel];
          }
        }
        const color = totals.map((total) => Math.floor(total / count));
        for (let py = by; py < ey; py++) {
          for (let px = bx; px < ex; px++) {
            const offset = (py * w + px) * 4;
            for (let channel = 0; channel < 4; channel++) pixels.data[offset + channel] = color[channel];
          }
        }
      }
    }
    context.putImageData(pixels, x, y);
  };
  annotations.forEach(drawAnnotation);
  if (annotationDraft) drawAnnotation(annotationDraft);
}

function schedulePreview(): void {
  if (previewFrame !== null) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    try { renderAnnotations(); }
    catch (error) { reportError(error, "标注预览失败，请重试。"); }
  });
}

function renderSelection(): void {
  box.hidden = !selection;
  surface.dataset.selected = String(Boolean(selection));
  surface.dataset.dragging = String(Boolean(drag));
  surface.dataset.busy = String(busy);
  surface.dataset.tool = activeTool;
  if (selection) {
    box.style.left = `${selection.x}px`;
    box.style.top = `${selection.y}px`;
    box.style.width = `${selection.width}px`;
    box.style.height = `${selection.height}px`;
    box.style.backgroundPosition = `-${selection.x}px -${selection.y}px`;
    schedulePreview();
  } else {
    annotationCanvas.hidden = true;
  }
  actions.hidden = !selection || Boolean(drag) || !ready;
  actionButtons.forEach((button) => { button.disabled = busy; });
  toolButtons.forEach((button) => {
    const active = button.dataset.tool === activeTool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  undoButton.disabled = busy || annotations.length === 0;
  clearAnnotationsButton.disabled = busy || annotations.length === 0;
  if (!actions.hidden && selection) {
    const gap = 10;
    const toolbarWidth = actions.offsetWidth;
    const toolbarHeight = actions.offsetHeight;
    const left = clamp(selection.x + selection.width - toolbarWidth, 8, window.innerWidth - toolbarWidth - 8);
    const below = selection.y + selection.height + gap;
    const top = below + toolbarHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, selection.y - toolbarHeight - gap);
    actions.style.left = `${left}px`;
    actions.style.top = `${top}px`;
  }
}

function updateDrag(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const point = pointerPoint(event);
  const original = drag.original;
  if (drag.mode === "annotate" && original && drag.annotationTool) {
    const x = clamp(point.x, original.x, original.x + original.width);
    const y = clamp(point.y, original.y, original.y + original.height);
    const left = Math.min(drag.start.x, x) - original.x;
    const top = Math.min(drag.start.y, y) - original.y;
    const right = Math.max(drag.start.x, x) - original.x;
    const bottom = Math.max(drag.start.y, y) - original.y;
    const relativeX = clamp(left / original.width, 0, 1);
    const relativeY = clamp(top / original.height, 0, 1);
    annotationDraft = {
      tool: drag.annotationTool,
      x: relativeX,
      y: relativeY,
      width: Math.min(1 - relativeX, (right - left) / original.width),
      height: Math.min(1 - relativeY, (bottom - top) / original.height),
    };
  } else if (drag.mode === "create") {
    selection = {
      x: Math.min(drag.start.x, point.x),
      y: Math.min(drag.start.y, point.y),
      width: Math.abs(point.x - drag.start.x),
      height: Math.abs(point.y - drag.start.y),
    };
  } else if (original && drag.mode === "move") {
    selection = {
      ...original,
      x: clamp(original.x + point.x - drag.start.x, 0, window.innerWidth - original.width),
      y: clamp(original.y + point.y - drag.start.y, 0, window.innerHeight - original.height),
    };
  } else if (original && drag.mode === "resize" && drag.edge) {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    let left = original.x;
    let top = original.y;
    let right = original.x + original.width;
    let bottom = original.y + original.height;
    if (drag.edge.includes("w")) left = clamp(original.x + dx, 0, right - minimumSize);
    if (drag.edge.includes("e")) right = clamp(right + dx, left + minimumSize, window.innerWidth);
    if (drag.edge.includes("n")) top = clamp(original.y + dy, 0, bottom - minimumSize);
    if (drag.edge.includes("s")) bottom = clamp(bottom + dy, top + minimumSize, window.innerHeight);
    selection = { x: left, y: top, width: right - left, height: bottom - top };
  }
  renderSelection();
}

function releaseDrag(): void {
  const pointerId = drag?.pointerId;
  drag = null;
  annotationDraft = null;
  if (pointerId !== undefined && surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
}

function bindPointer(): void {
  surface.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".selection-actions") || !ready || busy || drag || event.button !== 0) return;
    event.preventDefault();
    errorNotice.hidden = true;
    const edge = target.closest<HTMLElement>("[data-edge]")?.dataset.edge;
    const onSelection = selection && target.closest(".selection-box");
    if (onSelection && activeTool !== "move" && annotations.length >= maximumAnnotations) {
      reportError("最多可添加 128 个标注，请先撤销或清除部分标注。", "标注数量已达上限。");
      return;
    }
    const point = pointerPoint(event);
    drag = {
      pointerId: event.pointerId,
      start: selection && onSelection ? {
        x: clamp(point.x, selection.x, selection.x + selection.width),
        y: clamp(point.y, selection.y, selection.y + selection.height),
      } : point,
      original: selection ? { ...selection } : null,
      originalAnnotations: annotations,
      mode: onSelection ? activeTool !== "move" ? "annotate"
        : edge && edges.includes(edge as Edge) ? "resize" : "move" : "create",
      edge: edge as Edge | undefined,
      annotationTool: activeTool === "move" ? undefined : activeTool,
    };
    surface.setPointerCapture(event.pointerId);
    if (drag.mode === "create") {
      selection = null;
      annotations = [];
      annotationCanvas.hidden = true;
    }
    renderSelection();
  });
  surface.addEventListener("pointermove", updateDrag);
  surface.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    updateDrag(event);
    if (annotationDraft && selection
      && annotationDraft.width * selection.width >= annotationMinimumSize
      && annotationDraft.height * selection.height >= annotationMinimumSize) {
      annotations = [...annotations, annotationDraft];
    }
    if (drag.mode === "create") activeTool = "move";
    releaseDrag();
    if (selection && (selection.width < minimumSize || selection.height < minimumSize)) selection = null;
    renderSelection();
  });
  const abortDrag = () => {
    if (!drag) return;
    selection = drag.original;
    annotations = drag.originalAnnotations;
    releaseDrag();
    renderSelection();
  };
  surface.addEventListener("pointercancel", abortDrag);
  surface.addEventListener("lostpointercapture", abortDrag);
}

function reportError(error: unknown, fallback: string): void {
  errorNotice.textContent = typeof error === "string" && error.trim() ? error
    : error instanceof Error ? error.message : fallback;
  errorNotice.hidden = false;
}

function undoAnnotation(): void {
  if (busy || drag || annotations.length === 0) return;
  annotations = annotations.slice(0, -1);
  renderSelection();
}

async function withSelection(action: (area: Selection) => Promise<boolean | void>): Promise<void> {
  if (!selection || busy || drag || !ready) return;
  const area: Selection = {
    ...selection, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
    annotations: annotations.map((annotation) => ({ ...annotation })),
  };
  busy = true;
  errorNotice.hidden = true;
  renderSelection();
  try {
    const result = await action(area);
    if (result !== false) clearCapture();
  } catch (error) {
    reportError(error, "截图操作失败，请重试。");
  } finally {
    busy = false;
    renderSelection();
  }
}

function clearCapture(): void {
  releaseDrag();
  selection = null;
  annotations = [];
  activeTool = "move";
  ready = false;
  busy = false;
  if (previewFrame !== null) cancelAnimationFrame(previewFrame);
  previewFrame = null;
  if (screenshotImage) {
    screenshotImage.onload = null;
    screenshotImage.onerror = null;
    screenshotImage.removeAttribute("src");
  }
  screenshotImage = null;
  annotationCanvas.width = 0;
  annotationCanvas.height = 0;
  surface.style.removeProperty("--screenshot-image");
  errorNotice.hidden = true;
  renderSelection();
}

async function cancel(): Promise<void> {
  if (busy) return;
  busy = true;
  renderSelection();
  try {
    await invoke("cancel_screenshot");
    clearCapture();
  } catch (error) {
    busy = false;
    reportError(error, "取消截图失败。");
    renderSelection();
  }
}

async function init(): Promise<void> {
  document.querySelector(".titlebar")?.remove();
  bindPointer();
  toolButtons.forEach((button) => button.addEventListener("click", () => {
    if (busy || drag) return;
    const tool = button.dataset.tool;
    if (tool !== "move" && tool !== "redBox" && tool !== "mosaic") return;
    activeTool = tool;
    renderSelection();
  }));
  undoButton.addEventListener("click", undoAnnotation);
  clearAnnotationsButton.addEventListener("click", () => {
    if (busy || drag) return;
    annotations = [];
    renderSelection();
  });
  requiredElement<HTMLButtonElement>("#save-selection").addEventListener("click", () => {
    void withSelection((area) => invoke<boolean>("save_screenshot", { selection: area }));
  });
  requiredElement<HTMLButtonElement>("#copy-selection").addEventListener("click", () => {
    void withSelection((area) => invoke<void>("copy_screenshot", { selection: area }));
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); void cancel(); }
    else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoAnnotation();
    }
  });
  surface.addEventListener("contextmenu", (event) => { event.preventDefault(); void cancel(); });
  window.addEventListener("resize", () => {
    releaseDrag();
    selection = null;
    annotations = [];
    activeTool = "move";
    annotationCanvas.width = 0;
    annotationCanvas.height = 0;
    renderSelection();
  });
  const cleanupReady = await listen<string>("screenshot-ready", (event) => {
    clearCapture();
    const image = new Image();
    screenshotImage = image;
    image.onload = () => {
      if (screenshotImage !== image) return;
      surface.style.setProperty("--screenshot-image", `url("${image.src}")`);
      ready = true;
      renderSelection();
    };
    image.onerror = () => {
      if (screenshotImage === image) reportError("加载截图失败，请按 Esc 取消并重试。", "加载截图失败。");
    };
    image.src = event.payload;
  });
  const cleanupFinished = await listen("screenshot-finished", clearCapture);
  window.addEventListener("beforeunload", () => {
    cleanupReady(); cleanupFinished(); clearCapture();
  }, { once: true });
  await invoke("screenshot_overlay_ready");
}

void init().catch((error) => reportError(error, "初始化截图窗口失败，请按 Esc 退出。"));
