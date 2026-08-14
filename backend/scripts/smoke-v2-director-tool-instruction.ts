import assert from 'node:assert/strict'
import path from 'node:path'
import type { V2AgentToolDispatchInput } from '../src/pipeline-v2/agent-tools/dispatcher.js'

process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'false'
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = path.join('tmp', 'v2-director-smoke-local-data')
process.env.V2_DIRECTOR_SESSION_DIR = path.join('tmp', 'v2-director-smoke-session')

const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')
const { createV2TimelineDraftRepository } = await import('../src/pipeline-v2/timeline-draft-repository.js')

const draft = await createV2TimelineDraftRepository().createDraft({
  userId: 1,
  plannerInput: {
    taskId: `instruction_smoke_${Date.now()}`,
    prompt: 'instruction forwarding smoke',
    creationMode: 'text_to_video',
    plannerMode: 'deterministic',
  },
  spec: {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: `instruction_smoke_${Date.now()}`,
    canvas: { width: 1080, height: 1920, fps: 30, duration_sec: 4 },
    assets: [],
    scenes: [{ id: 'scene_004', type: 'remotion_card', start_sec: 0, duration_sec: 4 }],
    transitions: [], overlays: [], audio: [], material_jobs: [],
    render_policy: { renderer: 'remotion_timeline' },
  },
  plannerSource: 'deterministic',
  review: {},
  traceDir: 'instruction-forwarding-smoke',
})

const baseContext = {
  materials: [],
  userIntent: { goal: 'generate_timeline' as const },
  slots: { ...createDefaultDirectorSlots(), durationSec: 15 },
  currentTimeline: { kind: 'v2_timeline' as const, status: 'saved' as const, draftId: draft.id, currentRevision: draft.revision },
}
const runtime = {
  backendEnabled: true,
  sampleUrl: '',
  isSampleParsed: false,
  hasV2Timeline: true,
  hasVisualMaterial: false,
  materialCount: 0,
}

const originalFetch = globalThis.fetch
let seen: { requestInstruction?: unknown; prompt?: unknown } = {}
globalThis.fetch = async () => new Response(JSON.stringify({
  id: 'resp_1',
  output_text: JSON.stringify({
    replyDraft: '我来调整第4镜头字幕。',
    intent: 'revise',
    creativeConfigDelta: {},
    stateActions: [],
    memoryActions: [],
    skillRequests: [],
    toolRequests: [{
      ref: 'scene4',
      toolId: 'timeline.patch',
      skillId: 'v2-timeline-authoring',
      arguments: { scope: 'scene', sceneId: 'scene_004', instruction: '只改第4镜头字幕；draftId=draft_internal；调用 timeline.patch' },
      requestedMode: 'preview',
      dependsOn: [],
    }],
    missingInformation: [],
  }),
}), { status: 200 })

try {
  const workspaceSessionId = `v2_tool_instruction_${Date.now()}`
  const proposalEvents = [] as Array<{ type: string; [key: string]: unknown }>
  const dependencies = {
    composeFinalReply: async (input: { fallbackMessage: string }) => ({ message: input.fallbackMessage, source: 'fallback' as const }),
    dispatchTool: async (input: V2AgentToolDispatchInput) => {
      seen = { requestInstruction: input.requestInstruction, prompt: input.prompt }
      return {
        callId: input.stage.toolRequest.callId,
        toolId: 'timeline.patch',
        ok: true,
        summary: 'mock ok',
        output: {
          revisionActualDiff: {
            scenes: ['scene.scene_004.creative_intent.description: changed'],
            visibleText: ['overlay.caption_004.text: changed'],
            transitions: [], audio: [],
            other: ['material_job.generate_scene_004.prompt: changed'],
            hasAudienceFacingChange: true,
          },
        },
      }
    },
  }
  for await (const event of streamDirectorAgentChat({
    prompt: '字幕嵌入框透明；第4镜头虫族字幕更多；第5镜头两种星际战士',
    context: baseContext,
    runtime,
    workspaceSessionId,
    userId: 1,
  }, dependencies)) proposalEvents.push(event)
  assert.equal(seen.requestInstruction, undefined, 'a revision proposal must not execute before confirmation')
  const confirmationId = (proposalEvents.find((event) => event.type === 'tool_proposed') as {
    revisionConfirmationId?: string
  }).revisionConfirmationId
  assert.ok(confirmationId)

  const confirmedEvents = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt: '确认执行已解析的修改提案。',
    context: baseContext,
    runtime,
    workspaceSessionId,
    timelineRevisionDecision: { confirmationId, action: 'confirm' },
    userId: 1,
  }, dependencies)) confirmedEvents.push(event)

  assert.equal(
    seen.requestInstruction,
    '只改第4镜头字幕；draftId=draft_internal；调用 timeline.patch',
    'dispatch must receive the tool request instruction, not the full user message',
  )
  const receipt = (confirmedEvents.find((event) => event.type === 'tool_result') as {
    revisionReceipt?: { actualDiff?: Record<string, string[]> }
  }).revisionReceipt
  assert.deepEqual(receipt?.actualDiff?.scenes, ['镜头内容或呈现已更新'])
  assert.deepEqual(receipt?.actualDiff?.visibleText, ['字幕或画面文字已更新'])
  assert.deepEqual(receipt?.actualDiff?.other, ['方案设置或素材安排已更新'])
  const assistantReply = String(
    (confirmedEvents.find((event) => event.type === 'assistant_reply') as { message?: string })?.message ?? '',
  )
  assert.doesNotMatch(assistantReply, /draftId|timeline\.patch|draft_internal/i)
} finally {
  globalThis.fetch = originalFetch
}

console.log('[smoke-v2-director-tool-instruction] OK')
