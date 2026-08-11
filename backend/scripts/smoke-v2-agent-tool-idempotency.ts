import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DPL304_LOCAL_MODE = 'true'
const localDataDir = await mkdtemp(path.join(tmpdir(), 'dpl304-tool-idempotency-'))
process.env.DPL304_LOCAL_DATA_DIR = localDataDir

try {
  const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
  const { createDirectorWorkspaceState } = await import('../src/modules/director-agent/director-workspace-session.js')
  const { resolveV2AgentExecutionPlan } = await import('../src/pipeline-v2/agent-skills/registry.js')
  const { dispatchV2AgentTool } = await import('../src/pipeline-v2/agent-tools/dispatcher.js')
  const { V2_TIMELINE_PLANNER_PROTOCOL_VERSION } = await import('../src/pipeline-v2/remotion-timeline-llm-planner.js')

  assert.match(V2_TIMELINE_PLANNER_PROTOCOL_VERSION, /^v2_timeline_planner_protocol\.v\d+$/)

  const context = { materials: [], userIntent: {}, slots: createDefaultDirectorSlots() }
  const workspace = createDirectorWorkspaceState({ context })
  const plan = await resolveV2AgentExecutionPlan({
    intent: 'revise',
    callIdContext: { workspaceSessionId: 'workspace_tool_idem', turnRequestId: 'turn_tool_idem' },
    skillRequests: [{ skillId: 'subtitle-track-authoring', purpose: '修改字幕' }],
    toolRequests: [{
      ref: 'patch_without_draft',
      toolId: 'timeline.patch',
      skillId: 'subtitle-track-authoring',
      arguments: { scope: 'subtitle', instruction: '修改字幕' },
      requestedMode: 'preview',
      dependsOn: [],
    }],
  })
  const input = {
    stage: plan.stages[0]!,
    prompt: '修改字幕',
    userId: 1,
    context,
    runtime: {
      backendEnabled: true, sampleUrl: '', isSampleParsed: false,
      hasVisualMaterial: false, materialCount: 0,
    },
    workspace,
    traceSessionId: 'workspace_tool_idem',
  }
  const first = await dispatchV2AgentTool(input)
  const replay = await dispatchV2AgentTool(input)
  assert.equal(first.ok, false)
  assert.deepEqual(replay, JSON.parse(JSON.stringify(first)))

  const conflict = await dispatchV2AgentTool({ ...input, requestInstruction: '同 key 的不同修改' })
  assert.equal(conflict.gate, 'idempotency_conflict')
} finally {
  await rm(localDataDir, { recursive: true, force: true })
}

console.info('[smoke-v2-agent-tool-idempotency] OK')
