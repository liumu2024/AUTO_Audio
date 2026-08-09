# V2 转场能力调查记录（2026-08-07）

本记录覆盖 V2 主链路中"转场效果"从用户需求到可交付成片的完整调查：需求、问题时间线、架构分层、逐项证据、根因链、能力矩阵与建议措施。所有技术事实均有代码或实测证据，证据路径在文内标注。

## 1. 背景与目标

V2 是一个"导演 Agent + Remotion 时间线"系统：导演模型理解用户意图并提议工具，Planner 产出完整时间线 spec，系统做确定性校验，审查模型判结果是否满足请求，Remotion 渲染成片。

用户对"转场效果"的核心诉求：

1. 用户说"模糊渐变 / 爆炸 / 硬切"等效果时，系统能正确实现；
2. **能直接调用的用官方/内置能力**（不浪费 token 走组件创作）；
3. **调不到的用模型创作兜底**（模型基于 Remotion 知识写组件，沙箱隔离执行）；
4. 全过程**不静默失败**：找不到能力就明确提示（capability gap），不让 Planner 从内置枚举兜底乱选；组件创作失败明确反馈，不假装成功；
5. 不做"加一个效果补一处代码"的枚举补丁（遵循 `Generalize, never special-case` 工程原则）。

## 2. 问题时间线

### 2.1 转场修改被拒（"scene 修订需要目标场景"）

现象：用户请求"第5和第6镜头转场改渐变模糊；第3和第4镜头转场改影切"，系统拒绝：

```
scene 修订需要目标场景：请在草稿中选中要修改的镜头，或提供该镜头的 sceneId。
```

证据（trace `v2_director_21e6f92e-...`）：

- 模型只发了一个 `timeline.patch`：`scope=scene, sceneId=（空）, instruction=两个转场需求`；
- dispatcher 的 scene scope 要求 sceneId 或当前选中镜头，两者都没有 → 拒绝。

结论：模型没有把两个转场需求拆成多个 patch、也没有填 sceneId。

### 2.2 用户修复：新增 transition scope

用户实现了协议级修复（transition scope）：

- `timelinePatchArgumentsSchema` 改为按 scope 分型的 discriminatedUnion，新增 `scope: 'transition'` + `transitionIds`（必填、1–20、去重）；
- `applyV2TimelineRevisionScope` 增加 transition 分支：只替换 `transitionIds` 指定的转场，其他保持 base；
- 审查、prompt、评测、`timelineFacts.transitions`（新增 `id/fromSceneId/toSceneId/fromSceneIndex/toSceneIndex`）全部同步；
- 实测"第5-6 硬切"成功（`cut` 内置枚举）。

结论：**多转场一次修订的能力问题已解决**（transition scope 生效）。

### 2.3 "模糊渐变"仍失败（模型兜底乱选）

现象：用户请求"第4镜头转场改模糊渐变；第5-6 改硬切"，硬切成功、模糊渐变失败：

```
The transition between scene_004 and scene_005 was not updated to the requested blur gradient (it was set to slide instead).
```

证据（trace `v2_director_7743b1ed-...`）：

- 导演模型原始输出（model-call.json）：只发 `timeline.patch`（scope=transition, transitionIds=transition_004,transition_005），**无 render.author**；
- skill-tool-execution-plan.json：无 render.author 提议、无拒绝记录（rejected_tools 为空）；
- planner 输入：`componentHints=`（空）、`availableComponents=`（空）——真实环境无任何渲染组件；
- 模型在无组件可用时从内置枚举选了 `slide`。

结论：**"效果→能力"核对没有归属**——没有任何一层检查"模糊渐变是否被某能力覆盖"，模型只能兜底乱选。

### 2.4 自然语言 capability_gap 尝试（已删除）

曾在 dispatcher 按整段指令的关键词和中文短语相似度判断能力。复核发现它会让“硬切＋未知效果”因命中一个内置词而整批放行，也会把纯时长、方向修改误判为能力缺失。该实现已经删除。

当前职责边界为：模型选择创作语义和效果；服务端只核验结构化 preset、component ID、purpose、目标对象和动作依赖。

