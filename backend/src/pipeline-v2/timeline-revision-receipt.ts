import type { DirectorTimelineRevisionIntent } from '../../../shared/types/director-stream.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'

const IMPACT = {
  subtitle: '文字、时间或呈现方式',
  scene: '叙事内容及对应生成要求',
  structure: '拆分、合并、顺序或时长',
  visual_strategy: '视觉策略及对应生成要求',
  transition: '类型、时长或自定义效果',
  global: '创作总纲或完整方案',
} as const

function seconds(value: number): string {
  return `${value.toFixed(1)}s`
}

function sceneName(scene: RemotionTimelineSpecV1['scenes'][number]): string {
  return scene.creative_intent?.title?.trim() || scene.title?.trim() || scene.note?.trim() || scene.id
}

function targetDisplay(
  scope: keyof typeof IMPACT,
  targetIds: string[],
  spec?: RemotionTimelineSpecV1,
): string[] {
  if (scope === 'global') return ['全片']
  if (!spec) return targetIds
  const scenes = new Map(spec.scenes.map((scene) => [scene.id, scene]))
  const overlays = new Map(spec.overlays.map((overlay) => [overlay.id, overlay]))
  const transitions = new Map(spec.transitions.map((transition) => [transition.id, transition]))
  return targetIds.map((id) => {
    const overlay = overlays.get(id)
    if (overlay) {
      const text = overlay.text?.trim() ? `“${overlay.text.trim()}”` : overlay.type
      return `${id} · ${text} · ${seconds(overlay.start_sec)}–${seconds(overlay.end_sec)}`
    }
    const transition = transitions.get(id)
    if (transition) {
      const from = scenes.get(transition.from_scene_id)
      const to = scenes.get(transition.to_scene_id)
      const fromEnd = from ? from.start_sec + from.duration_sec : 0
      return `${id} · ${from ? sceneName(from) : transition.from_scene_id} → ${to ? sceneName(to) : transition.to_scene_id} · ${seconds(Math.max(0, fromEnd - transition.duration_sec))}–${seconds(fromEnd)}`
    }
    const scene = scenes.get(id)
    if (scene) {
      return `${id} · ${sceneName(scene)} · ${seconds(scene.start_sec)}–${seconds(scene.start_sec + scene.duration_sec)}`
    }
    return id
  })
}

const BOUNDARY = {
  subtitle: '未选中的字幕及作用域外对象保持不变',
  scene: '非目标镜头及其素材、字幕、转场保持不变',
  structure: '目标范围外的镜头及依赖保持不变',
  visual_strategy: '目标镜头的叙事、时间、字幕及其他镜头保持不变',
  transition: '未选中的转场及镜头内容保持不变',
  global: '仅按明确的全局模式开放变更，仍需通过完整结构与资源校验',
} as const

export function buildV2TimelineRevisionIntent(input: {
  callId: string
  userRequest: string
  arguments: Record<string, unknown>
  baseSpec?: RemotionTimelineSpecV1
}): DirectorTimelineRevisionIntent | undefined {
  const scope = input.arguments.scope
  if (!Object.hasOwn(IMPACT, String(scope))) return undefined
  const typedScope = scope as keyof typeof IMPACT
  const targetIds = typedScope === 'subtitle'
    ? Array.isArray(input.arguments.overlayIds)
      ? input.arguments.overlayIds.filter((id): id is string => typeof id === 'string')
      : typeof input.arguments.sceneId === 'string' ? [input.arguments.sceneId] : []
    : typedScope === 'transition'
      ? Array.isArray(input.arguments.transitionIds)
        ? input.arguments.transitionIds.filter((id): id is string => typeof id === 'string')
        : []
      : typedScope === 'structure'
        ? Array.isArray(input.arguments.sceneIds)
          ? input.arguments.sceneIds.filter((id): id is string => typeof id === 'string')
          : []
        : typedScope === 'scene' || typedScope === 'visual_strategy'
          ? typeof input.arguments.sceneId === 'string' ? [input.arguments.sceneId] : []
          : []
  const display = targetDisplay(typedScope, targetIds, input.baseSpec)
  const target = display.length ? display.join('；') : '全片'
  return {
    callId: input.callId,
    originalRequest: input.userRequest,
    instruction: typeof input.arguments.instruction === 'string'
      ? input.arguments.instruction
      : input.userRequest,
    scope: typedScope,
    targetIds,
    targetDisplay: display,
    ...(typedScope === 'global' && (input.arguments.mode === 'brief_update' || input.arguments.mode === 'full_replan')
      ? { globalMode: input.arguments.mode }
      : {}),
    ...(typedScope === 'structure' && (input.arguments.durationMode === 'preserve_range' || input.arguments.durationMode === 'resize_timeline')
      ? { durationMode: input.arguments.durationMode }
      : {}),
    expectedImpact: `将调整 ${target} 的${IMPACT[typedScope]}`,
    protectedBoundary: BOUNDARY[typedScope],
  }
}
