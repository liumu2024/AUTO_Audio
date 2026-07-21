import { existsSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { remotionRenderer } from '../src/modules/render-engine/remotion-renderer.service.js'
import { extractAudioVisualUnderstandingHints } from '../src/modules/sample-understanding/preprocessor/audio-visual-feature-extractor.js'
import type { VideoInput } from '../src/modules/video-understanding/video-input.js'
import { stageLocalAssetsForRemotion } from '../../experiments/remotion-render-lab/src/plan-utils.js'
import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import type { MigrationProtocolV12 } from '../../shared/types/migration-protocol.v1.2.js'
import type { UserMaterialDto } from '../../shared/types/pipeline.js'
import type { RenderPlanV1 } from '../../shared/types/render-plan.v1.js'

const taskId = 'e2e_sample3_render_recipe'
const repoRoot = path.resolve(process.cwd(), '..')
const sampleVideoPath = path.join(
  repoRoot,
  'experiments/remotion-render-lab/example_videos/3.mp4',
)
const materialRoot = path.join(
  repoRoot,
  'experiments/remotion-render-lab/example_videos/1imgs',
)
const outDir = path.join(
  repoRoot,
  'experiments/remotion-render-lab/runs',
  taskId,
)

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function browserExecutable(): string | undefined {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  return candidates.find((item): item is string => Boolean(item && existsSync(item)))
}

async function buildSampleInput(): Promise<VideoInput> {
  const info = await stat(sampleVideoPath)
  return {
    storageKind: 'local',
    localPath: sampleVideoPath,
    originalName: '3.mp4',
    mimeType: 'video/mp4',
    sizeBytes: info.size,
    createdAt: new Date(),
  }
}

function buildMaterials(): UserMaterialDto[] {
  const picks = [
    ['lake_wide_001', '16.png', ['landscape', 'wide', 'opening']],
    ['water_texture_001', '17.png', ['water', 'texture', 'cut']],
    ['tree_detail_001', '18.png', ['leaf', 'detail', 'texture']],
    ['sunset_boat_001', '19.png', ['sunset', 'boat', 'warm']],
    ['red_leaf_001', '20.png', ['red_leaf', 'accent', 'color_peak']],
    ['mist_lake_001', '21.png', ['mist', 'pause', 'soft']],
    ['final_wide_001', '22.png', ['closing', 'wide', 'calm']],
  ] as const

  return picks.map(([id, filename, tags]) => ({
    id,
    material_type: 'IMAGE',
    oss_url: path.join(materialRoot, filename),
    label: filename,
    ai_tags: [...tags],
    status: 'READY',
  }))
}

function anchor(input: {
  id: string
  index: number
  start: number
  end: number
  role: string
  assetId: string
  prompt: string
}): MigrationProtocolV12['semantic_anchors'][number] {
  return {
    anchor_id: input.id,
    start_sec: input.start,
    end_sec: input.end,
    sequence: {
      from_sec: input.start,
      duration_sec: round(input.end - input.start),
      layout: 'fill',
      premount_sec: 0.4,
    },
    logic_intent: {
      marketing_role: input.role,
      emotion_vibe: input.role === 'color_peak' ? 'surging' : 'cinematic',
    },
    match: {
      status: 'matched',
      asset_name: input.assetId,
      asset_id: input.assetId,
    },
    replication_instructions: {
      visual_generation_prompt: input.prompt,
      overlay_rewrite_instruction: '',
      visual_motion: {
        preset: input.index % 2 === 0 ? 'push_in' : 'pan',
        intensity: input.role === 'color_peak' ? 0.62 : 0.28,
        easing: 'ease-out',
        driver: 'useCurrentFrame',
      },
    },
  }
}

function buildStructure(input: {
  duration: number
  beatTimes: number[]
  strongBeats: number[]
  energyPeaks: Array<{ time: number; intensity: number; duration_sec?: number }>
  waveform: Array<{ time: number; value: number }>
}): MigrationProtocolV12 {
  const duration = round(input.duration)
  const segments = [
    {
      id: 'seg_001',
      start: 0,
      end: 1.1,
      role: 'cinematic_open',
      assetId: 'lake_wide_001',
      prompt:
        '静谧风景开场，电影级低对比灰度基底，轻微推近，保留画面呼吸感。',
    },
    {
      id: 'seg_002',
      start: 1.1,
      end: 2.15,
      role: 'horizontal_collage',
      assetId: 'water_texture_001',
      prompt:
        '横向切片拼贴，像杂志版面一样将水面和枝叶拆成多个窄条，按音乐切入。',
    },
    {
      id: 'seg_003',
      start: 2.15,
      end: 3.35,
      role: 'texture_cut',
      assetId: 'tree_detail_001',
      prompt:
        '质感特写，叶片纹理与天空色块交替，使用短促节奏缩放和轻微闪白。',
    },
    {
      id: 'seg_004',
      start: 3.35,
      end: 5.2,
      role: 'color_peak',
      assetId: 'sunset_boat_001',
      prompt:
        '色彩高潮段，暖色夕阳和水面反光铺满画面，强化饱和度、暗角和辉光。',
    },
    {
      id: 'seg_005',
      start: 5.2,
      end: 6.35,
      role: 'reflection_pause',
      assetId: 'mist_lake_001',
      prompt:
        '节奏留白，湖面雾气或反光慢推，画面更安静，给下一次切分留空间。',
    },
    {
      id: 'seg_006',
      start: 6.35,
      end: 7.55,
      role: 'triptych_collage',
      assetId: 'red_leaf_001',
      prompt:
        '三联屏拼贴，三块不同风景素材同步出现，中心画面更亮，两侧轻微色散。',
    },
    {
      id: 'seg_007',
      start: 7.55,
      end: 8.7,
      role: 'beat_cut',
      assetId: 'water_texture_001',
      prompt:
        '最后一组卡点切换，短促推拉，跟随强拍做轻微画面震动和闪白。',
    },
    {
      id: 'seg_008',
      start: 8.7,
      end: duration,
      role: 'closing_frame',
      assetId: 'final_wide_001',
      prompt:
        '收尾定格，宽景画面回到稳定构图，颜色柔和，留出结束呼吸。',
    },
  ]

  return {
    version: '1.2',
    metadata: {
      video_id: taskId,
      duration_sec: duration,
    },
    source_video: {
      url: sampleVideoPath,
      duration,
    },
    generated_video: {
      url: '',
      duration,
    },
    semantic_anchors: segments.map((item, index) =>
      anchor({ ...item, index, end: Math.min(item.end, duration) }),
    ),
    transitions: segments.slice(0, -1).map((item, index) => ({
      id: `tr_${index + 1}`,
      from_anchor_id: item.id,
      to_anchor_id: segments[index + 1].id,
      at_sec: Math.min(item.end, duration),
      presentation: 'cut',
      duration_sec: 0.08,
      timing: { type: 'linear' },
      overlay: {
        type: index % 3 === 1 ? 'flash' : 'none',
        intensity: index % 3 === 1 ? 0.32 : undefined,
      },
      reason: 'audio beat aligned editorial montage cut',
    })),
    render_recipe: {
      style_family: 'sample3_audio_guided_landscape_editorial',
      scene_effects: [
        {
          segment_id: 'seg_001',
          preset: 'cinematic_grade_pack',
          params: {
            color_grade: { saturate: 1.08, contrast: 1.08, brightness: 0.94 },
            vignette: { opacity: 0.52 },
          },
        },
        {
          segment_id: 'seg_002',
          preset: 'mask_slice_transition',
          params: {
            direction: 'horizontal',
            mode: 'shuffle',
            slice_count: 7,
            duration_sec: 0.72,
            stagger_sec: 0.045,
          },
        },
        {
          segment_id: 'seg_004',
          preset: 'cinematic_grade_pack',
          params: {
            color_grade: { saturate: 1.32, contrast: 1.16, brightness: 0.96 },
            bloom: { opacity: 0.26, blur_px: 22 },
            chromatic_aberration: { opacity: 0.16, offset_px: 2.4 },
          },
        },
        {
          segment_id: 'seg_006',
          preset: 'editorial_split_collage',
          params: {
            panels: [
              {
                id: 'left_panel',
                asset_id: 'lake_wide_001',
                start_sec: 0.05,
                end_sec: 1.15,
                x_pct: 22,
                y_pct: 50,
                width_pct: 34,
                height_pct: 74,
                fit: 'cover',
                entrance: 'slide_left',
                scale_from: 0.96,
                scale_to: 1.03,
              },
              {
                id: 'center_panel',
                asset_id: 'sunset_boat_001',
                start_sec: 0.16,
                end_sec: 1.15,
                x_pct: 50,
                y_pct: 50,
                width_pct: 31,
                height_pct: 82,
                fit: 'cover',
                entrance: 'zoom',
                scale_from: 0.9,
                scale_to: 1.04,
              },
              {
                id: 'right_panel',
                asset_id: 'red_leaf_001',
                start_sec: 0.28,
                end_sec: 1.15,
                x_pct: 78,
                y_pct: 50,
                width_pct: 34,
                height_pct: 74,
                fit: 'cover',
                entrance: 'slide_right',
                scale_from: 0.96,
                scale_to: 1.03,
              },
            ],
            panel_style: { chromatic_aberration_px: 2.4 },
          },
        },
      ],
      audio_driver: {
        preset: 'audio_reactive_cut_driver',
        beat_times: input.beatTimes,
        strong_beats: input.strongBeats,
        energy_peaks: input.energyPeaks,
        waveform: input.waveform,
      },
    },
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const hints = await extractAudioVisualUnderstandingHints(await buildSampleInput())
  const structure = buildStructure({
    duration: hints.metadata.video_duration,
    beatTimes: hints.audio_features.beats,
    strongBeats: hints.audio_features.strong_beats,
    energyPeaks: hints.audio_features.energy_peaks,
    waveform: hints.audio_features.waveform,
  })
  let plan: RenderPlanV1 = buildRenderPlanFromStructure({
    taskId,
    structure,
    materials: buildMaterials(),
    aspectRatio: '16:9',
  })

  const remotionRoot = path.join(repoRoot, 'remotion')
  plan = await stageLocalAssetsForRemotion(plan, remotionRoot)

  const hintsPath = path.join(outDir, `${taskId}.hints.json`)
  const structurePath = path.join(outDir, `${taskId}.structure.v1.2.json`)
  const planPath = path.join(outDir, `${taskId}.render-plan.json`)
  await writeFile(hintsPath, `${JSON.stringify(hints, null, 2)}\n`, 'utf8')
  await writeFile(structurePath, `${JSON.stringify(structure, null, 2)}\n`, 'utf8')
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')

  const result = await remotionRenderer.renderMedia(plan, {
    outputDir: outDir,
    propsDir: path.join(outDir, 'props'),
    remotionRoot,
    publicBaseUrl: 'http://localhost:3001',
    browserExecutable: browserExecutable(),
    requireRender: true,
  })

  await writeFile(
    path.join(outDir, `${taskId}.render-log.txt`),
    `${result.log ?? ''}\n`,
    'utf8',
  )

  console.info('[e2e-sample3-render-recipe] OK')
  console.info(
    JSON.stringify(
      {
        sampleVideoPath,
        materialCount: plan.assets.length,
        duration: plan.duration_sec,
        beatCount: hints.audio_features.beats.length,
        strongBeatCount: hints.audio_features.strong_beats.length,
        outputPath: result.outputPath,
        hintsPath,
        structurePath,
        planPath,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[e2e-sample3-render-recipe] FAILED')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
