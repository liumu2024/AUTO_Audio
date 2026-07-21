import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Prisma } from '@prisma/client'

import { processGenerationJob } from '../src/modules/generator/generation-job.processor.js'
import { updateTaskRenderPlan } from '../src/modules/render-plan/render-plan.service.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/shared/prisma.service.js'
import type { MigrationProtocolV12 } from '../../shared/types/migration-protocol.v1.2.js'
import type { RenderPlanV1 } from '../../shared/types/render-plan.v1.js'

const userId = 1
const taskId = `smoke_generation_${Date.now()}`

const structure: MigrationProtocolV12 = {
  version: '1.2',
  metadata: {
    video_id: 'smoke-video',
    duration_sec: 2,
  },
  source_video: {
    url: 'https://example.com/sample.mp4',
    duration: 2,
  },
  generated_video: {
    url: '',
    duration: 2,
  },
  semantic_anchors: [
    {
      anchor_id: 'anchor_hook',
      start_sec: 0,
      end_sec: 2,
      logic_intent: {
        marketing_role: 'hook',
        emotion_vibe: 'urgent',
      },
      match: {
        status: 'gap',
        asset_name: null,
      },
      replication_instructions: {
        visual_generation_prompt: 'Bold smoke-test motion graphics card',
        overlay_rewrite_instruction: 'SMOKE GENERATION OK',
      },
    },
  ],
}

const renderPlan: RenderPlanV1 = {
  version: '1.0',
  task_id: taskId,
  strategy: 'motion_graphics',
  duration_sec: 2,
  canvas: {
    width: 540,
    height: 960,
    fps: 30,
    ratio: '9:16',
  },
  assets: [],
  scenes: [
    {
      id: 'scene_hook',
      source_anchor_id: 'anchor_hook',
      name: 'Smoke Hook',
      start_sec: 0,
      end_sec: 2,
      role: 'hook',
      intent: {
        marketing_role: 'hook',
        emotion_vibe: 'urgent',
        purpose: 'Verify generation processor and Remotion render.',
      },
      visual: {
        mode: 'solid_bg',
        fit: 'cover',
        motion: { preset: 'zoom_in', intensity: 0.7 },
        visual_prompt: 'Smoke test background',
      },
      overlays: [
        {
          id: 'overlay_smoke',
          type: 'big_caption',
          start_sec: 0,
          end_sec: 2,
          text: 'SMOKE GENERATION OK',
          layout: {
            position: 'center',
            align: 'center',
            max_width_pct: 86,
          },
          style: {
            font_size: 72,
            font_weight: 'black',
            color: '#ffffff',
            background: '#7c3aed',
            stroke: '#18181b',
            shadow: true,
          },
          animation: {
            in: 'pop',
            out: 'fade_out',
            emphasis: 'scale_pulse',
          },
        },
      ],
      audio: [],
    },
  ],
}

async function main() {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dpl304-generation-'))
  env.renderOutputDir = outputDir

  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      userIdHash: 'smoke_user_1',
      username: 'Smoke User',
    },
    update: {},
  })

  await prisma.replicationTask.create({
    data: {
      id: taskId,
      userId,
      sampleVideoUrl: structure.source_video.url,
      globalPrompt: 'smoke generation processor',
      structureJson: structure as unknown as Prisma.InputJsonValue,
      taskStatus: 'WAITING_USER_EDIT',
    },
  })

  await updateTaskRenderPlan(taskId, renderPlan)

  const output = await processGenerationJob(
    { taskId, userId, prompt: 'smoke' },
    { mode: 'remotion' },
  )

  assert.ok(output.finalVideoUrl.endsWith(`${taskId}.mp4`))

  const task = await prisma.replicationTask.findUniqueOrThrow({
    where: { id: taskId },
  })
  assert.equal(task.taskStatus, 'COMPLETED')
  assert.equal(task.finalVideoUrl, output.finalVideoUrl)

  const structureAfter = task.structureJson as MigrationProtocolV12
  assert.equal(structureAfter.generated_video.url, output.finalVideoUrl)

  const outputPath = path.join(outputDir, `${taskId}.mp4`)
  const file = await stat(outputPath)
  assert.ok(file.size > 1000, 'rendered mp4 should not be empty')

  console.info('[smoke] generation processor + Remotion render OK')
  console.info(
    JSON.stringify(
      {
        taskId,
        finalVideoUrl: output.finalVideoUrl,
        outputPath,
        size: file.size,
      },
      null,
      2,
    ),
  )

  await rm(outputDir, { recursive: true, force: true })
}

try {
  await main()
} finally {
  await prisma.replicationTask.deleteMany({ where: { id: taskId } })
  await prisma.$disconnect()
}
