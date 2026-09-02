import type {
  DirectorSessionSnapshotInput,
  DirectorSessionState,
} from '../types/director-state.js'

export function createInitialDirectorSessionState(): DirectorSessionState {
  return {
    phase: 'idle',
    sampleStatus: 'missing',
    materialStatus: 'missing',
  }
}

export function syncDirectorSessionSnapshot(
  _previous: DirectorSessionState | undefined,
  input: DirectorSessionSnapshotInput,
): DirectorSessionState {
  const timeline = input.timeline
  const currentRevision = timeline?.currentRevision
  const hasTimeline = Boolean(timeline && timeline.status !== 'missing')
  const sampleStatus = input.isSampleParsed
    ? 'parsed'
    : input.sampleUrl?.trim()
      ? 'uploaded'
      : 'missing'
  const materialStatus = input.hasVisualMaterial
    ? 'ready'
    : input.materialCount > 0
      ? 'partial'
      : 'missing'
  const phase = timeline?.status === 'rendering'
    ? 'rendering'
    : hasTimeline
      ? timeline?.status === 'rendered' || timeline?.renderedRevision === currentRevision
        ? 'render_done'
        : 'plan_editing'
      : sampleStatus === 'parsed'
        ? 'sample_ready'
        : 'idle'

  return {
    taskId: input.taskId ?? undefined,
    phase,
    sampleStatus,
    materialStatus,
    timeline,
  }
}

export function summarizeDirectorSessionState(state?: DirectorSessionState): string {
  if (!state) return 'No director session state yet.'
  const timeline = state.timeline
  const revision = timeline?.currentRevision ? 'current plan saved' : 'no saved plan'
  const rendered = timeline?.renderedRevision ? 'current plan rendered' : 'not rendered'
  const diff = timeline?.lastChangeSummary
    ? `Last change: ${timeline.lastChangeSummary}`
    : 'No recent change.'
  return [
    `Phase: ${state.phase}`,
    `Sample: ${state.sampleStatus}`,
    `Materials: ${state.materialStatus}`,
    `Timeline: ${timeline?.status ?? 'missing'}, ${revision}, ${rendered}`,
    diff,
  ].join('\n')
}
