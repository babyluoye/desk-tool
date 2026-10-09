import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Tesseract from "./vendor/tesseract.js";
import type { OcrDocument, OcrRegion } from "./domain";

interface OcrTask { id: string; image: string; sourceLanguage: string }
interface Line { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
// Tesseract exposes terminate only after initialization; track native workers so failed initialization is cancellable.
const NativeWorker = window.Worker;
const nativeWorkers = new Set<Worker>();
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options); nativeWorkers.add(this);
  }
};
let worker: ReturnType<typeof Tesseract.createWorker> | null = null;
let workerLanguage = "";
let current: OcrTask | null = null;
const cancelledTasks = new Set<string>();
let generation = 0;
let closed = false;
let timeout: ReturnType<typeof setTimeout> | null = null;
let taskAbort: AbortController | null = null;

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("OCR cancelled");
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(new Error("OCR cancelled"));
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}

function assetPath(path: string): string { return new URL(`./ocr/${path}`, window.location.href).toString(); }

function releaseWorker(): void {
  const previous = worker;
  worker = null;
  workerLanguage = "";
  nativeWorkers.forEach((native) => native.terminate());
  nativeWorkers.clear();
  if (previous) void previous.then((engine) => engine.terminate()).catch(() => {});
}

function clearTask(): void {
  if (timeout !== null) clearTimeout(timeout);
  timeout = null;
  current = null;
  taskAbort?.abort();
  taskAbort = null;
}

function cancel(id: string): void {
  cancelledTasks.add(id);
  if (cancelledTasks.size > 32) cancelledTasks.delete(cancelledTasks.values().next().value as string);
  if (id !== current?.id) return;
  generation++;
  clearTask();
  releaseWorker();
}

function documentFromLines(data: any, width: number, height: number): OcrDocument {
  const lines: Line[] = (data.blocks ?? []).flatMap((block: any) =>
    (block.paragraphs ?? []).flatMap((paragraph: any) => paragraph.lines ?? []));
  const regions: OcrRegion[] = [];
  for (const line of lines) {
    if (!line.text?.trim() || !line.bbox || !Object.values(line.bbox).every(Number.isFinite)) continue;
    const x = Math.max(0, Math.min(width, line.bbox.x0));
    const y = Math.max(0, Math.min(height, line.bbox.y0));
    const right = Math.max(x, Math.min(width, line.bbox.x1));
    const bottom = Math.max(y, Math.min(height, line.bbox.y1));
    if (right <= x || bottom <= y) continue;
    regions.push({ id: regions.length, text: line.text.trim(), x: x / width, y: y / height,
      width: (right - x) / width, height: (bottom - y) / height });
  }
  if (!regions.length || regions.length > 256 || regions.reduce((sum, r) => sum + [...r.text].length, 0) > 20000) {
    throw new Error("OCR text limit");
  }
  return { width, height, regions };
}

async function processTask(task: OcrTask): Promise<void> {
  if (cancelledTasks.delete(task.id)) { task.image = ""; return; }
  current = task;
  const version = ++generation;
  const controller = new AbortController();
  taskAbort = controller;
  const image = new Image();
  const failed = async () => {
    if (version !== generation || closed) return;
    releaseWorker();
    await invoke("complete_ocr_task", { id: task.id, document: null });
  };
  timeout = setTimeout(() => {
    if (current?.id !== task.id) return;
    cancel(task.id);
    void invoke("complete_ocr_task", { id: task.id, document: null }).catch(() => {});
  }, 120000);
  try {
    image.src = task.image;
    await abortable(image.decode(), controller.signal);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000) throw new Error("OCR image limit");
    if (version !== generation || closed) return;
    const lang = task.sourceLanguage === "en" ? "eng" : "eng+chi_sim";
    if (workerLanguage !== lang) releaseWorker();
    if (!worker) {
      workerLanguage = lang;
      worker = Tesseract.createWorker(lang, 1, {
        workerPath: assetPath("worker.min.js"), corePath: assetPath("core"), langPath: assetPath("lang"),
        cacheMethod: "none", workerBlobURL: false,
        errorHandler: () => controller.abort(),
      });
    }
    const engine = await abortable(worker, controller.signal);
    if (version !== generation || closed) return;
    const result = await abortable(engine.recognize(image, {}, { blocks: true }), controller.signal);
    if (version !== generation || closed) return;
    const document = documentFromLines(result.data, width, height);
    await invoke("complete_ocr_task", { id: task.id, document });
  } catch {
    await failed().catch(() => {});
  } finally {
    image.removeAttribute("src");
    task.image = "";
    if (version === generation) { clearTask(); releaseWorker(); }
  }
}

async function poll(): Promise<void> {
  if (closed) return;
  try {
    if (!current) {
      const task = await invoke<OcrTask | null>("next_ocr_task");
      if (task && !closed) void processTask(task);
      else if (task) task.image = "";
    }
  } catch { /* Retry IPC without logging image or text data. */ }
  if (!closed) setTimeout(() => { void poll(); }, 300);
}

async function init(): Promise<void> {
  document.querySelector(".titlebar")?.remove();
  const unlisten = await listen<string>("ocr-cancel", (event) => cancel(event.payload));
  window.addEventListener("beforeunload", () => {
    closed = true;
    window.Worker = NativeWorker;
    generation++;
    clearTask();
    releaseWorker();
    unlisten();
  }, { once: true });
  void poll();
}
void init().catch(() => { closed = true; releaseWorker(); window.Worker = NativeWorker; });
