import type { DirectorTimelineRevisionIntent } from '../../../shared/types/director-stream.js'

const IMPACT = {
  subtitle: '目标字幕的文字、时间或呈现方式',
  scene: '目标镜头的叙事内容及对应生成要求',
  structure: '目标连续镜头范围的拆分、合并、顺序或时长',
  visual_strategy: '目标镜头的视觉策略及对应生成要求',
  transition: '目标转场的类型、时长或自定义效果',
  global: '全片创作总纲或完整方案',
} as const

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
  return {
    callId: input.callId,
    originalRequest: input.userRequest,
    instruction: typeof input.arguments.instruction === 'string'
      ? input.arguments.instruction
      : input.userRequest,
    scope: typedScope,
    targetIds,
    ...(typedScope === 'global' && (input.arguments.mode === 'brief_update' || input.arguments.mode === 'full_replan')
      ? { globalMode: input.arguments.mode }
      : {}),
    ...(typedScope === 'structure' && (input.arguments.durationMode === 'preserve_range' || input.arguments.durationMode === 'resize_timeline')
      ? { durationMode: input.arguments.durationMode }
      : {}),
    expectedImpact: IMPACT[typedScope],
    protectedBoundary: BOUNDARY[typedScope],
  }
}
