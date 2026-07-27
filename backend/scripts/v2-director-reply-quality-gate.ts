import { extractTextCandidate } from '../src/modules/agent-tools/structured-json-tool.js'
import { env } from '../src/config/env.js'

export type V2DirectorReplyQualityFailureKind =
  | 'capability_refusal'
  | 'unexpected_execution'
  | 'off_topic'
  | 'missing_context'
  | 'judge_protocol_failure'
  | 'judge_request_failure'

export interface V2DirectorReplyQualityVerdict {
  pass: boolean
  failure_kind: 'none' | Exclude<V2DirectorReplyQualityFailureKind, 'judge_protocol_failure' | 'judge_request_failure'>
  reason: string
  relevance_score: number
  action_alignment: 'aligned' | 'misaligned'
}

export interface V2DirectorReplyQualityInput {
  label: string
  prompt: string
  assistantResponse: string
  proposedAction: string
  expected: {
    kind: 'create' | 'discussion' | 'revise' | 'execute'
    allowedActions: string[]
    requiredFacts: string[]
  }
  currentFacts: string[]
  judge?: (input: Omit<V2DirectorReplyQualityInput, 'judge'>) => Promise<V2DirectorReplyQualityVerdict>
}

export interface V2DirectorReplyQualityResult {
  pass: boolean
  failureKind?: V2DirectorReplyQualityFailureKind
  reason: string
  deterministicChecks: string[]
  judge?: V2DirectorReplyQualityVerdict
}

const JudgeSchema = {
  type: 'object',
  required: ['pass', 'failure_kind', 'reason', 'relevance_score', 'action_alignment'],
  properties: {
    pass: { type: 'boolean' },
    failure_kind: { type: 'string', enum: ['none', 'capability_refusal', 'unexpected_execution', 'off_topic', 'missing_context'] },
    reason: { type: 'string' },
    relevance_score: { type: 'number', minimum: 0, maximum: 1 },
    action_alignment: { type: 'string', enum: ['aligned', 'misaligned'] },
  },
} as const

function hardCapabilityRefusal(message: string): boolean {
  return /我(?:不明白|不了解|无法理解|看不到|无法看到|看不见|无法访问|没有看到)|(?:我)?(?:不明白|不了解|无法理解|看不到|无法看到|看不见|无法访问|没有看到).{0,36}(?:当前|这个|方案|内容|素材|上下文)|(?:没有方案|没有素材).{0,32}(?:无法讨论|不能讨论|才可以讨论|才能讨论)/i.test(message)
}

function parseVerdict(raw: unknown): V2DirectorReplyQualityVerdict {
  const text = extractTextCandidate(raw).trim()
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (
    typeof parsed.pass !== 'boolean' ||
    typeof parsed.reason !== 'string' ||
    typeof parsed.relevance_score !== 'number' ||
    !Number.isFinite(parsed.relevance_score) ||
    (parsed.action_alignment !== 'aligned' && parsed.action_alignment !== 'misaligned') ||
    !['none', 'capability_refusal', 'unexpected_execution', 'off_topic', 'missing_context'].includes(String(parsed.failure_kind))
  ) {
    throw new Error('Judge JSON does not match the required quality verdict schema.')
  }
  return parsed as V2DirectorReplyQualityVerdict
}

async function callIndependentJudge(input: Omit<V2DirectorReplyQualityInput, 'judge'>): Promise<V2DirectorReplyQualityVerdict> {
  if (!env.directorAgentApiKey) throw new Error('DIRECTOR_AGENT_API_KEY is not configured for reply quality gate.')
  const prompt = [
    'You are an independent quality gate for a V2 video director conversation.',
    'Judge only the final assistant reply against the current user turn and supplied facts.',
    'Fail if it claims it cannot understand, see, access, or discuss supplied context; misses the question; ignores required facts; or proposes an action outside allowed actions.',
    'Do not infer hidden reasoning. Return JSON only.',
    JSON.stringify({
      label: input.label,
      user_prompt: input.prompt,
      assistant_reply: input.assistantResponse,
      proposed_action: input.proposedAction,
      expected: input.expected,
      current_facts: input.currentFacts,
    }),
  ].join('\n')
  const response = await fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.directorAgentApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.directorAgentModel,
      text: { format: { type: 'json_schema', name: 'v2_director_reply_quality', schema: JudgeSchema } },
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    }),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Quality judge returned ${response.status}: ${body.slice(0, 500)}`)
  return parseVerdict(JSON.parse(body))
}

export async function evaluateDirectorReplyQuality(input: V2DirectorReplyQualityInput): Promise<V2DirectorReplyQualityResult> {
  const deterministicChecks: string[] = []
  if (hardCapabilityRefusal(input.assistantResponse)) {
    return {
      pass: false,
      failureKind: 'capability_refusal',
      reason: 'Assistant reply contains a capability/context refusal.',
      deterministicChecks: ['capability_refusal'],
    }
  }
  deterministicChecks.push('no_capability_refusal')
  if (!input.expected.allowedActions.includes(input.proposedAction)) {
    return {
      pass: false,
      failureKind: 'unexpected_execution',
      reason: `Action ${input.proposedAction} is not allowed for ${input.expected.kind}.`,
      deterministicChecks: [...deterministicChecks, 'action_misaligned'],
    }
  }
  deterministicChecks.push('action_aligned')

  let verdict: V2DirectorReplyQualityVerdict
  try {
    verdict = await (input.judge ?? callIndependentJudge)(input)
  } catch (error) {
    return {
      pass: false,
      failureKind: /JSON|schema/i.test(error instanceof Error ? error.message : String(error))
        ? 'judge_protocol_failure'
        : 'judge_request_failure',
      reason: error instanceof Error ? error.message : String(error),
      deterministicChecks,
    }
  }
  if (!verdict.pass || verdict.action_alignment !== 'aligned' || verdict.relevance_score < 0.7) {
    return {
      pass: false,
      failureKind: verdict.failure_kind === 'none' ? 'off_topic' : verdict.failure_kind,
      reason: verdict.reason,
      deterministicChecks,
      judge: verdict,
    }
  }
  return { pass: true, reason: verdict.reason, deterministicChecks, judge: verdict }
}
