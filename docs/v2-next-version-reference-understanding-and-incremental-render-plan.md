# V2 下一版本：参考理解、创作知识与局部二次渲染计划

状态：P0 已实现并通过合并验证；P1/P2 与 revision fragment 按门槛延期

更新时间：2026-08-11

## 1. 目标与边界

本计划覆盖六个已经确认的问题，但按发布必要性分为 P0 与 P2；P0 构成本轮交付，P2 只有在前置质量或性能数据达到门槛后才独立实施：

1. 图片素材既要被理解为可迁移特征，也必须保留原图并作为视频生成模型的真实参考输入，不能只靠文字重新想象。
2. 样例视频要沉淀可迁移的导演方法，而不是机械复述时间段或把样例章节一对一复制成新镜头。
3. 二次渲染必须复用未变化的 AI 生成镜头，只重新生成真正变化的镜头。
4. 先完成 AI 镜头复用并测量完整 Remotion 渲染成本；只有性能数据达到门槛时才复用已渲染片段，且每次仍生成一份完整新成片。
5. 样例方法质量达到门槛后，再把普适创作知识与用户个人偏好分库存储、分路检索，避免两者互相冒充。
6. 删除或合并时间线对象后，服务端与前端必须同步清理失效的 UI 选择，不能把旧对象 ID 带入下一轮。

本版本不建设角色数据库、World Model、向量库、跨项目素材市场、新前端缓存协议或第二套 Timeline。图片、样例、生成素材、字幕和转场仍统一进入现有 `RemotionTimelineSpecV1`、Timeline Revision 与 RenderRun 链路。创作知识第一版复用现有轻量 BM25/关键词检索实现，不预置 embedding 基础设施。

以下不纳入前述 P0/P2 功能实施：

- 多个离散时间线对象一次修订的通用 target 协议；全片语义方向改动改由创作总纲承载，不再为它复制全部 scene ID；
- 修订模型由“完整候选 Timeline”改成“局部 revision fragment”的协议迁移；其依据、风险、验收和独立实施门槛统一放在本文最后一节；
- 新的字幕或转场逐对象 Tool 协议。

## 2. P0 实施后的代码事实

### 2.1 图片链路

- Planner 已通过 `prepareArkImageInputs` 获取真实图片像素。
- `generate_video` 已支持以 `input_asset_id` 绑定服务端图片，并在执行时发布为 Seedance 可访问的图片 URL。
- Timeline 的 `creative_brief.image_references` 持久化可验证图片事实和预期用途；Provider 请求由总纲、镜头 prompt、图片事实及样例方法单点组合。
- 带视觉素材的 LLM 规划失败时保存带 `planning_gaps` 的不可渲染编辑骨架，不再静默降级成图片推拉式 PPT。
- 新规划只使用服务端 `mat_...`；历史双 ID 仅在 Repository hydration 读取边界做唯一可确认的转换，歧义项不猜测。

### 2.2 样例理解链路

- `V2SampleUnderstandingResult` V2 分开保存内容观察、表达方法、时机理由、可迁移知识和真实切镜证据，并保留媒体元数据。
- V1 `segments` 语义协议、固定三/四/五段兜底和旧 compact mapping 已退出新写入链路。
- Planner 只选择与当前任务适用的少量样例方法；样例切点、章节数和素材数不再机械决定新方案镜头数。

### 2.3 二次渲染链路

- Timeline Revision 保存用户当前可编辑意图；RenderRun 保存一次执行的 source spec、resolved spec、生成结果和 MP4。
- 新 RenderRun 会按统一 Provider 请求指纹、文件 SHA256 和 ffprobe 可读性复用上一成功 Run 的未变化 AI 资产；新 Run 仍自包含。
- Remotion 当前把整份 Timeline 作为一个 Composition 一次编码，不是逐镜头编码后拼接。
- 正式渲染与外部生成已有 P0 幂等 Receipt；相同 key 同请求回放，相同 key 不同请求冲突，不同 key 表示新的执行意图。

### 2.4 长期偏好与知识链路

- 现有 `CreativeMemory`、`/api/creative-memories`、Director 检索和“创作偏好”界面已经形成用户/草稿偏好的轻量闭环；
- 当前只有 `CreativeMemory` 一类数据，尚无与用户偏好分离的普适创作知识实体、API、检索结果或管理界面；
- 现有 BM25/关键词评分、active/candidate/revoked 状态和来源证据可复用，但不能继续用同一表同时表达“用户喜欢什么”和“视频创作通常怎么做”。

## 3. P0：统一图片素材身份与引用闭包

### 3.1 单一素材 ID

新规划直接使用服务端素材 ID：

```text
mat_xxx
```

删除新链路中的：

```text
material_01_mat_xxx
planner_image_asset
```

等二次编号。模型只能引用 Planner 输入中服务端提供的资产 ID，不能生成或覆盖用户资产 ID、src 或公共 URL。

历史草稿在 hydration 时一次性把可确认映射的旧 ID 转成服务端素材 ID；转换后只保存新 ID，不保留双写或反向同步。

### 3.2 统一资源闭包

作用域合并后的最终候选必须从实际引用计算依赖闭包：

