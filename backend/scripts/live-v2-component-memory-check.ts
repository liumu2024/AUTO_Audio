import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-live-check-'))
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = path.join(dataDir, 'db')
process.env.V2_DIRECTOR_SESSION_DIR = path.join(dataDir, 'sessions')
process.env.RENDER_COMPONENTS_DIR = path.join(dataDir, 'components')

const results: Record<string, unknown> = {}

try {
  const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
  const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')
  const {
    listRenderComponents,
    promoteRenderComponent,
    registerRenderComponent,
  } = await import('../src/modules/render-components/component-registry.js')
  const { listCreativeMemories } = await import('../src/modules/creative-memory/creative-memory.service.js')

  // Pre-seed a promoted blur dissolve transition component (already verified
  // by a real render in the deterministic smoke).
  const blurSource = `
export default function BlurDissolve({ children, progress, direction }) {
  const blur = direction === 'exiting' ? 18 * (progress ?? 0) : 0
  const opacity = direction === 'exiting' ? 1 - (progress ?? 0) : 1
  return (
    <div style={{ filter: \`blur(\${blur}px)\`, height: '100%', opacity, width: '100%' }}>
      {children}
    </div>
  )
}
`
  await registerRenderComponent({
    id: 'cmp_blur_dissolve',
    source: blurSource,
    purpose: 'transition',
    displayName: '模糊溶解',
    effectSummary: '模糊溶解过渡：前一镜头模糊消失、后一镜头清晰显现',
    effectBrief: '模糊溶解过渡',
    acceptanceCriteria: ['前一镜头模糊消失', '后一镜头清晰显现'],
  })
  await promoteRenderComponent({
    id: 'cmp_blur_dissolve',
    previewEvidence: {
      verdict: 'passed', frameCount: 5, summary: 'pre-seeded verified fixture',
      criteria: [{ criterion: '前一镜头模糊消失', passed: true, evidence: 'fixture' }],
      reviewedAt: new Date().toISOString(),
    },
  })

  const baseContext = {
    materials: [],
    userIntent: { goal: 'generate_timeline' as const },
    slots: {
      ...createDefaultDirectorSlots(),
      durationSec: 12,
      styleIntensity: 'medium' as const,
    },
  }
  const runtime = {
    backendEnabled: true,
    sampleUrl: '',
    isSampleParsed: false,
    hasV2Timeline: false,
    hasVisualMaterial: false,
    materialCount: 0,
  }

  async function chat(workspaceSessionId: string, prompt: string) {
    const events: Array<Record<string, unknown>> = []
    for await (const event of streamDirectorAgentChat({
      prompt,
      context: baseContext,
      runtime,
      workspaceSessionId,
      userId: 1,
    })) events.push(event)
    const session = events.find((event) => event.type === 'workspace_session') as
      | { traceDir?: string }
      | undefined
    return {
      events,
      traceDir: session?.traceDir,
      reply: String((events.find((event) => event.type === 'assistant_reply') as { message?: unknown } | undefined)?.message ?? ''),
      tools: events
        .filter((event) => event.type === 'tool_result')
        .map((event) => ({ ref: event.actionRef, toolId: event.toolId, status: event.status, summary: event.summary })),
    }
  }

  async function findSpecTransitions(traceDir: string | undefined): Promise<unknown> {
    if (!traceDir) return null
    const candidates = [
      path.join(traceDir, 'operations', 'timeline-scoped-candidate.json'),
      path.join(traceDir, 'operations', 'timeline-spec.json'),
      path.join(traceDir, 'operations'),
    ]
    for (const file of candidates) {
      try {
        if (file.endsWith('operations')) {
          const { readdir } = await import('node:fs/promises')
          const entries = (await readdir(file, { withFileTypes: true })).filter((item) => item.isDirectory())
          const planDir = entries.find((item) => item.name.startsWith('timeline.plan'))
          if (planDir) {
            const spec = JSON.parse(
              await readFile(path.join(file, planDir.name, '02-planning', 'timeline-spec.json'), 'utf8'),
            )
            if (spec?.transitions) return spec.transitions
          }
        }
        const spec = JSON.parse(await readFile(file, 'utf8'))
        if (spec?.transitions) return spec.transitions
      } catch {
        // try next candidate
      }
    }
    return null
  }

  async function readTurnDiagnostics(traceDir: string | undefined): Promise<Record<string, unknown>> {
    if (!traceDir) return {}
    const turnDirs = []
    try {
      const { readdir } = await import('node:fs/promises')
      const opsRoot = path.join(traceDir, 'operations')
      for (const entry of (await readdir(opsRoot, { withFileTypes: true })).filter((item) => item.isDirectory())) {
        if (entry.name.startsWith('turn_')) turnDirs.push(path.join(opsRoot, entry.name))
      }
    } catch {
      return {}
    }
    const latest = turnDirs.sort().at(-1)
    if (!latest) return {}
    try {
      const result = JSON.parse(await readFile(path.join(latest, '00-director-turn', 'turn-result.json'), 'utf8'))
      return {
        intent: result.intent,
        toolRequests: result.tool_requests?.map((request: { toolId: string; arguments: Record<string, unknown> }) => ({
          toolId: request.toolId,
          arguments: request.arguments,
        })),
        memoryRequests: result.creative_memory_requests,
      }
    } catch {
      return {}
    }
  }

  // Scenario 1: model should reuse the promoted component instead of inventing
  // an unsupported transition type.
  const s1 = await chat('live_check_s1', '创建一个三镜头的科幻短片，第二和第三镜头之间使用模糊溶解过渡（Blur Dissolve），强化诡异感')
  results.scenario1_reuse = {
    traceDir: s1.traceDir,
    reply: s1.reply.slice(0, 300),
    tools: s1.tools,
    transitions: await findSpecTransitions(s1.traceDir),
    director: await readTurnDiagnostics(s1.traceDir),
  }

  // Scenario 2: natural, non-directive request. The model must decide on its
  // own that render.author is needed (no tool is named in the prompt).
  const s2 = await chat(
    'live_check_s2',
    '给第三镜头加一个粒子消散的入场效果',
  )
  const registeredComponents = await listRenderComponents()
  results.scenario2_author = {
    traceDir: s2.traceDir,
    reply: s2.reply.slice(0, 300),
    tools: s2.tools,
    director: await readTurnDiagnostics(s2.traceDir),
    componentsAfter: registeredComponents.map((item) => ({
      id: item.id,
      status: item.status,
      purpose: item.purpose,
      effectSummary: item.effectSummary,
    })),
  }

  // Scenario 3: the same preference expressed in two sessions becomes active
  // automatically (behavior-driven sedimentation).
  await chat('live_check_s3a', '我通常喜欢蓝灰低饱和的画面')
  await chat('live_check_s3b', '我通常喜欢蓝灰低饱和的画面')
  const memories = await listCreativeMemories({ userId: 1 })
  results.scenario3_memory = memories
    .filter((memory) => memory.statement.includes('蓝灰') || memory.statement.includes('低饱和'))
    .map((memory) => ({ id: memory.id, status: memory.status, scopeType: memory.scopeType, origin: memory.origin }))

  console.log(JSON.stringify(results, null, 2))
  console.log(`\n[dataDir] ${dataDir}`)
} finally {
  // Keep the data directory for post-run trace diagnosis.
}
