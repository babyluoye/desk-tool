# Implementation Status

## 当前阶段

- 阶段：阶段 21，截图选区视觉调整
- 状态：已完成（静态审阅）
- 开始时间：本次会话
- 完成时间：本次会话
- 约束：只修改当前工作目录；不安装环境；不构建；不启动服务。
- 本阶段目标：未框选时显示原始屏幕亮度，已框选区域使用蓝色边框。
- 本阶段范围：仅截图覆盖层 CSS 与阶段记录。
- 下一阶段：在 Windows 实机目视验证选区边框和暗化效果。

### 阶段 21：截图选区视觉调整

状态：已完成（静态审阅）

目标与范围：

- 移除未开始选择时的全屏深色遮罩，保持截图画面原始亮度。
- 将选区描边从白色改为蓝色，保留选区外暗化以突出已选区域。
- 仅改截图 CSS 和本阶段记录；未构建、不测试、不运行。

已完成行为：

- 未开始框选时不再施加全屏深色伪元素遮罩，原始屏幕截图按其亮度显示。
- 开始框选后，选区仍保持正常亮度，选区外继续使用暗化阴影区分范围；选区描边及缩放手柄使用蓝色。

本阶段修改文件：

- `src/capture.css`
- `IMPLEMENTATION_STATUS.md`

静态审阅结果：

- 确认无选区的 `::before` 全屏遮罩规则已删除，选区外遮罩仍由 `.selection-box` 的 box-shadow 提供。
- 确认选区边框和缩放手柄主色为蓝色。
- `git diff --check` 通过。
- 未执行构建、测试或运行验证。

未决事项与限制：

- 蓝色线条的最终视觉粗细与对比度需在 Windows 实机确认。
- 未执行构建、测试或运行验证。

### 阶段 20：截图交互与快捷键设置

状态：已完成（静态审阅）

已完成行为：

- 截图网页清除 HTML 默认 margin/padding，关闭原生窗口阴影；捕获窗口按 Tauri 主显示器位置/尺寸进入原生全屏，减少边缘留白和左侧白条。
- 选区创建/拖动期间不显示操作按钮；鼠标松开后才确认选区，并在选区右边缘对齐的下方显示保存/复制操作，屏幕底边空间不足时翻到选区上方。
- 选区支持内部拖动整体移动，以及四条边、四角手柄拖拽缩放；选区坐标限制在视口内，右键/Esc 可取消。
- 设置页可录入 Ctrl/Alt + 字母/数字/F1–F12 组合键，默认 Ctrl+Shift+S，可恢复默认。录入期间临时注销系统快捷键以便 WebView 收到按键，失焦后恢复。
- 快捷键设置保存到既有系统密钥环安全快照；旧快照通过 Serde 默认值兼容。后端校验快捷键格式；先注册新快捷键再保存，冲突/存储失败保留旧设置。启动注册失败时仍可从工具集手动截图并显示提示。
- 截图捕获、文件对话框和快捷键插件的阻塞操作移到 blocking worker，避免阻塞 WebView/Tauri 主线程。

本阶段修改文件：

- `AGENTS.md`
- `IMPLEMENTATION_STATUS.md`
- `src-tauri/src/lib.rs`
- `src-tauri/src/models.rs`
- `src-tauri/src/screenshot.rs`
- `src-tauri/src/screenshot_shortcut.rs`（新增）
- `src-tauri/tauri.conf.json`
- `src/api.ts`
- `src/capture.css`
- `src/capture.ts`
- `src/domain.ts`
- `src/main.ts`
- `src/styles.css`

静态审阅结果：

- 检查截图窗口通过 primary monitor 的位置/尺寸配置后进入 fullscreen；页面 CSS 重置边距、padding 和窗口阴影，并用完整固定定位画布覆盖。
- 检查选区 create/move/resize 状态、四边/四角 hit target、pointer capture/lost capture 回滚、视口边界约束、按钮确认后显示和底部避让。
- 检查快捷键 input 录入、失焦恢复、默认值序列化兼容、前后端参数命名、注册冲突回退及应用主线程隔离。
- `git diff --check` 和 Tauri JSON 配置语法检查通过；Cargo Windows-only 依赖声明已人工核对。
- 未执行构建、测试、开发服务器或运行验证（遵循项目约束）。

未决事项与限制：

- 全屏/WebView 的 Windows 显示、每边缘手柄热区、DPI 映射、多显示器边缘和系统文件对话框置顶情况需目标 Windows 实机验证。
- 操作系统或其它应用占用快捷键时无法注册；可更换快捷键或使用工具集按钮。
- 快捷键可录入 Ctrl/Alt 加字母、数字或 F1–F12（可选 Shift）；不支持 Win/Meta、标点键和任意组合。
- 未执行构建、测试或运行验证。

