import type {
  DirectorContextSlots,
  DirectorMaterialStatus,
  DirectorReferenceSummary,
  DirectorSampleVideoStatus,
} from '../types/director-context.js'
import type { V2SampleUnderstandingResult } from '../types/v2-sample-understanding.js'

export interface DirectorConversationRuntime {
  backendEnabled: boolean
  sampleUrl: string
  sampleName?: string
  isSampleParsed: boolean
  activeTaskId?: string | null
  hasV2Timeline?: boolean
  v2TaskId?: string | null
  v2SceneCount?: number
  v2TraceDir?: string | null
  hasVisualMaterial: boolean
  materialCount: number
  /** Video materials that the director may explicitly promote to a sample reference. */
  sampleCandidates?: Array<{ id: string; url: string; name?: string }>
}

export function createDefaultDirectorSlots(
  partial?: Partial<DirectorContextSlots>,
): DirectorContextSlots {
  return {
    sampleVideoStatus: 'missing',
    materialStatus: 'missing',
    contentDomain: 'general',
    aspectRatio: '9:16',
    styleIntensity: 'medium',
    ...partial,
  }
}

export function mergeDirectorSlots(
  base: DirectorContextSlots,
  patch: Partial<DirectorContextSlots>,
): DirectorContextSlots {
  return {
    ...base,
    ...patch,
    pendingConfirmation: patch.pendingConfirmation ?? base.pendingConfirmation,
  }
}

export function deriveRuntimeSlotStatus(
  runtime: DirectorConversationRuntime,
): Pick<DirectorContextSlots, 'sampleVideoStatus' | 'materialStatus'> {
  const sampleVideoStatus: DirectorSampleVideoStatus = runtime.isSampleParsed
    ? 'parsed'
    : runtime.sampleUrl.trim()
      ? 'attached'
      : 'missing'

  const materialStatus: DirectorMaterialStatus = runtime.hasVisualMaterial
    ? runtime.materialCount > 0
      ? 'ready'
      : 'partial'
    : 'missing'

  return { sampleVideoStatus, materialStatus }
}

export function summarizeDirectorReference(
  understanding: V2SampleUnderstandingResult,
): DirectorReferenceSummary {
  return {
    source: 'sample_video',
    summary: understanding.summary,
    methodHighlights: understanding.method_observations.slice(0, 6).map((item) => item.expression),
    transferableKnowledge: understanding.transferable_knowledge.slice(0, 6).map((item) => item.statement),
    shotCount: (understanding.shot_evidence ?? []).filter((shot) => shot.confidence >= 0.6).length,
    warnings: understanding.warnings,
  }
}
