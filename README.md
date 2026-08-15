# 多模态智能视频创作平台

一个面向多轮 AI 视频创作的可编辑 Agent 平台。系统把自然语言、图片素材和样例视频转换为版本化时间线，支持持续修改、AI 镜头生成、程序化合成、失败恢复与可追踪评测。

当前主链以 `RemotionTimelineSpecV1` 为唯一交付协议：Seedance 等视觉模型负责生成真实动态镜头，Remotion 负责字幕、转场、覆盖层和确定性时间线合成，FFmpeg 负责媒体标准化与最终封装。

## 核心差异

- **先规划、再确认、后执行**：首次创作和方案修订都先生成可审查提案；高成本生成与渲染只有在用户明确确认后才执行。
- **版本化可编辑方案**：镜头、字幕、转场、素材和创作总纲保存在统一时间线中；局部修改经过作用域合并和结果审查，非目标内容保持不变。
- **真实工具回执**：用户回复以服务端实际执行结果为事实来源；模型只负责自然组织表达，不能把失败改写成成功。
- **素材知识迁移**：图片既参与语义理解，也作为条件生成的真实输入；样例视频提取内容、表现方法、时机依据和可迁移知识，而不是机械复刻分段。
- **长期创作上下文**：区分用户个人偏好与普适创作知识，支持候选、启用、撤销、来源追踪及按任务检索。
- **低成本二次创作**：生成请求使用幂等记录；未变化的 AI 镜头按请求指纹、文件哈希和媒体可读性校验后复用，只重新生成受影响镜头。
- **混合渲染交付**：用户素材、AI 视频、程序化画面、字幕和转场在同一时间线中合成，避免让单一生成模型承担全部工作。
- **可量化评测**：评测包覆盖对话决策、方案生成、局部修改、图片理解、样例理解、偏好检索、幂等、渲染和 UI 边界。

## 创作链路

```text
自然语言 + 图片素材 + 样例视频
  -> Director Agent 理解意图与选择工具
  -> 首次创作摘要 / 修改提案
  -> 用户确认
  -> Planner 生成或修订 RemotionTimelineSpecV1
  -> 结构校验 + 作用域合并 + 结果审查
  -> 素材解析与 AI 镜头生成/复用
  -> FFmpeg 标准化
  -> Remotion 完整时间线合成
  -> MP4 + Trace + 版本化执行记录
```

文本、图片和样例不是互斥分支。用户可以从纯文本开始，之后继续添加图片或样例；所有新方案都通过创作总纲统一方向、图片观察事实、样例方法和实际采用的偏好。

## 当前能力

| 领域 | 已实现 |
| --- | --- |
| Director Agent | 多轮意图理解、工具选择、执行前确认、自然终态回复、工作区冲突恢复 |
| 可编辑时间线 | 镜头、字幕、转场、素材、音频、全局创作方向及版本历史 |
| 局部修改 | 字幕、镜头内容、视觉策略、结构、转场和全局总纲修订；非目标对象受保护 |
| 多模态素材 | 图片像素理解、条件视频生成、样例视频方法提取、素材身份与依赖闭包 |
| 生成与渲染 | Seedance 适配、AI 镜头复用、FFmpeg 标准化、Remotion 完整合成 |
| 执行安全 | readiness 预检、幂等请求、版本冲突保护、真实取消状态、失败修订门禁 |
| 记忆与知识 | 用户/草稿偏好、普适创作知识、状态管理、BM25 检索、来源与采用记录 |
| 评测 | 冻结数据集、确定性/在线/稳定性/少量付费成片 profile、离线人工评分 |

## 技术栈

- TypeScript、React、Vite、Zustand
- Express、Prisma、PostgreSQL（服务器模式）
- OpenAI Responses API 兼容的结构化模型调用
- Ark / Seedance 视频理解与生成
- Remotion、FFmpeg
- Electron 桌面壳

## 目录

| 路径 | 职责 |
| --- | --- |
| `backend/` | Director、Planner、素材分析、时间线服务、生成/渲染、记忆、知识和评测 |
| `fonted/` | React 编辑器、对话工作区、时间线编辑、素材与历史运行状态 |
| `shared/` | 前后端共享协议、时间线类型、校验器和确定性工具 |
| `remotion/` | 最终时间线 Composition 与程序化画面组件 |
| `desktop/` | Electron 本地启动器，不承载视频业务逻辑 |

## 快速开始

### 1. 安装依赖

```powershell
npm.cmd install
npm.cmd --prefix backend install
npm.cmd --prefix fonted install
npm.cmd --prefix remotion install
npm.cmd --prefix backend run build:shared
```

