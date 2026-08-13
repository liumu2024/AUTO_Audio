# V2 Agent 评测包

这里是当前唯一正式评测入口。数据源、冻结数据、运行器和指标定义放在同一模块中；历史 `backend/evals/v2-agent` 与旧 formal runner 不再作为成绩来源。

## 目录

- `datasets/source/`：可长期追加的人工可读数据源。新增场景时修改这里。
- `datasets/frozen/current.v1.json`：构建后冻结的单一数据集，包含源文件 SHA256、统计和 Provider 预算。
- `src/build.ts`：校验、冻结并生成数据集 hash。
- `src/run.ts`：按 profile 执行并生成一份 JSON 与一份 Markdown 报告。
- `src/media-evaluation.ts` / `src/sample-evaluation.ts`：分别量化真实图片像素与真实样例视频的语义理解。
- `src/score.ts`：统一处理 0/1、比例、连续均值、计数和 0–10 评分，并执行硬门禁。
- `tests/smoke.ts`：评测包自身的契约测试。
- `reports/`：运行结果，已加入 `.gitignore`，不参与后续正式成绩。

## 使用

在 `backend` 目录运行：

```powershell
npm.cmd run eval:v2:build
npm.cmd run eval:v2:run -- --profile deterministic
npm.cmd run eval:v2:run -- --profile live
npm.cmd run eval:v2:run -- --profile stability
```

默认及 live/stability 均禁止视频生成 Provider。`live` 调用 Director、Planner、图片理解与离线回复 Judge，但 `V2_VIDEO_GENERATION_PROVIDER=none`；`stability` 只对 manifest 中列出的关键 case 连续运行三次。
报告同时记录 Git commit、工作树是否干净和 diff hash；live、stability、canary 在启动前要求 clean worktree，结束时再次核对 commit 与 diff hash，避免先产生 Provider 费用再失败，或把混合代码结果归到错误 commit。

局部修订评测遵循正式 UI 的两阶段协议：首轮只收集并持久化 `timeline.patch` 提案，确认没有 Tool 提前执行后，运行器才模拟同一用户点击“确认执行”，并以确认后的真实 revision、Receipt 和 Trace 计分。只有 case 明确期望 `timeline.patch` 时才会确认；意外提案不会被评测器自动批准。修改与正式渲染仍是两个独立用户意图，评测数据不会用一次确认同时授权高成本渲染。

少量真实成片只能显式执行：

```powershell
npm.cmd run eval:v2:run -- --profile canary --allow-provider
```

canary 当前最多产生 5 个不同 RenderRun，并在真实 Provider adapter 外层同时硬限制 20 次生成尝试和 60 个目标生成秒；素材复用命中不会消耗生成预算，超过任一预算会在调用 Provider 前拒绝并阻断报告。这里的“目标生成秒”是请求镜头时长，不冒充 Provider 最终账单。没有 `--allow-provider`、真实 Seedance 配置或全部预期 RenderRun 成功时，canary 都不会报告通过。人工评分复制 `manual-ratings.example.json`，再通过 `--ratings <file>` 传入；成片评分必须用 `renderIndex` 绑定本次报告中的成功 RenderRun 和实际文件，方案、回复等评分必须用 `runIndex + turnIndex` 绑定本次 Trace。未提供的主观指标显示为“未评分”，不会计为 0。

付费 canary 建议先只执行并保存报告，再人工查看成片填写评分，最后离线附加评分：

```powershell
npm.cmd run eval:v2:score -- --report evaluation/reports/<canary>/report.json --ratings evaluation/datasets/source/manual-ratings.local.json
```

