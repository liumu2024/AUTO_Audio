import assert from 'node:assert/strict'

process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DIRECTOR_AGENT_API_KEY = 'test-key'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'true'

const originalFetch = globalThis.fetch
const requestBodies: Array<Record<string, unknown>> = []

try {
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({
      id: 'resp_after_tool',
      output_text: JSON.stringify({
        assistantMessage: '已检查 1 个素材；它可以作为当前方案的主画面候选。',
        publicThoughts: ['已根据真实 Tool 结果回复。'],
      }),
    }), { status: 200 })
  }

  const { respondToDirectorToolResultsWithLlm } = await import(
    '../src/modules/director-agent/llm-intent-router.js'
  )
  const response = await respondToDirectorToolResultsWithLlm({
    prompt: '检查我刚上传的素材',
    previousResponseId: 'resp_before_tool',
    initialAssistantMessage: '我先检查素材。',
    workspaceFacts: { materialCount: 1 },
    selectedSkills: [{ id: 'v2-timeline-authoring', version: '1.0.0', hash: 'abc' }],
    toolResults: [{
      callId: 'inspect_001',
      toolId: 'material.inspect',
      ok: true,
      summary: '已检查 1 个 V2 候选素材。',
      output: { materials: [{ id: 'material_1', type: 'image', name: '产品图' }] },
    }],
  })

  assert.equal(response.assistantMessage, '已检查 1 个素材；它可以作为当前方案的主画面候选。')
  assert.equal(response.responseId, 'resp_after_tool')
  assert.equal(requestBodies[0]?.previous_response_id, 'resp_before_tool')
  const promptText = JSON.stringify(requestBodies[0]?.input)
  assert.match(promptText, /material\.inspect/)
  assert.match(promptText, /已检查 1 个 V2 候选素材/)

  globalThis.fetch = async () => {
    throw new Error('provider unavailable')
  }
  const fallback = await respondToDirectorToolResultsWithLlm({
    prompt: '检查素材',
    initialAssistantMessage: '我先检查。',
    workspaceFacts: {},
    selectedSkills: [],
    toolResults: [{
      callId: 'inspect_002',
      toolId: 'material.inspect',
      ok: false,
      summary: '素材读取失败。',
      recovery: '请重新上传后重试。',
    }],
  })
  assert.match(fallback.assistantMessage, /素材读取失败/)
  assert.match(fallback.assistantMessage, /请重新上传后重试/)
  assert.ok(fallback.fallbackReason)

  globalThis.fetch = async () => {
    throw new Error('previous_response_id is not supported')
  }
  const continuityFallback = await respondToDirectorToolResultsWithLlm({
    prompt: '继续检查',
    previousResponseId: 'resp_stale',
    initialAssistantMessage: '继续。',
    workspaceFacts: {},
    selectedSkills: [],
    toolResults: [{
      callId: 'inspect_003',
      toolId: 'material.inspect',
      ok: true,
      summary: '已检查素材。',
    }],
  })
  assert.equal(continuityFallback.responseContinuityRejected, true)
} finally {
  globalThis.fetch = originalFetch
}

console.log('V2 director Tool feedback smoke passed.')
