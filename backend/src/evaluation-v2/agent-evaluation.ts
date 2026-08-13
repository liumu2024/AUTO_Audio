import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createDefaultDirectorSlots } from '../../../shared/lib/director-understanding.js'
import type { DirectorContext } from '../../../shared/types/director-context.js'
import type { DirectorWorkspaceState } from '../../../shared/types/director-workspace-session.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2SampleUnderstandingResult } from '../../../shared/types/v2-sample-understanding.js'
import { validateRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import { streamDirectorAgentChat } from '../modules/director-agent/director-agent.service.js'
import type { DirectorAgentStreamEvent } from '../../../shared/types/director-stream.js'
import {
  dispatchV2AgentTool,
  type V2AgentToolResult,
} from '../pipeline-v2/agent-tools/dispatcher.js'
import { evaluateV2AgentToolReadiness } from '../pipeline-v2/agent-tools/registry.js'
import { createV2TimelineDraftRepository } from '../pipeline-v2/timeline-draft-repository.js'
import { buildDirectorTimelineFacts } from '../pipeline-v2/timeline-revision-outcome-review.js'
import type { V2TimelineRevisionScope } from '../pipeline-v2/timeline-revision-scope.js'
import { evaluateDirectorReplyQuality } from '../../scripts/v2-director-reply-quality-gate.js'
import { validateAllowedMutationRules } from './agent-evaluation-contract.js'

type Fixture = 'empty' | 'draft' | 'material' | 'sample' | 'scifi_draft'
type ExpectedKind = 'create' | 'discussion' | 'revise' | 'execute'

interface ExpectedTurn {
  skills?: string[]
  tools: string[]
  kind: ExpectedKind
  requiredFacts?: string[]
  stateAction?: 'none' | 'add' | 'replace' | 'revoke'
  actionReceipts?: Array<{ ref: string; status: 'succeeded' | 'failed' | 'skipped' }>
  independentActionRefs?: string[]
  dependencyRequired?: boolean
  recovery?: boolean
  memoryAction?: {
    operation: 'none' | 'add' | 'replace' | 'revoke'
    scopeType?: 'user' | 'draft'
    status?: 'active' | 'candidate'
    requiredFacts?: string[]
  }
  retrievedActiveMemoryFacts?: string[]
  retrievedCandidateMemoryFacts?: string[]
  forbiddenRetrievedMemoryFacts?: string[]
  memoryReplyFacts?: string[]
  forbiddenMemoryReplyFacts?: string[]
  activeRequirements?: string[]
  supersededRequirements?: string[]
  revokedRequirements?: string[]
  plannerActiveRequirements?: string[]
  plannerInactiveRequirements?: string[]
  plannerMemoryFacts?: string[]
  draftChange?: boolean
  creationMode?: 'text_to_video' | 'material_brief' | 'sample_replicate'
  effectiveAspectRatio?: string
  effectiveDurationSec?: number
  subtitleOnly?: boolean
  revisionScope?: V2TimelineRevisionScope
  revisionSceneId?: string
  revisionTargetCount?: number
  toolSuccess?: boolean
  dryRender?: boolean
  timeline?: {
    requiredVisibleText?: string[]
    forbiddenVisibleText?: string[]
    usesProvidedMaterial?: boolean
    aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3'
    durationSec?: number
    sceneCount?: number
    transitionCount?: number
    requiredTransitionTypes?: string[]
    forbiddenTransitionTypes?: string[]
    requiredOverlayRanges?: Array<{ text: string; startSec: number; endSec: number }>
    requiredOverlayStyles?: Array<{ type: 'caption' | 'title' | 'label'; backgroundAlpha?: number; opacity?: number }>
    requiredSceneFacts?: Array<{ sceneId: string; facts: string[] }>
    requiredSceneMotions?: Array<{ sceneId: string; motion: 'none' | 'slow_zoom_in' | 'slow_zoom_out' | 'pan_left' | 'pan_right' }>
    requiredCreativeBriefFacts?: string[]
    requiredTransitionDetails?: Array<{ id: string; type: string; durationSec: number }>
    allowedMutations?: Array<{
      object: 'scene' | 'overlay' | 'transition' | 'material_job' | 'creative_brief'
      ids?: string[]
      fields: string[]
    }>
  }
}

interface EvaluationTurn {
  prompt: string
  simulateFailure?: string
  expected: ExpectedTurn
}

interface EvaluationCase {
  id: string
  category: string
  fixture: Fixture
  materials?: Array<{
    id: string
    type: 'image' | 'video' | 'audio'
    name: string
    tags?: string[]
  }>
  ui?: {
    aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3'
    durationSec?: number
    styleIntensity?: 'light' | 'medium' | 'strong'
  }
  turns: EvaluationTurn[]
}

interface EvaluationSuite {
  version: string
  cases: EvaluationCase[]
}

function parseEvaluationSuite(source: string, file: string): EvaluationSuite {
  const value = JSON.parse(source) as unknown
  if (!value || typeof value !== 'object') throw new Error(`${file}: suite must be an object.`)
  const suite = value as Partial<EvaluationSuite>
  if (typeof suite.version !== 'string' || !Array.isArray(suite.cases) || !suite.cases.length) {
    throw new Error(`${file}: version and at least one case are required.`)
  }
  const ids = new Set<string>()
  for (const evaluationCase of suite.cases) {
    if (!evaluationCase?.id || ids.has(evaluationCase.id) || !evaluationCase.category) {
      throw new Error(`${file}: every case needs a unique id and category.`)
    }
    ids.add(evaluationCase.id)
    if (!Array.isArray(evaluationCase.turns) || !evaluationCase.turns.length) {
      throw new Error(`${file}: ${evaluationCase.id} needs at least one turn.`)
    }
    for (const [index, turn] of evaluationCase.turns.entries()) {
      if (
        !turn?.prompt
        || !turn.expected
        || !Array.isArray(turn.expected.tools)
        || !['create', 'discussion', 'revise', 'execute'].includes(turn.expected.kind)
      ) {
        throw new Error(`${file}: invalid ${evaluationCase.id} turn ${index + 1}.`)
      }
      validateAllowedMutationRules(
        turn.expected.timeline?.allowedMutations,
        `${file}: ${evaluationCase.id} turn ${index + 1}`,
      )
    }
  }
  return suite as EvaluationSuite
}

interface TokenUsage {
  input: number
  output: number
  total: number
  calls: number
}

export interface EvaluationTurnResult {
  caseId: string
  category: string
  expectedKind?: ExpectedKind
  expectedDraftChange?: boolean
  run: number
  turn: number
  prompt: string
  assistantReply: string
  action: string
  skills: string[]
  tools: string[]
  toolResults: Array<{
    actionRef: string
    status: 'succeeded' | 'failed' | 'skipped'
    toolId: string
    ok: boolean
    summary: string
    result?: Record<string, unknown>
  }>
  actionReceipts: Array<{ ref: string; kind: string; status: 'succeeded' | 'failed' | 'skipped'; dependsOn: string[] }>
  source: string
  creationMode?: string
  effectiveAspectRatio?: string
  effectiveDurationSec?: number
  deterministicPass: boolean
  deterministicFailures: string[]
  judgePass?: boolean
  judgeRequested: boolean
  judgeFailure?: string
  relevanceScore?: number
  expectedStateAction?: ExpectedTurn['stateAction']
  expectedSkills?: string[]
  expectedToolSuccess?: boolean
  expectedCreationMode?: ExpectedTurn['creationMode']
  expectedEffectiveAspectRatio?: string
  expectedEffectiveDurationSec?: number
  stateActionPassed: boolean
  activeRequirementChecks: number
  activeRequirementChecksPassed: number
  conversationRecallChecks: number
  conversationRecallChecksPassed: number
  memoryWriteActual: number
  memoryWriteCorrect: number
  memoryWriteExpected: number
  memoryWriteExpectedPassed: number
  memoryScopeChecks: number
  memoryScopeChecksPassed: number
  memoryRetrievalChecks: number
  memoryRetrievalChecksPassed: number
  memoryApplicationChecks: number
  memoryApplicationChecksPassed: number
  memoryNonInterferenceCheck: boolean
  memoryNonInterferencePassed: boolean
  crossScopeMemoryLeak: boolean
  memoryBlockedTurn: boolean
  falseMemoryPersistenceClaim: boolean
  contextDecisionPassed: boolean
  independentActionChecks: number
  independentActionChecksPassed: number
  dependencyChecks: number
  dependencyChecksPassed: number
  systemBindingIntegrityPassed: boolean
  capabilityGroundedActionPassed: boolean
  recoveryCheck: boolean
  recoveryPassed: boolean
  systemResourceOverride: boolean
  crossDomainMutation: boolean
  skillAligned: boolean
  toolAligned: boolean
  toolOutcomeAligned: boolean
  creationModeAligned: boolean
  configAligned: boolean
  draftChanged: boolean
  timelineValid?: boolean
  timelineRequirementChecks: number
  timelineRequirementChecksPassed: number
  plannerRequirementChecks: number
  plannerRequirementChecksPassed: number
  subtitleScopePreserved?: boolean
  jsonRepair: boolean
  fallback: boolean
  falseSuccess: boolean
  unauthorizedExecution: boolean
  agentLatencyMs: number
  judgeLatencyMs: number
  directorUsage: TokenUsage
  judgeUsage: TokenUsage
  traceDir: string
}

export interface EvaluationReport {
  manifest: {
    suite: string
    gitCommit: string
    dirty: boolean
    startedAt: string
    completedAt: string
    runs: number
    mode: 'live-agent-dry-media'
    directorModel: string
    judgeModel: string
    judgeUsesDirectorModel: boolean
    mediaGenerationCalled: false
    remotionRenderCalled: false
  }
  summary: ReturnType<typeof summarizeEvaluation>
  turns: EvaluationTurnResult[]
}

const fixtureSample: V2SampleUnderstandingResult = {
  schema_version: 'v2_sample_understanding.v2',
  task_id: 'evaluation_sample_fixture',
  source: 'heuristic',
  sample: {
    name: 'evaluated-reference.mp4',
    duration_sec: 15,
    width: 1080,
    height: 1920,
    fps: 30,
  },
  summary: '样例先建立生活问题，再证明能力并克制收束。',
  content_observations: [{ statement: '夜间回家后出现产品能力证明', evidence_ranges: [{ start_sec: 0, end_sec: 10 }] }],
  method_observations: [{
    id: 'method_problem_proof', expression: '先建立情境，再揭示解决方案', purpose: '让能力证明具有因果基础',
    timing_rationale: '观众理解问题后再展示产品', evidence_ranges: [{ start_sec: 0, end_sec: 10 }],
  }],
  transferable_knowledge: [{ statement: '先建立问题，再展示解决方案', applicability: '功能证明类短片', evidence_method_ids: ['method_problem_proof'] }],
  shot_evidence: [],
  questions: [],
  warnings: ['只迁移创作方法，不复制具体画面、人物、品牌和文案。'],
}

function fixtureSpec(taskId: string): RemotionTimelineSpecV1 {
  return {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: taskId,
    canvas: { width: 1920, height: 1080, fps: 30, duration_sec: 15 },
    assets: [],
    scenes: [
      {
        id: 'scene_1',
        type: 'remotion_card',
        start_sec: 0,
        duration_sec: 5,
        title: '夜归开场',
        body: '夜间回家，智能门锁亮起柔和提示。',
        visual_role: 'hook',
        creative_intent: { description: '建立夜归安心感。' },
      },
      {
        id: 'scene_2',
        type: 'remotion_card',
        start_sec: 5,
        duration_sec: 5,
        title: '远程确认',
        body: '手机端确认门锁状态。',
        visual_role: 'proof',
        creative_intent: { description: '证明远程确认能力。' },
      },
      {
        id: 'scene_3',
        type: 'remotion_card',
        start_sec: 10,
        duration_sec: 5,
        title: '自然收束',
        body: '产品与品牌信息克制收尾。',
        visual_role: 'cta',
        creative_intent: { description: '以自然邀请收束。' },
      },
    ],
    transitions: [
      {
        id: 'transition_1',
        from_scene_id: 'scene_1',
        to_scene_id: 'scene_2',
        type: 'fade',
        duration_sec: 0.3,
      },
      {
        id: 'transition_2',
        from_scene_id: 'scene_2',
        to_scene_id: 'scene_3',
        type: 'fade',
        duration_sec: 0.3,
      },
    ],
    overlays: [
      {
        id: 'caption_1',
        type: 'caption',
        scene_id: 'scene_1',
        start_sec: 0.3,
        end_sec: 4.7,
        x_pct: 50,
        y_pct: 82,
        width_pct: 78,
        text: '安心到家，从容开门',
      },
      {
        id: 'caption_2',
        type: 'caption',
        scene_id: 'scene_2',
        start_sec: 5.3,
        end_sec: 9.7,
        x_pct: 50,
        y_pct: 82,
        width_pct: 78,
        text: '远程确认，状态心中有数',
      },
      {
        id: 'caption_3',
        type: 'caption',
        scene_id: 'scene_3',
        start_sec: 10.3,
        end_sec: 14.7,
        x_pct: 50,
        y_pct: 82,
        width_pct: 78,
        text: '让每次回家更安心',
      },
    ],
    material_jobs: [],
    audio: [],
    render_policy: { renderer: 'remotion_timeline' },
    notes: ['智能门锁广告；不得展示具体住址；不使用恐吓式文案。'],
  }
}

function fixtureScifiSpec(taskId: string): RemotionTimelineSpecV1 {
  return {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: taskId,
    canvas: { width: 1920, height: 1080, fps: 30, duration_sec: 20 },
    assets: [],
    scenes: [
      {
        id: 'scene_1',
        type: 'remotion_card',
        start_sec: 0,
        duration_sec: 4,
        title: '空间站全景',
        body: '曙光号进入静默区。',
        visual_role: 'hook',
        creative_intent: { description: '建立太空孤寂感。' },
      },
      {
        id: 'scene_2',
        type: 'remotion_card',
        start_sec: 4,
        duration_sec: 4,
        title: '气闸舱',
        body: '气压异常告警。',
        visual_role: 'feature',
        creative_intent: { description: '气闸舱异常与 AI 乘务员判断。' },
      },
      {
        id: 'scene_3',
        type: 'remotion_card',
        start_sec: 8,
        duration_sec: 4,
        title: '控制台',
        body: '保持联络。',
        visual_role: 'proof',
        creative_intent: { description: '确认仍在联络。' },
      },
      {
        id: 'scene_4',
        type: 'remotion_card',
        start_sec: 12,
        duration_sec: 4,
        title: '引力波监测',
        body: '读数衰减。',
        visual_role: 'feature',
        creative_intent: { description: '引力波异常升级。' },
      },
      {
        id: 'scene_5',
        type: 'remotion_card',
        start_sec: 16,
        duration_sec: 4,
        title: '收束',
        body: '保持联络。',
        visual_role: 'cta',
        creative_intent: { description: '克制收尾。' },
      },
    ],
    transitions: [1, 2, 3, 4].map((index) => ({
      id: `transition_${index}`,
      from_scene_id: `scene_${index}`,
      to_scene_id: `scene_${index + 1}`,
      type: 'fade',
      duration_sec: 0.3,
    })),
    overlays: [
      {
        id: 'cap_1',
        type: 'caption',
        scene_id: 'scene_1',
        start_sec: 0.3,
        end_sec: 3.7,
        x_pct: 50,
        y_pct: 82,
        width_pct: 78,
        text: '三小时后，曙光号进入静默区',
      },
      {
        id: 'cap_2',
        type: 'caption',
        scene_id: 'scene_2',
        start_sec: 4.3,
        end_sec: 7.7,
        x_pct: 50,
        y_pct: 82,
        width_pct: 78,
        text: '注意：气闸舱气压异常',
      },
      {
        id: 'cap_3',
        type: 'caption',
        scene_id: 'scene_3',
        start_sec: 8.3,
        end_sec: 11.7,
        x_pct: 50,
        y_pct: 82,
        width_pct: 78,
        text: '我们仍保持联络',
      },
      {
        id: 'cap_4',
        type: 'caption',
        scene_id: 'scene_4',
        start_sec: 12.3,
        end_sec: 15.7,
        x_pct: 50,
        y_pct: 82,
        width_pct: 78,
        text: '引力波读数正在衰减',
      },
    ],
    material_jobs: [],
    audio: [],
    render_policy: { renderer: 'remotion_timeline' },
    notes: ['科幻评测草稿；画面保持蓝灰硬边光。'],
  }
}

async function createFixture(
  evaluationCase: EvaluationCase,
  userId: number,
): Promise<{ context: DirectorContext; currentSpec?: RemotionTimelineSpecV1 }> {
  const fixtureNonce = randomUUID().replaceAll('-', '').slice(0, 12)
  const slots = createDefaultDirectorSlots({
    aspectRatio: evaluationCase.ui?.aspectRatio ?? '16:9',
    durationSec: evaluationCase.ui?.durationSec ?? (evaluationCase.category === 'context' ? 12 : 15),
    styleIntensity: evaluationCase.ui?.styleIntensity ?? 'medium',
  })
  const context: DirectorContext = {
    materials: evaluationCase.materials?.map((material, index) => ({
      ...material,
      id: `material_${fixtureNonce}_${index}`,
      url: `https://example.invalid/${fixtureNonce}/${index}`,
    })) ?? (evaluationCase.fixture === 'material'
      ? [{
          id: `material_${fixtureNonce}`,
          type: 'image',
          url: 'https://example.invalid/evaluation-product.jpg',
          name: '智能门锁产品图',
          tags: ['产品', '门锁'],
        }]
      : []),
    userIntent: {},
    slots,
    explicitUiControls: evaluationCase.ui,
  }

  if (evaluationCase.fixture === 'sample') {
    context.sampleVideo = {
      id: `sample_${fixtureNonce}`,
      url: 'evaluation://parsed-sample',
      name: '已解析样例.mp4',
      sampleUnderstanding: fixtureSample,
      reference: {
        source: 'sample_video',
        summary: fixtureSample.summary,
        methodHighlights: fixtureSample.method_observations.map((item) => item.expression),
        transferableKnowledge: fixtureSample.transferable_knowledge.map((item) => item.statement),
        shotCount: (fixtureSample.shot_evidence ?? []).filter((shot) => shot.confidence >= 0.6).length,
      },
    }
  }
  if (evaluationCase.fixture !== 'draft' && evaluationCase.fixture !== 'scifi_draft') return { context }

  const spec = evaluationCase.fixture === 'scifi_draft'
    ? fixtureScifiSpec(`fixture_${fixtureNonce}`)
    : fixtureSpec(`fixture_${fixtureNonce}`)
  if (evaluationCase.category === 'context') {
    spec.canvas.duration_sec = 12
    spec.scenes = spec.scenes.map((scene, index) => ({
      ...scene,
      start_sec: index * 4,
      duration_sec: 4,
      title: `段落 ${index + 1}`,
      body: '内容待进一步确认。',
      creative_intent: { description: '保留一个中性的可编辑段落。' },
    }))
    spec.overlays = []
    spec.notes = []
  }
  const draft = await createV2TimelineDraftRepository().createDraft({
    userId,
    plannerInput: {
      taskId: spec.task_id,
      prompt: 'V2 时间线评测基础草稿',
      creationMode: 'text_to_video',
      durationSec: 15,
      plannerMode: 'deterministic',
      canvas: { width: 1920, height: 1080, fps: 30 },
    },
    spec,
    plannerSource: 'evaluation_fixture',
    review: {},
    traceDir: 'evaluation_fixture',
  })
  context.currentTimeline = {
    kind: 'v2_timeline',
    status: 'saved',
    draftId: draft.id,
    currentRevision: draft.revision,
    savedRevision: draft.revision,
    sceneCount: spec.scenes.length,
  }
  context.timelineFacts = buildDirectorTimelineFacts(draft.revision, spec)
  return { context, currentSpec: spec }
}

function runtime(context: DirectorContext) {
  const visualMaterials = context.materials.filter(
    (material) => material.type === 'image' || material.type === 'video',
  )
  return {
    backendEnabled: true,
    sampleUrl: context.sampleVideo?.url ?? '',
    isSampleParsed: Boolean(context.sampleVideo?.sampleUnderstanding),
    hasV2Timeline: Boolean(context.currentTimeline?.draftId),
    hasVisualMaterial: visualMaterials.length > 0,
    materialCount: context.materials.length,
    v2SceneCount: context.currentTimeline?.sceneCount,
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
}

async function findFiles(root: string, names: Set<string>): Promise<string[]> {
  if (!(await exists(root))) return []
  const found: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name)
    if (entry.isDirectory()) found.push(...await findFiles(child, names))
    else if (names.has(entry.name)) found.push(child)
  }
  return found
}

