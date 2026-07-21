import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'

export interface GenerateInput {
  taskId: string
  prompt?: string
  structure: MigrationProtocolV12
  renderPlan?: RenderPlanV1
  sampleVideoUrl?: string
}

export interface GenerateOutput {
  finalVideoUrl: string
  durationSec: number
}

/** 视频生成接口 — 替换为 FFmpeg / AIGC 管线时实现此 Port */
export interface VideoGeneratorPort {
  generate(input: GenerateInput): Promise<GenerateOutput>
}
