/**
 * V2-only interfaces for capabilities intentionally not executable yet.
 * They make future persistence/retrieval/audio work explicit without allowing
 * the current director to claim that it can perform the work.
 */
export interface CreativeMemoryRecord {
  id: string
  ownerUserId: number
  scope: 'user' | 'project'
  kind: 'preference' | 'timeline_fragment' | 'template' | 'component_preset' | 'retrospective'
  title: string
  facts: Record<string, unknown>
  confirmed: boolean
  createdAt: string
  updatedAt: string
}

export interface CreativeMemoryChunk {
  id: string
  recordId: string
  text: string
  embedding?: number[]
  metadata: Record<string, string | number | boolean>
}

export interface CreativeMemoryQuery {
  ownerUserId: number
  projectId?: string
  text: string
  filters: Record<string, string | number | boolean>
  limit: number
}

export interface CreativeMemoryRetrievalResult {
  record: CreativeMemoryRecord
  score: number
  source: 'keyword' | 'vector' | 'hybrid'
  explanation: string
}

export interface CreativeMemoryRepository {
  search(query: CreativeMemoryQuery): Promise<CreativeMemoryRetrievalResult[]>
  proposeWrite(record: Omit<CreativeMemoryRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<CreativeMemoryRecord>
}

export type V2AudioAssetKind = 'user_audio' | 'bgm' | 'ai_video_embedded_audio' | 'tts_narration' | 'ambient' | 'sfx'

export interface V2AudioAssetDescriptor {
  id: string
  kind: V2AudioAssetKind
  src: string
  durationSec?: number
  editable: boolean
  origin: 'user' | 'provider' | 'future_tts'
}

export interface V2SubtitleNarrationAlignment {
  captionOverlayId: string
  audioAssetId: string
  startSec: number
  endSec: number
  wordTimings?: Array<{ word: string; startSec: number; endSec: number }>
  status: 'planned' | 'aligned' | 'needs_revision'
}