```text
scene
├─ material job
│  ├─ input asset
│  ├─ output asset
│  └─ fallback asset
├─ overlay asset
└─ custom component
```

目标对象被保留时，其服务端权威依赖必须一并保留；真正未被任何对象引用的新资产才允许删除。作用域合并通过一个共享纯函数裁剪本轮候选中新增且未被引用的资源；Repository 的 create/save 边界再对最终完整 spec 执行同一套结构与引用校验。前者负责候选归一化，后者负责所有写入入口的最终事实门禁，不能在各 scope 或 HTTP/Director 入口复制不同规则。

### 3.3 验收

- 新 Planner 输入、候选、Revision 和 RenderRun 对同一用户素材始终使用同一个 `mat_...`。
- 模型伪造 ID、src 或跨素材替换时被拒绝。
- 目标 scene/job 保留后，其 input/output/fallback asset 不会在作用域合并时丢失。
- Director、HTTP 或内部调用只要试图保存悬空 scene/job/asset 引用，都会在 Repository 边界被拒绝。
- 历史旧 ID hydration 后不再写回旧结构。

### 3.4 删除对象后的 UI 选择归一化

时间线对象删除、合并或替换后，在同一次 Revision commit 中按最终保存的 spec 归一化 `selectedItemId`：

- 目标对象仍存在：保留选择；
- 目标对象已不存在：清空选择；
- 当前协议不根据“只新增了一个对象”等现象推断替代关系，也不根据位置、名称或序号猜测；
- 若未来结构操作协议显式返回替代对象，可由该明确 receipt 另行选择，但本轮不预置该协议。
- 最终 `workspace_session` 只返回归一化后的选择；前端不得再把旧 `selectedClipId` 反写回服务端。

该处理是提交后状态一致性，不依赖模型理解。参数化测试随机改变场景 ID、顺序和拆分结果，只验证两项不变量：原 ID 仍存在时保留，原 ID 消失时清空；下一轮上下文不得再出现已删除 ID。

## 4. P0：图片“双通道”参考与草稿创作总纲

### 4.1 双通道原则

图片同时通过两条互补通道参与创作：

```text
真实图片像素
→ Planner 观察并提取可迁移事实
→ 保存为草稿创作总纲中的图片参考画像

原始图片资产
→ generate_video.input_asset_id
→ 执行时作为 Seedance 的真实条件图片
```

抽象画像帮助 Planner 和不同镜头使用一致语言；原始图片防止视频生成模型只根据文字和自身知识重新生成一个“描述相似但人物/物体不同”的结果。二者不能互相替代。

### 4.2 最小协议

在 `RemotionTimelineSpecV1` 增加一份可选、编辑态但不直接渲染的总纲：

```ts
interface V2CreativeBrief {
  direction: string
  image_references: Array<{
    asset_id: string
    observed_facts: string[]
    intended_use: string
  }>
  sample_methods: string[]
}
```

其中：

- `observed_facts` 描述图片中可见或可合理判断、且可能影响当前创作的事实，不预设固定的元素类别或数量；
- `intended_use` 说明这张图在当前方案中可作为哪些方面的参考，使用自然语言表达，不增加固定业务枚举；
- `direction` 是当前草稿的统一创作方向，不是用户原话的累积日志；
- `sample_methods` 只保存当前方案实际采用的样例表现方法，具体内容由当前创作目标决定。

本字段由 Planner 在同一次方案调用中生成，不新增图片分析模型调用。Revision 合并默认保留它；只有真正改变全局创作方向、参考素材用途或相关镜头内容的修订才更新对应部分。

Prompt 所有权必须唯一，避免总纲和镜头 prompt 重复或冲突：

```text
creative_brief.direction = 当前草稿的全局创作语义
material_job.prompt = 当前镜头独有的主体、环境、动作、运镜和局部表达
真实 Provider prompt = 服务端统一组合全局语义、局部 prompt、图片画像和已采用样例方法
```

Planner 不再把同一全局要求重复写进每个新 job；Material Resolver 和 Adapter 也不能各自再次拼接。历史草稿不做不可靠的自然语言反向拆分：未重新规划的旧 job 继续按原完整 prompt 执行；第一次进入新协议的修订统一重建该草稿的 brief 与局部 job prompt，随后只保存新语义。兼容读取集中在唯一请求准备函数，不保留双写或反向同步。

全片语义变化不再要求模型把同一句风格或叙事要求复制进每个 scene：

```text
“整个视频更轻松、有反差”
→ 更新 creative_brief.direction 一次
→ 执行层把它应用到所有受该总纲约束的 AI 生成请求
→ 请求指纹据真实变化自动决定哪些 AI 镜头失效
```

该机制只承载全局创作语义。背景资源、字幕、转场、时间、素材绑定等具有直接渲染含义的字段仍修改对应时间线对象，不能塞入 `direction` 后假装已经实现。Reviewer 分两层检查：总纲是否满足全局要求；由总纲组装出的实际生成请求是否确实覆盖应受影响的镜头。

实施时必须同步修改并逐项验收：Timeline 类型/Schema/validator/digest、初次 Planner、Revision 合并、Provider 请求准备、生成指纹、outcome review、Trace 以及前端总纲展示。任一层仍自行复制“全片要求”或忽略总纲，都视为未完成；不再额外引入 `all_scenes` 后由模型复制 ID。

