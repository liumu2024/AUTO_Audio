import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import { analyzeAssetHeuristically } from '../../shared/lib/asset-analysis-heuristic.js'
import { loadMockMaterials, loadMockStructure } from '../../shared/lib/load-mocks.js'
import { buildRemotionRenderProps } from '../src/modules/render-engine/render-props.js'
import { remotionRenderer } from '../src/modules/render-engine/remotion-renderer.service.js'

const taskId = 'smoke_render_pipeline'
const structure = loadMockStructure()
const materials = loadMockMaterials()

const renderPlan = buildRenderPlanFromStructure({
  taskId,
  structure,
  materials,
})
const gapFillPlan = buildRenderPlanFromStructure({
  taskId: `${taskId}_gap_fill`,
  structure,
  materials: [
    {
      ...materials[0]!,
      asset_analysis: analyzeAssetHeuristically({
        id: materials[0]!.id,
        type: materials[0]!.material_type,
        name: materials[0]!.label,
        url: materials[0]!.oss_url,
        tags: materials[0]!.ai_tags,
      }),
    },
    {
      id: 'mat_product_closeup',
      material_type: 'IMAGE',
      oss_url: 'https://cdn.example.com/materials/product-closeup.png',
      label: 'product demo closeup.png',
      ai_tags: ['product', 'demo', 'close_up'],
      asset_analysis: analyzeAssetHeuristically({
        id: 'mat_product_closeup',
        type: 'IMAGE',
        name: 'product demo closeup.png',
        url: 'https://cdn.example.com/materials/product-closeup.png',
        tags: ['product', 'demo', 'close_up'],
      }),
      status: 'READY',
    },
  ],
})

const remotionProps = buildRemotionRenderProps(renderPlan)
const outputDir = await mkdtemp(path.join(tmpdir(), 'dpl304-render-smoke-'))
const prepared = await remotionRenderer.prepareRenderProps(renderPlan, {
  outputDir,
})
const skippedRender = await remotionRenderer.renderMedia(renderPlan, {
  propsDir: outputDir,
  outputDir,
  remotionRoot: outputDir,
})
const preparedProps = JSON.parse(await readFile(prepared.propsPath, 'utf8')) as {
  taskId: string
  scenes: unknown[]
}

assert.equal(renderPlan.version, '1.0')
assert.equal(renderPlan.task_id, taskId)
assert.equal(renderPlan.duration_sec, structure.metadata.duration_sec)
assert.ok(
  ['montage', 'motion_graphics', 'hybrid'].includes(renderPlan.strategy),
  `unexpected render strategy: ${renderPlan.strategy}`,
)
assert.equal(renderPlan.scenes.length, structure.semantic_anchors.length)
assert.equal(renderPlan.assets.length, materials.length)

const firstScene = renderPlan.scenes[0]
assert.ok(firstScene, 'first render scene should exist')
assert.equal(firstScene.source_anchor_id, structure.semantic_anchors[0]?.anchor_id)
assert.equal(firstScene.visual.mode, 'material_clip')
assert.equal(firstScene.visual.asset_id, 'mat_v_hook_01')
assert.ok(firstScene.visual.visual_prompt.length > 0)
assert.ok(firstScene.overlays.length > 0, 'first scene should have overlay')
assert.equal(firstScene.overlays[0]?.text, '限时秒杀，仅限今天')
assert.ok(firstScene.audio.length > 0, 'first scene should have audio layer')
assert.equal(firstScene.audio[0]?.sfx_type, 'hit')

const secondScene = renderPlan.scenes[1]
assert.ok(secondScene, 'second render scene should exist')
assert.ok(
  ['ai_generated', 'image_motion'].includes(secondScene.visual.mode),
  `gap scene should use generated/image motion visual, got ${secondScene.visual.mode}`,
)
assert.equal(secondScene.visual.asset_id, undefined)
assert.equal(secondScene.intent.marketing_role, 'product_demo')

const gapFilledScene = gapFillPlan.scenes[1]
assert.equal(gapFilledScene?.visual.mode, 'material_clip')
assert.equal(gapFilledScene?.visual.asset_id, 'mat_product_closeup')
assert.ok(gapFilledScene?.visual.trim, 'gap-filled scene should trim segment')

assert.equal(remotionProps.taskId, taskId)
assert.equal(remotionProps.fps, renderPlan.canvas.fps)
assert.equal(remotionProps.width, 1080)
assert.equal(remotionProps.height, 1920)
assert.equal(
  remotionProps.durationInFrames,
  renderPlan.duration_sec * renderPlan.canvas.fps,
)
assert.equal(remotionProps.scenes.length, renderPlan.scenes.length)
assert.equal(remotionProps.scenes[0]?.fromFrame, 0)
assert.equal(
  remotionProps.scenes[0]?.durationInFrames,
  5 * renderPlan.canvas.fps,
)
assert.equal(prepared.status, 'props_ready')
assert.equal(prepared.taskId, taskId)
assert.equal(preparedProps.taskId, taskId)
assert.equal(preparedProps.scenes.length, renderPlan.scenes.length)
assert.equal(skippedRender.status, 'render_skipped')
assert.equal(skippedRender.taskId, taskId)
assert.ok(skippedRender.propsPath.endsWith('.render-props.json'))

const summary = {
  taskId,
  strategy: renderPlan.strategy,
  durationSec: renderPlan.duration_sec,
  canvas: renderPlan.canvas,
  assetCount: renderPlan.assets.length,
  sceneCount: renderPlan.scenes.length,
  scenes: renderPlan.scenes.map((scene) => ({
    id: scene.id,
    role: scene.role,
    visualMode: scene.visual.mode,
    assetId: scene.visual.asset_id ?? null,
    overlayCount: scene.overlays.length,
    audioCount: scene.audio.length,
    fromFrame:
      remotionProps.scenes.find((s) => s.id === scene.id)?.fromFrame ?? null,
  })),
}

console.info('[smoke] render pipeline OK')
console.info(JSON.stringify(summary, null, 2))

await rm(outputDir, { recursive: true, force: true })
