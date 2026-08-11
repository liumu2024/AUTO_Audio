export const V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION = 'v2_sample_understanding.v2' as const

export type V2SampleUnderstandingSource = 'llm' | 'heuristic' | 'llm_fallback'

export interface V2SampleEvidenceRange {
  start_sec: number
  end_sec: number
}

export interface V2SampleShotEvidence {
  id: string
  start_sec: number
  end_sec: number
  boundary: 'hard_cut' | 'soft_transition' | 'continuous' | 'end' | 'unknown'
  confidence: number
  description?: string
}

export interface V2SampleUnderstandingResult {
  schema_version: typeof V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION
  task_id: string
  source: V2SampleUnderstandingSource
  sample: {
    name?: string
    duration_sec: number
    width?: number
    height?: number
    fps?: number
  }
  summary: string
  content_observations: Array<{
    statement: string
    evidence_ranges: V2SampleEvidenceRange[]
  }>
  method_observations: Array<{
    id: string
    expression: string
    purpose: string
    timing_rationale: string
    evidence_ranges: V2SampleEvidenceRange[]
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
