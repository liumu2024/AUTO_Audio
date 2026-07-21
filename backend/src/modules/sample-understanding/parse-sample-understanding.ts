import { AnalyzerResponseError } from '../video-understanding/errors.js'
import {
  normalizeSampleUnderstandingCandidate,
  type UnderstandingNormalizeContext,
} from './normalizer/sample-understanding-normalizer.js'
import {
  SampleUnderstandingResultSchema,
  type SampleUnderstandingResult,
} from './sample-understanding.schema.js'

/**
 * Ark / LLM 理解输出 → 可落库、可适配的 SampleUnderstandingResult。
 *
 * 两阶段管道（避免在 Zod 字段上零散 preprocess）：
 *   Phase A: normalizeSampleUnderstandingCandidate — 形状修复 + 枚举归一
 *   Phase B: SampleUnderstandingResultSchema — 严格契约 + 跨字段 superRefine
 */
export function parseSampleUnderstandingResult(
  candidate: unknown,
  context: UnderstandingNormalizeContext,
): SampleUnderstandingResult {
  const normalized = normalizeSampleUnderstandingCandidate(candidate, context)
  const validated = SampleUnderstandingResultSchema.safeParse(normalized)

  if (!validated.success) {
    throw new AnalyzerResponseError(
      `Responses API output does not match SampleUnderstandingResult schema: ${validated.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
      validated.error,
    )
  }

  return validated.data
}
