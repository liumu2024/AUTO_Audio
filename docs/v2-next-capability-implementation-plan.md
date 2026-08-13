# V2 下一阶段能力实施计划

状态：Agent Tool/Skill 运行闭环已于 2026-07-29 补齐；以下为其上的后续能力。所有内容只接入 V2 草稿、版本、`RemotionTimelineSpecV1` 和 V2 trace；禁止读取或恢复 V1 RenderPlan。

## 0. Agent Tool / Skill 运行闭环（已实现）

- 理解模型通过 `skillRequests` 与 `toolRequests` 自由选择当前阶段能力，不使用关键词路由替代模型。
- 服务端将两者解析为单一执行计划；Tool 必须绑定本轮已选主 Skill。
- 运行时加载主 Skill 的 manifest、`SKILL.md` 和声明依赖，并把版本、来源、hash 与内容写入 trace。
- 每个可用 Tool 暴露并校验真实输入 Schema；执行器消费标准化参数。
- Tool 结果写回 V2 工作区后再次交给理解模型生成最终回复；失败时按真实结果降级。
- Tool 异常被收敛为结构化失败，不中断会话状态保存。
- 正式交付授权来自本轮模型的结构化执行决定，不依赖原文字符串匹配。

对应可重复测试：`smoke-v2-agent-tool-skill-registry`、`smoke-v2-director-skill-tool-loop`、`smoke-v2-director-session-lifecycle`。

## 1. 局部时间线修订

状态：`timeline.patch` 已开放 `subtitle` / `scene` / `visual_strategy` / `global` 四个通用范围（2026-08-04）；`audio` 已取消，不再规划（2026-08-04）。

### 目标

在现有 `timeline.patch(scope=subtitle)` 基础上，分批开放 `scene`、`visual_strategy`、`audio` 和 `global`。每种范围只允许改变其声明的事实，其余基础版本事实必须由服务端保护。

### 实施

1. 为每个 scope 定义输入 JSON Schema、允许字段、禁止字段和差异审查规则（已实现：subtitle/scene/global）。
2. `scene` 要求 `scene_id`；只允许修改该镜头的叙事内容及对应生成任务，字幕、时间、视觉呈现和转场保持不变（已实现）。
3. `visual_strategy` 允许 AI 视频、图片动态、Remotion 卡片和混合方案之间的选择，但禁止无关文案与音频改动（已实现）。
4. `audio` 已取消，不再规划（2026-08-04）。
5. `global` 必须生成完整新版本、记录明确授权、通过修订语义审查（已实现）。

### 验收

每种 patch 均有“只改指定范围”和“越界改写被拒绝”双向 smoke；每个 trace 写入基础事实、候选事实、实际差异和审查结论。

## 2. 独立音频、BGM 与旁白

### 数据与协议

扩展 V2 音频资产，区分 `user_audio`、`bgm`、`ai_video_embedded_audio`、`tts_narration`、`ambient`、`sfx`。视频模型片内声音保留为独立来源，不能被误称为可编辑项目 BGM。

### 实施顺序

1. 用户音频上传、音频资产发布与 Remotion 音频轨渲染。
2. 音频计划 Tool：音量、淡入淡出、镜头交接与 BGM ducking。
3. 接入 TTS Provider；只在用户明确授权时生成旁白。
4. 字幕型旁白：锁定字幕文本 → 获取 TTS 实际时长和词级时间 → 校验字幕/声音/镜头范围 → 小偏差调整时序，大偏差回到方案修订。
5. FFmpeg 只用于已有音频的转码、响度标准化、混音和封装，不承担文本生成声音。

### 验收

同一段字幕的音频起止与字幕段误差受控；BGM ducking 不压低旁白可懂度；生成片内声音、项目 BGM 和旁白在预览中可辨识。

## 3. 长期创作记忆与检索

状态：第一阶段（可控写入、关键词检索、用户可见管理页、确认要求台账）已于 2026-08-04 完成并纳入正式回归；向量/混合检索、语义重排、自动冲突消解与跨项目候选聚合仍延后。

### 先做可控写入

实现 `CreativeMemoryRecord`、`CreativeMemoryChunk` 的持久化及用户可见管理页。用户明确确认才写入；跨项目重复且未被否定的偏好仅形成待确认候选。

### 检索流程

权限/范围过滤 → 结构化条件过滤（画幅、行业、视频类型、视觉策略） → 关键词与向量混合召回 → 融合排序 → 对少量候选语义重排 → 去重与冲突消解 → 返回 3–5 条带来源建议。

### 验收

未确认记忆不影响新项目；当前用户输入与当前 V2 草稿优先；用户能查看、编辑、删除每条记忆及其来源。

## 4. Remotion-first 视觉与组件沉淀

### 第一阶段：固定组件

实现受 schema 约束的 `brand_intro`、`product_feature_card`、`comparison_table`、`metric_counter`、`data_chart`、`logo_end_card`、`image_collage`。规划器只能选择组件和有限 props，不能输出 JSX。

### 第二阶段：沙箱组件

自定义组件必须经过隔离编译、静态检查和预览，只有审核通过的版本才能进入注册表并被时间线引用。

### 验收

分别完成 AI-first、Remotion-first、混合视觉方案测试；组件失败可回滚，不影响现有 V2 草稿。

## 5. Provider 原生 Function Calling

保留 JSON `toolRequests` 为唯一业务协议。原生 provider function calling 仅作为适配层：原生调用 → V2 ToolRequest → 同一 Registry、授权器、Dispatcher、trace。通过兼容性 smoke 前不启用。

## 6. 草稿版本与成片历史对比（后续）

状态：数据库已保存草稿 revision 和 RenderRun，但当前历史工作台只展示最近 revision 与最近 RenderRun，尚不能浏览、播放和比较完整历史。本项只记录为当前真实端到端测试后的后续工作；本次测试前不修改运行代码。

### 最小实现

1. 在现有历史工作台或中间方案区增加“版本记录”入口，按时间列出 revision、对应修改要求和 RenderRun。
2. 支持打开任一历史方案及其成片；不得覆盖当前工作区，也不得把历史 RenderRun 的 resolved spec 回写成当前草稿。
3. 允许选择两个 revision，展示镜头、字幕、转场和素材绑定的结构化差异，并可分别播放对应成片。
4. 沿用现有 revision/RenderRun 数据，不新增第二套版本状态或重复持久化。

### 验收

修改前后两个版本及各自 RenderRun 均可追溯、播放和对比；重新打开草稿后历史仍存在；查看历史不会改变当前 revision、草稿内容或交付结果。

## 完成定义

每一项完成时必须更新此文档：已实现模块、接口变更、可重复 smoke、trace 示例、未实现边界。临时测试驱动和 mock trace 必须删除；正式 V2 trace 与历史真实测试 trace 不得清理。
