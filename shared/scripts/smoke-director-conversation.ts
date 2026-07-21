import {
  createDefaultDirectorSlots,
  routeDirectorConversation,
} from '../lib/director-understanding.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const baseRuntime = {
  backendEnabled: true,
  sampleUrl: 'https://example.com/sample.mp4',
  sampleName: '3.mp4',
  isSampleParsed: false,
  hasPipeline: false,
  activeTaskId: null,
  hasVisualMaterial: false,
  materialCount: 0,
}

const parsedRuntime = {
  ...baseRuntime,
  isSampleParsed: true,
  hasPipeline: true,
  activeTaskId: 'task_ana_1',
}

let passed = 0

function case1() {
  const result = routeDirectorConversation({
    prompt: '解析样例视频，识别导演结构和可复用风格',
    slots: createDefaultDirectorSlots({ sampleVideoStatus: 'attached' }),
    runtime: baseRuntime,
  })
  assert(result.nextAction === 'ANALYZE_SAMPLE', `case1 action=${result.nextAction}`)
  passed += 1
}

function case2() {
  const result = routeDirectorConversation({
    prompt: '生成成片',
    slots: createDefaultDirectorSlots({
      sampleVideoStatus: 'parsed',
      materialStatus: 'missing',
    }),
    runtime: parsedRuntime,
  })
  assert(result.nextAction === 'ASK_USER', `case2 action=${result.nextAction}`)
  assert(
    result.missingSlots.includes('materialStatus'),
    `case2 missing=${result.missingSlots.join(',')}`,
  )
  passed += 1
}

function case3() {
  const result = routeDirectorConversation({
    prompt: '不要字幕，9:16，按样例风格生成',
    slots: createDefaultDirectorSlots({ sampleVideoStatus: 'parsed' }),
    runtime: parsedRuntime,
  })
  assert(result.slotsPatch.aspectRatio === '9:16', 'case3 aspectRatio')
  assert(result.slotsPatch.subtitlePolicy === 'none', 'case3 subtitlePolicy')
  assert(result.slotsPatch.generationMode === 'style_replicate', 'case3 generationMode')
  assert(result.nextAction === 'ASK_USER', `case3 action=${result.nextAction}`)
  passed += 1
}

function case4() {
  const result = routeDirectorConversation({
    prompt: '解析样例',
    slots: createDefaultDirectorSlots({ sampleVideoStatus: 'parsed' }),
    runtime: parsedRuntime,
  })
  assert(result.nextAction !== 'GENERATE_VIDEO', `case4 should not auto-generate: ${result.nextAction}`)
  assert(result.nextAction !== 'RENDER', 'case4 should not render')
  passed += 1
}

case1()
case2()
case3()
case4()

console.log(`smoke-director-conversation: ${passed}/4 passed`)