### 阶段 19：修复截图构建错误

状态：已完成（静态审阅）

问题：

- `lib.rs` 的 Tauri command wrapper 与 `screenshot.rs` 中同名 command 宏生成相同的宏命名空间标识，导致 `__cmd__save_screenshot`、`__cmd__copy_screenshot`、`__cmd__cancel_screenshot` 重定义及 handler 歧义。
- `screenshot.rs` 调用 `AppHandle::emit`，但未导入 `tauri::Emitter` trait。

修复计划：

- 将截图模块里的保存、复制、取消逻辑改为非 command 的 `*_impl` 函数，保留 `lib.rs` command 作为唯一 Tauri 边界。
- 将截图模块三个重复的 Tauri command 实现改名为 `save_screenshot_impl`、`copy_screenshot_impl`、`cancel_screenshot_impl`，移除其 `#[tauri::command]` 属性；`lib.rs` 保留同名唯一 command wrapper 并转调实现函数。
- 导入 `tauri::Emitter`，使截图 ready/finished 事件调用可解析。

本阶段修改文件：

- `src-tauri/src/lib.rs`
- `src-tauri/src/screenshot.rs`
- `IMPLEMENTATION_STATUS.md`

静态审阅结果：

- 检查 `screenshot.rs` 的保存/复制/取消实现不再声明 `#[tauri::command]`，避免命令宏生成名冲突；command wrapper 和 invoke 注册名称保持不变，前端调用协议未变。
- 确认 `tauri::Emitter` 已导入，覆盖 `emit` 两处调用。
- `git diff --check` 通过。
- 未执行构建、测试或运行验证（遵循项目约束）。

### 阶段 18：Windows 区域截图工具

状态：已完成（静态审阅）

已完成行为：

- 应用默认打开“工具集”，区域截图作为独立 Windows 工具呈现；NewAPI 管理保留为辅助页面。
- Ctrl+Shift+S 全局快捷键和工具集按钮均可尝试启动区域截图；快捷键因其它应用占用时不阻断应用启动。
- 启动时截取主显示器并显示透明度遮罩覆盖层，支持鼠标拖选、区域预览、Esc/取消、保存 PNG 和复制至系统剪贴板。
- 保存时提供系统文件对话框；截图图片只在 Rust 进程内存中暂存，完成/取消后清除，不落盘、不记录日志。
- 截图窗口仅在 Windows 创建 command/state/依赖；非 Windows 工具集显示不可用提示。

本阶段修改文件：

- `AGENTS.md`
- `IMPLEMENTATION_STATUS.md`
- `src-tauri/Cargo.toml`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/error.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/screenshot.rs`（新增）
- `src-tauri/tauri.conf.json`
- `src/api.ts`
- `src/capture.css`（新增）
- `src/capture.ts`（新增）
- `src/entry.ts`
- `src/main.ts`
- `src/styles.css`

静态审阅结果：

- 对照 screenshots 0.8、image 0.24 和 arboard API 的图像类型/像素缓冲格式；确认使用 primary display 元数据定位截图窗口，并根据实际捕获图像与覆盖层 CSS 视口比例换算裁剪像素。
- 检查快捷键插件按键注册、Windows 条件依赖/command handler、截图窗口 label/hash 路由、Tauri invoke 参数 camelCase、工具集事件和截图完成清理路径。
- 检查截图输入有限值、正宽高、视口边界和裁剪图像边界；截图图像不写入普通配置、NewAPI 状态、日志或磁盘（用户保存操作除外）。
- `git diff --check` 通过。
- 未执行构建、打包、测试、开发服务器或运行验证（遵循项目约束）。

未决事项与限制：

- 第一版仅截取 Windows 主显示器，多显示器逐屏选择尚未支持；需 Windows 实机验证不同 DPI 缩放/显示器坐标下覆盖层覆盖与选区映射。
- `Ctrl+Shift+S` 若与其它应用快捷键冲突，会无法注册；应用仍可通过工具集按钮截图。
- 保存对话框、剪贴板和 WebView 覆盖窗口焦点行为需要 Windows 实机验证。
- 未执行构建、测试或运行验证。

### 阶段 17：GitHub Release 发布与 DeskTool 命名

状态：已完成（静态审阅）

已完成行为：

- GitHub 手动 Windows 构建不再上传 Actions Artifacts；构建后直接创建 GitHub Release。
- Release 名称/tag 格式为 UTC `Vyyyy-MMdd-HHmm`，例如 `V2026-0619-1427`；构建前预留 tag。Windows 安装包版本映射为合法三段数字版本：major=年份-2020、minor=月份、patch=(日期-1)*1440+当天分钟数，以便 Windows Installer 识别版本。
- 为避免并发/同一分钟运行覆盖 Release，工作流在构建前检查并原子预留 tag；遇到同名 tag 时等待下一 UTC 分钟。
- Release 附件包含 `DeskTool.exe`（独立运行文件）、MSI 安装包和 NSIS 安装 EXE；工作流检查三类产物存在后才发布。
- Tauri 产品名、主窗口/网页标题、托盘提示、前端品牌、NewAPI 请求 User-Agent、Cargo binary/package 与 npm package 名称统一为 DeskTool/desk-tool。
- Gitea workflow 不负责创建 Release，仍保留原 Artifacts 行为；为避免其构建因 Cargo binary 改名失败，已同步独立 exe 输出路径为 `desk-tool.exe`。

本阶段修改文件：

- `.github/workflows/build-windows-x64.yml`
- `.gitea/workflows/build-windows-x64.yml`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/newapi.rs`
- `src/main.ts`
- `src/window-controls.ts`
- `index.html`
- `package.json`
- `package-lock.json`
- `IMPLEMENTATION_STATUS.md`

