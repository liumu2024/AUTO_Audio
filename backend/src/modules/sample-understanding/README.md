# sample-understanding

样例理解层：**契约（schema）** 与 **归一化（normalizer）** 分离。

## 管道（生产路径）

```
Ark Responses JSON
  → parseSampleUnderstandingResult()     # 唯一入口
       Phase A: normalizeSampleUnderstandingCandidate()
       Phase B: SampleUnderstandingResultSchema (严格 Zod)
  → templateToMigrationProtocolV12()
  → MigrationProtocolV12 / RenderPlan
```

调用方：`video-understanding/ark/ark-files-responses.analyzer.ts`

## 目录

| 路径 | 职责 |
|------|------|
| `parse-sample-understanding.ts` | 对外 API：`parseSampleUnderstandingResult` |
| `normalizer/sample-understanding-normalizer.ts` | 顶层归一化编排 |
| `normalizer/template-normalizer.ts` | `template`：structure / slots / transitions / render_recipe |
| `prompts/` | Director Grounding `.md` 模板 + `prompt-loader.ts` |
| `director-grounding/director-grounding-prompt.ts` | 组装模板变量与任务上下文，不写长规则 |
| `normalizer/enum-coercion.ts` | 枚举与别名映射（转场方向、特效 preset、槽位类型等） |
| `normalizer/json-utils.ts` | 通用 JSON 工具（`coerceStringArray`、id 规范化） |
| `sample-understanding.schema.ts` | **仅**严格 Zod + `superRefine`，不做字段级补丁 |

## 扩展方式

新增 LLM 易错字段时：

1. 在 `enum-coercion.ts` 或 `template-normalizer.ts` 增加映射/默认值  
2. 在 `sample-understanding.schema.ts` 补充严格类型（若为新字段）  
3. 在 `video-understanding-prompt.ts` 写清合法枚举  

避免在 `schema.ts` 内新增零散的 `z.preprocess`。

## 相关文档

- [docs/SAMPLE_UNDERSTANDING_LAYER.md](../../../docs/SAMPLE_UNDERSTANDING_LAYER.md)
- [shared/types/template-schema.v1.ts](../../../shared/types/template-schema.v1.ts)
