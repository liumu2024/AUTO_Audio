import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const outputDir = path.resolve(argument('--output') ?? path.join('tmp', 'v2-component-authoring-live', new Date().toISOString().replace(/[:.]/g, '-')))
const reuseRuns = Number(argument('--reuse-runs') ?? 3)
const selectedCaseIds = new Set((argument('--case') ?? '').split(',').map((item) => item.trim()).filter(Boolean))
await mkdir(outputDir, { recursive: true })
process.env.RENDER_COMPONENTS_DIR = path.join(outputDir, 'components')

const { authorRenderComponent } = await import('../src/modules/render-components/component-authoring-agent.js')
const { listPromotedComponents, listRenderComponents } = await import('../src/modules/render-components/component-registry.js')
const { routeDirectorIntentWithLlm } = await import('../src/modules/director-agent/llm-intent-router.js')
const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
const { renderV2RemotionTimeline } = await import('../src/pipeline-v2/remotion-timeline-renderer.js')

const skillContent = await readFile(path.resolve('src/pipeline-v2/agent-skills/v2-render-delivery/SKILL.md'), 'utf8')
const effects = [
  {
    id: 'scene_rings', purpose: 'scene' as const, displayName: '青色同心光环',
    effectBrief: '深蓝背景上三层青色同心光环从中心依次扩大并淡出',
    acceptanceCriteria: ['五帧中能看到至少三层青色同心光环', '光环半径随时间明显增大', '背景始终为深蓝色'],
  },
  {
    id: 'scene_bars', purpose: 'scene' as const, displayName: '紫色柱状动画',
    effectBrief: '三根紫色竖条从底部依次上升，形成有节奏的数据展示动画',
    acceptanceCriteria: ['画面中始终存在三根紫色竖条', '三根竖条的上升进度存在先后差异', '竖条从画面底部向上生长'],
  },
  {
    id: 'transition_iris', purpose: 'transition' as const, displayName: '圆形渐变',
    effectBrief: '从画面中心扩大的圆形光圈揭示下一镜头，退出方向反向收拢',
    acceptanceCriteria: ['progress 0 时下一镜头 B 的圆形揭示区域最小', 'progress 1 时下一镜头 B 覆盖全画面且不残留 A', '中间帧能看到清晰的圆形边界'],
  },
  {
    id: 'transition_diagonal', purpose: 'transition' as const, displayName: '青色斜向擦除',
    effectBrief: '带青色发光边缘的斜向擦除，从左上角推进到右下角',
    acceptanceCriteria: ['擦除边界从左上方向右下方移动', '中间帧存在斜向边界', '边界附近可见青色高亮'],
  },
]
const selectedEffects = selectedCaseIds.size ? effects.filter((effect) => selectedCaseIds.has(effect.id)) : effects

function applicationSpec(effect: typeof effects[number], componentId: string): RemotionTimelineSpecV1 {
  const transition = effect.purpose === 'transition'
  return {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: `live_apply_${effect.id}`,
    canvas: { width: 202, height: 360, fps: 12, duration_sec: 1 },
    assets: [],
    scenes: transition
      ? [
          { id: 'a', type: 'remotion_card', start_sec: 0, duration_sec: 0.5, title: 'A', background: '#1d4ed8' },
          { id: 'b', type: 'remotion_card', start_sec: 0.5, duration_sec: 0.5, title: 'B', background: '#dc2626' },
        ]
      : [{
          id: 'scene', type: 'remotion_card', start_sec: 0, duration_sec: 1,
          background: '#0f172a', custom_render: { component_id: componentId, params: {} },
        }],
    transitions: transition ? [{
      id: 'ab', from_scene_id: 'a', to_scene_id: 'b', type: 'fade', duration_sec: 5 / 12,
      custom_render: { component_id: componentId, params: {} },
    }] : [],
    overlays: [], material_jobs: [], audio: [],
    render_policy: { renderer: 'remotion_timeline' },
  }
}