async function checkPlannerRequirements(
  traceDir: string | undefined,
  expectedActive: string[] = [],
  expectedInactive: string[] = [],
  expectedMemories: string[] = [],
) {
  const checks = expectedActive.length + expectedInactive.length + expectedMemories.length
  if (!checks) return { checks: 0, passed: 0, failures: [] as string[] }
  const files = traceDir
    ? await findFiles(traceDir, new Set(['timeline-planner-input.json']))
    : []
  const plannerInput = files.length ? await readJson(files.at(-1)!) : undefined
  const planningContext = plannerInput?.planningContext as Record<string, unknown> | undefined
  const active = Array.isArray(planningContext?.activeRequirements)
    ? planningContext.activeRequirements.map(String)
    : []
  const recalled = Array.isArray(planningContext?.recalledCreativeMemories)
    ? planningContext.recalledCreativeMemories.map(String)
    : []
  const contains = (fact: string) => active.some((statement) => includesFactSemantic(statement, fact))
  const failures: string[] = []
  let passed = 0
  for (const fact of expectedActive) {
    if (contains(fact)) passed += 1
    else failures.push(`Planner 输入缺少 active 要求：${fact}`)
  }
  for (const fact of expectedInactive) {
    if (!contains(fact)) passed += 1
    else failures.push(`Planner 输入仍包含失效要求：${fact}`)
  }
  for (const fact of expectedMemories) {
    if (recalled.some((statement) => includesFactSemantic(statement, fact))) passed += 1
    else failures.push(`Planner 输入缺少召回的用户创作偏好：${fact}`)
  }
  return { checks, passed, failures }
}

function findUsage(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const own = record.usage && typeof record.usage === 'object'
    ? [record.usage as Record<string, unknown>]
    : []
  return own.concat(Object.values(record).flatMap(findUsage))
}

function numberField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

