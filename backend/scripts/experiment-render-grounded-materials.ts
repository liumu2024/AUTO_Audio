import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { remotionRenderer } from '../src/modules/render-engine/remotion-renderer.service.js'
import { stageLocalAssetsForRemotion } from '../../experiments/remotion-render-lab/src/plan-utils.js'
import type { RenderAsset, RenderPlanV1, RenderScene } from '../../shared/types/render-plan.v1.js'
import { createDefaultEffect } from '../../shared/lib/effect-registry.js'

const repoRoot = path.resolve(process.cwd(), '..')
const taskId = 'gt_material_grounded_preview'
const sourcePropsPath = path.resolve(
  'tmp/agent-trace/task_ana_1780399868314/artifacts/render/task_ana_1780399868314.render-props.json',
)
const outDir = path.join(repoRoot, 'experiments/remotion-render-lab/runs', taskId)

interface ExistingRenderPropsAsset {
  id: string
  url: string
  name: string
  type: RenderAsset['type']
  source: RenderAsset['source']
}

function localUploadPath(url: string): string {
  const match = url.match(/\/uploads\/([^/?#]+)/)
  if (!match) return url
  return path.join(repoRoot, 'backend/uploads', match[1])
}

function withAsset(index: number, assets: RenderAsset[]): string {
  return assets[index % assets.length]?.id ?? assets[0]?.id ?? ''
}

function grade(params: Record<string, unknown> = {}) {
  return {
    ...createDefaultEffect('cinematic_grade_pack'),
    ...params,
  } as RenderScene['effects']
}

function audioReactive(params: Record<string, unknown> = {}) {
  return {
    ...createDefaultEffect('audio_reactive_cut_driver'),
    ...params,
  } as RenderScene['effects']
}

function maskSlice(params: Record<string, unknown> = {}) {
  return {
    ...createDefaultEffect('mask_slice_transition'),
    ...params,
  } as RenderScene['effects']
}

function collage(params: Record<string, unknown> = {}) {
  return {
    ...createDefaultEffect('editorial_split_collage'),
    ...params,
  } as RenderScene['effects']
}

function overlay(id: string, start: number, end: number) {
  return {
    id: `overlay_${id}`,
    type: 'subtitle' as const,
    start_sec: start,
    end_sec: end,
    text: 'WEST LAKE',
    layout: {
      position: 'bottom' as const,
      align: 'center' as const,
      max_width_pct: 78,
    },
    style: {
      font_size: 22,
      font_weight: 'regular' as const,
      color: 'rgba(255,255,255,0.58)',
      shadow: true,
    },
    animation: {
      in: 'fade_in' as const,
      out: 'fade_out' as const,
    },
  }
}

function scene(input: {
  id: string
  start: number
  end: number
  role: string
  assetId: string
  prompt: string
  motion: 'static' | 'push_in' | 'pan' | 'zoom_in'
  effects?: RenderScene['effects']
}): RenderScene {
  return {
    id: `scene_${input.id}`,
    source_anchor_id: input.id,
    name: input.role,
    start_sec: input.start,
    end_sec: input.end,
    sequence: {
      from_sec: input.start,
      duration_sec: input.end - input.start,
      layout: 'fill',
      premount_sec: 0.5,
    },
    role: input.role,
    intent: {
      marketing_role: input.role,
      emotion_vibe: 'cinematic_poetic',
      purpose: input.prompt,
    },
    visual: {
      mode: 'image_motion',
      asset_id: input.assetId,
      material_source: 'user_material',
      fit: 'cover',
      motion: {
        preset: input.motion,
        intensity: input.motion === 'static' ? 0 : 0.32,
        easing: 'ease-out',
        driver: 'useCurrentFrame',
      },
      visual_prompt: input.prompt,
    },
    effects: input.effects,
    overlays: [overlay(input.id, input.start, input.end)],
    audio: [],
  }
}

async function loadAssets(): Promise<RenderAsset[]> {
  const props = JSON.parse(await readFile(sourcePropsPath, 'utf8')) as {
    assets: ExistingRenderPropsAsset[]
  }
  return props.assets
    .filter((asset) => asset.type === 'image' || asset.type === 'video')
    .map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      url: localUploadPath(asset.url),
      source: 'user_material' as const,
    }))
    .filter((asset) => existsSync(fileURLToPathIfNeeded(asset.url)))
}

function fileURLToPathIfNeeded(value: string): string {
  return value.startsWith('file://') ? fileURLToPath(value) : value
}