静态审阅结果：

- 检查 GitHub workflow 无 Artifact 上传步骤；Release 文件来源明确为 `release-assets/*`。
- 对照 Tauri target/release 的 Cargo binary、MSI/NSIS bundle 目录和复制目标名称。
- 检查 release token 的 `contents: write` 权限、tag collision 检查/创建流程、UTC 格式化、Windows 包版本映射和 Tauri 配置版本注入步骤。
- 发布资产在上传前统一命名为 `DeskTool.exe`、`DeskTool-Installer.msi`、`DeskTool-Setup.exe`，不含 Artifact 上传步骤。
- 用例式范围检查版本映射：月份为 1–12、日期内分钟换算的 patch 不超过 44639，当前版本格式满足 Windows Installer 三段数字版本字段范围。
- 检查核心 UI 与 Tauri 显示名称引用、package-lock 根 package 名同步；内部系统密钥环服务标识和应用 bundle identifier 保持不变，避免更名导致用户现存凭证不可读。
- 未执行构建、打包、测试或运行验证（遵循项目约束）。

未决事项与限制：

- GitHub Release 需要仓库允许 Actions 使用 `GITHUB_TOKEN` 写入 contents/releases；仓库权限策略若禁用，发布步骤会失败。
- Release tag 时间取构建前版本分配步骤执行的 UTC 时间；同一分钟的并发或重复构建会排到下一分钟。若预留 tag 后构建失败，会留下无 Release 的 tag；Windows 安装包版本在 Tauri 配置中使用对应的合法数字版本。
- Windows MSI/NSIS 产物和独立 exe 文件名仍需首次 GitHub Actions 实际构建确认。
- Gitea 工作流仍上传原有 Artifacts，按本次确认范围仅调整可执行文件路径。
- 未执行构建或运行验证。

### 阶段 16：缓存 GitHub Actions 构建依赖

状态：已完成（静态审阅）

背景：

- Windows Tauri bundle 阶段每次从干净 runner 下载 Cargo crates 并重新编译，Rust target 目录未缓存。
- npm 安装没有锁文件，原先使用 `npm install`，依赖解析无法固定。

改动：

- GitHub Actions 使用 `Swatinem/rust-cache@v2` 缓存 `src-tauri -> target`，包含 Cargo registry/git 依赖和 Rust 构建产物；缓存共享键固定为 Windows x64 MSVC，工作流及 Cargo manifest 变化按 action 默认 key 机制刷新。
- 新增 `package-lock.json`，npm 依赖安装切换为 `npm ci`。
- `actions/setup-node@v4` 启用 npm 缓存，并根据 package-lock.json 生成依赖键。
- 仅改 GitHub workflow；Gitea workflow 保持不变。

本阶段修改文件：

- `.github/workflows/build-windows-x64.yml`
- `package-lock.json`
- `IMPLEMENTATION_STATUS.md`

静态审阅结果：

- 核对 Rust workspace 路径与 Tauri manifest 目录一致。
- 核对 npm 缓存依赖清单存在，`npm ci` 与锁文件配对。
- YAML 结构人工审阅；未运行 workflow、npm 构建或 Rust 构建。

未决事项与限制：

- 首次 GitHub Actions 运行需要建立缓存，后续同一分支/依赖键的运行才会命中。
- Rust cache 只能复用匹配 Windows runner、target、工具链和依赖配置的缓存；Cargo manifest/lockfile 变化会触发重新编译部分内容。
- 缓存命中不代表整个 Tauri bundle 都免耗时，应用本身仍需编译和打包。
- 未执行构建、测试或运行验证。