### 4.3 根据创作目标选择图片使用方式

- 需要图片中的人物、物体或环境产生新动作、扩展场景、发展故事或加入原图不存在的事件时，使用 `ai_video + generate_video + input_asset_id`；抽象画像参与方案设计，原图同时到达生成 Provider。
- 镜头职责是忠实展示照片、相册叙事、静态构图或轻微推拉，且不需要生成原图外的新内容时，允许使用 `image_motion`。这不是失败兜底，而是正常创作选择。
- 选择依据是镜头实际需要的视觉变化，不依赖固定人物、动物、交通工具等关键词，也不把“图片创作分支”机械等同于任一实现。
- 条件生成失败不得静默退化为图片推拉/PPT 并宣称成功；对应镜头返回未生成，或仅使用用户明确授权的 fallback。
- 确定性 Planner 同样按“是否需要生成新视觉变化”选择，删除“有图片就一律 image_motion”或“一律生成 AI 视频”的两种机械兜底。

Provider 请求如何组合、如何生成指纹以及如何被二次渲染复用，统一放在第 7 节的执行闭环中，不在创作总纲旁建立第二套实现说明。

### 4.4 验收

- Planner 观察到的图片事实进入 `creative_brief.image_references`。
- 对条件生成场景，原始图片仍通过 `input_asset_id` 到达真实 Adapter 请求。
- 同一主体跨多个镜头时，各 job 使用相同参考画像和同一原图资产。
- “展示原图”和“基于原图创造新镜头”反向用例均正确。
- 同一图片在不同用户目标下能够分别规划为条件生成或忠实展示，选择理由可从镜头职责和真实执行对象复核。
- 全片语义修改只更新一次创作总纲，但所有相关生成请求都能观察到该变化；没有受影响的直接渲染字段保持不变。
- 前端方案能说明“AI 视频 · 参考素材：文件名”，但不新增第二套素材状态。

## 5. P0：样例视频从时间复述升级为导演方法理解

### 5.1 三个核心问题

样例理解应结合用户的具体提问统一回答；以下三点仅作为用户未提出额外要求时的默认分析维度：

1. 画面中发生了什么？
2. 它是如何表现出来的？
3. 为什么在这个时间点这样表现？

第一点提供内容证据；第二点提取镜头、运镜、剪辑、节奏、转场和氛围；第三点解释注意力、信息揭示、铺垫、高潮、动作与音乐强拍关系以及镜头的叙事功能。

### 5.2 V2 协议替换与旧字段删除

这里不是在 V1 结果上再增加一个聚合字段。当前协议同时存在全局 `story/atmosphere/editing/rhythm/reusable_style` 与逐 `segment` 重复的 camera、motion、editing、rhythm、transition、reusable 等描述，容易让 Planner 继续按章节机械映射。V2 改为三个互相分工的事实集合：

```ts
interface V2SampleUnderstandingResultV2 {
  schema_version: 'v2_sample_understanding.v2'
  summary: string
  content_observations: Array<{
    statement: string
    evidence_ranges: Array<{ start_sec: number; end_sec: number }>
  }>
  method_observations: Array<{
    id: string
    expression: string
    purpose: string
    timing_rationale: string
    evidence_ranges: Array<{ start_sec: number; end_sec: number }>
  }>
  transferable_knowledge: Array<{
    statement: string
    applicability: string
    evidence_method_ids: string[]
  }>
  shot_evidence: V2SampleShotEvidence[]
  questions: string[]
  warnings: string[]
}
```

- `content_observations` 回答“发生什么”，仅作为内容与证据，不是新方案章节模板；
- `method_observations` 回答“如何表现、为什么此时这样表现”；
- `transferable_knowledge` 只保存脱离样例具体人物、品牌和文案后仍成立的方法；
- `shot_evidence` 保留真实切点和密度证据，不承担章节语义。

迁移时同步删除被上述字段取代的 V1 全局描述、重复 segment 方法字段、旧 Planner compact 映射、旧 Prompt、mock、fixture、生成声明和确定性 Planner 的 segment 循环映射。历史 V1 分析结果标记为需要重新分析；不在运行时保留 V1/V2 双写或把旧字段拼回新 Prompt。

### 5.3 Planner 的选择性迁移

Planner 不“默认照单全收”样例方法，而是根据当前用户目标、目标时长、素材事实和创作总纲选择少量适用方法：

```text
当前用户要求与项目事实
→ 判断哪些 method_observations/transferable_knowledge 适用
→ 把实际采用的方法写入 creative_brief.sample_methods
→ 再据此设计新的镜头内容与节奏
```

- 不要求使用所有方法，不因某个方法已被提取就强行套用；
- 不迁移样例中的具体人物、品牌、文案和事件，除非用户明确要求内容复刻；
- 镜头数量由新任务时长、信息量、节奏和用户要求决定，不等于内容观察数、证据数或素材数；
- `shot_evidence` 只帮助判断镜头密度、切换节奏和方法证据，不作为固定拆镜模板；
- Planner 在方案里说明采用了哪些样例方法及其适用理由，未采用的方法无需解释；
- 样例视频不进入最终 `assets`，除非用户把同一文件另行明确指定为成片素材；最终视觉镜头由 AI 生成，Remotion 负责字幕、转场和确定性编排。