function buildPlan(assets: RenderAsset[]): RenderPlanV1 {
  const sceneEffects = {
    intro: grade({
      color_grade: { saturate: 1.08, contrast: 1.12, brightness: 0.92, sepia: 0.05 },
      vignette: { enabled: true, opacity: 0.62, radius_pct: 56 },
    }),
    rectReveal: maskSlice({
      direction: 'vertical',
      mode: 'reveal',
      slice_count: 1,
      duration_sec: 0.42,
      start_sec: 0.02,
      slide_distance_pct: 8,
      slice_style: { gap_px: 0, shadow: true, chromatic_aberration_px: 1.2 },
    }),
    squareReveal: maskSlice({
      direction: 'horizontal',
      mode: 'reveal',
      slice_count: 2,
      duration_sec: 0.46,
      start_sec: 0.02,
      stagger_sec: 0.025,
      slide_distance_pct: 14,
      slice_style: { gap_px: 2, shadow: true, chromatic_aberration_px: 1.6 },
    }),
    circleLike: {
      ...createDefaultEffect('ripple_displacement'),
      ripple: {
        origin: { x_pct: 50, y_pct: 50 },
        start_sec: 0.04,
        duration_sec: 0.78,
        radius_pct_keyframes: [
          { time: 0, value: 0 },
          { time: 0.22, value: 24 },
          { time: 0.52, value: 68 },
          { time: 0.78, value: 112 },
        ],
        amplitude_px: 18,
        frequency: 7.2,
        decay: 0.74,
        width_pct: 8,
      },
    } as RenderScene['effects'],
    verticalCollage: collage({
      panels: [
        {
          id: 'left',
          asset_id: withAsset(0, assets),
          start_sec: 0.04,
          end_sec: 0.9,
          x_pct: 18,
          y_pct: 50,
          width_pct: 34,
          height_pct: 100,
          fit: 'cover',
          entrance: 'slide_left',
          scale_from: 0.98,
          scale_to: 1.04,
        },
        {
          id: 'center',
          asset_id: withAsset(1, assets),
          start_sec: 0.12,
          end_sec: 0.9,
          x_pct: 50,
          y_pct: 50,
          width_pct: 34,
          height_pct: 100,
          fit: 'cover',
          entrance: 'zoom',
          scale_from: 0.94,
          scale_to: 1.04,
        },
        {
          id: 'right',
          asset_id: withAsset(2, assets),
          start_sec: 0.2,
          end_sec: 0.9,
          x_pct: 82,
          y_pct: 50,
          width_pct: 34,
          height_pct: 100,
          fit: 'cover',
          entrance: 'slide_right',
          scale_from: 0.98,
          scale_to: 1.04,
        },
      ],
      panel_style: { shadow: true, chromatic_aberration_px: 1.6 },
    }),
    horizontalCollage: collage({
      panels: [
        {
          id: 'top',
          asset_id: withAsset(3, assets),
          start_sec: 0.04,
          end_sec: 1.0,
          x_pct: 50,
          y_pct: 17,
          width_pct: 100,
          height_pct: 34,
          fit: 'cover',
          entrance: 'slide_left',
          scale_from: 1,
          scale_to: 1.05,
        },
        {
          id: 'middle',
          asset_id: withAsset(4, assets),
          start_sec: 0.12,
          end_sec: 1.0,
          x_pct: 50,
          y_pct: 50,
          width_pct: 100,
          height_pct: 34,
          fit: 'cover',
          entrance: 'slide_right',
          scale_from: 1,
          scale_to: 1.05,
        },
        {
          id: 'bottom',
          asset_id: withAsset(0, assets),
          start_sec: 0.2,
          end_sec: 1.0,
          x_pct: 50,
          y_pct: 83,
          width_pct: 100,
          height_pct: 34,
          fit: 'cover',
          entrance: 'slide_left',
          scale_from: 1,
          scale_to: 1.05,
        },
      ],
      panel_style: { shadow: true, chromatic_aberration_px: 1.4 },
    }),
    beatPulse: audioReactive({
      beat_times: [0.16, 0.48, 0.82],
      strong_beats: [0.48],
      energy_peaks: [{ time: 0.48, intensity: 0.88, duration_sec: 0.18 }],
      pulse: { scale: 0.035, duration_sec: 0.16 },
      flash: { enabled: true, color: 'rgba(255,255,255,1)', opacity: 0.14, duration_sec: 0.08 },
      shake: { enabled: false, amplitude_px: 0, duration_sec: 0.12 },
    }),
  }

  return {
    version: '1.0',
    task_id: taskId,
    strategy: 'montage',
    duration_sec: 9.6,
    canvas: { width: 1920, height: 1080, fps: 30, ratio: '16:9' },
    assets,
    scenes: [
      scene({
        id: 'seg_001',
        start: 0,
        end: 2,
        role: 'cinematic_open',
        assetId: withAsset(0, assets),
        prompt: 'Still poetic landscape opening, slow foreground movement feeling, cinematic Chinese travel tone.',
        motion: 'pan',
        effects: sceneEffects.intro,
      }),
      scene({
        id: 'seg_002',
        start: 2,
        end: 2.9,
        role: 'rect_window_reveal',
        assetId: withAsset(1, assets),
        prompt: 'Beat-synced rectangle window reveal from center, switching into a close scenic detail.',
        motion: 'push_in',
        effects: sceneEffects.rectReveal,
      }),
      scene({
        id: 'seg_003',
        start: 2.9,
        end: 3.9,
        role: 'humanistic_dusk_cut',
        assetId: withAsset(2, assets),
        prompt: 'Quiet dusk / humanistic insert, breathing zoom, calm transition between landscape beats.',
        motion: 'push_in',
        effects: sceneEffects.beatPulse,
      }),
      scene({
        id: 'seg_004',
        start: 3.9,
        end: 4.8,
        role: 'square_window_reveal',
        assetId: withAsset(3, assets),
        prompt: 'Square geometric reveal into warm autumn scenic detail, aligned to strong beat.',
        motion: 'zoom_in',
        effects: sceneEffects.squareReveal,
      }),
      scene({
        id: 'seg_005',
        start: 4.8,
        end: 5.8,
        role: 'circle_window_reveal',
        assetId: withAsset(4, assets),
        prompt: 'Circular garden-window style reveal, soft ripple expansion from center.',
        motion: 'push_in',
        effects: sceneEffects.circleLike,
      }),
      scene({
        id: 'seg_006',
        start: 5.8,
        end: 6.7,
        role: 'vertical_triptych_collage',
        assetId: withAsset(0, assets),
        prompt: 'Vertical three-panel collage, staggered slide-in, cinematic editorial layout.',
        motion: 'static',
        effects: sceneEffects.verticalCollage,
      }),
      scene({
        id: 'seg_007',
        start: 6.7,
        end: 7.7,
        role: 'horizontal_strip_collage',
        assetId: withAsset(3, assets),
        prompt: 'Horizontal three-strip collage, dense landscape information release on energy peak.',
        motion: 'static',
        effects: sceneEffects.horizontalCollage,
      }),
      scene({
        id: 'seg_008',
        start: 7.7,
        end: 8.7,
        role: 'night_light_peak',
        assetId: withAsset(1, assets),
        prompt: 'Darkening night-light emotional peak, subtle flash on the strongest beat.',
        motion: 'push_in',
        effects: sceneEffects.beatPulse,
      }),
      scene({
        id: 'seg_009',
        start: 8.7,
        end: 9.6,
        role: 'closing_frame',
        assetId: withAsset(2, assets),
        prompt: 'Poetic closing frame, slow push into red leaves / window-like composition.',
        motion: 'push_in',
        effects: sceneEffects.intro,
      }),
    ],
    transitions: [
      { id: 'tr_001', from_anchor_id: 'seg_001', to_anchor_id: 'seg_002', at_sec: 2, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'none' } },
      { id: 'tr_002', from_anchor_id: 'seg_002', to_anchor_id: 'seg_003', at_sec: 2.9, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'flash', intensity: 0.18 } },
      { id: 'tr_003', from_anchor_id: 'seg_003', to_anchor_id: 'seg_004', at_sec: 3.9, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'none' } },
      { id: 'tr_004', from_anchor_id: 'seg_004', to_anchor_id: 'seg_005', at_sec: 4.8, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'none' } },
      { id: 'tr_005', from_anchor_id: 'seg_005', to_anchor_id: 'seg_006', at_sec: 5.8, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'none' } },
      { id: 'tr_006', from_anchor_id: 'seg_006', to_anchor_id: 'seg_007', at_sec: 6.7, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'none' } },
      { id: 'tr_007', from_anchor_id: 'seg_007', to_anchor_id: 'seg_008', at_sec: 7.7, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'flash', intensity: 0.22 } },
      { id: 'tr_008', from_anchor_id: 'seg_008', to_anchor_id: 'seg_009', at_sec: 8.7, presentation: 'cut', duration_sec: 0, timing: { type: 'linear' }, overlay: { type: 'none' } },
    ],
  }
}

function findBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  return candidates.find((item): item is string => Boolean(item && existsSync(item)))
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const assets = await loadAssets()
  if (!assets.length) throw new Error('No uploaded visual assets found')

  const remotionRoot = path.join(repoRoot, 'remotion')
  let plan = buildPlan(assets)
  plan = await stageLocalAssetsForRemotion(plan, remotionRoot)

  const planPath = path.join(outDir, `${taskId}.render-plan.json`)
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')

  const result = await remotionRenderer.renderMedia(plan, {
    outputDir: outDir,
    propsDir: path.join(outDir, 'props'),
    remotionRoot,
    publicBaseUrl: 'http://localhost:3001',
    browserExecutable: findBrowserExecutable(),
    requireRender: true,
  })

  await writeFile(
    path.join(outDir, `${taskId}.render-log.txt`),
    `${result.log ?? ''}\n`,
    'utf8',
  )

  console.info('[experiment-render-grounded-materials] OK')
  console.info(
    JSON.stringify(
      {
        taskId,
        assetCount: assets.length,
        planPath,
        outputPath: result.outputPath,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[experiment-render-grounded-materials] FAILED')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