### 阶段 15：使用日志列表与关闭行为设置

状态：已完成（静态审阅）

已完成行为：

- 增加主窗口“菜单”下拉导航和窄屏工具栏，可进入令牌管理、使用日志或设置；托盘菜单新增“使用日志”，点击后恢复主窗口并打开日志页。
- 增加 NewAPI `GET /api/log/` 消费日志（type=2）只读分页请求，每页 50 条；页面展示时间、用户/令牌名称、模型、分组、额度、输入/输出 Token、耗时和流式标记。
- Rust API 边界只将日志白名单字段序列化给前端，不读取/返回 `content`、`other`、IP、请求 ID 或密钥；查询错误避免透传可能含敏感信息的服务端响应。
- 增加设置页面，关闭按钮可设置为隐藏到托盘或直接退出；设置写入系统密钥环中已使用的安全快照，旧快照缺字段默认为直接关闭，保留既有行为。
- Tauri 原生 CloseRequested 按设置隐藏窗口或允许退出；窗口关闭按钮 tooltip 同步展示当前关闭行为。

本阶段修改文件：

- `src-tauri/src/lib.rs`
- `src-tauri/src/models.rs`
- `src-tauri/src/newapi.rs`
- `src-tauri/capabilities/default.json`
- `src/api.ts`
- `src/domain.ts`
- `src/main.ts`
- `src/styles.css`
- `src/window-controls.ts`
- `IMPLEMENTATION_STATUS.md`

静态审阅结果：

- 对照 NewAPI 官方接口文档及当前主线 controller/model，确认管理员 `GET /api/log/` 使用 `p`、`page_size` 分页；仅查询消费类型日志。
- 检查 Rust 序列化日志模型白名单，不包含内容、额外字段、IP、请求 ID 或任何 API key。
- 核对 Tauri command 名称/参数与前端 invoke 调用、托盘菜单 ID 与导航事件、关闭事件设置读取以及旧快照 Serde 默认值。
- `git diff --check` 通过。
- 未执行构建、类型检查、测试、开发服务器或运行验证（遵循项目约束）。

未决事项与限制：

- 部署版 NewAPI 日志分页 data 结构和具体字段仍需目标实例验证；若部署定制版本字段不同，需调整日志适配器。
- NewAPI 日志查询需要管理权限；认证或权限不足时界面会提示通用错误。
- 未做筛选、排序或时间范围控件；当前提供按服务端最新时间排序的消费日志分页列表。
- 未执行构建、测试或运行验证。

### 阶段 14：修改分组时保留令牌其它属性

状态：已完成（静态审阅）

范围与根因：

- 已阅读 QuantumNous/new-api 主线 `controller/token.go` 的 `UpdateToken`、`GetToken` 和 `model/token.go` 的 `Update`，以及 token 路由。
- 普通 `PUT /api/token/` 会覆盖名称、过期时间、剩余额度、无限额度、模型限制、IP 限制、分组和跨分组重试；仅发送 id/group 会让遗漏字段被零值覆盖。
- 更新前读取 `GET /api/token/:id` 最新详情，完整保留普通编辑字段，只修改 group；读取失败或必要字段缺失时不发 PUT。
- 原 `unlimited_quota = true` 必须保留；详情不使用默认值填补，完整 key 不写入请求、缓存、日志或前端。

本阶段修改文件：

- `src-tauri/src/newapi.rs`
- `IMPLEMENTATION_STATUS.md`

已完成与静态审阅：

- 使用严格的 TokenGroupUpdate 输入/序列化模型，不为编辑字段设置缺省值；可空 allow_ips 也要求详情明确包含该键。
- 在 PUT 前 GET 最新详情并校验 id，使用白名单保留名称、过期时间、额度、无限额度、模型限制、IP 限制和跨分组重试，只替换 group。
- 不转发 key、user_id、用量、时间统计或 status；主线普通更新由服务端保留 status。
- 不提交 auto_groups，主线 auto 分组保留已有列表，非 auto 分组的跨组重试/自动分组清理由服务端实施。
- 详情缺失、类型不兼容或 id 不匹配时不发送 PUT；服务端失败时不修改本地缓存。
- 编写五个纯函数回归用例，覆盖有限/无限额度、空值/零值、缺字段、类型错误、id 不匹配和敏感字段排除；用例未执行。
- 已对照官方 controller 的普通赋值字段与 model 的 Select 更新列表；`git diff --check` 通过。

下一步与限制：

