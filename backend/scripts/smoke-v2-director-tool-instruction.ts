import assert from 'node:assert/strict'
import path from 'node:path'

process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'false'
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = path.join('tmp', 'v2-director-smoke-local-data')
process.env.V2_DIRECTOR_SESSION_DIR = path.join('tmp', 'v2-director-smoke-session')

const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')

const baseContext = {
  materials: [],
  userIntent: { goal: 'generate_timeline' as const },
  slots: { ...createDefaultDirectorSlots(), durationSec: 15 },
  currentTimeline: { kind: 'v2_timeline' as const, status: 'saved' as const, draftId: 'draft_1', currentRevision: 1 },
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
      arguments: { scope: 'scene', sceneId: 'scene_004', instruction: '只改第4镜头字幕' },
      requestedMode: 'preview',
      dependsOn: [],
    }],
    missingInformation: [],
  }),
}), { status: 200 })

try {
  const events = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt: '字幕嵌入框透明；第4镜头虫族字幕更多；第5镜头两种星际战士',
    context: baseContext,
    runtime,
    workspaceSessionId: `v2_tool_instruction_${Date.now()}`,
    userId: 1,
  }, {
    dispatchTool: async (input) => {
      seen = input as typeof seen
      return { callId: 'v2call_test', toolId: 'timeline.patch', ok: true, summary: 'mock ok' }
    },
  })) events.push(event)

  assert.equal(
    seen.requestInstruction,
    '只改第4镜头字幕',
    'dispatch must receive the tool request instruction, not the full user message',
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log('[smoke-v2-director-tool-instruction] OK')