const attempts: Array<Record<string, unknown> & {
  effect: typeof effects[number]
  result: Awaited<ReturnType<typeof authorRenderComponent>>
  application?: { outputPath: string; fileSizeBytes: number }
}> = []
for (const effect of selectedEffects) {
  const started = Date.now()
  const result = await authorRenderComponent({
    purpose: effect.purpose,
    displayName: effect.displayName,
    effectBrief: effect.effectBrief,
    acceptanceCriteria: effect.acceptanceCriteria,
    canvas: { width: 1080, height: 1920, fps: 30, durationSec: 10 },
    skillContent,
    sourceWorkspaceSessionId: `live_${effect.id}`,
  })
  if (!result.ok) {
    attempts.push({ effect, result, durationMs: Date.now() - started })
    continue
  }
  const rendered = await renderV2RemotionTimeline({
    spec: applicationSpec(effect, result.componentId),
    outputDir: path.join(outputDir, 'applications', effect.id),
    outputName: `${effect.id}.mp4`,
  })
  attempts.push({ effect, result, application: { outputPath: rendered.outputPath, fileSizeBytes: rendered.fileSizeBytes }, durationMs: Date.now() - started })
}

const context = {
  materials: [],
  userIntent: {},
  slots: { ...createDefaultDirectorSlots(), aspectRatio: '9:16' as const, durationSec: 10 },
}
const runtime = {
  backendEnabled: true,
  sampleUrl: '',
  isSampleParsed: false,
  hasVisualMaterial: false,
  materialCount: 0,
}
const reuseDecisions = []
const authored = attempts.filter((item): item is typeof item & { result: Extract<typeof item.result, { ok: true }>; application: { outputPath: string; fileSizeBytes: number } } => item.result.ok && Boolean(item.application))
for (let run = 1; run <= reuseRuns; run += 1) {
  for (const item of authored) {
    const routed = await routeDirectorIntentWithLlm({
      prompt: `创建一个10秒竖版短片，并使用已注册的“${item.result.effectSummary}”效果；不要重新创建相同组件。`,
      context,
      runtime,
      currentTurnId: `reuse_${run}_${item.effect.id}`,
    })
    const toolRequests = routed.result.agentToolProposals ?? []
    const repeatedAuthor = toolRequests.some((request) => request.toolId === 'render.author')
    reuseDecisions.push({ run, effectId: item.effect.id, source: routed.source, toolRequests, repeatedAuthor })
  }
}

const registeredComponents = await listRenderComponents()
const promotedComponents = await listPromotedComponents()
const illegalPromotionCount = registeredComponents.filter((component) => {
  const evidence = component.previewEvidence
  return component.status === 'promoted' && (
    evidence?.verdict !== 'passed'
    || evidence.frameCount !== 5
    || evidence.criteria.length === 0
    || evidence.criteria.some((criterion) => !criterion.passed)
  )
}).length
const report = {
  generatedAt: new Date().toISOString(),
  model: process.env.DIRECTOR_AGENT_MODEL ?? 'configured-default',
  effects: attempts,
  promotedComponents,
  reuseDecisions,
  metrics: {
    authoringSuccessRate: selectedEffects.length ? authored.length / selectedEffects.length : 0,
    applicationSuccessRate: selectedEffects.length ? authored.filter((item) => item.application.fileSizeBytes > 0).length / selectedEffects.length : 0,
    repeatedAuthorCount: reuseDecisions.filter((item) => item.repeatedAuthor).length,
    illegalPromotionCount,
  },
}
await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputDir, metrics: report.metrics }, null, 2))
if (report.metrics.authoringSuccessRate < 1 || report.metrics.applicationSuccessRate < 1 || report.metrics.repeatedAuthorCount > 0 || report.metrics.illegalPromotionCount > 0) {
  process.exitCode = 1
}