- 未执行构建、类型检查、测试或运行验证；需在实际部署版本确认 GET 详情与 PUT 字段兼容性。
- 主线 PUT 不支持只更新 group 的原子操作，GET 到 PUT 间的并发消耗/编辑仍有覆盖风险，需服务端提供 group 专用更新或版本条件才能彻底消除。
- 若旧版本已误清空名称或改变无限额度，需用户先在 NewAPI 后台恢复正确值，本次修改不会猜测历史配置。
- 本阶段仅修改上述两个文件，保留前一阶段未提交的窗口和托盘变更。

### 阶段 13：移除悬浮窗并改造主窗口

状态：已完成（静态审阅）

已完成行为：

- 删除悬浮窗及其窗口配置、刷新间隔、失焦透明度、跨窗口通知和前端模块。
- 主窗口最小宽度设为 200px，使用自定义标题栏，在最小化左侧提供置顶开关。
- 小于 300px 时以分组为主，保留紧凑令牌选择器；窗口标题使用所选令牌名称，不包含完整 API key。
- 显式设置系统托盘图标；最小化隐藏到托盘，点击图标或菜单恢复主窗口，提供退出菜单。
- 兼容旧安全缓存，不新增全局“当前令牌”持久化字段。

本阶段修改文件：

- `AGENTS.md`
- `IMPLEMENTATION_STATUS.md`
- `src/entry.ts`
- `src/floating.ts`（删除）
- `src/main.ts`
- `src/window-controls.ts`（新增）
- `index.html`
- `src/styles.css`
- `src/api.ts`
- `src/domain.ts`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/models.rs`
- `src-tauri/src/lib.rs`

静态检查结果：

- `src/` 与 `src-tauri/` 中无悬浮窗、刷新间隔、透明度或跨窗口通知残留；历史阶段记录保留。
- 窗口配置只保留 `main`，最小宽度为 200px；标题栏按钮固定在页面重绘区域之外。
- Tauri 配置和 capability JSON 语法有效，前端窗口操作已声明相应权限。
- 前端本地模块引用和四个 Tauri command 边界一致；HTML 标题栏无重复 ID。
- 旧快照字段由 Serde 默认忽略未知字段的行为兼容，不清空安全缓存。
- 手动同步和分组提交保留原有服务端优先逻辑；初次读取缓存及请求进行期间禁用数据操作。
- 标题更新串行化且失败不会无限重绘；置顶失败保留按钮原状态。
- `git diff --check` 通过；新增窗口控制文件无行尾空白。

未决事项与下一步：

- 未执行构建、类型检查、测试、开发服务器或运行验证。
- 在 Windows 重新构建后验证托盘图标显示、右键菜单、点击恢复、最小化隐藏、置顶和关闭退出。
- 在 Windows 验证无边框窗口边缘缩放、标题栏拖动/双击最大化、200px 最小尺寸和 300px 临界布局。
- 关闭按钮保持退出应用语义，最小化按钮隐藏到托盘；窗口选择与置顶状态不新增持久化配置。

### 阶段 12：修复生产入口资源加载

问题：

- `src/entry.ts` 使用变量动态导入主页面和悬浮窗模块；Vite/Rollup 无法稳定分析这种动态导入并为生产包生成可用的模块映射，Tauri 安装包启动后可能只显示空白页面。
- Vite 未显式配置相对资源基路径，桌面应用使用本地协议打开构建资源时，根路径资源引用可能无法加载。
- `SaveConnectionInput.admin_credential_configured` 只由前端传入，但 Rust 业务逻辑不读取，导致构建产生 `dead_code` 警告。

修复：

- 将入口改为基于 hash 的两个字面量动态导入，让 Vite/Rollup 能静态收集 `main` 和 `floating` 两个模块。
- 为 Vite 配置 `base: "./"`，使生产资源使用相对路径。
- 移除未使用的 `SaveConnectionInput.admin_credential_configured` 字段，并同步精简前端保存配置调用参数。

本阶段修改文件：

- `src/entry.ts`
- `vite.config.ts`
- `src/api.ts`
- `src/main.ts`
- `src-tauri/src/models.rs`
- `IMPLEMENTATION_STATUS.md`

本阶段静态检查：

- 已检查前端入口、Vite 配置、Tauri `frontendDist` 与窗口 URL 的一致性。
- 已确认保存配置调用与 Rust 输入模型字段一致。
- `git diff --check` 通过。
- 未执行构建、测试、开发服务器或运行验证；需要在 Windows CI runner 重新构建并安装后验证窗口内容。

## 已完成阶段

### 阶段 0：需求基线与协作约束

状态：已完成

已确认：

- 项目是 Rust + Tauri 2 桌面应用。
- 应用包含主页面和通过系统托盘打开的悬浮窗。
- 当前只管理一个 NewAPI 地址。
- 管理凭证与 API 令牌是两类不同的数据。
- API 令牌和分组从 NewAPI 服务端同步。
- 本地需要安全保存管理凭证和 API 令牌。
- 悬浮窗先选择一个 API 令牌，再选择一个分组。
- 选择分组后，使用管理凭证立即更新该 API 令牌的分组。
- 服务端更新成功后再更新本地缓存，失败时保留原数据并提示。
- 不存在“当前令牌”或“当前分组”的概念。

## 已完成阶段

### 阶段 1：建立项目骨架

状态：已完成

已完成：

- 创建 Tauri 2、Rust 和 TypeScript/Vite 的基础目录结构。
- 创建主页面和悬浮窗入口，悬浮窗使用 `index.html#floating` 独立渲染。
- 创建连接配置、API 令牌、令牌分组和同步结果的数据模型。
- 创建 `get_snapshot`、`save_connection`、`sync_from_newapi`、`update_token_group` 四个 Tauri command 边界。
- 管理凭证和令牌快照分别通过系统密钥环保存，不降级到明文文件。
- 主页面实现 NewAPI 地址、管理凭证配置、数据同步、令牌选择和分组更新界面。
- 悬浮窗实现“先选令牌，再选分组，再提交更新”的两步交互。
- 系统托盘菜单预留“打开悬浮窗”和“退出”操作。
- 更新令牌分组时，先调用服务端适配器，成功后才修改本地快照。

