import assert from 'node:assert/strict'

import { Prisma } from '@prisma/client'

import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import { loadMockMaterials, loadMockStructure } from '../../shared/lib/load-mocks.js'
import { prisma } from '../src/shared/prisma.service.js'
import { getPipelineBundle } from '../src/modules/pipeline/pipeline.service.js'
import {
  getTaskRenderPlan,
  updateTaskRenderPlan,
} from '../src/modules/render-plan/render-plan.service.js'

const userId = 1
const taskId = `smoke_render_plan_db_${Date.now()}`
const structure = loadMockStructure()
const materials = loadMockMaterials()

async function main() {
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      userIdHash: 'smoke_user_1',
      username: 'Smoke User',
    },
    update: {},
  })

  for (const material of materials) {
    await prisma.userMaterial.upsert({
      where: { id: material.id },
      create: {
        id: material.id,
        userId,
        materialType: material.material_type,
        ossUrl: material.oss_url,
        label: material.label,
        aiTags: material.ai_tags ?? [],
        status: material.status,
      },
      update: {
        materialType: material.material_type,
        ossUrl: material.oss_url,
        label: material.label,
        aiTags: material.ai_tags ?? [],
        status: material.status,
      },
    })
  }

  await prisma.replicationTask.create({
    data: {
      id: taskId,
      userId,
      sampleVideoUrl: structure.source_video.url,
      globalPrompt: 'smoke render plan persistence',
      structureJson: structure as unknown as Prisma.InputJsonValue,
      taskStatus: 'WAITING_USER_EDIT',
    },
  })

  const fallbackBundle = await getPipelineBundle(taskId)
  assert.ok(fallbackBundle?.render_plan, 'pipeline should derive render_plan')
  assert.equal(fallbackBundle.render_plan.task_id, taskId)
  assert.equal(fallbackBundle.render_plan.scenes.length, 2)

  const renderPlan = buildRenderPlanFromStructure({
    taskId,
    structure,
    materials,
  })
  renderPlan.strategy = 'motion_graphics'
  renderPlan.scenes[0]!.visual.mode = 'image_motion'
  renderPlan.scenes[0]!.overlays[0]!.text = 'SMOKE_PATCHED_OVERLAY'

  await updateTaskRenderPlan(taskId, renderPlan)

  const persisted = await getTaskRenderPlan(taskId)
  assert.ok(persisted, 'persisted render plan should be readable')
  assert.equal(persisted.strategy, 'motion_graphics')
  assert.equal(persisted.scenes[0]?.visual.mode, 'image_motion')
  assert.equal(persisted.scenes[0]?.overlays[0]?.text, 'SMOKE_PATCHED_OVERLAY')

  const bundleAfterPatch = await getPipelineBundle(taskId)
  assert.equal(bundleAfterPatch?.render_plan?.strategy, 'motion_graphics')
  assert.equal(
    bundleAfterPatch?.render_plan?.scenes[0]?.overlays[0]?.text,
    'SMOKE_PATCHED_OVERLAY',
  )

  console.info('[smoke] render-plan DB persistence OK')
  console.info(
    JSON.stringify(
      {
        taskId,
        fallbackStrategy: fallbackBundle.render_plan.strategy,
        persistedStrategy: persisted.strategy,
        sceneCount: persisted.scenes.length,
        patchedOverlay: persisted.scenes[0]?.overlays[0]?.text,
      },
      null,
      2,
    ),
  )
}

try {
  await main()
} finally {
  await prisma.replicationTask.deleteMany({ where: { id: taskId } })
  await prisma.$disconnect()
}