### 5.4 验收

- 同一份样例能输出“内容、表现方法、时点原因”三层事实。
- 新方案不因样例有三个章节就固定生成三个镜头。
- 替换用户主题后仍能复用样例运镜、节奏和叙事方法，而不复制样例人物和文案。
- Planner 只采用对当前任务有用的方法，不能因为目录中存在方法就机械全部套用。
- V1 重复字段、旧 segment 映射和双版本 Prompt 在有效源码、测试和生成声明中无残留。

## 6. P2：用户创作偏好与普适创作知识分层

该方向在概念上正确，但不阻断图片理解、样例理解、AI 镜头复用和正式渲染链路发布。必须先验证样例方法提取的准确性和证据质量，再允许跨草稿知识 candidate 入库；不得为了赶本版本而把未经验证的模型总结批量沉淀为长期知识。

### 6.1 两种不同的数据实体

现有 `CreativeMemory` 继续只表示用户个人或当前草稿的偏好，例如“偏好克制的品牌语气”。新增轻量 `CreativeKnowledge` 表示与具体用户无关、可在视频创作中复用的方法知识，例如“高潮前逐步缩短镜头时长可增强压迫感”。两者不得写进同一记录后靠标签猜类型。

`CreativeKnowledge` 第一版只保留必要字段：

```ts
interface CreativeKnowledge {
  id: string
  statement: string
  applicability: string
  status: 'active' | 'candidate' | 'revoked'
  sourceType: 'sample' | 'project' | 'curated'
  sourceId: string
  evidenceSummary: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
}
```

当前应用按单用户运行，因此知识是应用级；不提前建设租户、组织或知识市场。可以复用 `CreativeMemory` 的 Repository 形态、状态流转、文本规范化、BM25 评分和 Trace 结构，但数据库表、类型、API 和检索结果必须分开。

### 6.2 分路检索与使用优先级

Planner 收到两个具名集合，禁止合并成无来源的字符串数组：

```ts
recalledUserPreferences: CreativeMemoryHit[]
recalledCreativeKnowledge: CreativeKnowledgeHit[]
```

两路检索都执行作用域/状态过滤、BM25/关键词相关性、最低门槛、稳定排序和 Top-K 截断；不足 K 条时允许返回 0 条，不能随机补齐。只有 active 记录进入 Planner，candidate 只进入管理界面等待核验。Trace 分别记录命中、分数、证据和未采用原因。

使用优先级固定为：

```text
当前用户输入
> 已确认项目要求与当前素材事实
> 当前草稿 creative_brief
> 用户个人偏好
> 普适创作知识
```

检索结果是候选依据，不是隐藏指令；Planner 只采用与当前任务相关且不冲突的少量结果，并在 `creative_brief` 中记录实际采用项。

### 6.3 沉淀边界

- 样例本轮提取的 method observations 可立即服务当前草稿，无需先写长期知识库；
- 脱离当前内容仍成立且有证据的方法可写为 `CreativeKnowledge candidate`，不能写成用户偏好；
- 用户明确表达的稳定审美、风格或兴趣继续写入 `CreativeMemory`，不能写成普适知识；
- 当前操作、临时要求、未经证实的结果和单个项目偶然选择不自动沉淀；
- candidate 经用户或明确的离线审核动作采纳后才成为 active，普通视频 Tool 成功不能顺便提升知识。

现有 Director 的 `memoryActions` 仍可选，不增加 `memoryDecision`、关键词触发器或第二次记忆模型调用。Prompt 仅增加少量正反 few-shot，重点区分“用户偏好、当前要求、普适方法、一次操作”，并保留服务端来源、归属、去重与 candidate 不参与规划的硬约束。

### 6.4 管理界面

现有“创作偏好”继续只管理 `CreativeMemory`。新增并列的“创作知识”视图，展示 active/candidate/revoked、statement、适用条件、来源和证据，并提供采纳、编辑、撤销和删除。前端不把两类数据拼成同一列表，也不允许用编辑偏好的 API 修改知识记录。

### 6.5 验收

- 同一查询分别返回偏好和知识，类型、来源、分数与采用结果可追踪；
- 样例方法 candidate 不会出现在“创作偏好”，用户偏好也不会进入全局知识；
- 无关知识、candidate 和 revoked 记录不会注入 Planner；
- 当前输入与知识冲突时以当前输入为准；
- 复用同一 BM25 实现但数据库、API、Prompt 字段和 UI 均保持概念隔离。

## 7. P0/P2：AI 镜头复用与按数据启用的 Remotion 分段优化

### 7.1 统一 Run 接口，分两阶段实施

对 Director、前端和 Repository 始终只暴露现有 RenderRun：输入一个已保存 revision，输出一个完整自包含 MP4 和一份真实 receipt。内部按收益和风险分两阶段，不要求一次上线全部缓存能力。

