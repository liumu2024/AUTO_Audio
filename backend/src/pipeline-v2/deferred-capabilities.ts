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