本地真实渲染还需要可用的 FFmpeg，以及 Remotion 可使用的 Chrome/Chromium。

### 2. 配置环境变量

参考：

- `backend/.env.example`
- `fonted/.env.example`

真实模型调用至少需要在 `backend/.env` 配置 Ark/Seedance 密钥。需要让外部生成服务读取本地上传图片时，还应配置公网可达素材地址或 TOS 发布器。不要提交真实密钥。

### 3. 启动桌面开发模式

```powershell
npm.cmd run desktop:dev
```

桌面模式默认启动：

- Backend：`http://127.0.0.1:3001`
- Frontend：`http://127.0.0.1:5173`

该模式使用本地持久化实现，不要求先启动 PostgreSQL、Redis 或独立 Worker。

仅检查启动：

```powershell
$env:DPL304_DESKTOP_SMOKE_MS='8000'
npm.cmd run desktop:dev
```

### 4. 服务器式开发

需要 PostgreSQL 持久化时：

```powershell
.\script\docker\db-up.ps1
npm.cmd --prefix backend run db:generate
npm.cmd --prefix backend run db:push
npm.cmd --prefix backend run dev
npm.cmd --prefix fonted run dev
```

## 关键环境配置

```env
# Director / 图片和样例理解
ARK_API_KEY=...
VIDEO_UNDERSTANDING_MODEL=doubao-seed-2-0-lite-260428

# AI 视频生成
V2_VIDEO_GENERATION_PROVIDER=ark-seedance
V2_VIDEO_GENERATION_API_KEY=...
V2_VIDEO_GENERATION_MODEL=doubao-seedance-1-5-pro-251215

# Remotion / FFmpeg
# FFMPEG_BIN=C:\path\to\ffmpeg.exe
# REMOTION_BROWSER_EXECUTABLE=C:\path\to\chrome.exe
```

素材发布和其他运行配置示例见 `backend/.env.example`。

## 验证与评测

V2 基础构建与时间线 smoke：

```powershell
npm.cmd run v2:check
```

构建并运行冻结评测集：

```powershell
npm.cmd --prefix backend run eval:v2:build
npm.cmd --prefix backend run eval:v2:run -- --profile deterministic
```

其他评测 profile：

- `live`：运行真实 Director、Planner、图片和样例理解，但禁止视频生成 Provider。
- `stability`：对关键场景重复运行，检查结果稳定性。
- `canary --allow-provider`：少量真实视频生成；有 RenderRun 数量、Provider 提交次数和目标生成秒数上限，会产生实际费用。

付费 canary 完成后可离线追加人工评分，不会再次调用模型或重新生成视频：

```powershell
New-Item -ItemType Directory -Force backend/evaluation/reports | Out-Null
Copy-Item backend/evaluation/datasets/source/manual-ratings.example.json `
  backend/evaluation/reports/manual-ratings.local.json
# 查看成片和 Trace 后填写 reports/manual-ratings.local.json，再执行：
npm.cmd --prefix backend run eval:v2:score -- `
  --report evaluation/reports/<canary>/report.json `
  --ratings evaluation/reports/manual-ratings.local.json
```

评测说明见 [backend/evaluation/README.md](backend/evaluation/README.md)。

## Trace 与运行产物

默认 Trace 位于：

```text
backend/tmp/v2-traces/
  sessions/<workspace>/operations/<operation>/
  tasks/<taskId>/
```

常见可清理产物：

- `fonted/dist/`
- `backend/tmp/`
- `backend/uploads/`
- `backend/renders/`
- `backend/v2-renders/`
- `remotion/public/render-lab-cache/`

不要直接删除 `shared/**/*.js`、`shared/**/*.d.ts` 及其 map；后端 NodeNext 运行时会消费这些生成文件。需要更新时运行：

```powershell
npm.cmd --prefix backend run build:shared
```

## 已知边界

- 当前只复用未变化的 AI 镜头，Remotion 最终 MP4 仍完整重新合成；分段渲染缓存尚未进入生产。
- 局部修订当前仍由完整候选方案、服务端作用域合并和完整 revision 保存完成；`revision fragment` 尚未实施。
- Provider 已进入提交中或状态未知时，系统会让当前 Run 失败并停止交付，但不能虚假承诺第三方任务已经停止。
- 后台 Worker、跨进程租约恢复和严格远程取消仍是后续能力。
- 样例理解评测当前样本量有限，因此只报告结果，不作为正式质量发布门槛。
