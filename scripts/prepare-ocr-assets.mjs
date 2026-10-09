import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ["src/vendor/tesseract.js", "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js"],
  ["public/ocr/worker.min.js", "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js"],
  ...["tesseract-core", "tesseract-core-simd", "tesseract-core-lstm", "tesseract-core-simd-lstm"].map((name) =>
    [`public/ocr/core/${name}.wasm.js`, `https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/${name}.wasm.js`]),
  ...["eng", "chi_sim"].map((lang) => [`public/ocr/lang/${lang}.traineddata.gz`,
    `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz`]),
  ["public/ocr/LICENSE-tesseract.txt", "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/LICENSE.md"],
  ["public/ocr/LICENSE-core.txt", "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/LICENSE"],
  ["public/ocr/LICENSE-data.txt", "https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.1.0/LICENSE"],
  ["public/icons/lucide.js", "https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js"],
  ["public/ocr/LICENSE-lucide.txt", "https://cdn.jsdelivr.net/npm/lucide@0.468.0/LICENSE"],
];
const manifestPath = resolve(root, "scripts/ocr-assets.json");
const record = process.argv.includes("--record");
const verify = process.argv.includes("--verify");
if (verify && record) throw new Error("--verify and --record cannot be combined");
let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
catch (error) { if (!record) throw error; }
for (const [path, url] of files) {
  let bytes;
  if (verify) bytes = await readFile(resolve(root, path));
  else {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Asset fetch failed: ${path} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!record && (manifest[path]?.sha256 !== sha256 || manifest[path]?.url !== url || manifest[path]?.bytes !== bytes.length)) {
    throw new Error(`Asset integrity mismatch: ${path}`);
  }
  if (!verify) {
    const destination = resolve(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  manifest[path] = { url, sha256, bytes: bytes.length };
  console.log(`${path}: ${bytes.length} bytes`);
}
if (record) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
