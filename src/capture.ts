import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./capture.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Capture root was not found");
const app = root;

type Selection = { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
let screenshot = "";
let start: { x: number; y: number } | null = null;
let selection: Selection | null = null;
let busy = false;
let cleanupReady: (() => void) | undefined;

function render(): void {
  const actionLeft = selection ? Math.max(8, Math.min(selection.x, window.innerWidth - 220)) : 0;
  const actionTop = selection
    ? selection.y + selection.height + 64 <= window.innerHeight
      ? selection.y + selection.height + 10
      : Math.max(8, selection.y - 64)
    : 0;
  app.style.setProperty("--screenshot-image", screenshot ? `url("${screenshot}")` : "none");
  app.style.setProperty("--selected-image", screenshot ? `url("${screenshot}")` : "none");
  app.innerHTML = `
    <main class="capture">
      <div class="capture-hint">拖动鼠标选择截图区域 · Esc 取消</div>
      ${selection ? `<div class="selection-box" style="left:${selection.x}px;top:${selection.y}px;width:${selection.width}px;height:${selection.height}px;background-position:-${selection.x}px -${selection.y}px"></div>
        <div class="selection-actions" style="left:${actionLeft}px;top:${actionTop}px">
          <button id="save-selection" type="button" ${busy ? "disabled" : ""}>保存图片</button>
          <button id="copy-selection" type="button" ${busy ? "disabled" : ""}>复制</button>
          <button id="cancel-selection" class="cancel" type="button" ${busy ? "disabled" : ""}>取消</button>
        </div>` : ""}
    </main>`;
  app.querySelector<HTMLButtonElement>("#save-selection")?.addEventListener("click", () => void save());
  app.querySelector<HTMLButtonElement>("#copy-selection")?.addEventListener("click", () => void copy());
  app.querySelector<HTMLButtonElement>("#cancel-selection")?.addEventListener("click", () => void cancel());
}

function bindPointer(): void {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".capture") || target.closest(".selection-actions")) return;
    if (!screenshot || event.button !== 0 || busy) return;
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    selection = null;
    render();
  });
  document.addEventListener("pointermove", (event) => {
    if (!screenshot || !start || busy) return;
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    selection = { x, y, width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y), viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    render();
  });
  document.addEventListener("pointerup", (event) => {
    if (!start) return;
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    const width = Math.abs(event.clientX - start.x);
    const height = Math.abs(event.clientY - start.y);
    start = null;
    selection = width >= 2 && height >= 2
      ? { x, y, width, height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
      : null;
    render();
  });
}

async function withSelection(action: (area: Selection) => Promise<unknown>): Promise<void> {
  if (!selection || busy) return;
  busy = true;
  render();
  try {
    await action(selection);
  } catch {
    busy = false;
    render();
    window.alert("截图操作失败，请重试。");
  }
}

async function save(): Promise<void> {
  await withSelection(async (area) => {
    const saved = await invoke<boolean>("save_screenshot", { selection: area });
    if (!saved) {
      busy = false;
      render();
    }
  });
}

async function copy(): Promise<void> {
  await withSelection((area) => invoke("copy_screenshot", { selection: area }));
}

async function cancel(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await invoke("cancel_screenshot");
  } catch {
    busy = false;
    window.alert("取消截图失败。");
  }
}

async function init(): Promise<void> {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") void cancel();
  });
  cleanupReady = await listen<string>("screenshot-ready", (event) => {
    screenshot = event.payload;
    selection = null;
    start = null;
    busy = false;
    render();
  });
  const cleanupFinished = await listen("screenshot-finished", () => {
    screenshot = "";
    selection = null;
    start = null;
    busy = false;
    render();
  });
  window.addEventListener("beforeunload", () => {
    cleanupReady?.();
    cleanupFinished();
  }, { once: true });
  render();
  bindPointer();
  await invoke("screenshot_overlay_ready");
}

void init().catch(() => window.alert("初始化截图窗口失败。"));