async function collectUsage(roots: string[]): Promise<TokenUsage> {
  const auditNames = new Set([
    'model-call.json',
    'model-json-repair-result.audit.json',
    'tool-result-model-response.audit.json',
    'llm-timeline-planner-model-response.audit.json',
    'llm-timeline-planner-json-repair-result.audit.json',
    'timeline-outcome-correction-model-response.audit.json',
  ])
  const files = new Set((await Promise.all(roots.map((root) => findFiles(root, auditNames)))).flat())
  const total: TokenUsage = { input: 0, output: 0, total: 0, calls: 0 }
  for (const file of files) {
    for (const usage of findUsage(await readJson(file))) {
      const input = numberField(usage, 'input_tokens', 'prompt_tokens')
      const output = numberField(usage, 'output_tokens', 'completion_tokens')
      total.input += input
      total.output += output
      total.total += numberField(usage, 'total_tokens') || input + output
      total.calls += 1
    }
  }
  return total
}

function sameOutsideSubtitle(before: RemotionTimelineSpecV1, after: RemotionTimelineSpecV1) {
  const withoutOverlays = (spec: RemotionTimelineSpecV1) => ({
    canvas: spec.canvas,
    assets: spec.assets,
    scenes: spec.scenes,
    transitions: spec.transitions,
    material_jobs: spec.material_jobs,
    audio: spec.audio,
    render_policy: spec.render_policy,
    notes: spec.notes,
  })
  return JSON.stringify(withoutOverlays(before)) === JSON.stringify(withoutOverlays(after))
    && JSON.stringify(before.overlays) !== JSON.stringify(after.overlays)
}

function alphaFromBackground(background: string | undefined) {
  if (!background) return undefined
  const match = background.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i)
  return match ? Number(match[1]) : undefined
}

function sameOutsideAllowedMutations(
  before: RemotionTimelineSpecV1,
  after: RemotionTimelineSpecV1,
  rules: NonNullable<NonNullable<ExpectedTurn['timeline']>['allowedMutations']>,
) {
  const normalize = (spec: RemotionTimelineSpecV1) => {
    const value = structuredClone(spec) as unknown as Record<string, any>
    for (const rule of rules) {
      const targets = rule.object === 'creative_brief'
        ? [value.creative_brief ??= { direction: undefined, image_references: [], sample_methods: [] }]
        : (value[rule.object === 'material_job' ? 'material_jobs' : `${rule.object}s`] as Array<Record<string, any>> | undefined)
          ?.filter((item) => !rule.ids || rule.ids.includes(item.id))
      for (const target of targets ?? []) {
        for (const field of rule.fields) delete target[field]
      }
    }
    return value
  }
  return JSON.stringify(normalize(before)) === JSON.stringify(normalize(after))
}

export function evaluateTimelineRequirements(
  spec: RemotionTimelineSpecV1 | undefined,
  expected: ExpectedTurn['timeline'],
  beforeSpec?: RemotionTimelineSpecV1,
) {
  if (!expected) return { checks: 0, passed: 0, failures: [] as string[] }
  const required = expected.requiredVisibleText ?? []
  const forbidden = expected.forbiddenVisibleText ?? []
  const requiredTransitions = expected.requiredTransitionTypes ?? []
  const forbiddenTransitions = expected.forbiddenTransitionTypes ?? []
  const requiredOverlayRanges = expected.requiredOverlayRanges ?? []
  const requiredOverlayStyles = expected.requiredOverlayStyles ?? []
  const requiredSceneFacts = expected.requiredSceneFacts ?? []
  const requiredSceneMotions = expected.requiredSceneMotions ?? []
  const requiredCreativeBriefFacts = expected.requiredCreativeBriefFacts ?? []
  const requiredTransitionDetails = expected.requiredTransitionDetails ?? []
  const checks = required.length + forbidden.length
    + (expected.usesProvidedMaterial === undefined ? 0 : 1)
    + (expected.aspectRatio === undefined ? 0 : 1)
    + (expected.durationSec === undefined ? 0 : 1)
    + (expected.sceneCount === undefined ? 0 : 1)
    + (expected.transitionCount === undefined ? 0 : 1)
    + requiredTransitions.length
    + forbiddenTransitions.length
    + requiredOverlayRanges.length
    + requiredOverlayStyles.length
    + requiredSceneFacts.reduce((sum, item) => sum + item.facts.length, 0)
    + requiredSceneMotions.length
    + requiredCreativeBriefFacts.length
    + requiredTransitionDetails.length
    + Number(Boolean(expected.allowedMutations?.length))
  if (!spec) {
    return {
      checks,
      passed: 0,
      failures: checks ? ['没有可检查的时间线草稿'] : [],
    }
  }
  const visibleText = [
    ...spec.scenes.flatMap((scene) => [scene.title, scene.subtitle, scene.body]),
    ...spec.overlays.map((overlay) => overlay.text),
  ].filter((value): value is string => Boolean(value)).join('\n')
  const failures: string[] = []
  let passed = 0
  for (const fact of required) {
    if (includesFact(visibleText, fact)) passed += 1
    else failures.push(`时间线可见文案缺少：${fact}`)
  }
  for (const fact of forbidden) {
    if (!includesFact(visibleText, fact)) passed += 1
    else failures.push(`时间线可见文案包含禁用内容：${fact}`)
  }
  if (expected.usesProvidedMaterial !== undefined) {
    const usesProvidedMaterial = spec.assets.some((asset) => asset.source === 'user_asset')
    if (usesProvidedMaterial === expected.usesProvidedMaterial) passed += 1
    else failures.push('用户素材使用状态与预期不一致')
  }
  const ratioByDimensions: Record<string, number> = {
    '9:16': 9 / 16,
    '16:9': 16 / 9,
    '1:1': 1,
    '4:3': 4 / 3,
  }
  if (expected.aspectRatio !== undefined) {
    const actualRatio = spec.canvas.width / spec.canvas.height
    if (Math.abs(actualRatio - ratioByDimensions[expected.aspectRatio]!) < 0.01) passed += 1
    else failures.push(`时间线画幅不是 ${expected.aspectRatio}`)
  }
  if (expected.durationSec !== undefined) {
    if (Math.abs(spec.canvas.duration_sec - expected.durationSec) < 0.05) passed += 1
    else failures.push(`时间线时长 ${spec.canvas.duration_sec} 秒，与预期 ${expected.durationSec} 秒不一致`)
  }
  if (expected.sceneCount !== undefined) {
    if (spec.scenes.length === expected.sceneCount) passed += 1
    else failures.push(`时间线镜头数 ${spec.scenes.length}，预期 ${expected.sceneCount}`)
  }
  if (expected.transitionCount !== undefined) {
    if (spec.transitions.length === expected.transitionCount) passed += 1
    else failures.push(`时间线转场数 ${spec.transitions.length}，预期 ${expected.transitionCount}`)
  }
  for (const type of requiredTransitions) {
    if (spec.transitions.some((transition) => transition.type === type)) passed += 1
    else failures.push(`时间线缺少转场：${type}`)
  }
  for (const type of forbiddenTransitions) {
    if (!spec.transitions.some((transition) => transition.type === type)) passed += 1
    else failures.push(`时间线包含禁用转场：${type}`)
  }
  for (const range of requiredOverlayRanges) {
    const matched = spec.overlays.some((overlay) => (
      includesFact(overlay.text ?? '', range.text)
      && Math.abs(overlay.start_sec - range.startSec) < 0.05
      && Math.abs(overlay.end_sec - range.endSec) < 0.05
    ))
    if (matched) passed += 1
    else failures.push(`覆盖层“${range.text}”未出现在 ${range.startSec}-${range.endSec} 秒`)
  }
  for (const style of requiredOverlayStyles) {
    const candidates = spec.overlays.filter((overlay) => overlay.type === style.type)
    const matched = candidates.length > 0 && candidates.every((overlay) => (
      (style.opacity === undefined || Math.abs((overlay.opacity ?? 1) - style.opacity) < 0.02)
      && (style.backgroundAlpha === undefined || Math.abs((alphaFromBackground(overlay.background) ?? -1) - style.backgroundAlpha) < 0.02)
    ))
    if (matched) passed += 1
    else failures.push(`覆盖层样式未落实：${style.type}`)
  }
  for (const requirement of requiredSceneFacts) {
    const scene = spec.scenes.find((item) => item.id === requirement.sceneId)
    const text = scene ? [scene.title, scene.subtitle, scene.body, scene.background, scene.note, scene.creative_intent?.title, scene.creative_intent?.description].filter(Boolean).join('\n') : ''
    for (const fact of requirement.facts) {
      if (includesFact(text, fact)) passed += 1
      else failures.push(`镜头 ${requirement.sceneId} 缺少内容事实：${fact}`)
    }
  }
  for (const requirement of requiredSceneMotions) {
    const scene = spec.scenes.find((item) => item.id === requirement.sceneId)
    if (scene?.motion === requirement.motion) passed += 1
    else failures.push(`镜头 ${requirement.sceneId} 运镜不是 ${requirement.motion}`)
  }
  const briefText = spec.creative_brief?.direction ?? ''
  for (const fact of requiredCreativeBriefFacts) {
    if (includesFact(briefText, fact)) passed += 1
    else failures.push(`创作总纲缺少：${fact}`)
  }
  for (const detail of requiredTransitionDetails) {
    const transition = spec.transitions.find((item) => item.id === detail.id)
    if (transition?.type === detail.type && Math.abs(transition.duration_sec - detail.durationSec) < 0.05) passed += 1
    else failures.push(`转场 ${detail.id} 未落实 ${detail.type}/${detail.durationSec}秒`)
  }
  if (expected.allowedMutations?.length) {
    if (beforeSpec && sameOutsideAllowedMutations(beforeSpec, spec, expected.allowedMutations)) passed += 1
    else failures.push('修订修改了声明允许范围之外的字段')
  }
  return { checks, passed, failures }
}

function claimsSuccess(message: string) {
  return /(?:已|已经).{0,12}(?:完成|成功|保存|渲染|更新)|操作成功/i.test(message)
}

function acknowledgesFailure(message: string) {
  return /失败|未完成|没有执行|无法|异常|已跳过|was not executed|failed|skipped/i.test(message)
}

function claimsMemoryPersistence(message: string) {
  return /(?:已|已经).{0,10}(?:记录|保存|更新|撤销).{0,10}(?:偏好|要求|记忆)|(?:偏好|要求|记忆).{0,10}(?:已|已经).{0,10}(?:记录|保存|更新|撤销)/i.test(message)
}

function factsFromState(state: DirectorWorkspaceState): string[] {
  return [
    ...state.confirmedRequirements
      .filter((item) => item.status === 'active')
      .map((item) => item.statement),
    ...(state.context.timelineFacts?.visibleText.map((item) => item.text) ?? []),
    ...(state.context.timelineFacts?.scenes.flatMap(
      (scene) => [scene.title ?? '', scene.description ?? ''],
    ) ?? []),
    ...(state.context.timelineFacts?.transitions.map((item) => item.type) ?? []),
    state.context.effectiveCreativeConfig
      ? `${state.context.effectiveCreativeConfig.aspectRatio} ${state.context.effectiveCreativeConfig.durationSec ?? ''}秒`
      : '',
  ].filter(Boolean)
}

interface TraceMemoryRequest {
  ref: string
  operation: 'add' | 'replace' | 'revoke'
  scopeType?: 'user' | 'draft'
  status?: 'active' | 'candidate'
  statement?: string
}

interface TraceMemoryChange {
  ref: string
  status: 'succeeded' | 'failed'
}

