import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./capture.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Capture root was not found");

root.innerHTML = `
  <main class="capture" data-selected="false">
    <div class="capture-hint">拖动选择区域；确认后可拖动选区或边缘调整 · Esc / 右键取消</div>
    <div class="selection-box" hidden>
      <span class="resize-edge edge-n" data-edge="n"></span>
      <span class="resize-edge edge-e" data-edge="e"></span>
      <span class="resize-edge edge-s" data-edge="s"></span>
      <span class="resize-edge edge-w" data-edge="w"></span>
      <span class="resize-corner corner-nw" data-edge="nw"></span>
      <span class="resize-corner corner-ne" data-edge="ne"></span>
      <span class="resize-corner corner-sw" data-edge="sw"></span>
      <span class="resize-corner corner-se" data-edge="se"></span>
    </div>
    <div class="selection-actions" hidden>
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
const actions = requiredElement<HTMLDivElement>(".selection-actions");
const errorNotice = requiredElement<HTMLDivElement>(".capture-error");
const actionButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>("button"));

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Edge = "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";
type Drag = {
  pointerId: number;
  mode: "create" | "move" | "resize";
  start: Point;
  original: Rect | null;
  edge?: Edge;
};
type Selection = Rect & { viewportWidth: number; viewportHeight: number };

let selection: Rect | null = null;
let drag: Drag | null = null;
let ready = false;
let busy = false;
const minimumSize = 2;
const edges: Edge[] = ["n", "e", "s", "w", "nw", "ne", "sw", "se"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function pointerPoint(event: PointerEvent): Point {
  return { x: clamp(event.clientX, 0, window.innerWidth), y: clamp(event.clientY, 0, window.innerHeight) };
}

function renderSelection(): void {
  box.hidden = !selection;
  surface.dataset.selected = String(Boolean(selection));
  surface.dataset.dragging = String(Boolean(drag));
  surface.dataset.busy = String(busy);
  if (selection) {
    box.style.left = `${selection.x}px`;
    box.style.top = `${selection.y}px`;
    box.style.width = `${selection.width}px`;
    box.style.height = `${selection.height}px`;
    box.style.backgroundPosition = `-${selection.x}px -${selection.y}px`;
  }
  actions.hidden = !selection || Boolean(drag) || !ready;
  actionButtons.forEach((button) => { button.disabled = busy; });
  if (!actions.hidden && selection) {
    const gap = 10;
    const toolbarWidth = actions.offsetWidth;
    const toolbarHeight = actions.offsetHeight;
    const left = clamp(selection.x + selection.width - toolbarWidth, 8, window.innerWidth - toolbarWidth - 8);
    const below = selection.y + selection.height + gap;
    // Prefer the lower-right side; flip above only when the screen bottom leaves no room.
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
  if (drag.mode === "create") {
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
  } else if (original && drag.edge) {
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
    drag = {
      pointerId: event.pointerId,
      start: pointerPoint(event),
      original: selection ? { ...selection } : null,
      mode: onSelection ? edge && edges.includes(edge as Edge) ? "resize" : "move" : "create",
      edge: edge as Edge | undefined,
    };
    surface.setPointerCapture(event.pointerId);
    if (drag.mode === "create") selection = null;
    renderSelection();
  });
  surface.addEventListener("pointermove", updateDrag);
  surface.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    updateDrag(event);
    releaseDrag();
    if (selection && (selection.width < minimumSize || selection.height < minimumSize)) selection = null;
    renderSelection();
  });
  const abortDrag = () => {
    if (!drag) return;
    selection = drag.original;
    releaseDrag();
    renderSelection();
  };
  surface.addEventListener("pointercancel", abortDrag);
  surface.addEventListener("lostpointercapture", abortDrag);
}

function reportError(error: unknown, fallback: string): void {
  errorNotice.textContent = typeof error === "string" && error.trim() ? error : fallback;
  errorNotice.hidden = false;
}

async function withSelection(action: (area: Selection) => Promise<boolean | void>): Promise<void> {
  if (!selection || busy || drag || !ready) return;
  const area = { ...selection, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
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
  ready = false;
  busy = false;
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
  requiredElement<HTMLButtonElement>("#save-selection").addEventListener("click", () => {
    void withSelection((area) => invoke<boolean>("save_screenshot", { selection: area }));
  });
  requiredElement<HTMLButtonElement>("#copy-selection").addEventListener("click", () => {
    void withSelection((area) => invoke<void>("copy_screenshot", { selection: area }));
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); void cancel(); }
  });
  surface.addEventListener("contextmenu", (event) => { event.preventDefault(); void cancel(); });
  window.addEventListener("resize", () => {
    releaseDrag();
    selection = null;
    renderSelection();
  });
  const cleanupReady = await listen<string>("screenshot-ready", (event) => {
    clearCapture();
    surface.style.setProperty("--screenshot-image", `url("${event.payload}")`);
    ready = true;
    renderSelection();
  });
  const cleanupFinished = await listen("screenshot-finished", clearCapture);
  window.addEventListener("beforeunload", () => { cleanupReady(); cleanupFinished(); }, { once: true });
  await invoke("screenshot_overlay_ready");
}

void init().catch((error) => reportError(error, "初始化截图窗口失败，请按 Esc 退出。"));
