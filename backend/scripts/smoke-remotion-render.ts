import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { remotionRenderer } from '../src/modules/render-engine/remotion-renderer.service.js'
import type { RenderPlanV1 } from '../../shared/types/render-plan.v1.js'

const taskId = `smoke_remotion_${Date.now()}`
const outputDir = await mkdtemp(path.join(tmpdir(), 'dpl304-remotion-render-'))
const propsDir = await mkdtemp(path.join(tmpdir(), 'dpl304-remotion-props-'))
const browserExecutable = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))

const plan: RenderPlanV1 = {
  version: '1.0',
  task_id: taskId,
  strategy: 'motion_graphics',
  duration_sec: 2,
  canvas: {
    width: 360,
    height: 640,
    fps: 24,
    ratio: '9:16',
  },
  assets: [],
  scenes: [
    {
      id: 'scene_hook',
      source_anchor_id: 'anchor_hook',
      name: 'Hook',
      start_sec: 0,
      end_sec: 2,
      role: 'hook',
      intent: {
        marketing_role: 'hook',
        emotion_vibe: 'urgent',
        purpose: 'smoke render',
      },
      visual: {
        mode: 'solid_bg',
        fit: 'cover',
        motion: {
          preset: 'zoom_in',
          intensity: 0.7,
        },
        visual_prompt: 'SMOKE REMOTION RENDER',
      },
      overlays: [
        {
          id: 'overlay_hook',
          type: 'big_caption',
          start_sec: 0,
          end_sec: 2,
          text: 'SMOKE OK',
          layout: {
            position: 'center',
            align: 'center',
            max_width_pct: 86,
          },
          style: {
            font_size: 56,
            font_weight: 'black',
            color: '#ffffff',
            background: '#ef4444',
            stroke: '#111111',
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

try {
  const result = await remotionRenderer.renderMedia(plan, {
    outputDir,
    propsDir,
    remotionRoot: path.resolve(process.cwd(), '../remotion'),
    publicBaseUrl: 'http://localhost:3001',
    browserExecutable,
    requireRender: true,
  })

  assert.equal(result.status, 'rendered')
  assert.ok(result.outputPath, 'outputPath should be set')
  assert.ok(result.finalVideoUrl?.includes(taskId), `finalVideoUrl should include task id: ${result.finalVideoUrl}`)
  assert.ok(result.finalVideoUrl?.endsWith('.mp4'))

  const file = await stat(result.outputPath)
  assert.ok(file.size > 1_000, `rendered file is too small: ${file.size}`)

  console.info('[smoke] remotion render OK')
  console.info(
    JSON.stringify(
      {
        taskId,
        outputPath: result.outputPath,
        finalVideoUrl: result.finalVideoUrl,
        size: file.size,
      },
      null,
      2,
    ),
  )
} finally {
  await rm(outputDir, { recursive: true, force: true })
  await rm(propsDir, { recursive: true, force: true })
}
