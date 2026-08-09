import type {
  RemotionTimelineMaterialJob,
  RemotionTimelineScene,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { RemotionTimelineValidationReport } from '../../../shared/lib/remotion-timeline-validator.js'

export interface V2TimelineSceneReviewItem {
  id: string
  type: string
  owner_zh: string
  source_zh: string
  role_zh: string
  start_sec: number
  duration_sec: number
  transition_after?: string
  title_zh?: string
  description_zh?: string
  asset_id?: string
  asset_label_zh?: string
  motion_zh?: string
  visual_state_zh: string
  overlay_texts_zh?: string[]
  material_usage_zh?: string
}

export interface V2TimelinePlanningReview {
  schema_version: 'v2_timeline_planning_review.v1'
  risk_level: 'low' | 'medium' | 'high'
  summary_zh: string
  metrics: {
    scene_count: number
    user_video_scene_count: number
    /** 已经解析为 ai_video 节点、可由渲染器直接引用的镜头。 */
    ai_video_scene_count: number
    /** 没有生成任务的纯 Remotion 程序化镜头。 */
    remotion_scene_count: number
    /** 计划生成视频的镜头数；preview 阶段可能尚未有 ai_video 节点。 */
    planned_ai_video_scene_count: number
    /** 计划 AI 视频、但当前仍以 Remotion 卡片作为待生成或失败兜底的镜头数。 */
    remotion_preview_fallback_scene_count: number
    transition_count: number
    overlay_count: number
    material_job_count: number
    planned_generate_video_count: number
    planned_generate_video_sec: number
    asset_count: number
    visual_asset_count: number
    used_visual_asset_count: number
    main_scene_visual_asset_count: number
    unused_visual_asset_count: number
  }
  scenes: V2TimelineSceneReviewItem[]
  warnings_zh: string[]
  next_actions_zh: string[]
}

function ownerForScene(
  scene: RemotionTimelineScene,
  generationJob?: RemotionTimelineMaterialJob,
): string {
  if (scene.type === 'ai_video') return '视频生成模型'
  if (generationJob?.status === 'planned') return '视频生成模型（待生成）'
  if (scene.type === 'user_video') return '用户素材'
  return 'Remotion'
}

function sourceForScene(
  scene: RemotionTimelineScene,
  generationJob?: RemotionTimelineMaterialJob,
): string {
  if (scene.type === 'ai_video') return scene.asset_id ? `生成素材 ${scene.asset_id}` : '待解析 AI 视频素材'
  if (generationJob) {
    return generationJob.status === 'planned' && generationJob.output_asset_id
      ? `计划生成素材 ${generationJob.output_asset_id}`
      : generationJob.status === 'planned'
        ? '计划调用视频生成模型'
        : '视频生成未解析为可用素材'
  }
  if (scene.type === 'user_video') return scene.asset_id ? `用户素材 ${scene.asset_id}` : '用户素材'
  if (scene.type === 'image_motion') return scene.asset_id ? `图片素材 ${scene.asset_id}` : '图片动效'
  return '程序化图文场景'
}

function roleLabel(scene: RemotionTimelineScene): string {
  const labels: Record<string, string> = {
    hook: '开篇引入',
    proof: '重点展开',
    feature: '内容推进',
    transition: '衔接过渡',
    cta: '结尾收束',
  }
  return labels[scene.visual_role ?? 'feature'] ?? '内容镜头'
}

function motionLabel(
  scene: RemotionTimelineScene,
  generationJob?: RemotionTimelineMaterialJob,
): string {
  if (scene.type === 'ai_video') return '由视频生成模型负责真实画面运动，Remotion 负责时间线承接。'
  if (generationJob?.status === 'planned') return '待视频生成模型生成真实画面运动；Remotion 当前只负责预览兜底、字幕和转场。'
  if (scene.type === 'user_video') return '沿用视频素材原始运动，并由 Remotion 负责裁切适配。'
  if (scene.type === 'image_motion') {
    const labels: Record<string, string> = {
      none: '静态图层',
      slow_zoom_in: '缓慢推近',
      slow_zoom_out: '缓慢拉远',
      pan_left: '向左平移',
      pan_right: '向右平移',
    }
    return labels[scene.motion ?? 'none'] ?? scene.motion ?? '图片动效'
  }
  return 'Remotion 程序化图文动效。'
}

function visualStateLabel(
  scene: RemotionTimelineScene,
  generationJob?: RemotionTimelineMaterialJob,
): string {
  if (generationJob?.status === 'planned' && scene.type !== 'ai_video') {
    return '待生成 AI 视频；当前预览使用 Remotion 兜底卡片。'
  }
  if (scene.type === 'ai_video') return '已解析 AI 视频素材，可直接进入渲染。'
  if (generationJob) return '视频生成未解析为可用素材；当前使用 Remotion 兜底卡片。'
  if (scene.type === 'user_video') return '使用用户视频素材。'
  return '纯 Remotion 程序化画面。'
}

function riskLevel(input: {
  plannedGenerateVideoCount: number
  plannedGenerateVideoSec: number
  warningCount: number
}): V2TimelinePlanningReview['risk_level'] {
  if (input.plannedGenerateVideoCount >= 4 || input.plannedGenerateVideoSec > 12) return 'high'
  if (input.plannedGenerateVideoCount > 0 || input.warningCount > 0) return 'medium'
  return 'low'
}

export function buildV2TimelinePlanningReview(input: {
  spec: RemotionTimelineSpecV1
  validation: RemotionTimelineValidationReport
}): V2TimelinePlanningReview {
  const generateVideoJobs = input.spec.material_jobs.filter((job) => job.type === 'generate_video')
  const generateVideoJobBySceneId = new Map(
    generateVideoJobs.map((job) => [job.scene_id, job]),
  )
  const sceneById = new Map(input.spec.scenes.map((scene) => [scene.id, scene]))
  const assetById = new Map(input.spec.assets.map((asset) => [asset.id, asset]))
  const visualAssets = input.spec.assets.filter((asset) => asset.type === 'video' || asset.type === 'image')
  const usedVisualAssetIds = new Set<string>()
  const mainSceneVisualAssetIds = new Set<string>()
  const plannedGenerateVideoSec = generateVideoJobs.reduce((sum, job) => {
    const scene = sceneById.get(job.scene_id)
    return sum + (scene?.duration_sec ?? 0)
  }, 0)
  const warnings = input.validation.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => `结构提示：${issue.path} ${issue.message}`)

  if (generateVideoJobs.some((job) => !job.fallback_asset_id && job.fallback_kind === 'none')) {
    warnings.push('部分视频生成镜头未声明有效兜底，生成失败时可能需要用户确认。')
  }

  const scenes = input.spec.scenes
    .slice()
    .sort((a, b) => a.start_sec - b.start_sec)
    .map((scene) => {
      const transition = input.spec.transitions.find((item) => item.from_scene_id === scene.id)
      const generationJob = generateVideoJobBySceneId.get(scene.id)
      const asset = scene.asset_id ? assetById.get(scene.asset_id) : undefined
      const generationInputAsset = generationJob?.input_asset_id
        ? assetById.get(generationJob.input_asset_id)
        : undefined
      if (asset && (asset.type === 'video' || asset.type === 'image')) {
        usedVisualAssetIds.add(asset.id)
        mainSceneVisualAssetIds.add(asset.id)
      }
      if (generationInputAsset?.type === 'image') usedVisualAssetIds.add(generationInputAsset.id)
      const sceneOverlays = input.spec.overlays.filter((overlay) => overlay.scene_id === scene.id)
      for (const overlay of sceneOverlays) {
        const overlayAsset = overlay.asset_id ? assetById.get(overlay.asset_id) : undefined
        if (overlayAsset && (overlayAsset.type === 'video' || overlayAsset.type === 'image')) {
          usedVisualAssetIds.add(overlayAsset.id)
        }
      }
      return {
        id: scene.id,
        type: scene.type,
        owner_zh: ownerForScene(scene, generationJob),
        source_zh: sourceForScene(scene, generationJob),
        role_zh: roleLabel(scene),
        start_sec: Number(scene.start_sec.toFixed(3)),
        duration_sec: Number(scene.duration_sec.toFixed(3)),
        transition_after: transition ? `${transition.type} / ${transition.duration_sec}s` : undefined,
        title_zh: scene.creative_intent?.title ?? scene.title,
        description_zh: [
          scene.creative_intent?.description ?? scene.body,
          scene.note,
          generationJob?.prompt ? `模型创作提示：${generationJob.prompt}` : undefined,
        ]
          .filter(Boolean)
          .join('；'),
        asset_id: scene.asset_id,
        asset_label_zh:
          scene.creative_intent?.material_label ?? asset?.label ?? asset?.id,
        motion_zh: motionLabel(scene, generationJob),
        visual_state_zh: visualStateLabel(scene, generationJob),
        overlay_texts_zh: sceneOverlays
          .filter((overlay) => overlay.text)
          .map((overlay) => overlay.text!)
          .slice(0, 4),
        material_usage_zh: generationJob
          ? 'run 阶段将调用视频生成模型；失败时按该任务声明的 fallback 处理'
          : asset
          ? `主画面使用 ${asset.label ?? asset.id}`
          : sceneOverlays.some((overlay) => overlay.asset_id)
            ? '素材作为覆盖层进入本镜头'
            : '未使用外部视觉素材',
      }
    })

  const plannedAiVideoSceneIds = new Set(generateVideoJobs.map((job) => job.scene_id))
  const resolvedAiVideoSceneCount = input.spec.scenes.filter((scene) => scene.type === 'ai_video').length
  const remotionPreviewFallbackSceneCount = input.spec.scenes.filter(
    (scene) => scene.type !== 'ai_video' && plannedAiVideoSceneIds.has(scene.id),
  ).length
  const remotionSceneCount = input.spec.scenes.filter(
    (scene) =>
      scene.type !== 'user_video' &&
      scene.type !== 'ai_video' &&
      !plannedAiVideoSceneIds.has(scene.id),
  ).length
  const unusedVisualAssets = visualAssets.filter((asset) => !usedVisualAssetIds.has(asset.id))
  if (unusedVisualAssets.length) {
    warnings.push(
      `仍有 ${unusedVisualAssets.length} 个视觉素材未进入方案：${unusedVisualAssets
        .slice(0, 8)
        .map((asset) => asset.label ?? asset.id)
        .join('、')}。`,
    )
  }
  const level = riskLevel({
    plannedGenerateVideoCount: generateVideoJobs.length,
    plannedGenerateVideoSec,
    warningCount: warnings.length,
  })

  return {
    schema_version: 'v2_timeline_planning_review.v1',
    risk_level: level,
    summary_zh: `这版方案包含 ${input.spec.scenes.length} 个镜头，主画面使用了 ${mainSceneVisualAssetIds.size}/${visualAssets.length} 个视觉素材；${plannedAiVideoSceneIds.size} 个镜头计划调用视频生成模型，其中 ${remotionPreviewFallbackSceneCount} 个在当前预览阶段暂由 Remotion 兜底卡片承载。生成任务成功解析后，这些镜头会切换为 AI 视频；纯 Remotion 画面只统计没有视频生成任务的镜头。`,
    metrics: {
      scene_count: input.spec.scenes.length,
      user_video_scene_count: input.spec.scenes.filter((scene) => scene.type === 'user_video').length,
      ai_video_scene_count: resolvedAiVideoSceneCount,
      remotion_scene_count: remotionSceneCount,
      planned_ai_video_scene_count: plannedAiVideoSceneIds.size,
      remotion_preview_fallback_scene_count: remotionPreviewFallbackSceneCount,
      transition_count: input.spec.transitions.length,
      overlay_count: input.spec.overlays.length,
      material_job_count: input.spec.material_jobs.length,
      planned_generate_video_count: generateVideoJobs.length,
      planned_generate_video_sec: Number(plannedGenerateVideoSec.toFixed(3)),
      asset_count: input.spec.assets.length,
      visual_asset_count: visualAssets.length,
      used_visual_asset_count: usedVisualAssetIds.size,
      main_scene_visual_asset_count: mainSceneVisualAssetIds.size,
      unused_visual_asset_count: unusedVisualAssets.length,
    },
    scenes,
    warnings_zh: warnings,
    next_actions_zh: [
      '先确认分镜结构、素材来源和转场是否符合预期。',
      '确认后再进入素材生成和 Remotion 完整时间线渲染。',
      '预览中的 Remotion 兜底卡片不代表最终视觉策略；视频生成任务成功后会解析为 ai_video 镜头。',
    ],
  }
}

