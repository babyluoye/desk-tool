# AGENTS.md

## 项目说明

DeskTool 是 Rust + Tauri 2 桌面应用，提供 NewAPI 令牌分组管理、Cloudflare DNS 管理，以及通用主窗口和系统托盘功能。

- 主页面管理一个 NewAPI 地址和独立管理凭证；管理凭证与 API 令牌不可混用。
- API 令牌和分组从 NewAPI 服务端同步，本地安全快照作为缓存。更新分组时服务端优先；仅服务端成功后更新本地状态。
- Cloudflare DNS 是独立工具：单独设置 Cloudflare API Token，管理该 Token 可访问的 Zone 内 DNS 记录，不创建或删除 Zone。
- Cloudflare Token 使用独立系统密钥环条目；请求仅由 Rust 后端访问固定 Cloudflare API origin，Zone/记录按需加载、不持久化。
- 主窗口支持置顶，最小宽度 200px；窄窗口标题显示所选令牌名称而非 API key。最小化/关闭到系统托盘及恢复/退出是通用外壳功能。
- 所选令牌和分组只作为页面临时交互状态，不持久化为全局当前选择。

## 工作边界

- 只在当前工作目录内读取、创建和修改项目文件。
- 不修改当前工作目录之外的任何文件。
- 不安装、升级或配置 Rust、Node.js、Tauri、系统库或其他开发环境。
- 不启动开发服务器。
- 不执行项目构建或打包。
- 不调用 `cargo build`、`cargo check`、`cargo test`、前端构建命令或 Tauri 构建命令。
- 不为了验证而改变系统配置、环境变量或全局缓存。

## 开发流程

1. 需求不明确时，先整理理解并提出必要问题。
2. 在开始编码前，说明实现范围、数据模型和关键交互。
3. 优先遵循项目已有的目录结构、技术选型和代码风格。
4. 修改前先阅读相关文件，避免覆盖用户已有改动。
5. 修改保持聚焦，不进行无关重构。
6. 完成后进行静态代码审阅，说明未执行构建和运行验证。

## 数据与安全

- 管理凭证和 API 令牌必须使用独立的数据模型、字段和界面区域。
- 敏感信息不得写入日志、错误提示、提交信息或普通明文配置。
- API 令牌和管理凭证在界面中默认脱敏显示。
- NewAPI 服务端是令牌和分组的权威数据源，本地数据作为安全缓存使用。
- 修改令牌分组时遵循服务端优先：服务端成功后才更新本地缓存。
- 网络错误、认证失败和服务端拒绝必须保留原数据并返回可理解的错误信息。

## 代码规范

- 保持 Rust、Tauri 和前端代码的职责边界清晰。
- Tauri command 负责跨端边界，业务逻辑应尽量放在可独立测试的模块中。
- 对外部输入进行校验，尤其是 NewAPI 地址、管理凭证、令牌标识和分组标识。
- 错误处理应保留上下文，但不得泄露敏感凭证或完整令牌。
- 使用 ASCII 作为默认文件字符集；只有确有必要时才引入非 ASCII 内容。
- 注释只用于解释非显而易见的设计或复杂逻辑，避免重复代码含义。

## 阶段记录

- 使用根目录的 `IMPLEMENTATION_STATUS.md` 记录每个实现阶段。
- 每次开始或完成一个阶段时，更新阶段状态、修改文件、未决事项和下一步计划。
- 新会话开始时，先阅读 `AGENTS.md` 和 `IMPLEMENTATION_STATUS.md`，再继续编码。

## 验收说明

由于当前工作约束禁止构建和运行验证，完成修改后应提供：

- 修改文件列表。
- 主要行为变化。
- 静态检查结果或检查范围。
- 明确说明未执行构建、测试和运行验证。

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `babyluoye/desk-tool` using `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository; read the root `GLOSSARY.md` and relevant ADRs in `docs/adr/` when present. See `docs/agents/domain.md`.
