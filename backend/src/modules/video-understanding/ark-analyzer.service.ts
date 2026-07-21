import type { AnalyzeInput, AnalyzeOutput, VideoAnalyzerPort } from '../analyzer/analyzer.port.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import { templateToMigrationProtocolV12 } from '../../../../shared/lib/template-to-migration.adapter.js'
import { broadcastTaskProgress } from '../websocket/ws.gateway.js'
import { ArkFilesResponsesAnalyzer } from './ark/ark-files-responses.analyzer.js'
import { resolveVideoInput } from './resolve-video-input.js'
import { isUnderstandingConfigured } from './understanding-env.js'

const arkAnalyzer = new ArkFilesResponsesAnalyzer()

/**
 * 真实视频理解 — 参考 test_module/understanding，接入 Ark Files + Responses。
 * 未配置 VIDEO_UNDERSTANDING_API_KEY 时不应调用。
 */
export class ArkVideoAnalyzerService implements VideoAnalyzerPort {
  async analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    if (!isUnderstandingConfigured()) {
      throw new Error('VIDEO_UNDERSTANDING_API_KEY is not configured')
    }

    const video = await resolveVideoInput(input.videoUrl)
    let sampleHints: AnalyzeOutput['sampleHints']

    const result = await arkAnalyzer.analyze(video, {
      taskId: input.taskId,
      videoUrl: input.videoUrl,
      globalPrompt: input.globalPrompt,
      materials: input.materials,
      onSampleHints: (hints) => {
        sampleHints = hints
      },
      reportProgress: ({ progress, stage }) => {
        broadcastTaskProgress(input.taskId, {
          progress,
          stage,
          log: `[理解] ${stage}`,
        })
      },
    })

    const migration = templateToMigrationProtocolV12(result.template, {
      taskId: input.taskId,
      videoUrl: input.videoUrl,
      materials: input.materials,
    })
    return {
      structure: {
        ...migration,
        director_grounding: result.director_grounding,
      },
      sampleHints,
    }
  }
}

export const arkVideoAnalyzer = new ArkVideoAnalyzerService()
