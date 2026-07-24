export interface V2TimelineDraftHistoryCardInput {
  draftId: string
  creationMode: 'sample_replicate' | 'material_brief' | 'text_to_video'
  createdAt: string
  updatedAt: string
  latestRun?: {
    status: 'running' | 'completed' | 'failed'
    outputUrl?: string
  }
}

export interface V2TimelineDraftHistoryCard {
  id: string
  title: string
  status: 'draft' | 'running' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  previewUrl?: string
}

const CREATION_MODE_LABEL: Record<V2TimelineDraftHistoryCardInput['creationMode'], string> = {
  sample_replicate: '样例复刻方案',
  material_brief: '素材成片方案',
  text_to_video: '文生视频方案',
}

export function mapV2TimelineDraftHistoryCard(
  draft: V2TimelineDraftHistoryCardInput,
): V2TimelineDraftHistoryCard {
  const runStatus = draft.latestRun?.status
  return {
    id: draft.draftId,
    title: CREATION_MODE_LABEL[draft.creationMode],
    status:
      runStatus === 'completed'
        ? 'completed'
        : runStatus === 'running'
          ? 'running'
          : runStatus === 'failed'
            ? 'failed'
            : 'draft',
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    previewUrl: runStatus === 'completed' ? draft.latestRun?.outputUrl : undefined,
  }
}
