// Builds a Remotion preview video from the 1.mp4 director-grounding result and local landscape frame materials.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { remotionRenderer } from '../src/modules/render-engine/remotion-renderer.service.js'
import { stageLocalAssetsForRemotion } from '../../experiments/remotion-render-lab/src/plan-utils.js'
import type {
  AudioReactiveCutDriverEffects,
  RenderAsset,
  RenderPlanV1,
  RenderScene,
} from '../../shared/types/render-plan.v1.js'

const repoRoot = path.resolve(process.cwd(), '..')
const taskId = 'gt_1_landscape_montage_preview'
const samplePath = path.join(
  repoRoot,
  'experiments/remotion-render-lab/example_videos/1.mp4',
)
const imageDir = path.join(
  repoRoot,
  'experiments/remotion-render-lab/example_videos/1imgs',
)
const hintsPath = path.join(
  process.cwd(),
  'tmp/gt-workflow/gt_1_1780403849161.sample-audio-visual-hints.json',
)
const groundingPath = path.join(
  process.cwd(),
  'tmp/gt-workflow/gt_1_1780403849161.director-grounding.json',
)
const outDir = path.join(repoRoot, 'experiments/remotion-render-lab/runs', taskId)

interface AudioVisualHints {
  metadata?: {
    video_duration?: number
    fps?: number
    width?: number
    height?: number
  }
  audio_features?: {
    beats?: number[]
    strong_beats?: number[]
    energy_peaks?: Array<{ time: number; intensity: number; duration_sec?: number }>
  }
}

interface GroundingResult {
  style_summary?: {
    style_family?: string
    editing_pattern?: string
    audio_sync_logic?: string
  }
}

function numericImageSort(left: string, right: string): number {
  const leftNumber = Number.parseInt(path.basename(left, path.extname(left)), 10)
  const rightNumber = Number.parseInt(path.basename(right, path.extname(right)), 10)
  return leftNumber - rightNumber
}

function localTimes(times: number[] | undefined, start: number, end: number): number[] {
  return (times ?? [])
    .filter((time) => time >= start && time < end)
    .map((time) => Number((time - start).toFixed(3)))
}

function localPeaks(
  peaks: AudioVisualHints['audio_features'] extends infer T
    ? T extends { energy_peaks?: infer P }
      ? P
      : never
    : never,
  start: number,
  end: number,
): AudioReactiveCutDriverEffects['energy_peaks'] {
  return (peaks ?? [])
    .filter((peak) => peak.time >= start && peak.time < end)
    .map((peak) => ({
      time: Number((peak.time - start).toFixed(3)),
      intensity: peak.intensity,
      duration_sec: peak.duration_sec ?? 0.18,
    }))
}

function effectForScene(
  start: number,
  end: number,
  hints: AudioVisualHints,
  baseFilter: string,
): AudioReactiveCutDriverEffects {
  const localBeatTimes = localTimes(hints.audio_features?.beats, start, end)
  const localStrongBeats = localTimes(hints.audio_features?.strong_beats, start, end)
  const localEnergyPeaks = localPeaks(hints.audio_features?.energy_peaks, start, end)
  const hasEnergyPeak = Boolean(localEnergyPeaks?.length)

  return {
    preset: 'audio_reactive_cut_driver',
    base_filter: baseFilter,
    beat_times: localBeatTimes.length ? localBeatTimes : [0],
    strong_beats: localStrongBeats.length ? localStrongBeats : [0],
    energy_peaks: localEnergyPeaks,
    pulse: {
      scale: hasEnergyPeak ? 0.034 : 0.018,
      duration_sec: hasEnergyPeak ? 0.18 : 0.14,
    },
    flash: {
      enabled: true,
      color: 'rgba(255,255,255,1)',
      opacity: hasEnergyPeak ? 0.16 : 0.07,
      duration_sec: 0.07,
    },
    shake: {
      enabled: hasEnergyPeak,
      amplitude_px: hasEnergyPeak ? 3 : 0,
      duration_sec: 0.14,
    },
  }
}

function scene(input: {
  id: string
  start: number
  end: number
  assetId: string
  role: string
  vibe: string
  prompt: string
  motion: 'push_in' | 'zoom_in' | 'pan' | 'static'
  effects: AudioReactiveCutDriverEffects
  includeAudio: boolean
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
      premount_sec: 0.15,
    },
    role: input.role,
    intent: {
      marketing_role: input.role,
      emotion_vibe: input.vibe,
      purpose: input.prompt,
    },
    visual: {
      mode: 'image_motion',
      asset_id: input.assetId,
      material_source: 'user_material',
      fit: 'cover',
      motion: {
        preset: input.motion,
        intensity: input.motion === 'static' ? 0 : 0.28,
        easing: 'ease-out',
        driver: 'useCurrentFrame',
      },
      visual_prompt: input.prompt,
    },
    effects: input.effects,
    overlays: [],
    audio: input.includeAudio
      ? [
          {
            id: `audio_${input.id}`,
            type: 'bgm',
            start_sec: input.start,
            end_sec: input.end,
            asset_id: 'sample_audio_1',
            emotion_vibe: 'uplifting_cinematic_travel',
            sfx_type: 'none',
            volume: 1,
            ducking: false,
          },
        ]
      : [],
  }
}

