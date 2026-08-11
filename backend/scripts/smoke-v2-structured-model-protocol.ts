import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

process.env.VIDEO_UNDERSTANDING_API_KEY = 'test-key'
process.env.DIRECTOR_AGENT_API_KEY = 'test-key'
process.env.V2_TRACE_BASE_DIR = path.join('tmp', 'v2-traces', 'tests', `structured-protocol_${Date.now()}`)

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
          schema_version: 'v2_sample_understanding.v2', task_id: 'sample_protocol', summary: '修复后的样例理解',
          content_observations: [], method_observations: [], transferable_knowledge: [], shot_evidence: [],
          questions: [], warnings: [],
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
  const plannerMaterialJobProperties = (
    requestBodies[0]?.text as {
      format?: { schema?: { properties?: { material_jobs?: { items?: { properties?: Record<string, unknown> } } } } }
    } | undefined
  )?.format?.schema?.properties?.material_jobs?.items?.properties ?? {}
  assert.equal('input_asset_id' in plannerMaterialJobProperties, true)
  assert.equal('input_image_url' in plannerMaterialJobProperties, false)
  assert.equal('text' in requestBodies[1]!, false)
  assert.match(JSON.stringify(requestBodies[1]), /Repair only the JSON format/)
  assert.equal('reasoning' in (plannerResult.rawResponse as Record<string, unknown>), false)

  requestBodies.length = 0
  const legacyModelSpec = {
    ...validSpec,
    material_jobs: validSpec.material_jobs.map((job) => ({
      ...job,
      input_image_url: 'https://model-invented.example.com/source.png',
    })),
  }
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({
      id: 'planner_legacy_image_url',
      output_text: JSON.stringify(legacyModelSpec),
    }), { status: 200 })
  }
  await assert.rejects(
    runV2TimelineLlmPlanner({
      taskId: 'planner_legacy_image_url', creationMode: 'text_to_video',
      prompt: 'Generate a short video.', durationSec: 6,
    }),
    /input_image_url is reserved for historical persisted jobs/,
  )

  requestBodies.length = 0
  let unauthorizedAssetCalls = 0
  const unauthorizedAssetSpec = {
    ...validSpec,
    assets: [{
      id: 'model_invented_stock_asset',
      type: 'video' as const,
      src: 'https://model-invented.example.com/stock.mp4',
      source: 'stock_asset' as const,
    }],
    scenes: validSpec.scenes.map((scene, index) => index === 0
      ? { ...scene, type: 'user_video' as const, asset_id: 'model_invented_stock_asset' }
      : scene),
  }
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    unauthorizedAssetCalls += 1
    return new Response(JSON.stringify({
      id: `planner_asset_ownership_${unauthorizedAssetCalls}`,
      output_text: JSON.stringify(unauthorizedAssetCalls === 1 ? unauthorizedAssetSpec : validSpec),
    }), { status: 200 })
  }
  const repairedUnauthorizedAsset = await runV2TimelineLlmPlanner({
    taskId: 'planner_protocol', creationMode: 'text_to_video',
    prompt: '生成一版无素材科技介绍视频', durationSec: 6,
  })
  assert.equal(unauthorizedAssetCalls, 2)
  assert.ok(repairedUnauthorizedAsset.jsonRepair)
  assert.equal(repairedUnauthorizedAsset.spec.assets.some((asset) => asset.id === 'model_invented_stock_asset'), false)
  assert.match(JSON.stringify(requestBodies[1]), /Correct only the fields implicated by the validation error/)
  assert.doesNotMatch(JSON.stringify(requestBodies[1]), /Do not change its business meaning, timeline choices, assets, or captions/)

  requestBodies.length = 0
  const conditionedAssetId = 'mat_conditioned_reference'
  const conditionedJob = validSpec.material_jobs.find((job) => job.type === 'generate_video')
  assert.ok(conditionedJob)
  const conditionedSpec = structuredClone(validSpec)
  conditionedSpec.task_id = 'planner_conditioned_reference'
  conditionedSpec.assets.push({
    id: conditionedAssetId,
    type: 'image',
    src: 'https://cdn.example.com/conditioned-reference.png',
    source: 'user_asset',
  })
  conditionedSpec.creative_brief = {
    ...conditionedSpec.creative_brief!,
    image_references: [],
  }
  conditionedSpec.material_jobs = conditionedSpec.material_jobs.map((job) => job.id === conditionedJob.id
    ? { ...job, input_asset_id: conditionedAssetId }
    : job)
  conditionedSpec.scenes = conditionedSpec.scenes.map((scene) => scene.id === conditionedJob.scene_id
    ? { ...scene, creative_intent: { ...scene.creative_intent, description: 'Retain the visible source subject while adding motion.' } }
    : scene)
  const repairedConditionedSpec = structuredClone(conditionedSpec)
  repairedConditionedSpec.creative_brief!.image_references = [{
    asset_id: conditionedAssetId,
    observed_facts: ['A clearly visible subject occupies the source image.'],
    intended_use: 'Preserve that subject as the visual identity reference for this generated scene.',
  }]
  let conditionedCalls = 0
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    conditionedCalls += 1
    return new Response(JSON.stringify({
      id: `planner_conditioned_${conditionedCalls}`,
      output_text: JSON.stringify(conditionedCalls === 1 ? conditionedSpec : repairedConditionedSpec),
    }), { status: 200 })
  }
  const repairedConditioned = await runV2TimelineLlmPlanner({
    taskId: 'planner_conditioned_reference',
    creationMode: 'text_to_video',
    prompt: 'Animate the supplied subject consistently.',
    durationSec: 6,
    materials: [{
      id: conditionedAssetId,
      type: 'image',
      name: 'conditioned-reference.png',
      src: 'https://cdn.example.com/conditioned-reference.png',
    }],
  })
  assert.equal(conditionedCalls, 2)
  assert.equal(repairedConditioned.spec.creative_brief?.image_references[0]?.asset_id, conditionedAssetId)
  assert.ok(repairedConditioned.spec.creative_brief?.image_references[0]?.observed_facts.length)
  assert.match(JSON.stringify(requestBodies[1]), new RegExp(`Server-owned asset catalog.*${conditionedAssetId}`))

  requestBodies.length = 0
  const installPlannerProtocolFailure = () => {
    let calls = 0
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1
      if (calls > 2) throw new Error('deterministic fallback must not require another model call')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestBodies.push(body)
      return new Response(JSON.stringify({ id: 'planner_invalid', output_text: '{"schema_version":' }), { status: 200 })
    }
    return () => calls
  }
  const textFallbackCalls = installPlannerProtocolFailure()
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
  assert.equal(textFallbackCalls(), 2, 'initial fallback stops after the planner and its one repair attempt')
  assert.equal(existsSync(path.join(
    fallbackPreview.traceDir, '02-planning', 'timeline-fallback-outcome-review.json',
  )), false)

  installPlannerProtocolFailure()
  const materialGap = await previewV2RemotionTimeline({
      taskId: 'planner_material_protocol_second_failure',
      creationMode: 'material_brief',
      plannerMode: 'llm',
      allowPlannerFallback: true,
      prompt: 'Create a video that adds plausible motion and new elements based on this landscape image.',
      durationSec: 6,
      materials: [{
        id: 'landscape', type: 'image', name: 'landscape.png', src: 'https://cdn.example.com/landscape.png',
      }],
    })
  assert.equal(materialGap.plannerSource, 'llm_planning_gap')
  assert.equal(materialGap.spec.creative_brief?.planning_gaps?.[0]?.area, 'image_understanding')
  assert.equal(materialGap.spec.material_jobs.length, 0)

  installPlannerProtocolFailure()
  const mislabeledGap = await previewV2RemotionTimeline({
      taskId: 'planner_mislabeled_material_protocol_failure',
      creationMode: 'text_to_video',
      plannerMode: 'llm',
      allowPlannerFallback: true,
      prompt: 'Animate the supplied landscape image.',
      durationSec: 6,
      materials: [{
        id: 'mislabeled_landscape', type: 'image', name: 'landscape.png', src: 'https://cdn.example.com/landscape.png',
      }],
    })
  assert.equal(mislabeledGap.plannerSource, 'llm_planning_gap')
  assert.equal(mislabeledGap.spec.assets[0]?.id, 'mislabeled_landscape')

  installPlannerProtocolFailure()
  const sampleGap = await previewV2RemotionTimeline({
      taskId: 'planner_unparsed_sample_protocol_second_failure',
      creationMode: 'sample_replicate',
      plannerMode: 'llm',
      allowPlannerFallback: true,
      prompt: 'Create a new video using the uploaded sample structure.',
      durationSec: 6,
      referenceVideoPath: 'https://cdn.example.com/sample.mp4',
    })
  assert.equal(sampleGap.plannerSource, 'llm_planning_gap')
  assert.equal(sampleGap.spec.creative_brief?.planning_gaps?.[0]?.area, 'sample_transfer')

  installPlannerProtocolFailure()
  const understoodSampleFallback = await previewV2RemotionTimeline({
    taskId: 'planner_understood_sample_protocol_failure',
    plannerMode: 'llm',
    allowPlannerFallback: true,
    prompt: 'Create a new video using the analyzed sample structure.',
    durationSec: 6,
    referenceVideoPath: 'https://cdn.example.com/sample.mp4',
    sampleUnderstanding: sampleResult.understanding,
  })
  assert.equal(
    understoodSampleFallback.plannerSource,
    'llm_fallback_deterministic',
    'persisted sample understanding is sufficient for grounded deterministic fallback even without a mode label',
  )

  installPlannerProtocolFailure()
  await assert.rejects(
    previewV2RemotionTimeline({
      taskId: 'planner_revision_protocol_second_failure',
      creationMode: 'text_to_video',
      plannerMode: 'llm',
      allowPlannerFallback: true,
      prompt: '只调整当前字幕，不改变其他镜头。',
      durationSec: 6,
      revisionBaseSpec: validSpec,
      revisionScope: 'subtitle',
    }),
    /did not return|invalid/i,
    'a failed revision protocol must retain the saved base instead of replacing it with an initial-plan fallback',
  )

  const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
  const { parseDirectorModelDecision, routeDirectorIntentWithLlm } = await import('../src/modules/director-agent/llm-intent-router.js')
  const protocolBase = {
    replyDraft: '收到。', intent: 'chat', creativeConfigDelta: {}, stateActions: [],
    skillRequests: [], toolRequests: [], missingInformation: [],
  }
  assert.equal(parseDirectorModelDecision(JSON.stringify(protocolBase)).stateActions.length, 0)
  assert.deepEqual(parseDirectorModelDecision(JSON.stringify(protocolBase)).memoryActions, [])
  assert.equal(parseDirectorModelDecision(JSON.stringify({
    ...protocolBase,
    memoryActions: [{
      ref: 'remember_tone', operation: 'add', scopeType: 'user',
      statement: '品牌表达保持可靠但不冰冷', status: 'active', origin: 'explicit',
      sourceTurnIds: ['turn_current'], sourceExcerpt: '以后品牌表达都保持可靠但不冰冷。',
    }],
  })).memoryActions[0]?.operation, 'add')
  assert.throws(() => parseDirectorModelDecision(JSON.stringify({
    ...protocolBase,
    memoryActions: [{
      ref: 'invalid_memory', operation: 'add', scopeType: 'user',
      statement: '无来源的偏好', status: 'active', origin: 'inferred', sourceTurnIds: [],
    }],
  })))
  assert.equal(parseDirectorModelDecision(JSON.stringify({
    ...protocolBase,
    stateActions: [{
      ref: 'requirements', kind: 'requirements.update',
      operations: [{ operation: 'add', statement: '目标受众为独居青年' }],
    }],
  })).stateActions[0]?.kind, 'requirements.update')
  assert.throws(() => parseDirectorModelDecision(JSON.stringify({
    ...protocolBase, stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [] }],
  })))
  assert.throws(() => parseDirectorModelDecision(JSON.stringify({
    ...protocolBase, unexpected: true,
  })))
  assert.throws(() => parseDirectorModelDecision(JSON.stringify({
    ...protocolBase,
    toolRequests: [{
      ref: 'forbidden_chat_tool', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring',
      arguments: {}, requestedMode: 'preview', dependsOn: [],
    }],
  })))
  assert.throws(() => parseDirectorModelDecision(JSON.stringify({
    ...protocolBase,
    stateActions: [{
      ref: 'requirements', kind: 'requirements.update',
      operations: Array.from({ length: 21 }, (_, index) => ({ operation: 'add', statement: `要求 ${index}` })),
    }],
  })))
  assert.throws(() => parseDirectorModelDecision(JSON.stringify({
    ...protocolBase,
    stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'revoke', targetId: 'req_1' }] }],
  })))
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
            replyDraft: '这是修复后的自然回复。', intent: 'chat', creativeConfigDelta: {},
            stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
          }),
    }), { status: 200 })
  }
  const repairedDirector = await routeDirectorIntentWithLlm({
    prompt: '先讨论字幕策略', context: directorContext, runtime: directorRuntime,
  })
  assert.equal(repairedDirector.source, 'llm')
  assert.ok(repairedDirector.jsonRepair?.responseAudit)

  requestBodies.length = 0
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({
      id: 'director_image_chat',
      output_text: JSON.stringify({
        replyDraft: 'The image contains a white cup on a wooden table.', intent: 'chat', creativeConfigDelta: {},
        stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
      }),
    }), { status: 200 })
  }
  const imageChat = await routeDirectorIntentWithLlm({
    prompt: 'Describe the attached image.',
    currentTurnMaterialIds: ['material_image'],
    context: {
      ...directorContext,
      materials: [
        { id: 'historical_image', type: 'image' as const, name: 'old.png', url: 'https://cdn.example.com/old.png' },
        { id: 'material_image', type: 'image' as const, name: '8.png', url: 'https://cdn.example.com/8.png' },
      ],
    },
    runtime: { ...directorRuntime, hasVisualMaterial: true, materialCount: 1 },
  })
  assert.equal(imageChat.result.assistantMessage, 'The image contains a white cup on a wooden table.')
  assert.equal(imageChat.result.intent, 'chat', 'read-only visual conversation must not be reported as unknown')
  const directorContent = ((requestBodies[0]?.input as Array<{ content?: Array<Record<string, unknown>> }> | undefined)?.[0]?.content ?? [])
  assert.deepEqual(
    directorContent.filter((item) => item.type === 'input_image'),
    [{ type: 'input_image', image_url: 'https://cdn.example.com/8.png' }],
    'Director chat must receive the selected image pixels, not only material metadata',
  )

  requestBodies.length = 0
  const localImageName = `director-image-chat-${Date.now()}.png`
  const localImagePath = path.join(process.cwd(), 'uploads', localImageName)
  mkdirSync(path.dirname(localImagePath), { recursive: true })
  writeFileSync(localImagePath, new Uint8Array([137, 80, 78, 71]))
  try {
    let plannerLocalCalls = 0
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.endsWith('/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'director_local_image' }), { status: 200 })
      }
      if (target.endsWith('/files/director_local_image') && !init?.method) {
        return new Response(JSON.stringify({ status: 'active' }), { status: 200 })
      }
      if (target.endsWith('/files/director_local_image') && init?.method === 'DELETE') {
        return new Response('{}', { status: 200 })
      }
      if (target.includes('/responses')) {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({
          id: 'director_local_image_chat',
          output_text: JSON.stringify({
            replyDraft: 'Local image inspected.', intent: 'chat', creativeConfigDelta: {},
            stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
          }),
        }), { status: 200 })
      }
      throw new Error(`Unexpected mocked request: ${target}`)
    }
    await routeDirectorIntentWithLlm({
      prompt: 'Describe the local uploaded image.',
      currentTurnMaterialIds: ['material_local_image'],
      context: {
        ...directorContext,
        materials: [{
          id: 'material_local_image', type: 'image' as const, name: localImageName,
          url: `http://localhost:3001/uploads/${localImageName}`,
        }],
      },
      runtime: { ...directorRuntime, hasVisualMaterial: true, materialCount: 1 },
    })
    const localDirectorContent = ((requestBodies[0]?.input as Array<{ content?: Array<Record<string, unknown>> }> | undefined)?.[0]?.content ?? [])
    assert.deepEqual(
      localDirectorContent.filter((item) => item.type === 'input_image'),
      [{ type: 'input_image', file_id: 'director_local_image' }],
      'a backend upload URL must be resolved and attached through Ark Files',
    )

    requestBodies.length = 0
    const plannerImageBase = buildDeterministicRemotionTimelineSpec({
      taskId: 'planner_local_image',
      creationMode: 'material_brief',
      prompt: 'Use all supplied image materials to create a short landscape video.',
      durationSec: 6,
      materials: [{
        id: 'planner_local_image', type: 'image' as const, name: localImageName,
        src: `http://localhost:3001/uploads/${localImageName}`,
      }],
    })
    const sourceAssetId = plannerImageBase.assets[0]!.id
    const plannerImageSpec = {
      ...plannerImageBase,
      creative_brief: {
        ...plannerImageBase.creative_brief!,
        image_references: plannerImageBase.creative_brief!.image_references.map((reference) => ({
          ...reference,
          observed_facts: ['A landscape is visibly present in the supplied image.'],
        })),
      },
      assets: plannerImageBase.assets.map((asset) => ({
        ...asset,
        src: 'C:\\server-private\\model-invented.png',
      })),
      scenes: plannerImageBase.scenes.map((scene, index) => ({
        ...scene,
        type: 'ai_video' as const,
        asset_id: `generated_scene_${index + 1}`,
      })),
      material_jobs: plannerImageBase.scenes.map((scene, index) => ({
        id: `generate_scene_${index + 1}`,
        scene_id: scene.id,
        type: 'generate_video' as const,
        status: 'planned' as const,
        prompt: `Keep the supplied landscape and add a plausible moving subject for shot ${index + 1}.`,
        input_asset_id: sourceAssetId,
        output_asset_id: `generated_scene_${index + 1}`,
        fallback_asset_id: sourceAssetId,
        fallback_kind: 'static_image' as const,
        provider: 'ark_seedance' as const,
      })),
    }
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.endsWith('/files') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'planner_local_image_file' }), { status: 200 })
      }
      if (target.endsWith('/files/planner_local_image_file') && !init?.method) {
        return new Response(JSON.stringify({ status: 'active' }), { status: 200 })
      }
      if (target.endsWith('/files/planner_local_image_file') && init?.method === 'DELETE') {
        return new Response('{}', { status: 200 })
      }
      if (target.includes('/responses')) {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        plannerLocalCalls += 1
        return new Response(JSON.stringify({
          id: 'planner_local_image_response',
          output_text: plannerLocalCalls === 1 ? '{"schema_version":' : JSON.stringify(plannerImageSpec),
        }), { status: 200 })
      }
      throw new Error(`Unexpected mocked request: ${target}`)
    }
    const plannerWithLocalImage = await runV2TimelineLlmPlanner({
      taskId: 'planner_local_image',
      creationMode: 'material_brief',
      prompt: 'Use all supplied image materials to create a short landscape video.',
      durationSec: 6,
      materials: [{
        id: 'planner_local_image', type: 'image' as const, name: localImageName,
        src: `http://localhost:3001/uploads/${localImageName}`,
      }],
    })
    const plannerImageContent = ((requestBodies[0]?.input as Array<{ content?: Array<Record<string, unknown>> }> | undefined)?.[0]?.content ?? [])
    assert.deepEqual(
      plannerImageContent.filter((item) => item.type === 'input_image'),
      [{ type: 'input_image', file_id: 'planner_local_image_file' }],
      'Planner must use the same local-upload image adapter as Director',
    )
    const plannerRepairImageContent = ((requestBodies[1]?.input as Array<{ content?: Array<Record<string, unknown>> }> | undefined)?.[0]?.content ?? [])
    assert.deepEqual(
      plannerRepairImageContent.filter((item) => item.type === 'input_image'),
      [{ type: 'input_image', file_id: 'planner_local_image_file' }],
      'Planner protocol repair must retain the same authoritative image evidence.',
    )
    assert.deepEqual(plannerWithLocalImage.visualInputReport.attached_material_ids, ['planner_local_image'])
    assert.equal(
      plannerWithLocalImage.spec.assets.find((asset) => asset.id === sourceAssetId)?.src,
      `http://localhost:3001/uploads/${localImageName}`,
      'model-authored user asset paths must be rebound from server-owned material facts',
    )

    const { resolveUploadedAssetPath } = await import('../src/modules/upload/upload.service.js')
    assert.equal(
      await resolveUploadedAssetPath(`http://127.0.0.2:3001/uploads/${localImageName}`),
      undefined,
      'an unrelated origin must not resolve to a same-named local upload',
    )

    requestBodies.length = 0
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.endsWith('/files') && init?.method === 'POST') {
        return new Response('upload unavailable', { status: 503 })
      }
      if (target.includes('/responses')) {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({
          id: 'director_image_degraded_to_text',
          output_text: JSON.stringify({
            replyDraft: 'I could not inspect the attachment, but can still answer text questions.',
            intent: 'chat', creativeConfigDelta: {}, stateActions: [], skillRequests: [],
            toolRequests: [], missingInformation: [],
          }),
        }), { status: 200 })
      }
      throw new Error(`Unexpected mocked request: ${target}`)
    }
    const degradedImageChat = await routeDirectorIntentWithLlm({
      prompt: 'Continue the conversation even if this image is temporarily unavailable.',
      currentTurnMaterialIds: ['material_local_image'],
      context: {
        ...directorContext,
        materials: [{
          id: 'material_local_image', type: 'image' as const, name: localImageName,
          url: `http://localhost:3001/uploads/${localImageName}`,
        }],
      },
      runtime: { ...directorRuntime, hasVisualMaterial: true, materialCount: 1 },
    })
    assert.equal(degradedImageChat.source, 'llm', 'one failed image must not suppress the text model call')
    assert.equal(degradedImageChat.modelCalled, true)
    assert.equal(degradedImageChat.imageInputWarnings?.length, 1)
    const degradedContent = ((requestBodies[0]?.input as Array<{ content?: Array<Record<string, unknown>> }> | undefined)?.[0]?.content ?? [])
    assert.equal(degradedContent.some((item) => item.type === 'input_image'), false)

    let arbitraryLocalUploadAttempted = false
    globalThis.fetch = async (url, init) => {
      const target = String(url)
      if (target.endsWith('/files') && init?.method === 'POST') arbitraryLocalUploadAttempted = true
      if (target.includes('/responses')) {
        return new Response(JSON.stringify({
          id: 'director_arbitrary_local_path_rejected',
          output_text: JSON.stringify({
            replyDraft: 'The attachment is unavailable.', intent: 'chat', creativeConfigDelta: {},
            stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
          }),
        }), { status: 200 })
      }
      throw new Error(`Unexpected mocked request: ${target}`)
    }
    const arbitraryLocalPath = await routeDirectorIntentWithLlm({
      prompt: 'Inspect this image.',
      currentTurnMaterialIds: ['untrusted_local_path'],
      context: {
        ...directorContext,
        materials: [{
          id: 'untrusted_local_path', type: 'image' as const, name: 'private.png',
          url: 'C:\\server-private\\private.png',
        }],
      },
      runtime: { ...directorRuntime, hasVisualMaterial: true, materialCount: 1 },
    })
    assert.equal(arbitraryLocalUploadAttempted, false)
    assert.equal(arbitraryLocalPath.imageInputWarnings?.length, 1)
  } finally {
    rmSync(localImagePath, { force: true })
  }

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