export function renderV2TimelinePlanningReviewMarkdown(review: V2TimelinePlanningReview): string {
  const sceneRows = review.scenes
    .map(
      (scene, index) =>
        `${index + 1}. ${scene.id}：${scene.owner_zh}，${scene.role_zh}，${scene.start_sec}-${Number(
          (scene.start_sec + scene.duration_sec).toFixed(3),
        )}s，来源：${scene.source_zh}，状态：${scene.visual_state_zh}${scene.transition_after ? `，后接转场：${scene.transition_after}` : ''}`,
    )
    .join('\n')
  const warnings = review.warnings_zh.length
    ? review.warnings_zh.map((item) => `- ${item}`).join('\n')
    : '- 暂无明显结构风险。'
  const actions = review.next_actions_zh.map((item) => `- ${item}`).join('\n')
  return [
    '# V2 Timeline 分镜审查',
    '',
    `风险等级：${review.risk_level}`,
    '',
    review.summary_zh,
    '',
    '## 分镜',
    '',
    sceneRows,
    '',
    '## 指标',
    '',
    `- 镜头数：${review.metrics.scene_count}`,
    `- 用户视频镜头：${review.metrics.user_video_scene_count}`,
    `- 已解析 AI 视频镜头：${review.metrics.ai_video_scene_count}`,
    `- 计划 AI 视频镜头：${review.metrics.planned_ai_video_scene_count}`,
    `- 当前 Remotion 兜底镜头（待生成或失败）：${review.metrics.remotion_preview_fallback_scene_count}`,
    `- 纯 Remotion 程序化镜头：${review.metrics.remotion_scene_count}`,
    `- 转场数：${review.metrics.transition_count}`,
    `- overlay 数：${review.metrics.overlay_count}`,
    `- 计划视频生成任务：${review.metrics.planned_generate_video_count}`,
    `- 计划视频生成时长：${review.metrics.planned_generate_video_sec}s`,
    `- 主画面视觉素材：${review.metrics.main_scene_visual_asset_count}/${review.metrics.visual_asset_count}`,
    `- 总视觉素材覆盖：${review.metrics.used_visual_asset_count}/${review.metrics.visual_asset_count}`,
    `- 未用视觉素材：${review.metrics.unused_visual_asset_count}`,
    '',
    '## 风险提示',
    '',
    warnings,
    '',
    '## 下一步',
    '',
    actions,
    '',
  ].join('\n')
}
