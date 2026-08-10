import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { normalizeCustomTransitionProgress } from '../../shared/types/remotion-custom-component.js'

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'v2-component-authoring-'))
process.env.RENDER_COMPONENTS_DIR = path.join(dataDir, 'components')
process.env.DIRECTOR_AGENT_API_KEY = 'component-authoring-smoke-key'
process.env.DIRECTOR_AGENT_RESPONSES_URL = 'https://component-authoring.test/responses'
process.env.DIRECTOR_AGENT_FILES_URL = 'https://component-authoring.test/files'

try {
  assert.deepEqual(
    [0, 0.2, 0.4, 0.6, 0.8].map((progress) => Number(normalizeCustomTransitionProgress(progress, 5).toFixed(6))),
    [0, 0.25, 0.5, 0.75, 1],
    'the custom transition contract must expose exact 0..1 endpoints across rendered frames',
  )
  const {
    authorRenderComponent,
    buildRenderComponentCodingPrompt,
    ensureRenderComponentVisualEvidence,
    renderComponentPreviewSampleFrames,
    V2_TRANSITION_VISUAL_INTEGRITY_CRITERIA,
  } = await import('../src/modules/render-components/component-authoring-agent.js')
  const {
    listRenderComponents,
    promoteRenderComponent,
    readRenderComponent,
    registerRenderComponent,
    renderComponentEvidenceForCanvas,
    validateRenderComponentReferences,
  } = await import(
    '../src/modules/render-components/component-registry.js'
  )
  assert.deepEqual(renderComponentPreviewSampleFrames('transition'), [6, 7, 8, 9, 10])

  const knowledgePrompt = buildRenderComponentCodingPrompt({
    purpose: 'transition',
    displayName: '中心分裂',
    effectBrief: '画面从中心分裂，露出下一镜头',
    acceptanceCriteria: ['entering 从闭合到展开', 'exiting 从展开到闭合'],
    canvas: { width: 360, height: 640, fps: 12, durationSec: 1 },
    skillContent: '# V2 Render Delivery\n完整 Skill 内容',
  })
  const reactVersion = JSON.parse(await readFile(path.resolve('../remotion/node_modules/react/package.json'), 'utf8')).version
  const remotionVersion = JSON.parse(await readFile(path.resolve('../remotion/node_modules/remotion/package.json'), 'utf8')).version
  for (const required of [
    '完整 Skill 内容',
    'children',
    'progress',
    'direction',
    'params',
    'scene',
    'assets',
    '360',
    '640',
    '12',
    `React ${reactVersion}`,
    `Remotion ${remotionVersion}`,
    '@remotion/transitions',
    '@remotion/media',
    'Math.random',
    'network URL literals',
    'CSS animation/transition',
    'fractions of durationInFrames',
    'distinct and in-frame',
    'stagger animation state, not element existence',
    'do not hard-code Canvas numbers',
    'entering 从闭合到展开',
    'exiting 从展开到闭合',
    'Scene example',
    'Transition example',
    'Registered display name: 中心分裂',
  ]) {
    assert.match(knowledgePrompt, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  let codingCalls = 0
  const glowSource = `
    import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
    export default function Glow() {
      const frame = useCurrentFrame()
      const { durationInFrames } = useVideoConfig()
      const scale = interpolate(frame, [0, durationInFrames - 1], [0.2, 2])
      return <AbsoluteFill style={{background:'#071a3d',alignItems:'center',justifyContent:'center'}}>
        <div style={{width:120,height:120,borderRadius:'50%',border:'10px solid #60a5fa',transform:\`scale(\${scale})\`}} />
      </AbsoluteFill>
    }
  `
  const authored = await authorRenderComponent({
    purpose: 'scene',
    displayName: '蓝色光圈',
    effectBrief: '蓝色光圈从中心扩散',
    acceptanceCriteria: ['中心光圈随时间扩大', '背景保持深蓝色'],
    canvas: { width: 360, height: 640, fps: 12, durationSec: 1 },
    skillContent: '# V2 Render Delivery\n完整 Skill 内容',
    sourceWorkspaceSessionId: 'authoring_smoke',
  }, {
    generateCode: async ({ prompt, repairFeedback }) => {
      codingCalls += 1
      if (!repairFeedback) {
        return {
          source: `export default function Bad() { fetch('https://example.com') }`,
          effectSummary: '错误版本',
        }
      }
      assert.match(repairFeedback, /audit|审计|fetch/i)
      assert.match(prompt, /export default function Bad/)
      assert.match(prompt, /Previous source to repair/)
      return {
        source: glowSource,
        effectSummary: '蓝色光圈从中心扩散',
      }
    },
    renderPreview: async ({ componentId }) => ({
      videoPath: path.join(dataDir, `${componentId}.mp4`),
      framePaths: [0, 1, 2, 3, 4].map((index) => path.join(dataDir, `${componentId}-${index}.png`)),
    }),
    reviewPreview: async ({ acceptanceCriteria, prompt }) => {
      assert.match(prompt, /small but non-zero/i)
      return {
        passed: true,
        criteria: acceptanceCriteria.map((criterion) => ({ criterion, passed: true, evidence: '测试帧可见' })),
        summary: '满足全部条件',
        additionalProperties: false,
      }
    },
    cleanupPreview: async () => undefined,
  })

  assert.equal(authored.ok, true)
  assert.equal(codingCalls, 2)
  assert.equal(authored.ok ? authored.repaired : undefined, true)
  const persisted = authored.ok ? await readRenderComponent(authored.componentId) : null
  assert.equal(persisted?.manifest.status, 'promoted')
  assert.equal(persisted?.manifest.displayName, '蓝色光圈')
  assert.equal(persisted?.manifest.effectBrief, '蓝色光圈从中心扩散')
  assert.deepEqual(persisted?.manifest.acceptanceCriteria, ['中心光圈随时间扩大', '背景保持深蓝色'])
  const persistedEvidence = renderComponentEvidenceForCanvas(
    persisted?.manifest.previewEvidenceByAspect,
    { width: 360, height: 640 },
  )
  assert.equal(persistedEvidence?.verdict, 'passed')
  assert.equal(persistedEvidence?.policyVersion, 'render_component_visual.v2')
  assert.deepEqual(persistedEvidence?.canvas, { width: 360, height: 640 })

  await registerRenderComponent({
    id: 'cmp_legacy_revalidation',
    source: `${glowSource}\n// legacy revalidation fixture`,
    displayName: 'legacy glow',
    effectSummary: 'legacy glow',
    effectBrief: 'a blue ring expands from the center',
    acceptanceCriteria: ['the ring expands from the center'],
    purpose: 'scene',
  })
  await promoteRenderComponent({
    id: 'cmp_legacy_revalidation',
    previewEvidence: {
      verdict: 'passed', frameCount: 5, summary: 'legacy evidence',
      criteria: [{ criterion: 'the ring expands from the center', passed: true, evidence: 'legacy preview' }],
      reviewedAt: new Date().toISOString(),
    },
  })
  let legacyPreviewCalls = 0
  await ensureRenderComponentVisualEvidence({
    componentId: 'cmp_legacy_revalidation',
    canvas: { width: 720, height: 1280, fps: 24, durationSec: 2 },
  }, {
    renderPreview: async ({ componentId }) => {
      legacyPreviewCalls += 1
      return {
        videoPath: path.join(dataDir, `${componentId}-revalidated.mp4`),
        framePaths: [0, 1, 2, 3, 4].map((index) => path.join(dataDir, `${componentId}-revalidated-${index}.png`)),
      }
    },
    reviewPreview: async ({ acceptanceCriteria }) => ({
      passed: true,
      criteria: acceptanceCriteria.map((criterion) => ({ criterion, passed: true, evidence: 'current canvas preview passed' })),
      summary: 'current canvas preview passed',
    }),
    cleanupPreview: async () => undefined,
  })
  assert.equal(legacyPreviewCalls, 1)
  assert.deepEqual(
    renderComponentEvidenceForCanvas(
      (await readRenderComponent('cmp_legacy_revalidation'))?.manifest.previewEvidenceByAspect,
      { width: 720, height: 1280 },
    )?.canvas,
    { width: 720, height: 1280 },
  )
  assert.deepEqual(
    await validateRenderComponentReferences(
      [{ id: 'cmp_legacy_revalidation', purpose: 'scene' }],
      new Set(),
      { width: 720, height: 1280 },
    ),
    [],
    'legacy evidence is upgraded through the same visual acceptance path before reuse',
  )

  let landscapeReviewCalls = 0
  const reusedAtNewAspect = await authorRenderComponent({
    purpose: 'scene',
    displayName: persisted!.manifest.displayName,
    effectBrief: persisted!.manifest.effectBrief,
    acceptanceCriteria: persisted!.manifest.acceptanceCriteria,
    canvas: { width: 640, height: 360, fps: 12, durationSec: 1 },
    skillContent: '# V2 Render Delivery',
  }, {
    generateCode: async () => ({ source: glowSource, effectSummary: persisted!.manifest.effectSummary }),
    renderPreview: async ({ componentId }) => ({
      videoPath: path.join(dataDir, `${componentId}-landscape.mp4`),
      framePaths: [0, 1, 2, 3, 4].map((index) => path.join(dataDir, `${componentId}-landscape-${index}.png`)),
    }),
    reviewPreview: async ({ acceptanceCriteria }) => {
      landscapeReviewCalls += 1
      return {
        passed: true,
        criteria: acceptanceCriteria.map((criterion) => ({ criterion, passed: true, evidence: 'landscape preview passed' })),
        summary: 'landscape preview passed',
      }
    },
    cleanupPreview: async () => undefined,
  })
  assert.equal(reusedAtNewAspect.ok, true)
  assert.equal(landscapeReviewCalls, 1, 'a promoted source must be revalidated for a different aspect ratio')

  let newCriteriaReviewed = false
  const reusedWithNewCriteria = await authorRenderComponent({
    purpose: 'scene',
    displayName: '蓝色透明光圈',
    effectBrief: '蓝色光圈同时保持中央透明',
    acceptanceCriteria: ['光圈中央始终透明'],
    canvas: { width: 360, height: 640, fps: 12, durationSec: 1 },
    skillContent: '# V2 Render Delivery\n完整 Skill 内容',
  }, {
    generateCode: async () => ({ source: glowSource, effectSummary: '蓝色光圈从中心扩散' }),
    renderPreview: async ({ componentId }) => ({
      videoPath: path.join(dataDir, `${componentId}-reuse.mp4`),
      framePaths: [0, 1, 2, 3, 4].map((index) => path.join(dataDir, `${componentId}-reuse-${index}.png`)),
    }),
    reviewPreview: async ({ acceptanceCriteria }) => {
      newCriteriaReviewed = true
      return {
        passed: true,
        criteria: acceptanceCriteria.map((criterion) => ({ criterion, passed: true, evidence: '重新检查新条件' })),
        summary: '新条件已重新验收',
      }
    },
    cleanupPreview: async () => undefined,
  })
  assert.equal(reusedWithNewCriteria.ok ? reusedWithNewCriteria.componentId : undefined, authored.ok ? authored.componentId : undefined)
  assert.equal(reusedWithNewCriteria.ok ? reusedWithNewCriteria.reused : false, true)
  assert.equal(reusedWithNewCriteria.ok ? reusedWithNewCriteria.displayName : undefined, '蓝色透明光圈')
  assert.equal(
    authored.ok ? (await readRenderComponent(authored.componentId))?.manifest.displayName : undefined,
    '蓝色透明光圈',
  )
  assert.equal(newCriteriaReviewed, true, 'source hash reuse must not skip new acceptance criteria')

  let visualRepairCalls = 0
  let visualRepairPromptContainsChecklist = false
  let transitionIntegrityChecked = false
  const rejected = await authorRenderComponent({
    purpose: 'transition',
    displayName: '无变化转场',
    effectBrief: '实际没有发生变化的转场',
    acceptanceCriteria: ['中间帧必须出现明显变化'],
    canvas: { width: 360, height: 640, fps: 12, durationSec: 1 },
    skillContent: '# V2 Render Delivery\n完整 Skill 内容',
  }, {
    generateCode: async ({ prompt, repairFeedback }) => {
      visualRepairCalls += 1
      if (repairFeedback) {
        assert.match(repairFeedback, /criteria=/)
        assert.match(prompt, /function Noop/)
        visualRepairPromptContainsChecklist = /every failed acceptance criterion/i.test(prompt)
      }
      return {
        source: `export default function Noop({children}) { return children }`,
        effectSummary: '无变化',
      }
    },
    renderPreview: async ({ componentId }) => ({
      videoPath: path.join(dataDir, `${componentId}.mp4`),
      framePaths: [0, 1, 2, 3, 4].map((index) => path.join(dataDir, `${componentId}-${index}.png`)),
    }),
    reviewPreview: async ({ acceptanceCriteria, prompt }) => {
      assert.match(prompt, /boundary need not remain visible/i)
      assert.match(prompt, /asymmetric/i)
      assert.ok(
        acceptanceCriteria.some((criterion) => /complete, undistorted source A/i.test(criterion)),
        'transition review must always check the complete A endpoint',
      )
      assert.ok(
        acceptanceCriteria.some((criterion) => /complete, undistorted destination B/i.test(criterion)),
        'transition review must always check the complete B endpoint',
      )
      assert.ok(
        acceptanceCriteria.some((criterion) => /without repeated, stretched, or offset slices/i.test(criterion)),
        'transition review must reject spatially duplicated strips',
      )
      transitionIntegrityChecked = true
      return {
        passed: false,
        criteria: acceptanceCriteria.map((criterion) => ({ criterion, passed: false, evidence: '五帧无变化' })),
        summary: '不满足验收条件',
      }
    },
    cleanupPreview: async () => undefined,
  })
  assert.equal(rejected.ok, false)
  assert.equal(visualRepairCalls, 2)
  assert.equal(visualRepairPromptContainsChecklist, true)
  assert.equal(transitionIntegrityChecked, true)
  assert.match(rejected.ok ? '' : rejected.failedSource ?? '', /function Noop/)
  assert.equal((await listRenderComponents()).filter((item) => item.status === 'draft').length, 0)

  let protocolCodingCalls = 0
  const visualProtocolFailure = await authorRenderComponent({
    purpose: 'transition',
    displayName: '协议隔离转场',
    effectBrief: '视觉判定协议失败不应重写源码',
    acceptanceCriteria: ['输入画面保持可见'],
    canvas: { width: 360, height: 640, fps: 12, durationSec: 1 },
    skillContent: '# V2 Render Delivery\n完整 Skill 内容',
  }, {
    generateCode: async () => {
      protocolCodingCalls += 1
      return {
        source: `export default function Protocol({children}) { return children }`,
        effectSummary: '协议隔离测试',
      }
    },
    renderPreview: async ({ componentId }) => ({
      videoPath: path.join(dataDir, `${componentId}-protocol.mp4`),
      framePaths: [0, 1, 2, 3, 4].map((index) => path.join(dataDir, `${componentId}-protocol-${index}.png`)),
    }),
    reviewPreview: async () => { throw new Error('visual judge protocol failure') },
    cleanupPreview: async () => undefined,
  })
  assert.equal(visualProtocolFailure.ok, false)
  assert.equal(protocolCodingCalls, 1, 'visual judge protocol errors must not consume a source repair')
  assert.equal(visualProtocolFailure.ok ? '' : visualProtocolFailure.stage, 'visual_review')
  assert.match(visualProtocolFailure.ok ? '' : visualProtocolFailure.failedSource ?? '', /function Protocol/)

  const realCriteria = ['遮罩边界在五帧中从左向右移动', '转场期间始终能看到输入画面']
  const originalFetch = globalThis.fetch
  let uploadedFiles = 0
  let reviewedImageInputs = 0
  globalThis.fetch = async (resource, init) => {
    const url = String(resource)
    if (url.endsWith('/responses')) {
      const body = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ type: string }> }> }
      reviewedImageInputs = body.input[0]?.content.filter((item) => item.type === 'input_image').length ?? 0
      return new Response(JSON.stringify({
        output: [{ content: [{ text: JSON.stringify({
          passed: true,
          criteria: [...realCriteria, ...V2_TRANSITION_VISUAL_INTEGRITY_CRITERIA]
            .map((criterion) => ({ criterion, passed: true, evidence: '五个真实渲染采样帧可见' })),
          summary: '满足全部验收条件',
        }) }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (init?.method === 'POST') {
      uploadedFiles += 1
      return new Response(JSON.stringify({ id: `file_${uploadedFiles}` }), { status: 200 })
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return new Response(JSON.stringify({ status: 'processed' }), { status: 200 })
  }
  let realPreview: Awaited<ReturnType<typeof authorRenderComponent>>
  try {
    realPreview = await authorRenderComponent({
      purpose: 'transition',
      displayName: '蓝色遮罩揭示',
      effectBrief: '蓝色遮罩从左向右揭开下一画面',
      acceptanceCriteria: realCriteria,
      canvas: { width: 360, height: 640, fps: 12, durationSec: 1 },
      skillContent: '# V2 Render Delivery\n完整 Skill 内容',
    }, {
      generateCode: async () => ({
        source: `
          import { AbsoluteFill } from 'remotion'
          export default function Wipe({children, progress, direction}) {
            const p = direction === 'entering' ? progress : 1 - progress
            return <AbsoluteFill style={{overflow:'hidden'}}>
              <div style={{height:'100%',width:'100%',clipPath:\`inset(0 \${(1-p)*100}% 0 0)\`}}>{children}</div>
            </AbsoluteFill>
          }
        `,
        effectSummary: '蓝色遮罩从左向右揭开',
      }),
    })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(realPreview.ok, true, JSON.stringify(realPreview))
  assert.equal(realPreview.ok ? realPreview.status : undefined, 'promoted')
  assert.equal(uploadedFiles, 5)
  assert.equal(reviewedImageInputs, 5, 'the Ark visual review request must contain all five sampled frames')

  console.info('[smoke-v2-render-component-authoring-agent] OK')
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