interface TraceRankedMemory {
  memory?: {
    id?: string
    scopeType?: 'user' | 'draft'
    draftId?: string
    statement?: string
  }
}

function checkMemoryEvaluation(input: {
  expected: ExpectedTurn
  assistantReply: string
  currentDraftId?: string
  requests: TraceMemoryRequest[]
  changes: TraceMemoryChange[]
  active: TraceRankedMemory[]
  candidate: TraceRankedMemory[]
}) {
  const succeeded = new Set(
    input.changes.filter((change) => change.status === 'succeeded').map((change) => change.ref),
  )
  const actual = input.requests.filter((request) => succeeded.has(request.ref))
  const expected = input.expected.memoryAction
  const expectedFacts = expected?.requiredFacts ?? []
  const matching = expected && expected.operation !== 'none'
    ? actual.find((request) => (
        request.operation === expected.operation
        && (expected.scopeType === undefined || request.scopeType === expected.scopeType)
        && (expected.status === undefined || request.status === expected.status)
        && expectedFacts.every((fact) => includesFactSemantic(request.statement ?? '', fact))
      ))
    : undefined
  const expectedWrite = expected !== undefined && expected.operation !== 'none'
  const expectedPassed = expected === undefined
    ? true
    : expected.operation === 'none'
      ? actual.length === 0
      : Boolean(matching)
  const scopeChecks = expectedWrite && expected?.scopeType ? 1 : 0
  const scopePassed = scopeChecks && matching?.scopeType === expected?.scopeType ? 1 : 0

  const activeStatements = input.active.map((item) => item.memory?.statement ?? '')
  const candidateStatements = input.candidate.map((item) => item.memory?.statement ?? '')
  const retrievalChecks = [
    ...(input.expected.retrievedActiveMemoryFacts ?? []).map((fact) => ({ fact, statements: activeStatements, present: true })),
    ...(input.expected.retrievedCandidateMemoryFacts ?? []).map((fact) => ({ fact, statements: candidateStatements, present: true })),
    ...(input.expected.forbiddenRetrievedMemoryFacts ?? []).map((fact) => ({
      fact,
      statements: [...activeStatements, ...candidateStatements],
      present: false,
    })),
  ]
  const retrievalPassed = retrievalChecks.filter((check) => (
    check.statements.some((statement) => includesFactSemantic(statement, check.fact)) === check.present
  )).length
  const applicationChecks = [
    ...(input.expected.memoryReplyFacts ?? []).map((fact) => ({ fact, present: true })),
    ...(input.expected.forbiddenMemoryReplyFacts ?? []).map((fact) => ({ fact, present: false })),
  ]
  const applicationPassed = applicationChecks.filter((check) => (
    includesFactSemantic(input.assistantReply, check.fact) === check.present
  )).length
  const retrieved = [...input.active, ...input.candidate]
  const crossScopeMemoryLeak = retrieved.some((item) => (
    item.memory?.scopeType === 'draft'
    && item.memory.draftId !== input.currentDraftId
  ))
  const failed = input.changes.some((change) => change.status === 'failed')

  return {
    actual: expected === undefined ? 0 : actual.length,
    correct: matching ? 1 : expected?.operation === 'none' ? 0 : 0,
    expected: expectedWrite ? 1 : 0,
    expectedPassed: expectedWrite && expectedPassed ? 1 : 0,
    scopeChecks,
    scopePassed,
    retrievalChecks: retrievalChecks.length,
    retrievalPassed,
    applicationChecks: applicationChecks.length,
    applicationPassed,
    nonInterferenceCheck: expected?.operation === 'none',
    nonInterferencePassed: expected?.operation !== 'none' || actual.length === 0,
    crossScopeMemoryLeak,
    memoryBlockedTurn: failed && !input.assistantReply.trim(),
    falseMemoryPersistenceClaim: failed && claimsMemoryPersistence(input.assistantReply),
    expectationPassed: expectedPassed,
  }
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!
}

function rate(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null
}

function meets(value: number | null, threshold: number) {
  return value === null || value >= threshold
}

export function summarizeEvaluation(turns: EvaluationTurnResult[]) {
  const scenarios = new Map<string, EvaluationTurnResult[]>()
  for (const turn of turns) {
    const key = `${turn.caseId}:${turn.run}`
    scenarios.set(key, [...(scenarios.get(key) ?? []), turn])
  }
  const scenarioGoalCompletion = rate(
    [...scenarios.values()].filter((scenario) => scenario.every((turn) => turn.deterministicPass)).length,
    scenarios.size,
  )
  const contextDecisionAccuracy = rate(turns.filter((turn) => turn.contextDecisionPassed).length, turns.length)
  const independentActionChecks = turns.reduce((sum, turn) => sum + turn.independentActionChecks, 0)
  const independentActionCompletion = rate(
    turns.reduce((sum, turn) => sum + turn.independentActionChecksPassed, 0),
    independentActionChecks,
  )
  const dependencyChecks = turns.reduce((sum, turn) => sum + turn.dependencyChecks, 0)
  const dependencyExecutionAccuracy = rate(
    turns.reduce((sum, turn) => sum + turn.dependencyChecksPassed, 0),
    dependencyChecks,
  )
  const systemBindingIntegrity = rate(
    turns.filter((turn) => turn.systemBindingIntegrityPassed).length,
    turns.length,
  )
  const capabilityGroundedAction = rate(
    turns.filter((turn) => turn.capabilityGroundedActionPassed).length,
    turns.length,
  )
  const recoveryTurns = turns.filter((turn) => turn.recoveryCheck)
  const recoveryCompletion = rate(
    recoveryTurns.filter((turn) => turn.recoveryPassed).length,
    recoveryTurns.length,
  )
  const toolAlignment = rate(turns.filter((turn) => turn.toolAligned).length, turns.length)
  const skillTurns = turns.filter((turn) => turn.expectedSkills !== undefined)
  const skillSelectionAccuracy = rate(
    skillTurns.filter((turn) => turn.skillAligned).length,
    skillTurns.length,
  )
  const judgedTurns = turns.filter(
    (turn) => turn.judgeRequested && turn.judgePass !== undefined,
  )
  const judgeReplyQuality = rate(
    judgedTurns.filter((turn) => turn.judgePass).length,
    judgedTurns.length,
  )
  const draftTurns = turns.filter((turn) => turn.expectedDraftChange === true)
  const revisions = turns.filter(
    (turn) => turn.expectedKind === 'revise' && turn.expectedDraftChange === true,
  )
  const toolOutcomeTurns = turns.filter((turn) => turn.expectedToolSuccess !== undefined)
  const creationModeTurns = turns.filter((turn) => turn.expectedCreationMode !== undefined)
  const configTurns = turns.filter(
    (turn) => turn.expectedEffectiveAspectRatio !== undefined
      || turn.expectedEffectiveDurationSec !== undefined,
  )
  const timelineValidityTurns = turns.filter((turn) => turn.timelineValid !== undefined)
  const stateActionTurns = turns.filter((turn) => turn.expectedStateAction !== undefined)
  const stateActionSuccess = rate(
    stateActionTurns.filter((turn) => turn.stateActionPassed).length,
    stateActionTurns.length,
  )
  const activeRequirementChecks = turns.reduce((sum, turn) => sum + turn.activeRequirementChecks, 0)
  const activeRequirementChecksPassed = turns.reduce(
    (sum, turn) => sum + turn.activeRequirementChecksPassed,
    0,
  )
  const activeRequirementRetention = rate(activeRequirementChecksPassed, activeRequirementChecks)
  const recallChecks = turns.reduce((sum, turn) => sum + turn.conversationRecallChecks, 0)
  const recallChecksPassed = turns.reduce(
    (sum, turn) => sum + turn.conversationRecallChecksPassed,
    0,
  )
  const conversationRecall = rate(recallChecksPassed, recallChecks)
  const memoryWriteActual = turns.reduce((sum, turn) => sum + (turn.memoryWriteActual ?? 0), 0)
  const memoryWriteExpected = turns.reduce((sum, turn) => sum + (turn.memoryWriteExpected ?? 0), 0)
  const memoryWritePrecision = rate(
    turns.reduce((sum, turn) => sum + (turn.memoryWriteCorrect ?? 0), 0),
    memoryWriteActual,
  )
  const memoryWriteRecall = rate(
    turns.reduce((sum, turn) => sum + (turn.memoryWriteExpectedPassed ?? 0), 0),
    memoryWriteExpected,
  )
  const memoryScopeChecks = turns.reduce((sum, turn) => sum + (turn.memoryScopeChecks ?? 0), 0)
  const memoryScopeAccuracy = rate(
    turns.reduce((sum, turn) => sum + (turn.memoryScopeChecksPassed ?? 0), 0),
    memoryScopeChecks,
  )
  const memoryRetrievalChecks = turns.reduce((sum, turn) => sum + (turn.memoryRetrievalChecks ?? 0), 0)
  const memoryRetrievalExpectation = rate(
    turns.reduce((sum, turn) => sum + (turn.memoryRetrievalChecksPassed ?? 0), 0),
    memoryRetrievalChecks,
  )
  const memoryApplicationChecks = turns.reduce((sum, turn) => sum + (turn.memoryApplicationChecks ?? 0), 0)
  const memoryApplicationAccuracy = rate(
    turns.reduce((sum, turn) => sum + (turn.memoryApplicationChecksPassed ?? 0), 0),
    memoryApplicationChecks,
  )
  const memoryNonInterferenceTurns = turns.filter((turn) => turn.memoryNonInterferenceCheck)
  const memoryNonInterference = rate(
    memoryNonInterferenceTurns.filter((turn) => turn.memoryNonInterferencePassed).length,
    memoryNonInterferenceTurns.length,
  )
  const timelineRequirementChecks = turns.reduce(
    (sum, turn) => sum + (turn.timelineRequirementChecks ?? 0),
    0,
  )
  const timelineRequirementChecksPassed = turns.reduce(
    (sum, turn) => sum + (turn.timelineRequirementChecksPassed ?? 0),
    0,
  )
  const timelineRequirementRealization = rate(
    timelineRequirementChecksPassed,
    timelineRequirementChecks,
  )
  const plannerRequirementChecks = turns.reduce(
    (sum, turn) => sum + (turn.plannerRequirementChecks ?? 0),
    0,
  )
  const plannerRequirementChecksPassed = turns.reduce(
    (sum, turn) => sum + (turn.plannerRequirementChecksPassed ?? 0),
    0,
  )
  const plannerRequirementInput = rate(
    plannerRequirementChecksPassed,
    plannerRequirementChecks,
  )
  const artifactRequirementRealization = rate(
    plannerRequirementChecksPassed + timelineRequirementChecksPassed,
    plannerRequirementChecks + timelineRequirementChecks,
  )
  const draftCompletion = rate(
    draftTurns.filter((turn) => turn.draftChanged).length,
    draftTurns.length,
  )
  const revisionCompletion = rate(
    revisions.filter((turn) => turn.draftChanged).length,
    revisions.length,
  )
  const toolOutcomeAccuracy = rate(
    toolOutcomeTurns.filter((turn) => turn.toolOutcomeAligned).length,
    toolOutcomeTurns.length,
  )
  const creationBranchAccuracy = rate(
    creationModeTurns.filter((turn) => turn.creationModeAligned).length,
    creationModeTurns.length,
  )
  const configRealization = rate(
    configTurns.filter((turn) => turn.configAligned).length,
    configTurns.length,
  )
  const timelineValidity = rate(
    timelineValidityTurns.filter((turn) => turn.timelineValid).length,
    timelineValidityTurns.length,
  )
  const hardBlockers = {
    unauthorizedExecutionCount: turns.filter((turn) => turn.unauthorizedExecution).length,
    systemResourceOverrideCount: turns.filter((turn) => turn.systemResourceOverride).length,
    falseSuccessClaimCount: turns.filter((turn) => turn.falseSuccess).length,
    crossDomainMutationCount: turns.filter((turn) => turn.crossDomainMutation).length,
    crossScopeRetrievalCount: turns.filter((turn) => turn.crossScopeMemoryLeak).length,
    unrelatedMemoryInjectionCount: turns.filter(
      (turn) => turn.memoryNonInterferenceCheck && !turn.memoryNonInterferencePassed,
    ).length,
    memoryFailureBlockedTurnCount: turns.filter((turn) => turn.memoryBlockedTurn).length,
    falseMemoryPersistenceClaimCount: turns.filter(
      (turn) => turn.falseMemoryPersistenceClaim,
    ).length,
  }
  const sumUsage = (kind: 'directorUsage' | 'judgeUsage') => turns.reduce<TokenUsage>((sum, turn) => ({
    input: sum.input + turn[kind].input,
    output: sum.output + turn[kind].output,
    total: sum.total + turn[kind].total,
    calls: sum.calls + turn[kind].calls,
  }), { input: 0, output: 0, total: 0, calls: 0 })
  const directorUsage = sumUsage('directorUsage')
  const judgeUsage = sumUsage('judgeUsage')
  const combinedUsage = {
    input: directorUsage.input + judgeUsage.input,
    output: directorUsage.output + judgeUsage.output,
    total: directorUsage.total + judgeUsage.total,
    calls: directorUsage.calls + judgeUsage.calls,
  }
  const releaseBlocked = Object.values(hardBlockers).some((count) => count > 0)
  const deterministicPass = rate(
    turns.filter((turn) => turn.deterministicPass).length,
    turns.length,
  )
  const regressionPassed = !releaseBlocked
    && meets(deterministicPass, 0.95)
    && meets(scenarioGoalCompletion, 0.95)
    && meets(contextDecisionAccuracy, 0.95)
    && meets(independentActionCompletion, 1)
    && meets(dependencyExecutionAccuracy, 1)
    && meets(systemBindingIntegrity, 1)
    && meets(capabilityGroundedAction, 0.95)
    && meets(timelineValidity, 1)
    && meets(plannerRequirementInput, 1)
    && meets(artifactRequirementRealization, 0.9)
    && meets(judgeReplyQuality, 0.9)
    && meets(stateActionSuccess, 0.9)
    && meets(activeRequirementRetention, 0.9)
    && meets(conversationRecall, 0.9)
    && meets(memoryWritePrecision, 0.9)
    && meets(memoryWriteRecall, 0.9)
    && meets(memoryScopeAccuracy, 1)
    && meets(memoryRetrievalExpectation, 0.9)
    && meets(memoryApplicationAccuracy, 0.9)
    && meets(memoryNonInterference, 1)
    && meets(draftCompletion, 0.9)
    && meets(revisionCompletion, 0.9)
    && meets(recoveryCompletion, 0.9)
    && meets(rate(turns.filter((turn) => !turn.jsonRepair && !turn.fallback).length, turns.length), 0.95)
    && (rate(turns.filter((turn) => turn.fallback).length, turns.length) ?? 0) <= 0.05
  return {
    turns: turns.length,
    deterministicPassed: turns.filter((turn) => turn.deterministicPass).length,
    deterministicPassRate: deterministicPass,
    scenarioGoalCompletionRate: scenarioGoalCompletion,
    independentActionCompletionRate: independentActionCompletion,
    dependencyExecutionAccuracyRate: dependencyExecutionAccuracy,
    systemBindingIntegrityRate: systemBindingIntegrity,
    contextDecisionAccuracyRate: contextDecisionAccuracy,
    capabilityGroundedActionRate: capabilityGroundedAction,
    artifactRequirementRealizationRate: artifactRequirementRealization,
    recoveryCompletionRate: recoveryCompletion,
    skillSelectionAccuracyRate: skillSelectionAccuracy,
    toolAlignmentRate: toolAlignment,
    toolOutcomeAccuracyRate: toolOutcomeAccuracy,
    creationBranchAccuracyRate: creationBranchAccuracy,
    configRealizationRate: configRealization,
    timelineValidityRate: timelineValidity,
    plannerRequirementInputRate: plannerRequirementInput,
    timelineRequirementRealizationRate: timelineRequirementRealization,
    stateActionSuccessRate: stateActionSuccess,
    activeRequirementRetentionRate: activeRequirementRetention,
    conversationRecallRate: conversationRecall,
    memoryWritePrecision,
    memoryWriteRecall,
    memoryScopeAccuracyRate: memoryScopeAccuracy,
    memoryRetrievalExpectationRate: memoryRetrievalExpectation,
    memoryApplicationAccuracyRate: memoryApplicationAccuracy,
    memoryNonInterferenceRate: memoryNonInterference,
    judgeReplyQualityRate: judgeReplyQuality,
    judgedTurns: judgedTurns.length,
    draftCompletionRate: draftCompletion,
    revisionCompletionRate: revisionCompletion,
    structuredFirstPassRate: rate(
      turns.filter((turn) => !turn.jsonRepair && !turn.fallback).length,
      turns.length,
    ),
    fallbackRate: rate(turns.filter((turn) => turn.fallback).length, turns.length),
    hardBlockers,
    releaseBlocked,
    regressionPassed,
    latencyMs: {
      agentP50: percentile(turns.map((turn) => turn.agentLatencyMs), 0.5),
      agentP95: percentile(turns.map((turn) => turn.agentLatencyMs), 0.95),
      judgeP50: percentile(turns.map((turn) => turn.judgeLatencyMs).filter(Boolean), 0.5),
      judgeP95: percentile(turns.map((turn) => turn.judgeLatencyMs).filter(Boolean), 0.95),
      combinedP50: percentile(turns.map((turn) => turn.agentLatencyMs + turn.judgeLatencyMs), 0.5),
      combinedP95: percentile(turns.map((turn) => turn.agentLatencyMs + turn.judgeLatencyMs), 0.95),
    },
    directorUsage,
    judgeUsage,
    combinedUsage,
  }
}

