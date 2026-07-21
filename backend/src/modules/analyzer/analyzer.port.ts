import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type { ParsedCreativeIntent } from '../../../../shared/types/template-schema.v1.js'
import type { UserMaterialDto } from '../../../../shared/types/pipeline.js'
import type { AudioVisualUnderstandingHints } from '../../../../shared/types/sample-understanding-skills.js'
import type {
  ReferenceMaterialInputDto,
  SampleVideoInputDto,
} from '../../../../shared/types/analyze-request.js'

export interface AnalyzeInput {
  taskId: string
  videoUrl: string
  sampleVideo?: SampleVideoInputDto
  referenceMaterials?: ReferenceMaterialInputDto[]
  creativeIntent?: ParsedCreativeIntent
  globalPrompt?: string
  materials?: UserMaterialDto[]
}

export interface AnalyzeOutput {
  structure: MigrationProtocolV12
  sampleHints?: AudioVisualUnderstandingHints
}

/** 视频理解接口 — 替换为真实 CV/LLM 服务时实现此 Port */
export interface VideoAnalyzerPort {
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>
}