async function loadImages(): Promise<RenderAsset[]> {
  const files = (await readdir(imageDir))
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .sort(numericImageSort)

  return files.map((file, index) => ({
    id: `landscape_frame_${String(index + 1).padStart(2, '0')}`,
    type: 'image',
    name: file,
    url: path.join(imageDir, file),
    source: 'user_material',
  }))
}

function buildPlan(
  imageAssets: RenderAsset[],
  hints: AudioVisualHints,
  grounding: GroundingResult,
): RenderPlanV1 {
  const duration = Math.min(16, Math.floor(hints.metadata?.video_duration ?? 16))
  const sceneDurations = Array.from({ length: duration }, (_, index) => ({
    start: index,
    end: index + 1,
  }))
  const prompts = [
    'Open with a clean alpine meadow and cabin feeling, establishing premium travel freshness.',
    'Cut on the strong beat to a saturated blue lake and snow mountain wide view.',
    'Keep the visual lush and green, using a subtle sideways aerial drift.',
    'Landmark mirror-lake shot, stable and quiet, letting the beat create the impact.',
    'Pasture and village life insert, slower push-in but still cut exactly on beat.',
    'Energy peak: outdoor snow or high-altitude action feel, add bloom flash and tiny shake.',
    'Misty mountain grandeur, high aerial scale, cool highlights and low grain.',
    'Red train or motion insert feeling, using pan to imply travel movement.',
    'Lakeside tower or castle scene, elegant postcard-like framing.',
    'Bridge or valley infrastructure, geometric landscape composition.',
    'Energy peak: old town river view, warm roofs, quick highlight lift.',
    'Urban lake and wheel/interchange feeling, cooler color temperature.',
    'Blue-hour lake atmosphere, slow push with restrained cinematic contrast.',
    'Strongest energy peak: mountain pasture or castle view, brief shake and flash.',
    'Forest road or route-forward closing movement, travel journey continuation.',
    'Final cool scenic hold, clean landscape memory point before ending.',
  ]
  const motions: Array<'push_in' | 'zoom_in' | 'pan' | 'static'> = [
    'push_in',
    'zoom_in',
    'pan',
    'static',
    'push_in',
    'zoom_in',
    'zoom_in',
    'pan',
    'static',
    'pan',
    'push_in',
    'pan',
    'push_in',
    'zoom_in',
    'pan',
    'push_in',
  ]

  const scenes = sceneDurations.map(({ start, end }, index) => {
    const asset = imageAssets[index % imageAssets.length]
    const isLateCool = start >= 11
    const baseFilter = isLateCool
      ? 'saturate(1.08) contrast(1.08) brightness(0.95) hue-rotate(-5deg)'
      : 'saturate(1.16) contrast(1.1) brightness(0.98)'
    return scene({
      id: `seg_${String(index + 1).padStart(3, '0')}`,
      start,
      end,
      assetId: asset.id,
      role: 'landscape_beat_cut',
      vibe: index < 5 ? 'fresh_open_air' : index < 11 ? 'uplifting_alpine' : 'cool_cinematic_memory',
      prompt: prompts[index] ?? grounding.style_summary?.editing_pattern ?? 'Beat-synced alpine landscape cut.',
      motion: motions[index] ?? 'push_in',
      effects: effectForScene(start, end, hints, baseFilter),
      includeAudio: true,
    })
  })

  return {
    version: '1.0',
    task_id: taskId,
    strategy: 'montage',
    duration_sec: duration,
    canvas: {
      width: hints.metadata?.width ?? 1280,
      height: hints.metadata?.height ?? 720,
      fps: hints.metadata?.fps ?? 30,
      ratio: '16:9',
    },
    assets: [
      ...imageAssets,
      {
        id: 'sample_audio_1',
        type: 'audio',
        name: '1.mp4 audio reference',
        url: samplePath,
        duration_sec: hints.metadata?.video_duration,
        source: 'user_material',
      },
    ],
    scenes,
    transitions: scenes.slice(0, -1).map((current, index) => ({
      id: `tr_${String(index + 1).padStart(3, '0')}`,
      from_anchor_id: current.source_anchor_id,
      to_anchor_id: scenes[index + 1].source_anchor_id,
      at_sec: current.end_sec,
      presentation: 'cut',
      duration_sec: 0,
      timing: { type: 'linear' },
      overlay: { type: 'flash', intensity: index === 4 || index === 10 || index === 13 ? 0.12 : 0 },
    })),
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
  const hints = JSON.parse(await readFile(hintsPath, 'utf8')) as AudioVisualHints
  const grounding = JSON.parse(await readFile(groundingPath, 'utf8')) as GroundingResult
  const imageAssets = await loadImages()
  if (!imageAssets.length) throw new Error(`No image materials found in ${imageDir}`)

  const remotionRoot = path.join(repoRoot, 'remotion')
  let plan = buildPlan(imageAssets, hints, grounding)
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

  console.info('[experiment-render-video1-grounded] OK')
  console.info(
    JSON.stringify(
      {
        taskId,
        styleFamily: grounding.style_summary?.style_family,
        imageCount: imageAssets.length,
        planPath,
        outputPath: result.outputPath,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[experiment-render-video1-grounded] FAILED')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