```text
阶段 A（P0，必须实施）
读取最终 Revision
→ 组装真实 Provider 请求并计算 fingerprint
→ 复用未变化 AI 镜头，只生成未命中镜头
→ 使用完整 resolved spec 做一次完整 Remotion 渲染
→ 保存新的完整 RenderRun

阶段 B（P2，性能门槛满足后才实施）
在阶段 A 的完整 AI 资产基础上
→ 尝试复用未变化 Remotion frameRange 片段
→ 重渲染失效片段并 concat
→ 失败时回退完整 Remotion 渲染，不重新调用 Provider
```

外部接口统一不等于内部实现揉成一个大模块。Run orchestrator 只负责编排并汇总 receipt；AI 请求复用和 Remotion 片段复用保留各自独立的指纹与校验实现。

### 7.2 Provider 请求与 AI 镜头指纹

Provider Prompt 不是独立协议。创作总纲在规划阶段生成，执行时由 Material Resolver 与 Adapter 之间的唯一请求准备函数组合：

```ts
prepareMaterialGenerationRequest({ creativeBrief, scene, job, inputAsset })
  -> { request: V2MaterialGenerationRequest; fingerprint: string }
```

真实 prompt 由 `creative_brief.direction + job.prompt 局部意图 + 参考图片 observed_facts/intended_use + 实际采用的 sample_methods` 组成。Provider 与 fingerprint 必须消费同一个 `request`，禁止 Resolver、Adapter 或 Trace 重新拼接另一份 prompt。

指纹只包含真正影响生成结果的事实：协议版本、Provider/模型、实际完整 prompt、条件图片内容 hash（取不到时使用规范化外部 URL）以及 Adapter 实际发送的时长、分辨率、seed 等参数；不包含 scene/job/output ID、Revision、字幕、转场和 UI 文案。

复用来源只取当前草稿最近一次成功 RenderRun 的 generation manifest 与 resolved spec。命中后确认旧文件仍存在且 ffprobe 可读，再硬链接或复制进新 Run，并以当前 output asset 注册为 fulfilled。新 Run 不永久引用旧目录，不扫描全部历史 Run，也不增加缓存表。

### 7.3 阶段 A 失效与验收

- 只改字幕、转场或编辑器说明：AI 镜头全部复用，生成 Adapter 调用数为 0；
- 改一个镜头的真实 Provider 请求或参考图：只重新生成该镜头；
- 全局 creative brief 改变：逐 job 重建真实请求，只有 fingerprint 改变的镜头失效；
- Provider/模型、真实生成参数或参考图片内容变化：只使实际依赖它的镜头失效；
- 文件缺失、损坏或旧 manifest 无指纹：安全重新生成对应镜头，不伪造命中；
- 无论命中多少 AI 镜头，阶段 A 都使用完整 resolved spec 做一次完整 Remotion 渲染，确保字幕、转场和时间线行为与当前正式路径一致；
- 新 Run 删除旧 Run 后仍可播放，Trace 逐镜头记录 `reused/generated/invalidated` 和原因。

### 7.4 阶段 B 启动门槛

阶段 A 上线后，用真实 15 秒及更长场景统计完整 Remotion 渲染的 p50/p95、在二次渲染总耗时中的占比和本地资源消耗。只有同时满足以下条件才进入分段实现：

- 完整 Remotion 渲染已经成为二次渲染的显著耗时部分，而不是 Seedance、素材标准化或 IO 才是主要瓶颈；
- 低分辨率原型证明分段复用能稳定降低至少 25% 的二次渲染中位耗时；
- 常见局部修改的预计片段命中率不低于 50%；
- 与完整渲染逐帧/关键帧对比未发现字幕、转场、音视频时序差异。

任一条件不满足，就保留“AI 镜头复用＋完整 Remotion 渲染”，不为未证实的性能问题建设片段缓存。

### 7.5 阶段 B 最小实现

如门槛满足，以最终 resolved spec 的场景时间边界切分 frame ranges；每段仍从完整 `TimelineComposition` 使用 Remotion `frameRange` 渲染。片段 fingerprint 仅包含：Renderer/React/Remotion 版本与源码 hash、canvas/fps/绝对帧范围、当前及相邻场景、入出转场、相交 overlays/caption tracks、相关资产 hash、自定义组件 bundle/purpose/params。

是否复用只比较两个最终 Run 的真实依赖，不能依赖模型声称的 scope 或前端选择。命中片段复制或硬链接进新 Run，未命中片段重渲染；ffprobe 确认 codec、尺寸、fps/time base、pixel format 和流布局一致后使用 concat `-c copy` 生成完整新 MP4。

concat、片段检查或缓存读取失败时，保留阶段 A 已复用/生成的 AI 镜头，只回退完整 Remotion 渲染。不得重新调用 Seedance、污染 Revision、删除旧成功 Run或宣称局部缓存成功。

### 7.6 协议边界

- 不新增前端缓存请求字段；前端只展示服务端 receipt，不能决定命中与失效；
- 不从旧 MP4 逆向切片，不跨草稿复用，不扫描全部历史 Run，不实现 DAG 调度器；
- AI manifest 与可选 Remotion segment manifest 使用同一 runId/revision，但由两个内部实现各自维护；
- 成功条件始终是新 Run 拥有完整可播放 MP4，任何局部步骤成功都不能伪装整轮成功。

## 8. 请求幂等里程碑

### 8.1 P0：正式渲染与外部视频生成

