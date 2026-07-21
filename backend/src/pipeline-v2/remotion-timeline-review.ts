import type {
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
}

export interface V2TimelinePlanningReview {
  schema_version: 'v2_timeline_planning_review.v1'
  risk_level: 'low' | 'medium' | 'high'
  summary_zh: string
  metrics: {
    scene_count: number
    user_video_scene_count: number
    ai_video_scene_count: number
    remotion_scene_count: number
    transition_count: number
    overlay_count: number
    material_job_count: number
    planned_generate_video_count: number
    planned_generate_video_sec: number
  }
  scenes: V2TimelineSceneReviewItem[]
  warnings_zh: string[]
  next_actions_zh: string[]
}

function ownerForScene(scene: RemotionTimelineScene): string {
  if (scene.type === 'ai_video') return '视频生成模型'
  if (scene.type === 'user_video') return '用户素材'
  return 'Remotion'
}

function sourceForScene(scene: RemotionTimelineScene): string {
  if (scene.type === 'ai_video') return scene.asset_id ? `生成素材 ${scene.asset_id}` : '待生成素材'
  if (scene.type === 'user_video') return scene.asset_id ? `用户素材 ${scene.asset_id}` : '用户素材'
  if (scene.type === 'image_motion') return scene.asset_id ? `图片素材 ${scene.asset_id}` : '图片动效'
  return '程序化图文场景'
}

function roleLabel(scene: RemotionTimelineScene): string {
  const labels: Record<string, string> = {
    hook: '开场吸引',
    proof: '证明/展示',
    feature: '卖点承接',
    transition: '节奏过渡',
    cta: '收束行动',
  }
  return labels[scene.visual_role ?? 'feature'] ?? '内容镜头'
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
  const sceneById = new Map(input.spec.scenes.map((scene) => [scene.id, scene]))
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
      return {
        id: scene.id,
        type: scene.type,
        owner_zh: ownerForScene(scene),
        source_zh: sourceForScene(scene),
        role_zh: roleLabel(scene),
        start_sec: Number(scene.start_sec.toFixed(3)),
        duration_sec: Number(scene.duration_sec.toFixed(3)),
        transition_after: transition ? `${transition.type} / ${transition.duration_sec}s` : undefined,
      }
    })

  const remotionSceneCount = input.spec.scenes.filter(
    (scene) => scene.type !== 'user_video' && scene.type !== 'ai_video',
  ).length
  const level = riskLevel({
    plannedGenerateVideoCount: generateVideoJobs.length,
    plannedGenerateVideoSec,
    warningCount: warnings.length,
  })

  return {
    schema_version: 'v2_timeline_planning_review.v1',
    risk_level: level,
    summary_zh: `本方案包含 ${input.spec.scenes.length} 个镜头，其中 ${remotionSceneCount} 个由 Remotion 程序化生成，${generateVideoJobs.length} 个计划调用视频生成模型。Remotion 负责时间线、转场、字幕与图文表现，真实复杂画面由素材或视频模型提供。`,
    metrics: {
      scene_count: input.spec.scenes.length,
      user_video_scene_count: input.spec.scenes.filter((scene) => scene.type === 'user_video').length,
      ai_video_scene_count: input.spec.scenes.filter((scene) => scene.type === 'ai_video').length,
      remotion_scene_count: remotionSceneCount,
      transition_count: input.spec.transitions.length,
      overlay_count: input.spec.overlays.length,
      material_job_count: input.spec.material_jobs.length,
      planned_generate_video_count: generateVideoJobs.length,
      planned_generate_video_sec: Number(plannedGenerateVideoSec.toFixed(3)),
    },
    scenes,
    warnings_zh: warnings,
    next_actions_zh: [
      '先确认分镜结构、素材来源和转场是否符合预期。',
      '确认后再进入素材生成和 Remotion 完整时间线渲染。',
      '如果某个镜头需要真实复杂画面，应将该镜头标记为 ai_video，而不是让 Remotion 硬模拟。',
    ],
  }
}

export function renderV2TimelinePlanningReviewMarkdown(review: V2TimelinePlanningReview): string {
  const sceneRows = review.scenes
    .map(
      (scene, index) =>
        `${index + 1}. ${scene.id}：${scene.owner_zh}，${scene.role_zh}，${scene.start_sec}-${Number(
          (scene.start_sec + scene.duration_sec).toFixed(3),
        )}s，来源：${scene.source_zh}${scene.transition_after ? `，后接转场：${scene.transition_after}` : ''}`,
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
    `- AI 视频镜头：${review.metrics.ai_video_scene_count}`,
    `- Remotion 程序化镜头：${review.metrics.remotion_scene_count}`,
    `- 转场数：${review.metrics.transition_count}`,
    `- overlay 数：${review.metrics.overlay_count}`,
    `- 计划视频生成任务：${review.metrics.planned_generate_video_count}`,
    `- 计划视频生成时长：${review.metrics.planned_generate_video_sec}s`,
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
