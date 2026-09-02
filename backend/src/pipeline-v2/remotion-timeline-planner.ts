import { createHash } from 'node:crypto'
import path from 'node:path'

import { assertValidRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import {
  REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  type RemotionTimelineAsset,
  type RemotionTimelineMaterialJob,
  type RemotionTimelineOverlay,
  type RemotionTimelineScene,
  type RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2PlannerInput } from './v2-input.js'

export interface V2RemotionTimelinePlannerInput extends V2PlannerInput {
  imageSrc?: string
}

const MAX_TIMELINE_SCENES = 12

function creationModeFor(input: V2RemotionTimelinePlannerInput): NonNullable<V2RemotionTimelinePlannerInput['creationMode']> {
  if (input.creationMode) return input.creationMode
  if (input.sampleUnderstanding || input.referenceVideoPath) return 'sample_replicate'
  if (input.materials?.some((material) => material.type === 'image' || material.type === 'video')) {
    return 'material_brief'
  }
  return 'text_to_video'
}

function resolveRepoPath(value: string): string {
  if (/^https?:\/\//i.test(value) || value.startsWith('static:')) return value
  if (path.isAbsolute(value)) return value
  return path.resolve(process.cwd(), '..', value)
}

function textFromPrompt(prompt: string): {
  title: string
  subtitle: string
  body: string
} {
  const trimmed = prompt.trim()
  if (!trimmed) {
    return {
      title: '风格化时间线方案',
      subtitle: '按素材编排镜头、动效和转场',
      body: '基于用户的创作要求安排画面、运镜、转场和文字层。',
    }
  }
  return {
    title: trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed,
    subtitle: '按当前输入生成的分镜方案',
    body: '基于用户的创作要求安排画面、运镜、转场和文字层。',
  }
}

function structuredSegmentCount(prompt: string): number | undefined {
  const matches = prompt.match(/^\s*片段\s*\d+\s*[:：]/gm)
  return matches?.length ? Math.min(MAX_TIMELINE_SCENES, matches.length) : undefined
}

function durationFromFrameRanges(prompt: string, fps: number): number | undefined {
  const matches = [...prompt.matchAll(/第\s*(\d+)\s*[-—~至]\s*(\d+)\s*帧/g)]
  const maxFrame = matches.reduce((max, match) => Math.max(max, Number(match[2] ?? 0)), 0)
  return maxFrame > 0 && fps > 0 ? Number((maxFrame / fps).toFixed(3)) : undefined
}

function legacyImageAssetId(source: string): string {
  return `mat_${createHash('sha256').update(source).digest('hex').slice(0, 16)}`
}

function materialLabel(input: { name?: string; id: string; type: string }): string {
  return input.name?.trim() || `${input.type} ${input.id}`
}

function buildPlannerAssets(input: V2RemotionTimelinePlannerInput): RemotionTimelineAsset[] {
  if (input.materials?.length) {
    return input.materials.map((material) => ({
      id: material.id,
      type: material.type,
      src: resolveRepoPath(material.src),
      source: 'user_asset',
      label: materialLabel(material),
    }))
  }

  const assets: RemotionTimelineAsset[] = []
  if (input.mainVideoPath) {
    assets.push({
      id: 'main_video_asset',
      type: 'video',
      src: resolveRepoPath(input.mainVideoPath),
      source: 'user_asset',
      label: 'User main video',
    })
  }
  if (input.imageSrc || input.inputImageUrl) {
    assets.push({
      id: legacyImageAssetId(input.imageSrc ?? input.inputImageUrl as string),
      type: 'image',
      src: input.imageSrc ? resolveRepoPath(input.imageSrc) : input.inputImageUrl as string,
      source: input.imageSrc ? 'user_asset' : 'stock_asset',
      label: 'Planner image asset',
    })
  }
  return assets
}

function parseRequestedSceneCount(prompt: string): number | undefined {
  const arabic = prompt.match(/(\d{1,2})\s*(段|个镜头|镜头|个场景|场景|幕|scene|scenes)/i)
  if (arabic) return Number(arabic[1])
  const zhMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }
  const zh = prompt.match(/([一二两三四五六七八九十])\s*(段|个镜头|镜头|个场景|场景|幕)/)
  return zh ? zhMap[zh[1]!] : undefined
}

function distributeDurations(durationSec: number, count: number): number[] {
  const base = durationSec / count
  return Array.from({ length: count }, (_, index) => {
    if (index === count - 1) {
      const used = Number((base * (count - 1)).toFixed(3))
      return Number((durationSec - used).toFixed(3))
    }
    return Number(base.toFixed(3))
  })
}

function roleForIndex(index: number, count: number): RemotionTimelineScene['visual_role'] {
  if (index === 0) return 'hook'
  if (index === count - 1) return 'cta'
  if (index === Math.floor(count / 2)) return 'proof'
  return 'feature'
}

function titleForRole(role: RemotionTimelineScene['visual_role'], index: number): string {
  const labels: Record<NonNullable<RemotionTimelineScene['visual_role']>, string> = {
    hook: '开篇引入',
    proof: '重点展开',
    feature: '内容推进',
    transition: '衔接过渡',
    cta: '结尾收束',
  }
  return labels[role ?? 'feature'] ?? `镜头 ${index + 1}`
}

function motionText(index: number): string {
  return index % 2 === 0 ? '缓慢推近' : '缓慢拉远'
}

function sceneBodyForAsset(input: {
  assetLabel?: string
  title: string
  motion: string
  copyBody: string
}) {
  const label = input.assetLabel?.trim() || '当前素材'
  return `主画面使用 ${label}，以${input.motion}呈现，承担“${input.title}”这一镜头功能。${input.copyBody}`
}

function sampleMethodContext(input: V2RemotionTimelinePlannerInput): string {
  const understanding = input.sampleUnderstanding
  if (!understanding || understanding.source !== 'llm') return ''
  const knowledge = understanding.transferable_knowledge.slice(0, 4).map((item) => item.statement)
  const methods = understanding.method_observations.slice(0, 4).map((item) => (
    `${item.expression}（目的：${item.purpose}；时机：${item.timing_rationale}）`
  ))
  const selected = knowledge.length ? knowledge : methods
  return selected.length ? `可按当前任务适配的样例方法：${selected.join('；')}` : ''
}

function transitionTypeForIndex(index: number): 'cut' | 'fade' | 'slide' | 'wipe' | 'light_flash' {
  return (['fade', 'slide', 'light_flash', 'wipe'] as const)[index % 4]
}

export function buildDeterministicRemotionTimelineSpec(
  input: V2RemotionTimelinePlannerInput,
): RemotionTimelineSpecV1 {
  const creationMode = creationModeFor(input)
  const width = input.canvas?.width ?? 720
  const height = input.canvas?.height ?? 1280
  const fps = input.canvas?.fps ?? 24
  const copy = textFromPrompt(input.prompt)
  const assets = buildPlannerAssets(input)
  const visualAssets = assets.filter((asset) => asset.type === 'video' || asset.type === 'image')
  const conditioningImageAssetId = assets.find((asset) => asset.type === 'image')?.id
  const requestedSceneCount = parseRequestedSceneCount(input.prompt)
  const segmentCount = structuredSegmentCount(input.prompt)
  const neutralSampleSceneCount = Math.max(4, Math.min(
    8,
    Math.round((input.durationSec ?? input.sampleUnderstanding?.sample.duration_sec ?? 12) / 2.5),
  ))
  const defaultSceneCount = creationMode === 'sample_replicate'
      ? neutralSampleSceneCount
      : visualAssets.length
        ? Math.min(MAX_TIMELINE_SCENES, Math.max(3, visualAssets.length))
        : 3
  const sceneCount = Math.max(
    1,
    Math.min(
      MAX_TIMELINE_SCENES,
      requestedSceneCount ??
        segmentCount ??
        defaultSceneCount,
    ),
  )
  const durationSec =
    input.durationSec ??
    durationFromFrameRanges(input.prompt, fps) ??
    Math.max(6, Number((sceneCount * 1.5).toFixed(3)))
  const durations = distributeDurations(durationSec, sceneCount)
  const scenes: RemotionTimelineScene[] = []
  const overlays: RemotionTimelineOverlay[] = []
  const materialJobs: RemotionTimelineMaterialJob[] = []
  const mainSceneAssets = new Set<string>()
  const sampleMethods = sampleMethodContext(input)
  let cursor = 0

  for (let index = 0; index < sceneCount; index += 1) {
    const start = Number(cursor.toFixed(3))
    const duration = durations[index]!
    const asset = creationMode === 'sample_replicate'
      ? visualAssets[index]
      : visualAssets[index % Math.max(visualAssets.length, 1)]
    const role = roleForIndex(index, sceneCount)
    const sceneId = `scene_${String(index + 1).padStart(3, '0')}`
    const baseTitle = titleForRole(role, index)
    const title = baseTitle
    const body = creationMode === 'sample_replicate'
      ? [copy.body, sampleMethods].filter(Boolean).join(' ')
      : copy.body

    if (asset?.type === 'video') {
      scenes.push({
        id: sceneId,
        type: 'user_video',
        start_sec: start,
        duration_sec: duration,
        asset_id: asset.id,
        fit: 'cover',
        creative_intent: {
          title,
          material_label: asset.label ?? '用户视频素材',
          description: sceneBodyForAsset({
            assetLabel: asset.label,
            title,
            motion: '沿用素材原始运动',
            copyBody: body,
          }),
        },
        visual_role: role,
      })
      mainSceneAssets.add(asset.id)
      materialJobs.push({
        id: `job_reuse_${sceneId}`,
        scene_id: sceneId,
        type: 'reuse_asset',
        status: 'fulfilled',
        output_asset_id: asset.id,
        provider: 'none',
        fallback_kind: 'none',
      })
    } else if (asset?.type === 'image') {
      const motion = index % 2 === 0 ? 'slow_zoom_in' : 'slow_zoom_out'
      scenes.push({
        id: sceneId,
        type: 'image_motion',
        start_sec: start,
        duration_sec: duration,
        asset_id: asset.id,
        fit: 'cover',
        motion,
        creative_intent: {
          title,
          material_label: asset.label ?? '用户图片素材',
          description: sceneBodyForAsset({
            assetLabel: asset.label,
            title,
            motion: motionText(index),
            copyBody: body,
          }),
        },
        visual_role: role,
      })
      mainSceneAssets.add(asset.id)
      materialJobs.push({
        id: `job_reuse_${sceneId}`,
        scene_id: sceneId,
        type: 'reuse_asset',
        status: 'fulfilled',
        output_asset_id: asset.id,
        provider: 'none',
        fallback_kind: 'none',
      })
    } else {
      const generateMissingFootage = creationMode === 'text_to_video' || creationMode === 'sample_replicate'
      scenes.push({
        id: sceneId,
        type: 'remotion_card',
        start_sec: start,
        duration_sec: duration,
        title: index === 0 ? copy.title : title,
        subtitle: generateMissingFootage ? '视频模型待生成' : copy.subtitle,
        body,
        accent_color: index % 2 === 0 ? '#38bdf8' : '#f59e0b',
        visual_role: role,
        creative_intent: { title, description: body },
      })
      if (generateMissingFootage) {
        materialJobs.push({
          id: `job_generate_${sceneId}`,
          scene_id: sceneId,
          type: 'generate_video',
          status: 'planned',
          prompt: [
            copy.title,
            `镜头作用：${baseTitle}`,
            '生成写实、连贯的视频画面，明确主体、环境、光线、动作和镜头运动',
          ]
            .filter(Boolean)
            .join('；'),
          output_asset_id: `generated_${sceneId}`,
          input_asset_id: conditioningImageAssetId,
          provider: 'ark_seedance',
          fallback_kind: 'none',
        })
      }
    }

    cursor += duration
  }

  const unusedImageAssets = visualAssets.filter(
    (asset) => asset.type === 'image' && !mainSceneAssets.has(asset.id),
  )
  unusedImageAssets.forEach((asset, index) => {
    const targetScene = scenes[index % scenes.length]
    if (!targetScene) return
    overlays.push({
      id: `image_badge_${String(index + 1).padStart(3, '0')}`,
      type: 'image_badge',
      scene_id: targetScene.id,
      start_sec: targetScene.start_sec + 0.15,
      end_sec: targetScene.start_sec + Math.max(0.35, targetScene.duration_sec - 0.15),
      asset_id: asset.id,
      x_pct: index % 2 === 0 ? 84 : 16,
      y_pct: index % 3 === 0 ? 20 : 76,
      width_pct: 20,
      height_pct: 20,
      opacity: 0.9,
      animation: 'pop',
    })
  })

  const spec: RemotionTimelineSpecV1 = {
    schema_version: REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
    task_id: input.taskId,
    creative_brief: {
      direction: input.prompt.trim() || 'Create an editable video plan from the current project facts.',
      image_references: assets
        .filter((asset) => asset.type === 'image')
        .map((asset) => ({
          asset_id: asset.id,
          observed_facts: [],
          intended_use: 'Use the original image as the authoritative visual reference.',
        })),
      sample_methods: input.sampleUnderstanding?.source === 'llm'
        ? (input.sampleUnderstanding.transferable_knowledge.length
            ? input.sampleUnderstanding.transferable_knowledge.slice(0, 6).map((item) => item.statement)
            : input.sampleUnderstanding.method_observations.slice(0, 6).map((item) => item.expression))
        : [],
      applied_preferences: [],
    },
    canvas: {
      width,
      height,
      fps,
      duration_sec: durationSec,
      background: '#09090b',
    },
    assets,
    scenes,
    transitions: scenes.slice(0, -1).map((scene, index) => ({
      id: `transition_${String(index + 1).padStart(3, '0')}`,
      from_scene_id: scene.id,
      to_scene_id: scenes[index + 1]!.id,
      type: transitionTypeForIndex(index),
      duration_sec:
        transitionTypeForIndex(index) === 'cut'
          ? 0
          : Math.min(0.35, scene.duration_sec / 3, scenes[index + 1]!.duration_sec / 3),
      direction: index % 2 === 0 ? 'from-right' : 'from-left',
    })),
    overlays,
    material_jobs: materialJobs,
    render_policy: {
      renderer: 'remotion_timeline',
      fallback_renderer: 'overlay_compose',
    },
    notes: [
      'Deterministic timeline planner uses Remotion for scene composition and does not generate custom components.',
      'Deterministic planning preserves explicit user caption requirements but does not infer captions from image content.',
      input.materials?.length
        ? `Received ${input.materials.length} user materials; visual materials are promoted to main scenes by default, with image_badge only used when the requested scene count is smaller than the material count.`
        : 'No material array was provided; legacy single-asset fields were used.',
      `Creation mode: ${creationMode}.`,
    ],
  }

  return assertValidRemotionTimelineSpec(spec)
}