function reportMarkdown(report: EvaluationReport) {
  const percent = (value: number | null) => value === null
    ? 'N/A'
    : `${(value * 100).toFixed(1)}%`
  const milliseconds = (value: number | null) => value === null ? 'N/A' : `${value}ms`
  const summary = report.summary
  const failures = report.turns.filter(
    (turn) => !turn.deterministicPass || turn.judgePass === false,
  )
  return [
    '# V2 Agent 评测报告',
    '',
    `- Suite：${report.manifest.suite}`,
    `- Git：${report.manifest.gitCommit}${report.manifest.dirty ? '（工作区有未提交改动）' : ''}`,
    `- 运行次数：${report.manifest.runs}`,
    `- Director：${report.manifest.directorModel}`,
    `- Judge：${report.manifest.judgeModel}（评价全部离线最终回复）`,
    '- 媒体生成：未调用',
    '- Remotion 正式渲染：未调用',
    '',
    '## Director 决策层',
    '',
    '| 指标 | 结果 |',
    '| --- | ---: |',
    `| 确定性检查通过轮次 | ${summary.deterministicPassed} / ${summary.turns} |`,
    `| 确定性检查通过率 | ${percent(summary.deterministicPassRate)} |`,
    `| 场景目标完成率 | ${percent(summary.scenarioGoalCompletionRate)} |`,
    `| 独立动作完成率 | ${percent(summary.independentActionCompletionRate)} |`,
    `| 依赖执行准确率 | ${percent(summary.dependencyExecutionAccuracyRate)} |`,
    `| 系统参数绑定完整率 | ${percent(summary.systemBindingIntegrityRate)} |`,
    `| 上下文决策准确率 | ${percent(summary.contextDecisionAccuracyRate)} |`,
    `| 能力事实对齐率 | ${percent(summary.capabilityGroundedActionRate)} |`,
    `| Skill 选择准确率 | ${percent(summary.skillSelectionAccuracyRate)} |`,
    `| Tool 选择准确率 | ${percent(summary.toolAlignmentRate)} |`,
    `| 结构化一次通过率 | ${percent(summary.structuredFirstPassRate)} |`,
    `| Fallback 率 | ${percent(summary.fallbackRate)} |`,
    '',
    '## 要求与对话层',
    '',
    `- 状态动作成功率：${percent(summary.stateActionSuccessRate)}`,
    `- active 要求保留率：${percent(summary.activeRequirementRetentionRate)}`,
    `- 对话事实召回率：${percent(summary.conversationRecallRate)}`,
    `- Judge 回复质量通过率：${percent(summary.judgeReplyQualityRate)}（${summary.judgedTurns} 轮）`,
    '',
    '## 用户创作偏好层',
    '',
    `- 写入精确率 / 召回率：${percent(summary.memoryWritePrecision)} / ${percent(summary.memoryWriteRecall)}`,
    `- 作用域准确率：${percent(summary.memoryScopeAccuracyRate)}`,
    `- 召回标注符合率：${percent(summary.memoryRetrievalExpectationRate)}`,
    `- 采用准确率：${percent(summary.memoryApplicationAccuracyRate)}`,
    `- 非干扰率：${percent(summary.memoryNonInterferenceRate)}`,
    '',
    '## Planner 草稿层',
    '',
    `- 创建分支准确率：${percent(summary.creationBranchAccuracyRate)}`,
    `- 配置落实率：${percent(summary.configRealizationRate)}`,
    `- 时间线结构有效率：${percent(summary.timelineValidityRate)}`,
    `- active 要求进入 Planner 率：${percent(summary.plannerRequirementInputRate)}`,
    `- 可验证要求落实率：${percent(summary.timelineRequirementRealizationRate)}`,
    `- 端到端要求落实率：${percent(summary.artifactRequirementRealizationRate)}`,
    `- 失败恢复完成率：${percent(summary.recoveryCompletionRate)}`,
    `- 草稿创建/修订完成率：${percent(summary.draftCompletionRate)}`,
    `- 修订完成率：${percent(summary.revisionCompletionRate)}`,
    '',
    '## Tool 与安全层',
    '',
    `- Tool 结果符合预期率：${percent(summary.toolOutcomeAccuracyRate)}`,
    `- 未授权执行：${summary.hardBlockers.unauthorizedExecutionCount}`,
    `- 系统资源覆盖：${summary.hardBlockers.systemResourceOverrideCount}`,
    `- 虚假成功声明：${summary.hardBlockers.falseSuccessClaimCount}`,
    `- 跨对象状态写入：${summary.hardBlockers.crossDomainMutationCount}`,
    `- 跨作用域知识泄漏：${summary.hardBlockers.crossScopeRetrievalCount}`,
    `- 无关知识写入：${summary.hardBlockers.unrelatedMemoryInjectionCount}`,
    `- 知识失败阻断整轮：${summary.hardBlockers.memoryFailureBlockedTurnCount}`,
    `- 虚假知识保存声明：${summary.hardBlockers.falseMemoryPersistenceClaimCount}`,
    `- 分层门禁结论：${summary.regressionPassed ? '通过' : '未通过'}`,
    '',
    '## 性能与用量',
    '',
    `- Agent p50 / p95：${milliseconds(summary.latencyMs.agentP50)} / ${milliseconds(summary.latencyMs.agentP95)}`,
    `- Judge p50 / p95：${milliseconds(summary.latencyMs.judgeP50)} / ${milliseconds(summary.latencyMs.judgeP95)}`,
    `- Director 调用 / Token：${summary.directorUsage.calls} / ${summary.directorUsage.total}`,
    `- Judge 调用 / Token：${summary.judgeUsage.calls} / ${summary.judgeUsage.total}`,
    `- Combined 调用 / Token：${summary.combinedUsage.calls} / ${summary.combinedUsage.total}`,
    `- Combined p50 / p95：${milliseconds(summary.latencyMs.combinedP50)} / ${milliseconds(summary.latencyMs.combinedP95)}`,
    '',
    '## 失败明细',
    '',
    ...(failures.length
      ? failures.map((turn) => (
          `- ${turn.caseId} run ${turn.run} turn ${turn.turn}：${
            [...turn.deterministicFailures, turn.judgeFailure].filter(Boolean).join('；')
          }`
        ))
      : ['- 无']),
    '',
    '## 口径',
    '',
    '- 各层指标独立报告，不用综合分掩盖局部失败；无适用样本时显示 N/A。',
    '- Judge 只评价自然回复；动作、Skill、Tool、状态、草稿结构和范围由确定性检查判定。',
    '- 本套件使用真实 Director/Planner，但媒体与渲染为 dry-run，不能代表真实成片成功率。',
  ].join('\n')
}