本阶段修改文件：

- `AGENTS.md`
- `IMPLEMENTATION_STATUS.md`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `index.html`
- `src/api.ts`
- `src/domain.ts`
- `src/main.ts`
- `src/floating.ts`
- `src/styles.css`
- `src-tauri/Cargo.toml`
- `src-tauri/build.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/models.rs`
- `src-tauri/src/error.rs`
- `src-tauri/src/storage.rs`
- `src-tauri/src/newapi.rs`

未完成或阻塞：

- 实际部署版本、凭证权限和主线 API 可能存在差异，需要在目标 NewAPI 实例上确认。
- 本阶段未执行构建、测试、开发服务器或运行验证。

## 已完成阶段

### 阶段 2：接入 NewAPI 管理接口

状态：已完成

已完成：

- 根据 NewAPI 官方文档和主线源码接入 `GET /api/token/?p=1&size=100`。
- 支持分页拉取令牌，直到拉完服务端返回的总数。
- 根据 NewAPI 返回的 `id`、`name`、`key`、`status`、`group` 等字段映射到本地模型。
- 令牌展示只保存和展示掩码值，不把完整令牌发送到前端状态。
- 接入管理员分组接口 `GET /api/group/`，将分组名称映射为本地分组 ID/名称。
- 接入令牌分组更新接口 `PUT /api/token/`，提交 `{ "id": <number>, "group": "<name>" }`。
- 统一处理 `{ success, message, data }` 响应和 HTTP/业务错误。
- 使用 `Authorization: Bearer <管理凭证>` 请求头；如果用户输入已包含 `Bearer `，不会重复添加。
- 同步时根据令牌 `group` 字段统计每个分组的令牌数量。
- 分组更新服务端成功后，更新本地令牌归属和分组计数。

本阶段修改文件：

- `src-tauri/Cargo.toml`
- `src-tauri/src/newapi.rs`
- `src-tauri/src/lib.rs`
- `IMPLEMENTATION_STATUS.md`

接口边界说明：

- NewAPI 主线的 `/api/token/` 由 `UserAuth` 保护，返回的是当前认证用户可见的令牌，不是管理员自动拥有的全量令牌列表。
- `/api/group/` 由 `AdminAuth` 保护，返回分组名称字符串数组。
- 当前应用将用户配置的“管理凭证”作为 HTTP 认证凭证；该凭证需要同时具备访问令牌接口和管理员分组接口的权限。
- 若实际部署的 NewAPI 使用了不同版本、定制路由或只能通过管理员界面读取其他用户令牌，需要再增加对应版本适配器。

本阶段未执行构建、测试、开发服务器或运行验证。

### 阶段 3：悬浮窗定时刷新

状态：已完成

已完成：

- 新增 `refreshIntervalSeconds` 应用设置，默认值为 10 秒。
- 主页面新增悬浮窗刷新间隔输入，允许设置 1 到 3600 秒。
- 修改并保存刷新间隔后，通过 `snapshot-updated` 事件立即通知悬浮窗。
- 悬浮窗收到间隔变更后立即刷新数据并重置定时器。
- 悬浮窗使用单次 `setTimeout` 调度，避免同步请求重叠。
- 已配置 NewAPI 时，定时刷新调用真实同步接口；网络失败时保留本地缓存并等待下一周期。
- 主页面同步、令牌分组更新、连接配置保存和刷新间隔变更均广播快照事件。
- 刷新间隔设置与令牌快照一起通过系统密钥环持久化。

