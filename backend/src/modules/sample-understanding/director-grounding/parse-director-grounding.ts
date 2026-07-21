import { AnalyzerResponseError } from '../../video-understanding/errors.js'
import { normalizeDirectorGroundingCandidate } from './director-grounding-normalizer.js'
import {
  DirectorGroundingResultSchema,
  type DirectorGroundingResult,
} from './director-grounding.schema.js'

export function parseDirectorGroundingResult(
  candidate: unknown,
  taskId: string,
): DirectorGroundingResult {
  const normalized = normalizeDirectorGroundingCandidate(candidate)
  const validated = DirectorGroundingResultSchema.safeParse(normalized)
  if (!validated.success) {
    throw new AnalyzerResponseError(
      `Responses API output does not match DirectorGroundingResult schema: ${validated.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
      validated.error,
    )
  }

  if (validated.data.task_id !== taskId) {
    throw new AnalyzerResponseError(
      `DirectorGroundingResult task_id mismatch: expected ${taskId}, got ${validated.data.task_id}`,
    )
  }

  return validated.data
}
