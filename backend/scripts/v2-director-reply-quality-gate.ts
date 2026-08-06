import { extractTextCandidate } from '../src/modules/agent-tools/structured-json-tool.js'
import { env } from '../src/config/env.js'

export type V2DirectorReplyQualityFailureKind =
  | 'capability_refusal'
  | 'off_topic'
  | 'missing_context'
  | 'judge_protocol_failure'
  | 'judge_request_failure'

export interface V2DirectorReplyQualityVerdict {
  pass: boolean
  failure_kind: 'none' | Exclude<V2DirectorReplyQualityFailureKind, 'judge_protocol_failure' | 'judge_request_failure'>
  reason: string
  relevance_score: number
}

export interface V2DirectorJudgeUsage {
  input: number
  output: number
  total: number
  calls: number
}

export interface V2DirectorReplyQualityInput {
  label: string
  prompt: string
  assistantResponse: string
  expected: {
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
  judgeUsage: V2DirectorJudgeUsage
}

const JudgeSchema = {
  type: 'object',
  required: ['pass', 'failure_kind', 'reason', 'relevance_score'],
  additionalProperties: false,
  properties: {
    pass: { type: 'boolean' },
    failure_kind: { type: 'string', enum: ['none', 'capability_refusal', 'off_topic', 'missing_context'] },
    reason: { type: 'string' },
    relevance_score: { type: 'number', minimum: 0, maximum: 1 },
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
    !['none', 'capability_refusal', 'off_topic', 'missing_context'].includes(String(parsed.failure_kind)) ||
    (parsed.pass === true && parsed.failure_kind !== 'none') ||
    (parsed.pass === false && parsed.failure_kind === 'none')
  ) {
    throw new Error('Judge JSON does not match the required quality verdict schema.')
  }
  return parsed as unknown as V2DirectorReplyQualityVerdict
}

function judgeUsage(raw: unknown): V2DirectorJudgeUsage {
  const usage = raw && typeof raw === 'object' && (raw as Record<string, unknown>).usage
  const record = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {}
  const input = Number(record.input_tokens ?? record.prompt_tokens ?? 0)
  const output = Number(record.output_tokens ?? record.completion_tokens ?? 0)
  return {
    input,
    output,
    total: Number(record.total_tokens ?? input + output),
    calls: 1,
  }
}

function semanticContainsReply(value: string, fact: string): boolean {
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, '')
  if (normalize(value).includes(normalize(fact))) return true
  const tokenize = (text: string) => {
    const normalized = normalize(text).toLocaleLowerCase()
    const ascii = normalized.match(/[a-z0-9]+/g) ?? []
    const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? []
    const han = hanRuns.flatMap((run) => {
      const chars = [...run]
      if (chars.length < 2) return chars
      return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)
    })
    return [...ascii, ...han]
  }
  const valueTokens = new Set(tokenize(value))
  const factTokens = tokenize(fact)
  if (!factTokens.length) return false
  return factTokens.filter((token) => valueTokens.has(token)).length / factTokens.length >= 0.5
}

async function callIndependentJudge(input: Omit<V2DirectorReplyQualityInput, 'judge'>): Promise<{
  verdict: V2DirectorReplyQualityVerdict
  usage: V2DirectorJudgeUsage
}> {
  if (!env.directorAgentApiKey) throw new Error('DIRECTOR_AGENT_API_KEY is not configured for reply quality gate.')
  const prompt = [
    'You are an independent quality gate for a V2 video director conversation.',
    'Judge only the final assistant reply against the current user turn and supplied facts.',
    'Fail if it claims it cannot understand, see, access, or discuss supplied context; misses the question; ignores required facts; or gives an irrelevant reply.',
    'Treat current_facts as authoritative outcomes. A reply that accurately explains an actual Tool failure and gives relevant recovery is on-topic even though the requested operation did not complete.',
    'A reply that answers the user\'s question about the current draft version/state is on-topic when a draft exists; do not flag off_topic merely because the reply discusses the draft or its revision.',
    'Evaluate whether outcome claims are faithful, but do not independently judge Tool choice, state mutation, authorization, or structured persistence.',
    'Only expected.requiredFacts are mandatory facts for the reply. Do not invent additional required facts from execution-boundary phrases such as "temporarily do not modify the plan".',
    'Do not infer hidden reasoning. Return JSON only.',
    JSON.stringify({
      label: input.label,
      user_prompt: input.prompt,
      assistant_reply: input.assistantResponse,
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
  const raw = JSON.parse(body)
  return { verdict: parseVerdict(raw), usage: judgeUsage(raw) }
}

export async function evaluateDirectorReplyQuality(input: V2DirectorReplyQualityInput): Promise<V2DirectorReplyQualityResult> {
  const deterministicChecks: string[] = []
  const capabilityRefusal = hardCapabilityRefusal(input.assistantResponse)
  deterministicChecks.push(capabilityRefusal ? 'capability_refusal' : 'no_capability_refusal')

  let verdict: V2DirectorReplyQualityVerdict
  let usage: V2DirectorJudgeUsage
  try {
    if (input.judge) {
      verdict = await input.judge(input)
      usage = { input: 0, output: 0, total: 0, calls: 1 }
    } else {
      const judged = await callIndependentJudge(input)
      verdict = judged.verdict
      usage = judged.usage
    }
  } catch (error) {
    return {
      pass: false,
      failureKind: /JSON|schema/i.test(error instanceof Error ? error.message : String(error))
        ? 'judge_protocol_failure'
        : 'judge_request_failure',
      reason: error instanceof Error ? error.message : String(error),
      deterministicChecks,
      judgeUsage: { input: 0, output: 0, total: 0, calls: 1 },
    }
  }
  if (capabilityRefusal) {
    return {
      pass: false,
      failureKind: 'capability_refusal',
      reason: 'Assistant reply contains a capability/context refusal.',
      deterministicChecks,
      judge: verdict,
      judgeUsage: usage,
    }
  }
  const requiredFacts = input.expected?.requiredFacts ?? []
  if (
    !verdict.pass
    && (verdict.failure_kind === 'missing_context' || verdict.failure_kind === 'off_topic')
    && requiredFacts.length > 0
    && requiredFacts.every((fact) => semanticContainsReply(input.assistantResponse, fact))
  ) {
    return {
      pass: true,
      reason: `${verdict.failure_kind} 判定被语义复核放行：回复已包含全部必需事实。`,
      deterministicChecks,
      judge: verdict,
      judgeUsage: usage,
    }
  }
  if (!verdict.pass || verdict.relevance_score < 0.7) {
    return {
      pass: false,
      failureKind: verdict.failure_kind === 'none' ? 'off_topic' : verdict.failure_kind,
      reason: verdict.reason,
      deterministicChecks,
      judge: verdict,
      judgeUsage: usage,
    }
  }
  return { pass: true, reason: verdict.reason, deterministicChecks, judge: verdict, judgeUsage: usage }
}