本阶段修改文件：

- `src/domain.ts`
- `src/api.ts`
- `src/main.ts`
- `src/floating.ts`
- `src/styles.css`
- `src-tauri/src/models.rs`
- `src-tauri/src/lib.rs`
- `IMPLEMENTATION_STATUS.md`

本阶段未执行构建、测试、开发服务器或运行验证。

### 阶段 4：悬浮窗失焦透明度设置

状态：已完成

已完成：

- 新增 `inactiveOpacityPercent` 设置，默认 `70%`，旧版快照缺字段时自动使用该默认值。
- 主页面新增透明度滑块，范围 `20%` 到 `100%`。
- 滑块拖动时更新数值显示，并在短暂防抖后保存。
- 新增 `update_inactive_opacity` Tauri command，服务端校验范围并持久化设置。
- 设置保存后通过 `snapshot-updated` 事件立即通知悬浮窗。
- 悬浮窗使用 Tauri 窗口焦点事件检测激活状态；失焦时以 CSS opacity 应用设置，聚焦时恢复 `100%`。
- 启用悬浮窗透明背景，并覆盖 HTML/body 背景避免透明层被页面背景遮挡。
- 主页面和悬浮窗控件监听跨窗口事件时避免重绘正在操作的控件。

本阶段修改文件：