### 2.5 特殊性修补被否定（补 blur 进枚举）

为让"模糊渐变"直接可用，曾把 `blur` 加进内置枚举（spec 类型、validator、planner schema、渲染分支、别名表五处同步）。被用户指出：这是**特殊性修补**，再来"爆炸"又要改五处，违背 Generalize 原则。

## 3. 架构分层（现状）

| 层 | 组件 | 职责 |
|---|---|---|
| 模型① | 导演模型（llm-intent-router） | 理解用户、判定意图、选工具、生成回复 |
| 模型② | Planner（remotion-timeline-llm-planner） | 把指令翻译成完整时间线 spec |
| 模型③ | 审查（timeline-revision-outcome-review） | 判修订结果是否满足用户请求 |
| 系统 | dispatcher | 工具执行入口：scope 合并、结构化引用校验、依赖绑定、幂等、保存 |
| 系统 | component-registry / 沙箱 | 组件静态审计、编译、注册、渲染注入 |
| 系统 | Remotion 渲染 | 真实出片 |

关键职责边界：**模型负责创作语义和能力选择，系统只验证服务端可证明的对象、资源与安全事实**。

## 4. 调查证据（逐项）

### 4.1 Remotion 转场 API 全集

文件：`remotion/node_modules/@remotion/transitions/dist/index.d.ts`

全部导出：`linearTiming`、`springTiming`、`TransitionSeries`、`useTransitionProgress`、`makeHtmlInCanvasPresentation`、`crossZoom`、`dreamyZoom`、`filmBurn`、`linearBlur`；子模块另有 `fade/slide/wipe/flip/clockWipe`。

### 4.2 本地静态文档

文件：`official-skills/skills/remotion-best-practices/remotion-markup/transitions.md`（5816 字节）

覆盖：TransitionSeries 的 Transition/Overlay 用法、可用转场（fade/slide/wipe/flip/clockWipe）、linearTiming/springTiming、方向参数、时长计算。

### 4.3 presentation 实现类型（关键）

逐个检查 `dist/presentations/*.js`：

| presentation | 实现 |
|---|---|
| crossZoom / dreamyZoom / filmBurn / linearBlur | **html-in-canvas（shader）** |
| fade / slide / wipe / flip / clockWipe | **plain（普通 React 样式）** |

### 4.4 html-in-canvas 崩溃根因

文件：`remotion/node_modules/remotion/dist/cjs/HtmlInCanvas.js` 的 `isHtmlInCanvasSupported()`：

```js
cachedSupport =
  typeof ctx?.drawElementImage === 'function' &&
  typeof canvas.requestPaint === 'function' &&
  typeof canvas.captureElementImage === 'function' &&
  'transferControlToOffscreen' in HTMLCanvasElement.prototype;
```

错误消息原文：Chrome 需 ≥148 或开 `chrome://flags/#canvas-draw-element`。

但 Remotion 启动参数已含该 flag（`remotion/node_modules/@remotion/renderer/dist/open-browser.js` 的 `featuresToEnable`：`enableAlways = ['NetworkService','NetworkServiceInProcess','CanvasDrawElement']`）→ **不是 flag 问题**。

实测完整错误（Edge 151 与 Chrome 151 相同）：

```
Failed to execute 'texElementImage2D' on 'WebGL2RenderingContext':
The provided value is not of type '(Element or ElementImage)'.
    at Object.draw (bundle.js:1052)
    at onElementImage (bundle.js:1443)
    at HTMLCanvasElement.onPaint (bundle.js:199)
```

结论：该错误只在强制使用系统 Chrome/Edge 151 时复现；Remotion 4.0.469 管理的 Headless Shell 149 可以完成同一个官方 `linearBlur` 探针。问题属于 Remotion 与浏览器版本组合不匹配，浏览器选择正是关键变量。

### 4.5 浏览器实测矩阵