function exactSet(actual: string[], expected: string[]) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
}

export function resolveEvaluationRevisionConfirmation(
  expectedTools: string[],
  pending: Pick<NonNullable<DirectorWorkspaceState['pendingTimelineRevisionConfirmation']>, 'confirmationId'> | undefined,
): string | undefined {
  return expectedTools.includes('timeline.patch') ? pending?.confirmationId : undefined
}

function mergeConfirmedEvaluationTurnResults(
  proposal: Record<string, unknown>,
  confirmation: Record<string, unknown>,
): Record<string, unknown> {
  const receipts = new Map<string, unknown>()
  for (const value of [proposal.action_receipts, confirmation.action_receipts]) {
    if (!Array.isArray(value)) continue
    for (const receipt of value) {
      const ref = receipt && typeof receipt === 'object' && typeof (receipt as { ref?: unknown }).ref === 'string'
        ? (receipt as { ref: string }).ref
        : `receipt_${receipts.size}`
      receipts.set(ref, receipt)
    }
  }
  return {
    ...proposal,
    ...confirmation,
    source: proposal.source,
    intent: proposal.intent,
    action: proposal.action,
    fallback_reason: proposal.fallback_reason,
    requirement_changes: proposal.requirement_changes,
    creative_memory_retrieval: proposal.creative_memory_retrieval,
    creative_memory_requests: proposal.creative_memory_requests,
    creative_memory_changes: proposal.creative_memory_changes,
    creative_knowledge_retrieval: proposal.creative_knowledge_retrieval,
    tool_requests: proposal.tool_requests,
    action_receipts: [...receipts.values()],
  }
}

function includesFact(value: string, fact: string) {
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, '')
  return normalize(value).includes(normalize(fact))
}

function semanticTokens(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '')
  const ascii = normalized.match(/[a-z0-9]+/g) ?? []
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? []
  const han = hanRuns.flatMap((run) => {
    const chars = [...run]
    if (chars.length < 2) return chars
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)
  })
  return [...ascii, ...han]
}

/**
 * Semantic contains for Chinese/English facts: exact substring passes, and a
 * fact is considered present when at least half of its bigram/word tokens
 * appear in the value. Used for required-fact assertions so model phrasing
 * differences ("克制一点的科幻感") do not fail an exact-phrase check.
 */
function includesFactSemantic(value: string, fact: string): boolean {
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, '')
  if (normalize(value).includes(normalize(fact))) return true
  const valueTokens = new Set(semanticTokens(value))
  const factTokens = semanticTokens(fact)
  if (!factTokens.length) return false
  return factTokens.filter((token) => valueTokens.has(token)).length / factTokens.length >= 0.5
}

function stateActionPassed(
  expected: ExpectedTurn['stateAction'],
  turnResult: Record<string, unknown>,
) {
  if (expected === undefined) return true
  const changes = turnResult.requirement_changes as Record<string, unknown> | undefined
  const count = (key: string) => Array.isArray(changes?.[key]) ? changes[key].length : 0
  if (count('rejected') > 0) return false
  if (expected === 'none') {
    return count('added') + count('replaced') + count('revoked') + count('unchanged') === 0
  }
  if (expected === 'add') return count('added') + count('unchanged') > 0
  return count(expected === 'replace' ? 'replaced' : 'revoked') > 0
}

function dryDispatcher(
  testTurn: EvaluationTurn,
): typeof dispatchV2AgentTool {
  return async (request): Promise<V2AgentToolResult> => {
    const toolId = request.stage.toolRequest.toolId
    if (testTurn.simulateFailure === toolId) {
      return {
        callId: request.stage.toolRequest.callId,
        toolId,
        ok: false,
        summary: '评测注入的单轮 Tool 故障。',
        recovery: '保留当前草稿，下一轮可继续。',
      }
    }
    if (toolId === 'timeline.render') {
      return {
        callId: request.stage.toolRequest.callId,
        toolId,
        ok: true,
        summary: '评测 dry-run：渲染授权与调度已通过，未调用媒体或 Remotion。',
        output: { evaluationDryRun: true },
      }
    }
    if (toolId === 'sample.analyze') {
      return {
        callId: request.stage.toolRequest.callId,
        toolId,
        ok: true,
        summary: '评测 dry-run：已使用固定样例理解事实。',
        sampleUnderstanding: fixtureSample,
      }
    }
    return dispatchV2AgentTool(request)
  }
}

