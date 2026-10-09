# OCR Feasibility

## 当前实现（阶段 25）

Windows 图片翻译采用本地 Tesseract.js 6.0.1、tesseract.js-core 6.0.0 和固定版本的英文/简中语言数据。不使用 Windows.Media.Ocr，不改变 EXE/MSI/NSIS 发布格式。

- `src/ocr.ts` 在隐藏 `ocr-worker` WebView 中运行单个后台 Worker，串行识别任务；任务结束、取消或失败后终止 Worker 并释放图像，下一任务重新初始化。
- 显式启用 `blocks` 输出并提取 `blocks[].paragraphs[].lines[]` 的文字和 bounding boxes，使用归一化坐标。
- OCR 只读取后端最终合成、含红框和马赛克的贴图 PNG，不能读取标注前的原始截图。
- 英文源语言只加载 `eng`，自动检测/简中加载 `eng+chi_sim`；翻译目标支持简中、繁中、英、日、韩、法、德、俄、西。目标语言与 OCR 支持语种不同。
- 图片上限为 16384 单边、4000 万像素；最多 256 行、20000 个字符；本地识别最多 120 秒，排队及识别等待最多 180 秒。
- 后端按贴图窗口保存任务和结果；关闭贴图删除任务，取消信号中止识别与网络等待，任务 ID 防止旧结果覆盖新结果。
- 文字选择模式与移动模式分开；覆盖坐标计入 `object-fit: contain` 留白与窗口变化，原图不修改。
- 长译文在自身 OCR 框内缩小，不覆盖相邻区域；完整原文与译文在文本视图可复制。极小区域字可能不可读，应使用文本视图。

## 资源与发布

`src/vendor/tesseract.js` 为官方固定版本 ESM 分发文件；`public/ocr/` 包含 Worker、四种核心（含内嵌 WASM）、两个语言文件和 Apache-2.0 许可证。`public/icons/lucide.js` 为固定版本 Lucide 图标分发文件，包含 ISC 许可证。

资源约 21 MB（未压缩文件总量），Vite 将 public 文件带入 dist，Tauri 将前端资源内嵌到 EXE。无需运行时 CDN、旁置模型目录或用户安装 OCR；实际 EXE 增量需发布验证。当前没有改 package.json/package-lock.json，也没有本地安装 npm 包。

- `scripts/ocr-assets.json` 记录每个文件的版本 URL、SHA-256 和大小。
- `node scripts/prepare-ocr-assets.mjs --verify` 只读取项目文件，离线检查资源完整性。
- `node scripts/prepare-ocr-assets.mjs` 按固定 URL 重新获取并比对校验值，只写项目目录，不安装环境。
- `--record` 仅供明确升级或调整清单时更新校验值，不用于绕过完整性失败。
- CSP 仅允许本地脚本、Worker、WASM 和 IPC；前端不允许远程请求。HTTP 翻译由 Rust 执行。

## 隐私与渠道

图像及文字仅存在内存，不保存历史，不写普通配置或内容日志。用户须先在设置中同意文字上传；撤销授权取消尚未完成的任务。OCR 原文通过所选渠道发送，不能保证第三方不保留文字。已经发送的请求无法撤回。

OpenAI 使用独立系统密钥环保存地址、模型和 Key。前端只收到已配置状态；修改 origin 不能静默复用旧 Key。Google Free 采用 `translate_a/single?client=gtx`，是免 Key 客户端接口，不是官方有 SLA 的免费 OCR/翻译 API，可能限流、变更或网络不可达。失败不自动切换渠道。

马赛克不保证不可逆或完全无法识别。敏感内容必须由用户确认处理，OCR 不充当脱敏工具。

## 限制与后续验证

本阶段只完成代码与资源接入、静态审阅，没有执行构建、类型检查、测试、OCR、网络翻译或 Windows 运行验证。

需在 Windows 验证：

1. 单文件 EXE/MSI/NSIS 的本地 Worker、WASM、语言文件加载，确认断网时 OCR 不访问 CDN。
2. 英文、简中、混排、小字、透明背景与复杂底图识别；日/韩等其他源语种不在首版识别范围。
3. 100%/125%/150%/200% DPI、窗口留白、手动缩放和滚轮后的坐标同步。
4. 原图/译文、文字选择、跨行复制、文本视图滚动、最小 120x72 窗口和图标渲染。
5. 多贴图排队、识别中取消、初始化失败、关闭、快速重试、撤销授权和退出时资源释放。
6. Google 网络不可达/限流；OpenAI 兼容服务 JSON 输出、拒绝响应、额度/权限错误、自定义 HTTP 代理。
7. 普通截图保存/复制/贴图、快捷键与 NewAPI 同步/分组更新无回归。

覆盖是文字区域背景加译文，不是有道服务端译图或背景修复；旋转文字、多栏顺序和低质量图片不能保证准确。

## Windows.Media.Ocr（未采用）

Microsoft 文档规定桌面应用需 package identity；当前发布普通 EXE/MSI/NSIS，不具备 MSIX 身份。中文还依赖系统 OCR 语言包，因此本阶段不使用此 API。

参考：

- https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr
- https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/api.md
- https://github.com/naptha/tesseract.js/blob/v6.0.1/docs/local-installation.md
- https://github.com/naptha/tessdata
- https://github.com/Harukaon/Glance