| 浏览器 | 结果 |
|---|---|
| Remotion Headless Shell 149.0.7790.0 | ✅ 官方 linearBlur 与 CSS blur 均通过 |
| Edge 151.0.4129.59 | ❌ 崩（同上错误） |
| Chrome 151.0.7922.109（正式版） | ❌ 崩（同上错误） |
| CSS 实现（filter+opacity） | ✅ 在上述三种浏览器均渲染通过 |

## 5. 根因链（分层）

1. **模型行为层**：导演模型不自主查组件清单、不自主调 render.author、不填 sceneId——prompt 规则写了但模型不执行（本项目反复出现，如"指令复述当偏好"、"要求台账双写"同类）；
2. **系统层缺口**：结构化 preset、component purpose 和同轮依赖没有统一校验；
3. **运行时事实**：Remotion 4.0.469 官方 shader 与系统 Chrome/Edge 151 不兼容，但与 Remotion 管理的 Headless Shell 149 兼容；
4. **设计教训**：不能用自然语言门禁或五处枚举补丁代替结构化能力事实；浏览器覆盖必须显式配置并经过真实渲染验证。

## 6. 能力矩阵（当前环境）

| 能力 | 状态 | 说明 |
|---|---|---|
| fade / slide / wipe | ✅ 可用 | 官方 plain，渲染通过 |
| blur | ✅ 可用 | **CSS 实现已内置**（filter+opacity），渲染通过 |
| flip / clockWipe | 未开放 | 包已导出但未进入 V2 preset 协议，也未做产物级回归 |
| crossZoom / dreamyZoom / filmBurn / linearBlur | 依浏览器而定 | Headless Shell 149 可用；系统 Chrome/Edge 151 不可用，当前未开放为 V2 preset |
| 模型 CSS 组件创作 | 兜底 | 依赖模型能力，未验证成功（live 两次失败） |

## 7. 最终实施

1. 内置转场清单集中到共享协议，并由类型、Validator、Planner 和 Tool 卡片读取；Renderer 只保留真正需要的效果实现。
2. 删除自然语言 capability gate 和 componentHints 短语映射；模型从服务端提供的结构化组件清单中选择。
3. `render.author` 强制声明 purpose，组件 ID 由服务端生成；显式依赖的 timeline 动作才能首次引用同轮 draft 组件。草稿持久化时再次校验：新草稿只接受 promoted 或本轮已授权组件，修订只额外继承基础版本已绑定的 draft 组件。
4. transition 局部合并固定 ID 和 `from_scene_id/to_scene_id`，候选只能更新效果字段。
5. 未配置 `REMOTION_BROWSER_EXECUTABLE` 时交给 Remotion 使用匹配浏览器；环境变量仅作为显式覆盖。
6. 渲染失败返回通用 `render_failed` receipt；只有错误中出现具体组件 ID 时才记录组件归因，浏览器或素材失败不会错误惩罚自定义组件。
7. 每次渲染生成独立临时组件注册模块，并在 Remotion 打包时只绑定到该次任务；完成后清理，不改写共享源码，进程内和多进程并发均不会互相覆盖。
8. CSS 组件创作约束直接补入现有 Render Skill，不新增 `referenceFiles` 加载框架。

## 8. 决策记录

| 决策 | 理由 |
|---|---|
| blur 用 CSS 实现而非官方 linearBlur | 官方 shader 在当前环境实测崩溃（Remotion 4.0.469 × 浏览器 151），CSS 实现渲染通过 |
| 默认使用 Remotion 管理浏览器 | 同一个 linearBlur 探针在 Headless Shell 149 通过，在系统 Chrome/Edge 151 失败 |
| 删除自然语言能力门禁 | 整句关键词既会误放行混合请求，也会误阻断参数修改 |
| 组件能力按 ID + purpose 校验 | 可确定、可复现，并防止 scene/transition 跨域引用 |
| 直接完善现有 Skill | 单文件已经足够承载当前约束，不需要新增聚合加载机制 |

## 9. 遗留项

- flip/clockWipe 是否值得进入 V2 preset 的产品决策和产物级实测；
- Remotion 升级评估（仅在需要支持系统 Chromium 151 或新增官方 shader preset 时）；
- 模型写组件能力的一次真实验证（决定"模型 CSS 创作兜底"是否可靠）。
