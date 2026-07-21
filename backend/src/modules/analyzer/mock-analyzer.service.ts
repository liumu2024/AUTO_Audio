import { loadMockStructure } from '../../../../shared/lib/load-mocks.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type { AnalyzeInput, AnalyzeOutput, VideoAnalyzerPort } from './analyzer.port.js'

/**
 * Mock 理解服务 — 读取 shared/mocks/02-analysis-result.v1.2.json
 * 替换真实服务：实现 VideoAnalyzerPort 并注入 Worker
 */
export class MockVideoAnalyzer implements VideoAnalyzerPort {
  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const structure = loadMockStructure()
    const promptNote = input.globalPrompt?.trim()
    const anchors = structure.semantic_anchors.map((anchor, index) => {
      if (index !== 0 || !promptNote) return anchor
      return {
        ...anchor,
        replication_instructions: {
          ...anchor.replication_instructions,
          visual_generation_prompt: `${anchor.replication_instructions.visual_generation_prompt}\n\n[用户创作指令] ${promptNote}`,
        },
      }
    })

    return {
      structure: {
        ...structure,
        semantic_anchors: anchors,
        source_video: { url: input.videoUrl, duration: structure.metadata.duration_sec },
        generated_video: {
          url: input.videoUrl,
          duration: structure.metadata.duration_sec,
        },
      },
    }
  }
}

export const mockVideoAnalyzer = new MockVideoAnalyzer()
