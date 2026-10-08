# Implementation Status

## 当前阶段

- 阶段：阶段 11，修复 Windows 空白窗口和控制台
- 状态：已完成
- 开始时间：2025-02-14
- 完成时间：2025-02-14
- 约束：只修改当前工作目录；不安装环境；不构建；不启动服务。
- 下一阶段：阶段 13，实际 CI runner 验证

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
4. 接入主页面同步和悬浮窗托盘流程的真实数据。
5. 在当前约束允许范围内进行静态审阅并更新本记录。

## 记录规则

每个阶段开始时将状态改为“进行中”，并记录目标与范围；完成时记录实际修改文件、行为变化和未执行的验证。新会话应先阅读本文件后继续。