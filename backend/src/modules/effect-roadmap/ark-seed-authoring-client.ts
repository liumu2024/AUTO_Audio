import { env } from '../../config/env.js'
import { AnalyzerResponseError } from '../video-understanding/errors.js'
import { parseJsonFromText, extractResponsesText } from './parse-effect-roadmap.js'
import { buildSeedAuthoringPrompt } from './seed-authoring-prompt.js'
import type {
  SeedAuthoringClient,
  SeedAuthoringInvokeResult,
  SeedAuthoringProposalDraft,
  SeedPluginAuthoringRequestPayload,
} from './seed-plugin-mapper.js'
import { createUnavailableSeedAuthoringClient } from './seed-authoring-client.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSeedProposalDraft(value: unknown): SeedAuthoringProposalDraft | null {
  if (!isRecord(value)) return null
  if (typeof value.atom_id !== 'string' || typeof value.missing_atom_id !== 'string') return null
  if (typeof value.plugin_id !== 'string' || typeof value.plugin_family !== 'string') return null
  if (value.target_layer !== 'effect' && value.target_layer !== 'overlay') return null

  return {
    atom_id: value.atom_id,
    missing_atom_id: value.missing_atom_id,
    plugin_id: value.plugin_id,
    plugin_family: value.plugin_family,
    target_layer: value.target_layer,
    must_match: isRecord(value.must_match)
      ? (value.must_match as SeedAuthoringProposalDraft['must_match'])
      : {},
    can_adapt: Array.isArray(value.can_adapt)
      ? value.can_adapt.filter((item): item is string => typeof item === 'string')
      : [],
    fallback:
      value.fallback === null
        ? null
        : isRecord(value.fallback) && typeof value.fallback.reason === 'string'
          ? (value.fallback as unknown as SeedAuthoringProposalDraft['fallback'])
          : null,
    loss_risk: Array.isArray(value.loss_risk)
      ? (value.loss_risk as SeedAuthoringProposalDraft['loss_risk'])
      : [],
    manifest: isRecord(value.manifest) ? value.manifest : undefined,
    component_summary:
      typeof value.component_summary === 'string' ? value.component_summary : undefined,
  }
}

function parseSeedInvokeResult(raw: string, body: unknown): SeedAuthoringInvokeResult {
  let candidate: unknown = body
  if (!(isRecord(body) && Array.isArray(body.proposals))) {
    const text = extractResponsesText(body) || raw
    candidate = parseJsonFromText(text)
  }

  if (!isRecord(candidate) || !Array.isArray(candidate.proposals)) {
    throw new AnalyzerResponseError('Seed authoring response missing proposals[].')
  }

  const proposals = candidate.proposals
    .map((item) => parseSeedProposalDraft(item))
    .filter((item): item is SeedAuthoringProposalDraft => item !== null)

  return {
    available: true,
    raw_response: raw,
    proposals,
  }
}

export function isSeedPluginAuthoringConfigured(): boolean {
  return Boolean(env.enableSeedPluginAuthoring && env.seedPluginAuthoringApiKey)
}

export function createArkSeedAuthoringClient(): SeedAuthoringClient {
  return {
    invoke: async (input: {
      taskId: string
      request: SeedPluginAuthoringRequestPayload
    }): Promise<SeedAuthoringInvokeResult> => {
      if (!env.seedPluginAuthoringApiKey) {
        return createUnavailableSeedAuthoringClient('Seed authoring API key missing').invoke(input)
      }

      const prompt = buildSeedAuthoringPrompt(input.taskId, input.request)
      const response = await fetch(env.seedPluginAuthoringResponsesUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.seedPluginAuthoringApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.seedPluginAuthoringModel,
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: prompt }],
            },
          ],
        }),
        signal: AbortSignal.timeout(env.seedPluginAuthoringTimeoutMs),
      })

      const raw = await response.text()
      if (!response.ok) {
        return {
          available: false,
          raw_response: raw,
          proposals: [],
          unavailable_reason: `Seed authoring API returned ${response.status}`,
        }
      }

      let body: unknown = raw
      try {
        body = JSON.parse(raw) as unknown
      } catch {
        body = raw
      }

      try {
        return parseSeedInvokeResult(raw, body)
      } catch (error) {
        return {
          available: false,
          raw_response: raw,
          proposals: [],
          unavailable_reason:
            error instanceof Error ? error.message : 'Seed authoring response parse failed',
        }
      }
    },
  }
}

export function resolveSeedAuthoringClient(override?: SeedAuthoringClient): SeedAuthoringClient {
  if (override) return override
  if (isSeedPluginAuthoringConfigured()) {
    return createArkSeedAuthoringClient()
  }
  return createUnavailableSeedAuthoringClient()
}
