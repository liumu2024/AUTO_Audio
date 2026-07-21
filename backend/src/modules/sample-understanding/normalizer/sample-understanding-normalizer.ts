import { coerceStringArray, isRecord } from './json-utils.js'
import { normalizeTemplateCandidate } from './template-normalizer.js'

export interface UnderstandingNormalizeContext {
  taskId: string
}

function normalizeIntent(value: unknown): unknown {
  if (isRecord(value)) {
    return {
      ...value,
      style_keywords: coerceStringArray(value.style_keywords),
      must_keep: coerceStringArray(value.must_keep),
      must_change: coerceStringArray(value.must_change),
    }
  }
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    return {
      raw_text: text,
      goal: 'generate_variant',
      style_keywords: [],
      must_keep: [],
      must_change: [],
      generation_directive: text,
    }
  }
  return value
}

function normalizeSource(value: unknown): unknown {
  if (!isRecord(value)) return value
  const sampleVideo = isRecord(value.sample_video) ? value.sample_video : {}
  const materials = Array.isArray(value.reference_materials)
    ? value.reference_materials.filter(isRecord).map((item) => ({
        ...item,
        role: 'slot_candidate',
        tags: coerceStringArray(item.tags),
      }))
    : []
  return {
    ...value,
    sample_video: {
      ...sampleVideo,
      role: 'structure_source',
    },
    reference_materials: materials,
  }
}

function normalizeSampleAnalysis(value: unknown): unknown {
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    return {
      hook_formula: text,
      narrative_arc: text,
      conversion_logic: text,
      audience_trigger: text,
      reusable_pattern: text,
    }
  }
  return value
}

/**
 * 样例理解结果统一归一化入口（在 Zod 严格校验之前执行）。
 *
 * 管道阶段：
 * 1. 顶层 task / version
 * 2. source / intent / sample_analysis
 * 3. template（结构、转场、render_recipe、槽位）
 */
export function normalizeSampleUnderstandingCandidate(
  value: unknown,
  context: UnderstandingNormalizeContext,
): unknown {
  if (!isRecord(value)) return value

  const intent = normalizeIntent(value.intent)
  const template = value.template
    ? normalizeTemplateCandidate(value.template, {
        intent: isRecord(intent) ? intent : undefined,
      })
    : value.template

  return {
    ...value,
    schema_version: 'sample_understanding.v1',
    task_id: context.taskId,
    source: normalizeSource(value.source),
    intent,
    sample_analysis: normalizeSampleAnalysis(value.sample_analysis),
    template,
  }
}
