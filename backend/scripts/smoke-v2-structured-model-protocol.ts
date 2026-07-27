import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

process.env.VIDEO_UNDERSTANDING_API_KEY = 'test-key'
process.env.DIRECTOR_AGENT_API_KEY = 'test-key'
process.env.V2_TRACE_BASE_DIR = path.join('tmp', 'v2-agent-trace', 'tests', `structured-protocol_${Date.now()}`)

const samplePath = path.resolve(process.cwd(), '..', 'example_videos', '1.mp4')
if (!existsSync(samplePath)) throw new Error(`Missing sample video: ${samplePath}`)

const originalFetch = globalThis.fetch
const requestBodies: Array<Record<string, unknown>> = []

try {
  let understandingCall = 0
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    if (target.endsWith('/files') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'file_mock_1' }), { status: 200 })
    }
    if (target.includes('/files/file_mock_1') && !init?.method) {
      return new Response(JSON.stringify({ status: 'active' }), { status: 200 })
    }
    if (target.includes('/files/file_mock_1') && init?.method === 'DELETE') {
      return new Response('{}', { status: 200 })
    }
    if (target.includes('/responses')) {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      understandingCall += 1
      if (understandingCall === 1) {
        return new Response(JSON.stringify({ id: 'understanding_1', output_text: '{"schema_version":' }), { status: 200 })
      }
      return new Response(JSON.stringify({
        id: 'understanding_2',
        output_text: JSON.stringify({
          schema_version: 'v2_sample_understanding.v1', task_id: 'sample_protocol', summary_zh: '修复后的样例理解', segments: [],
        }),
      }), { status: 200 })
    }
    throw new Error(`Unexpected mocked request: ${target}`)
  }

  const { analyzeV2Sample } = await import('../src/pipeline-v2/sample-understanding-service.js')
  const sampleResult = await analyzeV2Sample({ taskId: 'sample_protocol', prompt: '只做样例理解', sampleVideoPath: samplePath })
  assert.equal(sampleResult.understanding.source, 'llm')
  assert.equal((requestBodies[0]?.text as { format?: { type?: string } } | undefined)?.format?.type, 'json_schema')
  const repairContent = ((requestBodies[1]?.input as Array<{ content?: Array<{ type?: string }> }> | undefined)?.[0]?.content ?? [])
  assert.equal(repairContent.some((item) => item.type === 'input_video'), false)

  requestBodies.length = 0
  let plannerCall = 0
  const { buildDeterministicRemotionTimelineSpec } = await import('../src/pipeline-v2/remotion-timeline-planner.js')
  const validSpec = buildDeterministicRemotionTimelineSpec({
    taskId: 'planner_protocol', creationMode: 'text_to_video', prompt: '生成一版无素材科技介绍视频', durationSec: 6,
  })
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    plannerCall += 1
    return new Response(JSON.stringify({
      id: `planner_${plannerCall}`,
      output_text: plannerCall === 1 ? '{"schema_version":' : JSON.stringify(validSpec),
    }), { status: 200 })
  }
  const { runV2TimelineLlmPlanner } = await import('../src/pipeline-v2/remotion-timeline-llm-planner.js')
  const plannerResult = await runV2TimelineLlmPlanner({
    taskId: 'planner_protocol', creationMode: 'text_to_video', prompt: '生成一版无素材科技介绍视频', durationSec: 6,
  })
  assert.ok(plannerResult.jsonRepair)
  assert.equal((requestBodies[0]?.text as { format?: { type?: string } } | undefined)?.format?.type, 'json_schema')
  assert.equal('text' in requestBodies[1]!, false)
  assert.equal('reasoning' in (plannerResult.rawResponse as Record<string, unknown>), false)

  requestBodies.length = 0
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({ id: 'planner_invalid', output_text: '{"schema_version":' }), { status: 200 })
  }
  const { previewV2RemotionTimeline } = await import('../src/pipeline-v2/remotion-timeline-service.js')
  const fallbackPreview = await previewV2RemotionTimeline({
    taskId: 'planner_protocol_second_failure', creationMode: 'text_to_video',
    plannerMode: 'llm', allowPlannerFallback: true, prompt: '生成一版无素材科技介绍视频', durationSec: 6,
  })
  assert.equal(fallbackPreview.plannerSource, 'llm_fallback_deterministic')
  const failureDiagnostic = JSON.parse(readFileSync(
    path.join(fallbackPreview.traceDir, '02-planning', 'llm-timeline-planner-protocol-diagnostic.json'), 'utf8',
  )) as { fallback_reason?: string }
  assert.equal(failureDiagnostic.fallback_reason, 'unrepairable_structured_output')

  const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
  const { routeDirectorIntentWithLlm } = await import('../src/modules/director-agent/llm-intent-router.js')
  const directorContext = { materials: [], userIntent: {}, slots: createDefaultDirectorSlots() }
  const directorRuntime = {
    backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasV2Timeline: false,
    hasVisualMaterial: false, materialCount: 0,
  }
  let directorCall = 0
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    directorCall += 1
    return new Response(JSON.stringify({
      id: `director_${directorCall}`,
      output_text: directorCall === 1
        ? '{"intent":'
        : JSON.stringify({
            intent: 'clarify', confidence: 0.8, contentDomain: 'general', slotsPatch: {},
            missingSlots: [], requiresConfirmation: false, executionEffect: 'none',
            nextAction: 'ACKNOWLEDGE', assistantMessage: '这是修复后的自然回复。', publicThoughts: [], statePatch: {}, requirements: [],
          }),
    }), { status: 200 })
  }
  const repairedDirector = await routeDirectorIntentWithLlm({
    prompt: '先讨论字幕策略', context: directorContext, runtime: directorRuntime,
  })
  assert.equal(repairedDirector.source, 'llm')
  assert.ok(repairedDirector.jsonRepair?.responseAudit)

  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'director_invalid', output_text: '{"intent":' }), { status: 200 })
  const unrepairedDirector = await routeDirectorIntentWithLlm({
    prompt: '继续讨论字幕策略', context: directorContext, runtime: directorRuntime,
  })
  assert.equal(unrepairedDirector.source, 'context_fallback')
  assert.ok(unrepairedDirector.jsonRepair?.protocolError)
} finally {
  globalThis.fetch = originalFetch
}

console.log('[smoke] V2 structured model protocol passed')
