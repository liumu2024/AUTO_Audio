export type DirectorSessionPhase =
  | 'idle'
  | 'sample_analyzing'
  | 'sample_ready'
  | 'plan_drafting'
  | 'plan_editing'
  | 'rendering'
  | 'render_done'
  | 'failed'

/**
 * The product-facing state for whichever timeline is currently editable.
 * V2 uses this shape instead of borrowing fields from a legacy protocol.
 */
export type DirectorTimelineStatus =
  | 'missing'
  | 'draft'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'rendering'
  | 'rendered'
  | 'failed'

export interface DirectorTimelineSnapshot {
  kind: 'v2_timeline' | 'legacy_timeline'
  status: DirectorTimelineStatus
  draftId?: string
  currentRevision?: number
  savedRevision?: number
  renderedRevision?: number
  lastRunId?: string
  selectedClipId?: string
  selectedSceneId?: string
  lastChangeSummary?: string
}

export interface DirectorSessionState {
  taskId?: string
  phase: DirectorSessionPhase
  sampleStatus: 'missing' | 'uploaded' | 'analyzing' | 'parsed'
  materialStatus: 'missing' | 'partial' | 'ready'
  /** Authoritative timeline state for V2 and legacy adapters. */
  timeline?: DirectorTimelineSnapshot
}

export interface DirectorSessionSnapshotInput {
  taskId?: string | null
  sampleUrl?: string
  isSampleParsed: boolean
  hasVisualMaterial: boolean
  materialCount: number
  /** The editable timeline is supplied by the active workspace or a legacy adapter. */
  timeline?: DirectorTimelineSnapshot
}