- `src/domain.ts`
- `src/api.ts`
- `src/main.ts`
- `src/floating.ts`
- `src/styles.css`
- `src-tauri/src/models.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `IMPLEMENTATION_STATUS.md`

本阶段未执行构建、测试、开发服务器或运行验证。平台原生透明窗口效果仍需在目标桌面环境验证。

### 阶段 5：Gitea Windows x64 构建工作流

状态：已完成

已完成：

- 新增 `.gitea/workflows/build-windows-x64.yml` 和 `.github/workflows/build-windows-x64.yml`。
- 两份工作流均仅支持手动触发 `workflow_dispatch`，不会因分支或标签推送自动构建。
- 构建目标固定为 `x86_64-pc-windows-msvc`。
- 在 Windows runner 上准备 Node.js 22 和 Rust stable/MSVC target。
- 使用 `npm install` 安装前端依赖。
- 使用 Tauri CLI 构建 Windows bundle。
- 上传 MSI、NSIS EXE 和 release executable 作为 Gitea Actions artifact。
- 未在本地安装依赖或执行 CI 构建。

前置条件：

- Gitea runner 必须是 Windows x64，并支持 `windows-latest` 标签；若实际 runner 使用其他标签，需要修改 `runs-on`。
- Runner 需要 Visual Studio Build Tools、MSVC、Windows SDK 和 WebView2 Runtime。
- `actions/checkout`、`actions/setup-node`、`actions/upload-artifact` 需要 Gitea Actions 对应的 actions 兼容配置。

本阶段修改文件：

- `.gitea/workflows/build-windows-x64.yml`
- `.github/workflows/build-windows-x64.yml`
- `IMPLEMENTATION_STATUS.md`

本阶段未执行构建、测试、开发服务器或运行验证。

### 阶段 6：修复 CI 中 Tauri 版本不一致

状态：已完成

问题：

- GitHub Actions 中 npm 实际安装了 `@tauri-apps/api 2.12.1`。
- Rust 侧 `tauri` 和 `tauri-build` 仍声明为 `2.0.0`。
- Tauri CLI 检测到 Rust crate 与 npm 包的 major/minor 版本不一致并终止构建。

修复：

- `@tauri-apps/api` 固定为 `2.12.1`。
- `@tauri-apps/cli` 固定为 `2.12.1`。
- Rust `tauri` 固定为 `=2.12.1`。
- Rust `tauri-build` 固定为 `=2.12.1`。
- 已静态确认项目中不再存在旧的 `2.0.0` Tauri 版本声明。

本阶段修改文件：

- `package.json`
- `src-tauri/Cargo.toml`
- `IMPLEMENTATION_STATUS.md`

本阶段未执行构建或测试；需要在 GitHub/Gitea Windows runner 上重新手动触发工作流验证。

### 阶段 7：修复前端 DOM 根节点空值收窄错误

状态：已完成

问题：

- GitHub Actions 的 TypeScript 构建报告 `app` 和 `root` 可能为 `null`。
- 初次判空之后的闭包函数中，TypeScript 未保留对原变量的非空收窄。

修复：

- 对 `main.ts` 和 `floating.ts` 的 DOM 根节点分别判空。
- 判空后赋值给独立常量，供渲染函数和事件回调安全引用。

本阶段修改文件：

- `src/main.ts`
- `src/floating.ts`
- `IMPLEMENTATION_STATUS.md`

本地未执行构建或类型检查；应重新手动运行 GitHub Actions 验证。

### 阶段 8：修复 tauri-build 依赖版本

状态：已完成

问题：

- CI 已通过前端 Vite 构建和 Tauri npm/Rust major-minor 检查。
- Cargo 依赖解析失败，因为 crates.io 没有 `tauri-build = 2.12.1`。
- Tauri 2.12.1 发布批次对应的 `tauri-build` 版本为 `2.7.1`。

修复：

- `tauri` 保持 `=2.12.1`，与 `@tauri-apps/api 2.12.1` 的 major/minor 对齐。
- `tauri-build` 改为已发布的 `2.7.1`，使用兼容的宽版本约束。

本阶段修改文件：

- `src-tauri/Cargo.toml`
- `IMPLEMENTATION_STATUS.md`

本地未执行构建或测试；需要重新手动运行 GitHub Actions 验证。

### 阶段 9：修复 Windows 构建图标缺失

状态：已完成

问题：

- Tauri Windows 构建需要 `src-tauri/icons/icon.ico`。
- 仓库没有图标文件，`tauri-build` 在生成 Windows Resource 文件时失败。

修复：

- 新增 `scripts/generate-icon.ps1`，使用 PowerShell 标准库生成最小 32x32 ICO 文件。
- `tauri.conf.json` 配置 `icons/icon.ico`。
- GitHub Actions 和 Gitea Actions 均在 Tauri 构建前生成图标。
- 不依赖 ImageMagick 等额外图像工具，也不需要提交二进制图标。

本阶段修改文件：

- `scripts/generate-icon.ps1`
- `src-tauri/tauri.conf.json`
- `.github/workflows/build-windows-x64.yml`
- `.gitea/workflows/build-windows-x64.yml`
- `IMPLEMENTATION_STATUS.md`

本地未执行构建；需要重新手动运行 GitHub Actions 验证。

### 阶段 10：修复 Rust HTTP 响应类型错误

状态：已完成

问题：

- `reqwest::RequestBuilder::send().await` 返回 `reqwest::Response`。
- `newapi.rs` 错误地将请求链直接声明为 `ApiResponse<T>`，导致 `?` 报 `E0308` 类型不匹配。
- Tauri 托盘 API `menu_on_left_click` 同时产生弃用警告。

修复：

- 先接收 `reqwest::Response`，再传入 `parse_response` 解析为 `ApiResponse<T>`。
- 替换为 `show_menu_on_left_click`。

本阶段修改文件：

- `src-tauri/src/newapi.rs`
- `src-tauri/src/lib.rs`
- `IMPLEMENTATION_STATUS.md`

本地未执行构建或测试；需要重新手动运行 GitHub Actions 验证。

### 阶段 11：修复 Windows 空白窗口和控制台

状态：已完成

问题：

- `index.html` 依赖内联脚本根据 hash 加载入口，生产包 CSP 会阻止内联脚本执行，导致空白窗口。
- 新增的 `src/entry.ts` 尚未接入 HTML。
- Windows release 没有声明 GUI subsystem，启动时会额外显示控制台窗口。

修复：

- `index.html` 改为引用外部 `/src/entry.ts` 模块，保持 CSP 不放宽。
- `src/entry.ts` 根据 `#floating` 动态加载主页面或悬浮窗模块。
- `src-tauri/src/main.rs` 增加 `windows_subsystem = "windows"`，release 不再显示终端窗口。

本阶段修改文件：

- `index.html`
- `src/entry.ts`
- `src-tauri/src/main.rs`
- `IMPLEMENTATION_STATUS.md`

本地未执行构建或运行验证；需要重新手动运行 GitHub Actions。

## 待确认事项

- 实际部署的 NewAPI 版本是否与当前主线 API 一致。
- 管理凭证是否确实可以访问 `/api/token/`，并代表需要管理的令牌所属用户。
- 若要管理其他用户令牌，需要目标用户 ID 和对应管理员令牌管理接口；当前主线未发现管理员全量令牌接口。
- 本地系统密钥环在目标 Linux 发行版上的可用性。

## 后续阶段

1. 在目标 NewAPI 实例上确认版本、凭证权限和返回字段。
2. 根据实际部署差异补充兼容适配。
3. 完善令牌敏感值的安全保存与脱敏映射。
4. 在 Windows 上验证主窗口缩放、置顶与最小化到托盘的真实交互。
5. 在当前约束允许范围内进行静态审阅并更新本记录。

## 记录规则

每个阶段开始时将状态改为“进行中”，并记录目标与范围；完成时记录实际修改文件、行为变化和未执行的验证。新会话应先阅读本文件后继续。