P0 共用一个持久化 `V2IdempotencyReceipt`，唯一键为：

```text
userId + operation + idempotencyKey
```

`resourceKey`、草稿、revision 和规范化请求进入 `requestHash`。同一 key 与同一请求回放首次状态和结果；同一 key 搭配不同请求返回冲突；用户主动再次执行必须使用新 key。

- `timeline.render`：前端一次渲染意图生成一个 key，网络重试复用；Director 使用稳定 `callId`。相同 key 不创建第二个 RenderRun，并提供单个 Run 状态查询。
- `material.generate`：AI 复用未命中后才预留 receipt；Provider task ID 在提交成功、轮询开始前保存。提交结果未知且没有可恢复 task ID 时标记 `provider_submit_state_unknown`，当前 Run 失败且不会自动重提。
- AI 镜头复用：只检查同一草稿最近成功 Run；Provider 请求指纹相同、文件存在、SHA256 相同且 FFprobe 可读才复制到新 Run。新 Run 自包含，之后仍完整执行 Remotion 渲染。
- 本地 JSON 和 PostgreSQL 必须保持相同唯一键、状态回放和草稿级联清理语义。

### 8.2 P1：后续请求幂等（本轮不实现）

继续复用同一 Receipt，不建立第二套框架：

- Director 整轮：`workspaceSessionId + turnRequestId`，只持久化最终提交或拒绝，不保存每个流 token；
- 预览与初始草稿：同一请求返回同一 draft/revision，不重复调用 Planner；
- 草稿保存：先查幂等回放，再执行 `baseRevision` 乐观锁；幂等不能替代版本冲突；
- 组件生成：请求 hash 覆盖效果要求、画幅、Skill/模型/验收策略版本，同 key 不重复编码和试渲染。

### 8.3 P2：记忆幂等与 Worker 生命周期（本轮不实现）

- 记忆 add/replace/revoke 使用 `turnRequestId + action ref` 派生 key，并以规范化 statement 的 `semanticKey` 收敛并发重复；
- 只有引入后台 Worker 后才增加 lease、heartbeat、stale takeover、BullMQ claim 和 receipt 归档；Worker 必须领取同一 Receipt。

## 9. 合并实施与验证顺序

按优先级拆成独立里程碑；每个里程碑内部集中修改，完成全部代码后再统一执行一次完整验证，禁止每改一个小点就重复全量构建：

```text
P0 核心链路：
素材 ID、资源闭包与失效 UI 选择归一化
→ creative_brief、Prompt 所有权、图片选择规则与样例 V2 协议替换
→ Provider 请求准备与 AI 镜头复用
→ 用户偏好 few-shot
→ 一次合并定向验证
→ 一次 P0 全量验证

P2 独立里程碑：
样例方法质量达标后再做 CreativeKnowledge 分库、检索与管理视图
→ 阶段 A 性能数据达标后再做 Remotion frameRange 与 concat
→ 各里程碑完成全部修改后分别执行一次完整验证
```

P0 定向验证合并为三组：

1. 图片双通道、单一服务端 ID、资源闭包、UI 失效选择清理与条件生成正反例；
2. 样例三层理解、V1 字段删除、选择性方法迁移与非机械拆镜；
3. AI 请求指纹：字幕、转场、单镜头、全局总纲、参考图变化、文件损坏及新 Run 自包含。

P2 各自增加一组验收：知识里程碑验证分库存储、Top-K、候选隔离与冲突优先级；Remotion 里程碑验证片段指纹、相邻转场失效、时间结构失效、concat 和完整渲染对比。

每个里程碑的全部代码完成后只执行一次：

- shared / backend / remotion / frontend TypeScript；
- V2 全量确定性回归；
- 一次低成本静态素材 Remotion 回归；
- Standards / Spec 双轴审查。

本版本不运行 Seedance 三轮真实回归；真实三分支测试仍由用户确认后单独进行。

## 10. 完成定义

P0 完成定义：

- 图片抽象画像和原图条件输入同时到达 Planner/Provider，不能只剩其中一个。
- 样例理解能解释“发生什么、如何表现、为何此时表现”，Planner 不再机械按章节复刻。
- 删除时间线对象后，服务端和前端都不再保留或发送失效选择 ID。
- 新 Revision 只要生成请求未变，就不会重复生成对应 AI 镜头。
- 每次 RenderRun 都产出新的完整自包含 MP4，且能说明复用了什么、重做了什么及原因。
- 旧素材双 ID、V1 样例字段、新运行时兼容分支和被替代的机械样例 Prompt 已删除；不得保留双写。

P2 追加完成定义：

- 知识里程碑：用户偏好与普适创作知识分表、分路检索、分界面管理，互不污染；
- Remotion 里程碑：片段缓存和 concat 失败不会污染 Revision、删除旧成功 Run、重新调用 Provider或伪装成功；若性能门槛不成立，本项以“不实施”作为正确结论。

## 11. 最后独立实施：修订模型改为局部 revision fragment

### 11.1 强制实施门槛

该项不属于前述功能的依赖，禁止在其他功能改动完成前实施。只有满足以下条件才允许开始：

