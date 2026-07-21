import { env } from '../../config/env.js'
import type { AudioVisualUnderstandingHints } from '../../../../shared/types/sample-understanding-skills.js'
import type { EffectRoadmap } from '../../../../shared/types/effect-roadmap.v1.js'
import type { DirectorGroundingResult } from '../sample-understanding/director-grounding/director-grounding.schema.js'
import { AnalyzerResponseError } from '../video-understanding/errors.js'
import {
  buildRoadmapAgentPrompt,
  buildRoadmapAgentRepairPrompt,
} from './roadmap-agent-prompt.js'
import { buildRoadmapPluginRegistrySnapshot } from './roadmap-plugin-registry-snapshot.js'
import {
  extractEffectRoadmapFromResponsesBody,
  extractResponsesText,
  parseJsonFromText,
} from './parse-effect-roadmap.js'

export type RoadmapAgentRunStatus = 'ok' | 'disabled' | 'skipped' | 'failed'

export interface RoadmapAgentLlmClient {
  complete(prompt: string): Promise<{ raw: string; body: unknown }>
}

export interface RunRoadmapAgentInput {
  taskId: string
  directorGrounding: DirectorGroundingResult | null | undefined
  sampleHints?: AudioVisualUnderstandingHints
}

export interface RunRoadmapAgentResult {
  status: RoadmapAgentRunStatus
  roadmap: EffectRoadmap | null
  /** @deprecated use initialRawResponse + repairRawResponse */
  rawResponse: string
  initialRawResponse: string
  repairRawResponse: string
  repairRounds: number
  error?: string
}

const MAX_REPAIR_ROUNDS = 2

export function isRoadmapAgentConfigured(): boolean {
  return Boolean(env.roadmapAgentEnabled && env.roadmapAgentApiKey)
}

export function createArkRoadmapAgentLlmClient(): RoadmapAgentLlmClient {
  return {
    complete: async (prompt: string) => {
      if (!env.roadmapAgentApiKey) {
        throw new AnalyzerResponseError('ROADMAP_AGENT_API_KEY is not configured.')
      }

      const response = await fetch(env.roadmapAgentResponsesUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.roadmapAgentApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.roadmapAgentModel,
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: prompt }],
            },
          ],
        }),
        signal: AbortSignal.timeout(env.roadmapAgentTimeoutMs),
      })

      const raw = await response.text()
      if (!response.ok) {
        throw new AnalyzerResponseError(
          `Roadmap agent Responses API returned ${response.status}: ${raw.slice(0, 800)}`,
        )
      }

      let body: unknown = raw
      try {
        body = JSON.parse(raw) as unknown
      } catch {
        body = raw
      }

      return { raw, body }
    },
  }
}

function buildInitialPrompt(input: RunRoadmapAgentInput): string {
  return buildRoadmapAgentPrompt({
    taskId: input.taskId,
    directorGrounding: input.directorGrounding as DirectorGroundingResult,
    sampleHints: input.sampleHints,
    pluginRegistrySnapshot: buildRoadmapPluginRegistrySnapshot(),
  })
}

function resolveCandidateFromResponse(input: {
  raw: string
  body: unknown
}): { candidate: unknown; sourceText: string } {
  if (typeof input.body === 'object' && input.body !== null && 'schema_version' in input.body) {
    return { candidate: input.body, sourceText: input.raw }
  }

  const sourceText = extractResponsesText(input.body) || input.raw
  const candidate = parseJsonFromText(sourceText)
  return { candidate, sourceText }
}

export async function runRoadmapAgent(
  input: RunRoadmapAgentInput,
  llmClient: RoadmapAgentLlmClient = createArkRoadmapAgentLlmClient(),
): Promise<RunRoadmapAgentResult> {
  if (!isRoadmapAgentConfigured()) {
    return {
      status: 'disabled',
      roadmap: null,
      rawResponse: 'Roadmap agent disabled or API key missing.\n',
      initialRawResponse: 'Roadmap agent disabled or API key missing.\n',
      repairRawResponse: '',
      repairRounds: 0,
    }
  }

  if (!input.directorGrounding) {
    return {
      status: 'skipped',
      roadmap: null,
      rawResponse: 'Roadmap agent skipped: director_grounding missing.\n',
      initialRawResponse: 'Roadmap agent skipped: director_grounding missing.\n',
      repairRawResponse: '',
      repairRounds: 0,
    }
  }

  let prompt = buildInitialPrompt(input)
  let initialRawResponse = ''
  const repairRawChunks: string[] = []
  let repairRounds = 0

  try {
    for (let attempt = 0; attempt <= MAX_REPAIR_ROUNDS; attempt += 1) {
      const { raw, body } = await llmClient.complete(prompt)
      if (attempt === 0) {
        initialRawResponse = raw
      } else {
        repairRawChunks.push(raw)
      }

      let candidate: unknown | undefined
      let sourceText = extractResponsesText(body) || raw

      try {
        const resolved = resolveCandidateFromResponse({ raw, body })
        candidate = resolved.candidate
        sourceText = resolved.sourceText
        const roadmap = extractEffectRoadmapFromResponsesBody(candidate, input.taskId)
        const repairRawResponse = repairRawChunks.join('\n\n')
        return {
          status: 'ok',
          roadmap,
          rawResponse: [initialRawResponse, repairRawResponse].filter(Boolean).join('\n\n'),
          initialRawResponse,
          repairRawResponse,
          repairRounds,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt >= MAX_REPAIR_ROUNDS) {
          throw new AnalyzerResponseError(message, error)
        }

        repairRounds += 1
        prompt = buildRoadmapAgentRepairPrompt({
          taskId: input.taskId,
          validationError: message,
          previousJson: candidate,
          previousRawText: candidate === undefined ? sourceText : undefined,
        })
      }
    }

    throw new AnalyzerResponseError('Roadmap agent exhausted repair rounds without valid output.')
  } catch (error) {
    const repairRawResponse = repairRawChunks.join('\n\n')
    return {
      status: 'failed',
      roadmap: null,
      rawResponse: [initialRawResponse, repairRawResponse].filter(Boolean).join('\n\n'),
      initialRawResponse,
      repairRawResponse,
      repairRounds,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