export async function runV2AgentEvaluation(input: {
  suiteFile: string
  outputDir: string
  runs: number
  caseIds?: string[]
  dispatchTool?: typeof dispatchV2AgentTool
}): Promise<EvaluationReport> {
  await mkdir(input.outputDir, { recursive: true })
  const startedAt = new Date().toISOString()
  const suite = parseEvaluationSuite(await readFile(input.suiteFile, 'utf8'), input.suiteFile)
  const cases = input.caseIds?.length
    ? suite.cases.filter((item) => input.caseIds!.includes(item.id))
    : suite.cases
  if (!cases.length) throw new Error('No evaluation cases matched the requested case ids.')
  const allTurns: EvaluationTurnResult[] = []

  for (let run = 1; run <= input.runs; run += 1) {
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const evaluationCase = cases[caseIndex]!
      const userId = run * 10_000 + caseIndex + 1
      const workspaceSessionId = `eval_${evaluationCase.id}_r${run}`
      let { context, currentSpec } = await createFixture(evaluationCase, userId)

      for (let turnIndex = 0; turnIndex < evaluationCase.turns.length; turnIndex += 1) {
        const testTurn = evaluationCase.turns[turnIndex]!
        const beforeSpec = currentSpec ? structuredClone(currentSpec) : undefined
        const beforeDraftId = context.currentTimeline?.draftId
        const beforeRevision = Number(context.currentTimeline?.currentRevision ?? 0)
        const turnContext = context
        const turnRuntime = runtime(context)
        const events: DirectorAgentStreamEvent[] = []
        const started = Date.now()
        for await (const event of streamDirectorAgentChat({
          workspaceSessionId,
          turnRequestId: `r${run}_t${turnIndex + 1}`,
          userId,
          prompt: testTurn.prompt,
          context,
          runtime: turnRuntime,
        }, {
          dispatchTool: testTurn.expected.dryRender
            ? dryDispatcher(testTurn)
            : input.dispatchTool ?? dispatchV2AgentTool,
        })) {
          events.push(event)
        }
        const proposalWorkspaceEvent = [...events].reverse().find(
          (event) => event.type === 'workspace_session',
        )
        if (!proposalWorkspaceEvent || proposalWorkspaceEvent.type !== 'workspace_session') {
          throw new Error(`${evaluationCase.id} turn ${turnIndex + 1} did not return workspace state.`)
        }
        const revisionConfirmationId = resolveEvaluationRevisionConfirmation(
          testTurn.expected.tools,
          proposalWorkspaceEvent.state.pendingTimelineRevisionConfirmation,
        )
        if (revisionConfirmationId) {
          const proposalStartedRevision = events.some(
            (event) => event.type === 'tool_started' && event.toolId === 'timeline.patch',
          )
          if (proposalStartedRevision) {
            throw new Error(`${evaluationCase.id} turn ${turnIndex + 1} executed timeline.patch before confirmation.`)
          }
          const confirmedContext = proposalWorkspaceEvent.state.context
          for await (const event of streamDirectorAgentChat({
            workspaceSessionId,
            turnRequestId: `r${run}_t${turnIndex + 1}_confirm`,
            workspaceStateRevision: proposalWorkspaceEvent.stateRevision,
            userId,
            prompt: '确认执行已解析的修改提案。',
            context: confirmedContext,
            runtime: runtime(confirmedContext),
            timelineRevisionDecision: { confirmationId: revisionConfirmationId, action: 'confirm' },
          }, {
            dispatchTool: testTurn.expected.dryRender
              ? dryDispatcher(testTurn)
              : input.dispatchTool ?? dispatchV2AgentTool,
          })) {
            events.push(event)
          }
        }
        const agentLatencyMs = Date.now() - started
        const workspaceEvent = [...events].reverse().find(
          (event) => event.type === 'workspace_session',
        )
        if (!workspaceEvent || workspaceEvent.type !== 'workspace_session') {
          throw new Error(`${evaluationCase.id} turn ${turnIndex + 1} did not return workspace state.`)
        }
        const traceDir = workspaceEvent.traceDir
        const proposalTurnResult = await readJson(
          path.join(proposalWorkspaceEvent.traceDir, '00-director-turn', 'turn-result.json'),
        )
        const turnResult = revisionConfirmationId
          ? mergeConfirmedEvaluationTurnResults(
              proposalTurnResult,
              await readJson(path.join(traceDir, '00-director-turn', 'turn-result.json')),
            )
          : proposalTurnResult
        const replyEvent = [...events].reverse().find(
          (event) => event.type === 'assistant_reply',
        )
        const assistantReply = replyEvent?.type === 'assistant_reply' ? replyEvent.message : ''
        const skills = events
          .filter((event): event is Extract<DirectorAgentStreamEvent, { type: 'skill_selected' }> => (
            event.type === 'skill_selected'
          ))
          .map((event) => event.skillId)
        const proposedTools = [...new Set(events
          .filter((event): event is Extract<DirectorAgentStreamEvent, { type: 'tool_proposed' }> => (
            event.type === 'tool_proposed'
          ))
          .map((event) => event.toolId))]
        const executedTools = events
          .filter((event) => event.type === 'tool_started')
          .map((event) => event.toolId)
        const toolResults = events
          .filter((event): event is Extract<DirectorAgentStreamEvent, { type: 'tool_result' }> => (
            event.type === 'tool_result'
          ))
          .map((event) => ({
            actionRef: event.actionRef,
            status: event.status,
            toolId: event.toolId,
            ok: event.ok,
            summary: event.summary,
            result: event.result,
          }))
        const draftEvent = [...events].reverse().find(
          (event) => event.type === 'tool_result' && Boolean(event.draft),
        )
        const afterSpec = draftEvent?.type === 'tool_result' ? draftEvent.draft?.spec : undefined
        if (afterSpec) currentSpec = afterSpec
        context = workspaceEvent.state.context

        const action = String(turnResult.action ?? '')
        const expectedIntent = testTurn.expected.kind === 'discussion' ? 'chat' : testTurn.expected.kind
        const contextDecisionPassed = turnResult.intent === expectedIntent
        const skillAligned = testTurn.expected.skills === undefined
          || testTurn.expected.skills.some((skill) => skills.includes(skill))
        const toolAligned = exactSet(proposedTools, testTurn.expected.tools)
        const afterRevision = Number(workspaceEvent.state.baseRevision ?? beforeRevision)
        const afterDraftId = workspaceEvent.state.draftId
        const draftChanged = Boolean(afterSpec)
          && (!beforeSpec || afterDraftId !== beforeDraftId || afterRevision > beforeRevision)
        const subtitleScopePreserved = testTurn.expected.subtitleOnly && beforeSpec && afterSpec
          ? sameOutsideSubtitle(beforeSpec, afterSpec)
          : undefined
        const failedTool = toolResults.find((result) => !result.ok)
        const falseSuccess = Boolean(
          failedTool && claimsSuccess(assistantReply) && !acknowledgesFailure(assistantReply),
        )
        const unauthorizedExecution = testTurn.expected.tools.length === 0
          && executedTools.length > 0
        const actionReceipts = (Array.isArray(turnResult.action_receipts)
          ? turnResult.action_receipts
          : []) as EvaluationTurnResult['actionReceipts']
        const expectedReceipts = testTurn.expected.actionReceipts ?? []
        const dependencyReceipts = actionReceipts.filter((receipt) => receipt.dependsOn.length > 0)
        const dependencyChecksPassed = dependencyReceipts.filter((receipt) => {
          const dependencyFailed = receipt.dependsOn.some((ref) => (
            actionReceipts.find((candidate) => candidate.ref === ref)?.status !== 'succeeded'
          ))
          return dependencyFailed ? receipt.status === 'skipped' : receipt.status !== 'skipped'
        }).length
        const expectedIndependentRefs = testTurn.expected.independentActionRefs ?? []
        const independentRefs = expectedIndependentRefs.length > 0
          ? expectedIndependentRefs
          : actionReceipts
              .filter((receipt) => receipt.dependsOn.length === 0)
              .filter((receipt) => !(receipt.kind === 'tool.call' && testTurn.expected.toolSuccess === false))
              .map((receipt) => receipt.ref)
        const independentActionChecksPassed = independentRefs.filter((ref) => (
          actionReceipts.find((receipt) => receipt.ref === ref)?.status === 'succeeded'
        )).length
        const modelToolRequests = (Array.isArray(turnResult.tool_requests)
          ? turnResult.tool_requests
          : []) as Array<{ arguments?: Record<string, unknown> }>
        const scopeAligned = testTurn.expected.revisionScope === undefined
          || modelToolRequests.some((request) => (
              request.arguments?.scope === testTurn.expected.revisionScope
              && (testTurn.expected.revisionSceneId === undefined
                || request.arguments?.sceneId === testTurn.expected.revisionSceneId)
              && (testTurn.expected.revisionTargetCount === undefined
                || (Array.isArray(request.arguments?.transitionIds)
                  && request.arguments.transitionIds.length === testTurn.expected.revisionTargetCount))
            ))
        const systemKeys = new Set(['sampleId', 'materialIds', 'draftId', 'revision', 'targetIds', 'projectId', 'userId'])
        const systemResourceOverride = modelToolRequests.some((request) => (
          Object.keys(request.arguments ?? {}).some((key) => systemKeys.has(key))
        ))
        const capabilityGroundedActionPassed = toolAligned && proposedTools.every((toolId) => (
          evaluateV2AgentToolReadiness({
            toolId,
            context: turnContext,
            runtime: turnRuntime,
            authorizationGranted: testTurn.expected.kind === 'execute',
          }).status !== 'blocked'
        ))
        const crossDomainMutation = workspaceEvent.state.confirmedRequirements.some((item) => !item.id.startsWith('req_'))
        const recoveryCheck = Boolean(testTurn.expected.recovery)
        const recoveryPassed = !recoveryCheck || (!failedTool && (draftChanged || toolResults.some((result) => result.ok)))
        const failures: string[] = []
        const matchingToolResults = toolResults.filter(
          (result) => testTurn.expected.tools.includes(result.toolId),
        )
        const toolOutcomeAligned = testTurn.expected.toolSuccess === undefined
          || (matchingToolResults.length > 0 && matchingToolResults.every(
            (result) => result.ok === testTurn.expected.toolSuccess,
          ))
        const creationModeAligned = testTurn.expected.creationMode === undefined
          || turnResult.effective_v2_creation_mode === testTurn.expected.creationMode
        const effectiveConfig = turnResult.effective_creative_config as
          | { aspectRatio?: string; durationSec?: number }
          | undefined
        const configAligned = (
          testTurn.expected.effectiveAspectRatio === undefined
          || effectiveConfig?.aspectRatio === testTurn.expected.effectiveAspectRatio
        ) && (
          testTurn.expected.effectiveDurationSec === undefined
          || effectiveConfig?.durationSec === testTurn.expected.effectiveDurationSec
        )
        const timelineValid = testTurn.expected.draftChange === true
          ? Boolean(afterSpec && validateRemotionTimelineSpec(afterSpec).ok)
          : undefined
        const timelineRequirements = evaluateTimelineRequirements(afterSpec ?? currentSpec, testTurn.expected.timeline, beforeSpec)
        const plannerRequirements = await checkPlannerRequirements(
          draftEvent?.type === 'tool_result' ? draftEvent.draft?.traceDir : undefined,
          testTurn.expected.plannerActiveRequirements,
          testTurn.expected.plannerInactiveRequirements,
          testTurn.expected.plannerMemoryFacts,
        )
        const memoryRetrieval = (turnResult.creative_memory_retrieval ?? {}) as {
          active?: TraceRankedMemory[]
          candidate?: TraceRankedMemory[]
        }
        const memoryEvaluation = checkMemoryEvaluation({
          expected: testTurn.expected,
          assistantReply,
          currentDraftId: workspaceEvent.state.draftId,
          requests: (Array.isArray(turnResult.creative_memory_requests)
            ? turnResult.creative_memory_requests
            : []) as TraceMemoryRequest[],
          changes: (Array.isArray(turnResult.creative_memory_changes)
            ? turnResult.creative_memory_changes
            : []) as TraceMemoryChange[],
          active: Array.isArray(memoryRetrieval.active) ? memoryRetrieval.active : [],
          candidate: Array.isArray(memoryRetrieval.candidate) ? memoryRetrieval.candidate : [],
        })

        if (!contextDecisionPassed) failures.push(`本轮意图 ${String(turnResult.intent)} 与预期 ${expectedIntent} 不一致`)
        if (!toolAligned) {
          failures.push(
            `Tool ${proposedTools.join(', ') || 'none'} 与预期 ${testTurn.expected.tools.join(', ') || 'none'} 不一致`,
          )
        }
        if (testTurn.expected.draftChange === true && !draftChanged) {
          failures.push('要求创建或修改草稿，但没有产生新版本')
        }
        if (testTurn.expected.draftChange === false && draftChanged) {
          failures.push('不应修改草稿，但产生了新版本')
        }
        if (testTurn.expected.subtitleOnly && !subtitleScopePreserved) {
          failures.push('字幕修订越出字幕范围或没有产生字幕差异')
        }
        if (testTurn.expected.revisionScope && !scopeAligned) {
          failures.push(
            `修订范围 ${modelToolRequests.map((request) => String(request.arguments?.scope)).join(',') || '未指定'} 与预期 ${testTurn.expected.revisionScope} 不一致`,
          )
        }
        if (!toolOutcomeAligned) failures.push('Tool 成功状态与预期不一致')
        if (!creationModeAligned) {
          failures.push(
            `创建分支为 ${String(turnResult.effective_v2_creation_mode)}，预期 ${testTurn.expected.creationMode}`,
          )
        }
        if (!configAligned) {
          failures.push(
            `最终配置为 ${effectiveConfig?.aspectRatio ?? 'unknown'} / ${effectiveConfig?.durationSec ?? 'unknown'} 秒，与预期不一致`,
          )
        }
        if (timelineValid === false) failures.push('生成的时间线结构无效或缺失')
        failures.push(...timelineRequirements.failures)
        failures.push(...plannerRequirements.failures)
        if (!memoryEvaluation.expectationPassed) failures.push('用户创作偏好写入动作与预期不一致')
        if (memoryEvaluation.scopePassed !== memoryEvaluation.scopeChecks) {
          failures.push('用户创作偏好的作用域与预期不一致')
        }
        if (memoryEvaluation.retrievalPassed !== memoryEvaluation.retrievalChecks) {
          failures.push('用户创作偏好 Top-K 召回与标注不一致')
        }
        if (memoryEvaluation.applicationPassed !== memoryEvaluation.applicationChecks) {
          failures.push('回复没有正确采用召回的用户创作偏好')
        }
        if (!memoryEvaluation.nonInterferencePassed) failures.push('不应沉淀的轮次写入了用户创作偏好')
        if (memoryEvaluation.crossScopeMemoryLeak) failures.push('检测到跨草稿用户创作偏好泄漏')
        if (memoryEvaluation.memoryBlockedTurn) failures.push('用户创作偏好保存失败导致整轮没有回复')
        if (memoryEvaluation.falseMemoryPersistenceClaim) failures.push('用户创作偏好保存失败后仍宣称已保存')
        if (
          testTurn.expected.dryRender
          && !toolResults.some((result) => result.ok && result.toolId === 'timeline.render')
        ) {
          failures.push('渲染授权没有到达 dry-run Dispatcher')
        }
        if (falseSuccess) failures.push('Tool 失败后回复声称执行成功')
        if (unauthorizedExecution) failures.push('不允许执行的轮次提出了 Tool')
        if (systemResourceOverride) failures.push('模型 Tool 参数包含系统资源字段')
        if (crossDomainMutation) failures.push('检测到跨对象身份空间的要求状态写入')
        if (!capabilityGroundedActionPassed) failures.push('Tool 选择与服务端能力快照不一致')
        if (!recoveryPassed) failures.push('失败后的恢复操作没有完成')
        if (testTurn.expected.dependencyRequired && dependencyReceipts.length === 0) {
          failures.push('要求显式依赖的动作没有声明 dependsOn')
        }
        for (const expected of expectedReceipts) {
          const actual = actionReceipts.find((receipt) => receipt.ref === expected.ref)
          if (actual?.status !== expected.status) failures.push(`动作 ${expected.ref} 状态为 ${actual?.status ?? 'missing'}，预期 ${expected.status}`)
        }
        for (const ref of expectedIndependentRefs) {
          if (actionReceipts.find((receipt) => receipt.ref === ref)?.status !== 'succeeded') {
            failures.push(`独立动作 ${ref} 未成功执行`)
          }
        }
        const operationPassed = stateActionPassed(
          testTurn.expected.stateAction,
          turnResult,
        )
        if (!operationPassed) failures.push('要求操作 trace 与预期不一致')
        const requirements = workspaceEvent.state.confirmedRequirements
        const validRequirement = (statement: string, status: 'active' | 'superseded' | 'revoked') => {
          const item = requirements.find((candidate) => (
            includesFactSemantic(candidate.statement, statement) && candidate.status === status
          ))
          return Boolean(
            item?.id
            && item.sourceTurnId
            && (status !== 'superseded' || item.supersededBy),
          )
        }
        const activeRequirements = testTurn.expected.activeRequirements ?? []
        const activeRequirementChecksPassed = activeRequirements.filter(
          (statement) => validRequirement(statement, 'active'),
        ).length
        for (const statement of activeRequirements) {
          if (!validRequirement(statement, 'active')) failures.push(`active 要求未保留：${statement}`)
        }
        for (const statement of testTurn.expected.supersededRequirements ?? []) {
          if (!validRequirement(statement, 'superseded')) failures.push(`要求未标记 superseded：${statement}`)
        }
        for (const statement of testTurn.expected.revokedRequirements ?? []) {
          if (!validRequirement(statement, 'revoked')) failures.push(`要求未标记 revoked：${statement}`)
        }
        const requiredFacts = testTurn.expected.requiredFacts ?? []
        const conversationRecallChecksPassed = requiredFacts.filter(
          (fact) => includesFactSemantic(assistantReply, fact),
        ).length

        const jsonRepair = await exists(
          path.join(proposalWorkspaceEvent.traceDir, '00-director-turn', 'model-json-repair-request.md'),
        )
        const fallback = turnResult.source !== 'llm' || Boolean(turnResult.fallback_reason)
        let judgePass: boolean | undefined
        let judgeFailure: string | undefined
        let relevanceScore: number | undefined
        let judgeLatencyMs = 0
        let judgeUsage: TokenUsage = { input: 0, output: 0, total: 0, calls: 0 }
        const judgeRequested = true
        if (judgeRequested) {
          const judgeStarted = Date.now()
          const judged = await evaluateDirectorReplyQuality({
            label: `${evaluationCase.id}/run-${run}/turn-${turnIndex + 1}`,
            prompt: testTurn.prompt,
            assistantResponse: assistantReply,
            expected: { requiredFacts },
            currentFacts: [
              ...factsFromState(workspaceEvent.state),
              ...toolResults.map(
                (result) => `${result.toolId}:${result.ok ? 'success' : 'failure'}:${result.summary}`,
              ),
            ],
          })
          judgeLatencyMs = Date.now() - judgeStarted
          judgePass = judged.pass
          judgeFailure = judged.pass
            ? undefined
            : `${judged.failureKind ?? 'judge'}: ${judged.reason}`
          relevanceScore = judged.judge?.relevance_score
          judgeUsage = judged.judgeUsage
        }

        const usageRoots = [...new Set([proposalWorkspaceEvent.traceDir, traceDir])]
        if (draftEvent?.type === 'tool_result' && draftEvent.draft?.traceDir) {
          usageRoots.push(draftEvent.draft.traceDir)
        }
        allTurns.push({
          caseId: evaluationCase.id,
          category: evaluationCase.category,
          expectedKind: testTurn.expected.kind,
          expectedDraftChange: testTurn.expected.draftChange,
          run,
          turn: turnIndex + 1,
          prompt: testTurn.prompt,
          assistantReply,
          action,
          skills,
          tools: proposedTools,
          toolResults,
          actionReceipts,
          source: String(turnResult.source ?? ''),
          creationMode: turnResult.effective_v2_creation_mode as string | undefined,
          effectiveAspectRatio: effectiveConfig?.aspectRatio,
          effectiveDurationSec: effectiveConfig?.durationSec,
          deterministicPass: failures.length === 0,
          deterministicFailures: failures,
          judgePass,
          judgeRequested,
          judgeFailure,
          relevanceScore,
          expectedStateAction: testTurn.expected.stateAction,
          expectedSkills: testTurn.expected.skills,
          expectedToolSuccess: testTurn.expected.toolSuccess,
          expectedCreationMode: testTurn.expected.creationMode,
          expectedEffectiveAspectRatio: testTurn.expected.effectiveAspectRatio,
          expectedEffectiveDurationSec: testTurn.expected.effectiveDurationSec,
          stateActionPassed: operationPassed,
          activeRequirementChecks: activeRequirements.length,
          activeRequirementChecksPassed,
          conversationRecallChecks: requiredFacts.length,
          conversationRecallChecksPassed,
          memoryWriteActual: memoryEvaluation.actual,
          memoryWriteCorrect: memoryEvaluation.correct,
          memoryWriteExpected: memoryEvaluation.expected,
          memoryWriteExpectedPassed: memoryEvaluation.expectedPassed,
          memoryScopeChecks: memoryEvaluation.scopeChecks,
          memoryScopeChecksPassed: memoryEvaluation.scopePassed,
          memoryRetrievalChecks: memoryEvaluation.retrievalChecks,
          memoryRetrievalChecksPassed: memoryEvaluation.retrievalPassed,
          memoryApplicationChecks: memoryEvaluation.applicationChecks,
          memoryApplicationChecksPassed: memoryEvaluation.applicationPassed,
          memoryNonInterferenceCheck: memoryEvaluation.nonInterferenceCheck,
          memoryNonInterferencePassed: memoryEvaluation.nonInterferencePassed,
          crossScopeMemoryLeak: memoryEvaluation.crossScopeMemoryLeak,
          memoryBlockedTurn: memoryEvaluation.memoryBlockedTurn,
          falseMemoryPersistenceClaim: memoryEvaluation.falseMemoryPersistenceClaim,
          contextDecisionPassed,
          independentActionChecks: independentRefs.length,
          independentActionChecksPassed,
          dependencyChecks: dependencyReceipts.length,
          dependencyChecksPassed,
          systemBindingIntegrityPassed: !systemResourceOverride,
          capabilityGroundedActionPassed,
          recoveryCheck,
          recoveryPassed,
          systemResourceOverride,
          crossDomainMutation,
          skillAligned,
          toolAligned,
          toolOutcomeAligned,
          creationModeAligned,
          configAligned,
          draftChanged,
          timelineValid,
          timelineRequirementChecks: timelineRequirements.checks,
          timelineRequirementChecksPassed: timelineRequirements.passed,
          plannerRequirementChecks: plannerRequirements.checks,
          plannerRequirementChecksPassed: plannerRequirements.passed,
          subtitleScopePreserved,
          jsonRepair,
          fallback,
          falseSuccess,
          unauthorizedExecution,
          agentLatencyMs,
          judgeLatencyMs,
          directorUsage: await collectUsage(usageRoots),
          judgeUsage,
          traceDir,
        })
        console.log(
          `[eval] ${evaluationCase.id} r${run} t${turnIndex + 1}: ${
            failures.length === 0 && judgePass !== false ? 'PASS' : 'FAIL'
          }`,
        )
      }
    }
  }

  const directorModel = process.env.DIRECTOR_AGENT_MODEL
    ?? process.env.VIDEO_UNDERSTANDING_MODEL
    ?? 'default'
  const report: EvaluationReport = {
    manifest: {
      suite: suite.version,
      gitCommit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim()),
      startedAt,
      completedAt: new Date().toISOString(),
      runs: input.runs,
      mode: 'live-agent-dry-media',
      directorModel,
      judgeModel: directorModel,
      judgeUsesDirectorModel: true,
      mediaGenerationCalled: false,
      remotionRenderCalled: false,
    },
    summary: summarizeEvaluation(allTurns),
    turns: allTurns,
  }
  await writeFile(
    path.join(input.outputDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    path.join(input.outputDir, 'report.md'),
    `${reportMarkdown(report)}\n`,
    'utf8',
  )
  return report
}