- P0 素材身份、资源闭包、UI 选择、creative brief、Prompt 所有权、图片/样例协议和 AI 镜头复用均已完成并形成稳定回归基线；
- 已接受的 P2 知识或 Remotion 优化已经完成，或已根据数据明确记录为不实施；
- Timeline、creative brief、material job 和样例协议不再处于同轮变更中；
- 当前完整 revision 链路的 Token、p50/p95、first-pass、repair、goal completion 和 scope drift 基线已经冻结。

Fragment 必须作为最后一个独立里程碑、独立提交实施，不能夹在图片理解、知识库、AI 复用或 Renderer 改动中一起完成。

### 11.2 当前依据与判断

当前 revision 真实流程是：

```text
Director/Tool 声明 scope 与目标
→ 服务端把完整时间线投影为 revision_context
→ Planner 返回完整 RemotionTimelineSpecV1
→ JSON/字段 repair
→ 服务端按 scope 恢复非目标内容
→ 完整结构、安全、资源与 outcome review
→ 必要时再次要求完整 Timeline
→ 保存完整 revision
```

当前 `backend/tmp` 可读取 Trace 共 20 次，其中 17 次 revision、3 次初次规划。它们不是严格同场景 A/B，但足以证明 revision 存在明显的完整时间线重复：

| 类型 | 样本数 | 平均 Prompt 字符 | 平均输入 Token | 平均输出 Token | 平均候选大小 |
|---|---:|---:|---:|---:|---:|
| 初次规划 | 3 | 21,884 | 7,680 | 3,017 | 6.4 KB |
| Revision | 17 | 40,524 | 14,793 | 6,030 | 14.5 KB |

Revision 样本最高达到输入 17,534、输出 10,909 Token。对只改一个字幕、转场或镜头的请求，这一成本与风险明显偏高。Fragment 的主要动力不只是节省 Token，更是减少模型重写无关对象、输出截断和非目标漂移的机会。

### 11.3 目标接口

初次规划继续输出完整 Timeline。已有草稿修订改为后端内部的判别联合，不使用 RFC JSON Patch、数组下标路径或任意字段路径：

```ts
type V2TimelineRevisionFragment =
  | SubtitleFragment
  | SceneFragment
  | StructureFragment
  | VisualStrategyFragment
  | TransitionFragment
  | FullReplanFragment
```

```text
服务端提供全局总纲、目标对象及必要邻居/依赖
→ 模型只输出当前 scope 对应 fragment
→ applyRevisionFragment(baseSpec, fragment) 合并权威基础版本
→ 对完整最终 spec 执行现有 validator、资源闭包、安全门禁和非目标一致性检查
→ 从已合并的最终 spec 投影当前 scope 的语义审查闭包
→ Reviewer 只审查该闭包是否落实用户要求
→ 保存完整新 revision
→ 前端仍只接收完整最终 spec
```

Fragment 不取消对象 ID、scope、非目标保持不变或资源闭包；它只替换模型输出形状。Structure fragment 必须携带完整替换范围及其 scene、transition、overlay、caption track、material job 和新增 asset，不能退化为若干无依赖的小 patch。

这里必须区分两类检查：

- Schema、对象引用、时间连续性、资源闭包、权限、组件安全和非目标对象未变化，仍由程序对合并后的完整 spec 确定性检查；
- “用户要求是否真正落实”“目标文案是否适合展示”“目标镜头是否实现新增视觉内容”“样例方法是否被误抄”等语义问题，由 Reviewer 只基于当前 scope 的审查闭包判断。

不能先审 fragment、通过后才合并，因为 fragment 单独无法暴露对象 ID 冲突、时间范围断裂、跨对象引用缺失或相邻转场失效。正确顺序是“先合并并做完整确定性校验，再做局部语义审查”。

### 11.4 真实改动范围

按当前引用重新核对，预计涉及约 7～9 个后端生产/评测源码和 5～8 个 smoke、fixture、eval 入口，触及约 500～1000 行；最终净新增应明显低于触及行数，因为旧完整 revision 路径会同步删除。该数字是设计估算，不是验收成绩。

必须修改：

- `remotion-timeline-llm-planner.ts`：初次完整 Schema 与 revision fragment Schema 分流，首次调用和 repair 同步；
- `timeline-revision-context.ts`：按 scope 投影目标、邻居、全局总纲和资源依赖；
- `timeline-revision-scope.ts`：以 `applyRevisionFragment` 替换完整 candidate 恢复逻辑；
- `remotion-timeline-service.ts`：fragment 合并后再执行 hard requirements、完整校验和 correction；
- `v2-input.ts`：后端内部 fragment/context 类型；
- `timeline-revision-outcome-review.ts`：保留一个 Reviewer 入口；初次规划、`global` 和 `full_replan` 仍审查完整方案，其他 revision 从合并后的 base/final spec 生成 scope 审查闭包，correction 只请求 fragment；
- `dispatcher.ts`：继续绑定服务端 scope/目标，只做必要输入衔接；
- revision Trace、协议 smoke、scope/outcome smoke、真实评测 fixture 和指标解析。

不改变业务接口：

- Director 与前端流式协议；
- `timeline.patch` 用户侧 Tool 参数；
- 最终 `RemotionTimelineSpecV1`；
- Draft/Revision Repository；
- 已有草稿数据库；
- RenderRun、前端完整方案展示和 Remotion Renderer。