评分入口默认读取基础报告同目录保存的 `dataset.json`，先核对基础 `report.sha256`、数据集 hash、正式报告结构和 Git 来源，再核验既有 Trace、RenderRun 和产物哈希，输出到 `<canary>/scored/`；它不会调用 Director、Planner、Tool、Remotion 或 Seedance，也不会修改原始报告。成片指标必须绑定成功 RenderRun，方案、样例方法和参考运用指标必须绑定对应 `runIndex + turnIndex` 的 Trace。派生报告继承基础报告的发布阻断状态，阻断报告仍返回非零退出码。需要使用其他冻结集时可显式传 `--dataset`。这些 hash 用于防止误用和发现文件变化，不冒充能够抵抗拥有本机文件写权限的恶意篡改。

## 数据扩展规则

1. 新 case、query、图片或样例 task 的 ID 在对应冻结目录内唯一。
2. case 必须声明它衡量的 `metricIds`；未知指标构建失败。
3. 图片和样例视频必须位于仓库内，构建时记录内容 SHA256，素材被替换后数据集 hash 会变化。
4. canary 必须声明预期 RenderRun 数；运行时同时限制实际唯一 RenderRun、Provider 提交数和目标生成秒数，不能只靠数据集声明控制成本。
5. 确定性断言使用 0/1；比例指标保留微平均点估计，并以修订轮、图片、检索 query 或样例视频为独立单位做聚类 bootstrap 95% 区间；nDCG 等连续量只报告均值；回复与成片质量使用带 0/2/5/8/10 锚点的 0–10 人工评分。
6. 不用一个总分掩盖失败。报告分别给出执行有效性与质量资格：确定性失败、任务未完成、硬门禁和来源异常都会阻断正式发布，但不被误称为“安全失败”；核心可编辑方案与图片指标按 profile 的显式最低线判定质量是否达标，主观 Judge 不作为隐藏门禁；目前仅 2 个样例视频，样例指标只报告，不作为质量门槛，扩充多题材样例后再启用。
7. `failure-ledger.v1.json` 与 `review-rules.v1.json` 保存失败根因和反向用例，但不参与成绩计算。

长期记忆检索集目前是明确标注为 `synthetic` 的开发基准：20 条记忆在旅行、学术宣传、产品展示三个草稿中平衡 user/draft 作用域与 active/candidate/revoked 状态，25 个查询覆盖单项、多项、跨草稿、撤销、无关对话和主题相近干扰。数据集保存构造方法、相关度标注规则，并为每个 query 保存 `rationale`；3 表示直接满足、2 表示相关但次要，`forbiddenKeys` 表示因撤销或作用域必须排除。它足以检验确定性 Top-K 和隔离边界，但不等同于真实业务分布，后续可在同一协议中追加匿名真实查询。

## 当前覆盖与限制

当前冻结集覆盖：对话与要求账本、文本/图片/样例/混合创作、字幕/镜头/结构/转场/全局方向修订、失败恢复、工具回执、用户偏好、Top‑K 检索、幂等、Remotion 工程链和 UI 状态边界。

图片像素集目前包含 12 个仓库样本，覆盖自然景观、交通、城市、商品展台、科幻几何、抽象视觉、人物、传统服饰和幻想主体。其中 5 个水印或棋盘格样本不被排除，作为盲测干扰子集：提示不告知干扰类型，只有主体与环境金标全部提取正确才计入 `image_interference_robustness_rate`。该指标不冒充判断水印是否会被用于后续剧情；普通幻觉禁止项仍由 `image_hallucination_avoidance_rate` 单独报告。运行器同时验证真实像素已附加、事实提取、服务端 ID 绑定和条件生成规划。样例视频集仍直接分析现有 2 个风景类仓库视频，重点区分其表现方法、时间证据和可迁移知识，而非按题材数量计分。现有图片仍不足以证明室内、文字密集和低光素材的泛化能力。正式付费生成或公开交付前仍需由用户确认素材授权；评测入集本身不等同于已取得商用授权。

评测数据本身使用版本化 JSON 和 SHA256，不需要新建业务数据库。只有以后要多人标注、权限管理或跨版本查询海量结果时，才有必要单独建设评测数据库；当前直接引入会增加维护成本而没有收益。
