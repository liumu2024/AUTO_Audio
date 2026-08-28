# 多模态智能视频创作平台

面向 AI 视频创作中多轮需求容易偏移、个人偏好与样片方法难复用、局部修改常需重做整案等问题，构建基于 LLM 决策的 Agent 视频创作平台，实现从自然语言与用户素材到可编辑时间线和最终视频的完整闭环。

## 核心能力

- **多轮需求对齐与可信执行**：通过创作总纲统一用户要求、素材事实、样片方法和镜头意图；方案创建与修改先形成可核对提案，再依据真实工具结果继续决策。
- **创作记忆与知识复用**：区分用户偏好、草稿偏好和通用创作方法，支持状态管理、来源追踪及按任务相关性检索，并以当前要求为最高优先级。
- **可编辑时间线**：将镜头、字幕、转场、素材和全局方向保存为版本化时间线；同镜头多项修改可联合规划、审查和保存，并保护授权范围外的内容。
- **低成本二次创作**：复用未变化的素材与 AI 镜头，只重新生成受影响内容；通过幂等、版本冲突保护和失败隔离控制重复执行。
- **多模态素材协同**：结合用户图片与视频、样例视频、AI 生成画面和程序化动效；支持参考图条件生成，而非仅将图片静态拼接。
- **混合渲染交付**：Seedance 负责动态镜头生成，Remotion 负责字幕、转场与程序化画面，FFmpeg 负责媒体标准化和最终封装。

## 工作流程

```text
自然语言 + 用户素材 + 样例视频
  -> Director Agent 理解需求并选择工具
  -> 创作摘要或修改提案
  -> 用户确认
  -> Planner 生成或修订可编辑时间线
  -> 结构校验、权限裁剪与结果审查
  -> 素材生成或复用
  -> Remotion + FFmpeg 合成
  -> MP4、版本记录与可追溯回执
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | TypeScript、React、Vite、Zustand |
| Agent 与服务端 | Express、Responses API、结构化输出 |
| 数据 | Prisma、PostgreSQL、pgvector |
| 视频生成 | Ark / Seedance |
| 视频合成 | Remotion、FFmpeg |
| 桌面端 | Electron |

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `backend/` | Director、Planner、素材理解、生成与渲染、创作记忆和知识库 |
| `fonted/` | 对话式创作工作区、可编辑时间线、素材与历史状态界面 |
| `shared/` | 前后端共享协议、时间线类型与校验逻辑 |
| `remotion/` | 视频 Composition 与程序化渲染组件 |
| `official-skills/` | 随仓库保留的 Remotion 官方参考资料；正式链只按注册表加载已启用部分 |
| `desktop/` | Electron 本地启动器 |

## 快速开始

### 安装

```powershell
npm.cmd install
npm.cmd --prefix backend install
npm.cmd --prefix fonted install
npm.cmd --prefix remotion install
npm.cmd --prefix backend run build:shared
npm.cmd --prefix backend run db:generate
```

复制并填写环境变量：

- `backend/.env.example` → `backend/.env`
- `fonted/.env.example` → `fonted/.env.development`

真实模型调用需要配置 Ark / Seedance 凭证。本地渲染需要 FFmpeg，以及 Remotion 可用的 Chrome 或 Chromium。

### 桌面开发模式

```powershell
npm.cmd run desktop:dev
```

桌面模式使用本地持久化，不要求预先启动 PostgreSQL 或 Redis。

### PostgreSQL 开发模式

日常启动只需在项目根目录运行：

```powershell
npm.cmd run server:dev
```

请先启动 Docker Desktop。该命令不调用 PowerShell 脚本，因此无需修改系统执行策略；它会启动 PostgreSQL 与 Redis、应用数据库迁移，并同时启动后端和前端。按 `Ctrl+C` 会停止前后端进程，数据库容器及其数据仍保留。

首次创建数据库后，另执行一次初始化数据：

```powershell
npm.cmd --prefix backend run db:seed
```

`db:seed` 用于空数据库初始化，也可在版本化 Seed 更新后重复执行；人工审核、修改或撤销的数据不会被覆盖。

停止数据库服务并保留数据：

```powershell
docker compose down
```

当前 `X-User-Id` 仅用于本地开发身份隔离，不是生产级鉴权；不要将开发服务直接暴露到公网。

## 说明

- 用户偏好与通用创作知识分别持久化管理，只有启用的偏好和已采纳的知识参与规划。
- 本地运行数据、上传素材、Trace、评测文件和临时构建产物不会提交到仓库；`shared/` 中供后端 NodeNext 使用的 JavaScript、类型声明和 source map 除外。