Fragment 类型默认留在 backend 内部，不为了模型临时输出扩大 shared/前端接口。

### 11.5 删除与复用

迁移后必须删除：

- revision 复用完整 Timeline 输出 Schema 的路径；
- revision repair/correction 要求完整 Timeline 的 Prompt；
- `applyV2TimelineRevisionScope` 中依赖完整 candidate 再恢复无关对象的分支；
- revision Trace 中重复记录完整模型候选的旧格式；
- 局部 revision 的 Reviewer Prompt 中重复发送完整 base/candidate digest 的路径；
- 对应旧 mock、fixture、评测字段和运行时兼容判断。

继续复用：

- 初次规划的完整 Timeline Schema 和 Planner；
- base revision、现有 scope/目标 ID 与资源闭包规则；
- 完整最终 spec 的 validator、组件/素材/权限门禁和 hard requirements；
- outcome reviewer 的模型调用、结构化 verdict、一次 JSON repair、commit receipt、Revision Repository、RenderRun 和前端展示。

生产运行不保留“完整候选或 fragment 二选一”的双协议。先用测试建立纯 `applyRevisionFragment`，随后一次切换 revision LLM，并在同一修改中删除旧完整候选路径。

Reviewer 不新增第二套模型或第二个调用链。现有入口内部用一个纯投影函数生成审查输入：字幕包含目标 overlay/track 与所属场景时间；scene/visual strategy 包含目标场景、对应 job/asset、字幕及相邻转场；transition 包含目标转场、两端场景和组件事实；structure 包含替换范围、前后锚点及范围内依赖；global/full replan 使用完整事实。Trace 记录该投影、权威 diff 和完整 spec 的 revision/hash，避免再次复制整份模型候选。

### 11.6 主要风险与控制

1. **上下文裁剪过度**：Planner fragment 和 Reviewer 审查闭包共用同一套 scope 依赖投影规则；字幕需要 track/overlay 和场景时间，转场需要前后 scene，视觉修订需要 job/asset，structure 需要范围锚点和完整资源闭包。投影由服务端确定，不由模型或调用方自由挑上下文。
2. **Fragment Schema 过度复杂**：只使用现有 scope 判别联合，不设计通用路径语言；初次完整规划和明确整案推翻仍使用完整 Timeline。
3. **结构修订遗漏依赖**：Structure fragment 作为一个原子替换范围处理，合并后仍执行完整 validator、资源闭包和非目标深度比较。
4. **Repair 初期恶化**：使用冻结真实 revision Trace 做新旧协议 A/B；首次和 repair 必须使用同一 fragment Schema，不能 repair 回旧完整协议。
5. **Reviewer 局部审查漏掉跨范围问题**：程序必须先对合并后的完整 spec 完成确定性检查；Reviewer 的局部闭包只替代语义输入，不替代全局结构与安全校验。报告分别统计 Planner、Reviewer 和总调用成本，验证 Reviewer 的 Token/延迟是否实际下降。

### 11.7 失败与恢复

单轮 fragment 首次失败时只允许一次对应协议/语义修复；第二次仍失败则拒绝本轮并保持基础 revision，不使用旧完整候选作为运行时 fallback。

Fragment 只是模型与服务端之间的临时协议，数据库仍保存完整 Timeline，前端和 Renderer 也只读取完整 spec。因此整体迁移不需要数据迁移；如果 A/B 或回归不达标，可回滚该独立提交，现有草稿仍可由旧版本读取。实施前必须实际演练一次“新版本生成 revision → 回滚旧版本 → 重新打开和渲染该草稿”。

### 11.8 可期待与不可承诺的收益

可以合理期待：窄范围 revision 的 Planner 输入/输出 Token、Reviewer 输入 Token、两次模型调用的总延迟、原始候选 Trace 和无关对象漂移下降；Timeline 越长、修改范围越窄，收益越大。

不能提前承诺：模型调用次数减少、Reviewer 输出 Token 明显下降、初次规划加速、模型语义理解自动变准、最终完整 revision 变小。两三个镜头的短方案可能收益有限；Reviewer 的真实收益必须由 A/B 数据证明。

### 11.9 合并门槛

新旧协议必须在同一冻结数据集和相同模型配置上 A/B。只有全部满足才允许替换：

- revision 输出 Token 中位数至少下降 50%；
- revision 输入 Token 中位数至少下降 30%；
- 非 `global/full_replan` 的 Reviewer 输入 Token 中位数至少下降 30%，Reviewer pass/repair 准确率不得下降；
- structured first-pass 不低于旧协议，repair rate 和 Planner p95 不恶化；
- scenario goal completion 不下降；
- scope 越界、非目标对象变化、跨域 mutation 和虚假成功声明均为 0；
- subtitle、scene、visual strategy、transition、structure 和 full replan 均有确定性正反例；
- 8～10 个关键真实模型修订场景连续三轮通过；
- 回滚演练证明历史草稿和新生成完整 revision 均可恢复使用。

若 Token 收益达不到门槛，或正确性、repair、p95 任一恶化，则不合并 Fragment；继续使用完整候选协议是比带着双链路上线更安全的结论。
