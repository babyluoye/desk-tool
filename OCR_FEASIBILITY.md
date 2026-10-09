# OCR Feasibility

## 结论

贴图上的文字可以实现选中和复制，但当前项目还不适合直接接入 Windows 原生 OCR。推荐后续优先评估本地化的 Tesseract.js；如果愿意改成带 package identity 的 MSIX 发布，再评估 Windows.Media.Ocr。

## 需求拆分

“直接选中复制”不是只有 OCR 识别：

1. 识别贴图中的文字。
2. 为每个单词或文字行保留图片坐标。
3. 在贴图上叠加透明文字层，使鼠标可以选中。
4. 处理文字层和贴图拖动、窗口缩放之间的坐标映射。
5. 复制选中文字，并在识别失败时仍允许普通图片拖动。

当前贴图是无标题栏、可拖动、可缩放的置顶窗口，因此需要增加“移动贴图”和“选择文字”两种交互模式，避免文字选择手势误触发窗口移动。

## Windows.Media.Ocr

Windows 的 `Windows.Media.Ocr.OcrEngine` 可以识别图片文字，并返回按行/单词组织的结果；`OcrWord.BoundingRect` 可提供单词的图像坐标。中文识别依赖设备已安装的 OCR 语言包。

限制：Microsoft 文档说明 `Windows.Media.Ocr` 只支持带 package identity 的桌面应用。当前 DeskTool 的 Windows 工作流发布 MSI、NSIS 和普通 EXE，没有 MSIX package identity。直接接入会使开发环境和发布方式增加额外前置条件，不能仅通过增加一个 Rust 依赖完成。

如果以后切换到 MSIX：

- Rust 侧需要调用 Windows Runtime OCR API。
- 需要检查系统可用语言，中文不可用时给出明确提示。
- 需要将 OCR 的物理像素坐标映射到贴图 WebView 的逻辑像素坐标。
- 仍然需要前端透明文字选择层和拖动/缩放模式切换。

参考：

- https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr?view=winrt-26100
- https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrword.boundingrect?view=winrt-26100
- https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.availablerecognizerlanguages?view=winrt-26100

## Tesseract.js

Tesseract.js 在浏览器 Web Worker 中运行 WASM OCR，`worker.recognize` 可以返回文字及识别区域；适合在不改变 Windows 打包身份的情况下探索。中文需要额外的 `chi_sim` 或 `chi_tra` traineddata。新版默认只返回纯文字，必须显式开启 `blocks`（或 hOCR/TSV）输出，再解析单词/行的 bounding boxes，不能假定每次调用直接提供 `data.words`。

为实现完全离线识别并减少供应链依赖，建议将 worker、WASM 核心和语言数据作为应用资源打包，不依赖运行时 CDN 下载。下载公开的模型文件不等于上传截图，但仍需逐项核对引擎没有传输截图或识别文本的行为。这样会增加安装包大小和首次识别内存/耗时；OCR 应在后台 worker 中执行，并提供识别中的状态。

风险：

- 中英文混排、小字号、低分辨率和复杂背景的准确率需要实机评估。
- CSP 需要允许本地 worker/WASM 的实际加载方式，不能为了方便直接放宽为任意远程脚本。
- 识别结果的坐标和文字层在窗口缩放、DPI 变化、滚轮缩放后必须同步。
- WASM OCR 不是敏感信息脱敏方案，马赛克仍需由用户主动绘制。

参考：

- https://github.com/naptha/tesseract.js
- https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md
- https://github.com/naptha/tesseract.js/blob/master/docs/api.md

## 推荐后续实现

先在独立实验分支中引入本地 Tesseract.js 资源，仅支持英文和简体中文测试：

- 增加“识别文字”按钮，识别完成后显示可切换的文字选择模式。
- 仅对最终含标注的贴图 PNG 识别，不访问标注前的原始截图；避免从被遮挡前的原图恢复文字。马赛克本身不保证不可逆，应明确其脱敏局限。
- 识别结果保存为内存中的文字及 normalized bounding boxes，不写配置、不写日志、不上传。
- 共享或限制 OCR worker 数量，避免为最多 16 张贴图各自启动重型识别实例；关闭后清理图片任务与结果。
- 文字模式下允许拖选文字、Ctrl+C 复制；移动模式下保持当前拖动贴图行为。
- 贴图窗口滚轮缩放时同时更新文字层的 CSS 尺寸和坐标，计入 object-fit: contain 的实际显示区域与留白偏移；旋转文字需单独校正坐标和阅读顺序。
- 首版按单词/行选择，字符级选取和复杂版式的阅读顺序准确性不能仅凭单词框保证；中文混排和跨行复制需专项验证。
- 若 OCR 失败、语言包缺失或资源加载失败，贴图仍保持普通图片功能。

在确认安装包大小、中文准确率和 Windows DPI 行为后，再决定是否正式加入主流程，或改用 MSIX + Windows.Media.Ocr。

本次仅完成可行性探索，没有引入 OCR 依赖、下载语言模型或修改 OCR 运行逻辑。