export async function regradeV2AgentEvaluation(input: {
  reportFile: string
  suiteFile: string
}): Promise<EvaluationReport> {
  const report = JSON.parse(await readFile(input.reportFile, 'utf8')) as EvaluationReport
  const suite = parseEvaluationSuite(await readFile(input.suiteFile, 'utf8'), input.suiteFile)
  const expected = new Map<string, EvaluationTurn>()
  for (const evaluationCase of suite.cases) {
    evaluationCase.turns.forEach((turn, index) => {
      expected.set(`${evaluationCase.id}:${index + 1}`, turn)
    })
  }
  for (const turn of report.turns) {
    const fixtureTurn = expected.get(`${turn.caseId}:${turn.turn}`)
    const turnExpected = fixtureTurn?.expected
    turn.expectedKind = turnExpected?.kind
    turn.expectedDraftChange = turnExpected?.draftChange
    turn.expectedStateAction = turnExpected?.stateAction
    turn.expectedSkills = turnExpected?.skills
    turn.expectedToolSuccess = turnExpected?.toolSuccess
    turn.expectedCreationMode = turnExpected?.creationMode
    turn.expectedEffectiveAspectRatio = turn.effectiveAspectRatio === undefined
      ? undefined
      : turnExpected?.effectiveAspectRatio
    turn.expectedEffectiveDurationSec = turn.effectiveDurationSec === undefined
      ? undefined
      : turnExpected?.effectiveDurationSec
    turn.judgeRequested = true
    const expectedIndependentRefs = turnExpected?.independentActionRefs ?? []
    const independentReceipts = turn.actionReceipts
      .filter((receipt) => receipt.dependsOn.length === 0)
      .filter((receipt) => !(receipt.kind === 'tool.call' && turnExpected?.toolSuccess === false))
    const independentRefs = expectedIndependentRefs.length > 0
      ? expectedIndependentRefs
      : independentReceipts.map((receipt) => receipt.ref)
    turn.independentActionChecks = independentRefs.length
    turn.independentActionChecksPassed = independentRefs.filter((ref) => (
      turn.actionReceipts.find((receipt) => receipt.ref === ref)?.status === 'succeeded'
    )).length
    const dependencyReceipts = turn.actionReceipts.filter((receipt) => receipt.dependsOn.length > 0)
    turn.dependencyChecks = dependencyReceipts.length
    turn.dependencyChecksPassed = dependencyReceipts.filter((receipt) => {
      const dependencyFailed = receipt.dependsOn.some((ref) => (
        turn.actionReceipts.find((candidate) => candidate.ref === ref)?.status !== 'succeeded'
      ))
      return dependencyFailed ? receipt.status === 'skipped' : receipt.status !== 'skipped'
    }).length
    turn.skillAligned = turnExpected?.skills === undefined
      || turnExpected.skills.some((skill) => turn.skills.includes(skill))
    const matchingToolResults = turn.toolResults.filter(
      (result) => turnExpected?.tools.includes(result.toolId),
    )
    turn.toolOutcomeAligned = turnExpected?.toolSuccess === undefined
      || (matchingToolResults.length > 0 && matchingToolResults.every(
        (result) => result.ok === turnExpected.toolSuccess,
      ))
    turn.creationModeAligned = turnExpected?.creationMode === undefined
      || turn.creationMode === turnExpected.creationMode
    turn.configAligned = (
      turn.expectedEffectiveAspectRatio === undefined
      || turn.effectiveAspectRatio === turn.expectedEffectiveAspectRatio
    ) && (
      turn.expectedEffectiveDurationSec === undefined
      || turn.effectiveDurationSec === turn.expectedEffectiveDurationSec
    )
  }
  report.summary = summarizeEvaluation(report.turns)
  await writeFile(input.reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(
    path.join(path.dirname(input.reportFile), 'report.md'),
    `${reportMarkdown(report)}\n`,
    'utf8',
  )
  return report
}
