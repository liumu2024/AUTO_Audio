import { z } from 'zod'

import type { DirectorConversationRuntime } from '../../../../shared/lib/director-understanding.js'
import type { DirectorContext } from '../../../../shared/types/director-context.js'
import type { DirectorWorkspaceState } from '../../../../shared/types/director-workspace-session.js'
import { materialJobMissingRequiredOutput } from '../../../../shared/lib/remotion-timeline-validator.js'
import { REMOTION_TIMELINE_TRANSITION_TYPES } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import { env } from '../../config/env.js'
import { evaluateExternalPublicationReadiness } from '../../modules/upload/asset-publisher.js'

export type V2AgentToolStatus = 'available' | 'planned' | 'disabled'
export type V2AgentToolMode = 'preview' | 'execute'
export type V2AgentToolEffect = 'read' | 'draft' | 'delivery'

export function resolveV2AgentSample(
  context: DirectorContext,
  runtime: DirectorConversationRuntime,
) {
  if (context.sampleVideo?.url?.trim()) return context.sampleVideo
  const candidates = (runtime.sampleCandidates ?? []).filter((candidate) => {
    if (!candidate.url.trim()) return false
    return context.materials.some((material) =>
      material.id === candidate.id
      && material.type === 'video'
      && material.url === candidate.url)
  })
  return candidates.length === 1 ? candidates[0] : undefined
}

export interface V2AgentToolDefinition {
  id: string
  name: string
  summary: string
  status: V2AgentToolStatus
  effect: V2AgentToolEffect
  cost: 'none' | 'low' | 'external'
  skills: string[]
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  requiresExplicitAuthorization: boolean
  recovery: string
}

const emptyArgumentsSchema = z.object({}).strict()
const sampleAnalyzeArgumentsSchema = emptyArgumentsSchema
const materialInspectArgumentsSchema = emptyArgumentsSchema
const timelinePlanArgumentsSchema = z.object({
  instruction: z.string().trim().min(1).max(4_000).optional(),
}).strict()
const patchInstructionSchema = z.string().trim().min(1).max(4_000).optional()
const timelinePatchArgumentsSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('subtitle'), sceneId: z.string().trim().min(1).max(200).optional(), instruction: patchInstructionSchema }).strict(),
  z.object({ scope: z.literal('scene'), sceneId: z.string().trim().min(1).max(200).optional(), instruction: patchInstructionSchema }).strict(),
  z.object({
    scope: z.literal('structure'),
    sceneIds: z.array(z.string().trim().min(1).max(200)).min(1).max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'sceneIds must be unique.'),
    instruction: patchInstructionSchema,
  }).strict(),
  z.object({ scope: z.literal('visual_strategy'), sceneId: z.string().trim().min(1).max(200).optional(), instruction: patchInstructionSchema }).strict(),
  z.object({
    scope: z.literal('transition'),
    transitionIds: z.array(z.string().trim().min(1).max(200)).min(1).max(20)
      .refine((ids) => new Set(ids).size === ids.length, 'transitionIds must be unique.'),
    instruction: patchInstructionSchema,
  }).strict(),
  z.object({ scope: z.literal('global'), instruction: patchInstructionSchema }).strict(),
])
const timelineRenderArgumentsSchema = emptyArgumentsSchema
const renderAuthorArgumentsSchema = z.object({
  purpose: z.enum(['scene', 'transition']),
  displayName: z.string().trim().min(1).max(80),
  effectBrief: z.string().trim().min(1).max(2_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
}).strict()

function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
}

const emptyInputSchema = jsonSchema(emptyArgumentsSchema)
const objectOutputSchema = { type: 'object', additionalProperties: true } as const
const sampleAnalyzeInputSchema = jsonSchema(sampleAnalyzeArgumentsSchema)
const materialInspectInputSchema = jsonSchema(materialInspectArgumentsSchema)
const timelinePlanInputSchema = jsonSchema(timelinePlanArgumentsSchema)
const timelinePatchInputSchema = jsonSchema(timelinePatchArgumentsSchema)
const timelineRenderInputSchema = jsonSchema(timelineRenderArgumentsSchema)
const renderAuthorInputSchema = jsonSchema(renderAuthorArgumentsSchema)

const toolArgumentSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {
  'sample.analyze': sampleAnalyzeArgumentsSchema,
  'material.inspect': materialInspectArgumentsSchema,
  'timeline.plan': timelinePlanArgumentsSchema,
  'timeline.patch': timelinePatchArgumentsSchema,
  'timeline.render': timelineRenderArgumentsSchema,
  'render.author': renderAuthorArgumentsSchema,
}

export interface V2AgentToolReadiness {
  toolId: string
  status: 'ready' | 'needs_authorization' | 'blocked'
  missing: Array<{ code: string; description: string }>
  alternatives: string[]
}

export function evaluateV2AgentToolReadiness(input: {
  toolId: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  workspace?: Pick<DirectorWorkspaceState, 'draftId' | 'baseRevision'>
  authorizationGranted?: boolean
  timelineSpec?: RemotionTimelineSpecV1
}): V2AgentToolReadiness {
  const blocked = (code: string, description: string, alternatives: string[] = []) => ({
    toolId: input.toolId,
    status: 'blocked' as const,
    missing: [{ code, description }],
    alternatives,
  })
  const tool = findV2AgentTool(input.toolId)
  if (!tool || tool.status !== 'available') return blocked('tool_unavailable', '当前 Tool 不可用。')
  if (!input.runtime.backendEnabled) return blocked('backend_unavailable', 'V2 后端当前不可用。')

  const hasDraft = Boolean(
    (input.workspace?.draftId ?? input.context.currentTimeline?.draftId)
      && (input.workspace?.baseRevision ?? input.context.currentTimeline?.currentRevision),
  )
  if (input.toolId === 'sample.analyze' && !resolveV2AgentSample(input.context, input.runtime)) {
    return blocked('sample_missing', '当前没有已选样例。', ['timeline.plan'])
  }
  if (input.toolId === 'material.inspect' && input.context.materials.length === 0) {
    return blocked('materials_missing', '当前没有已选素材。', ['timeline.plan'])
  }
  if (input.toolId === 'timeline.patch' && !hasDraft) {
    return blocked('draft_missing', '当前没有可修改的草稿。', ['timeline.plan'])
  }
  if (input.toolId === 'timeline.plan' && hasDraft) {
    return blocked('draft_already_exists', '当前已有可编辑草稿；结构或内容调整必须创建修订版本。', ['timeline.patch'])
  }
  if (input.toolId === 'timeline.render' && !hasDraft) {
    return blocked('draft_missing', '当前没有可交付的草稿。', ['timeline.plan'])
  }
  if (input.toolId === 'timeline.render' && input.timelineSpec) {
    const missing: V2AgentToolReadiness['missing'] = []
    const assetById = new Map(input.timelineSpec.assets.map((asset) => [asset.id, asset]))
    const assetIds = new Set(assetById.keys())
    for (const job of input.timelineSpec.material_jobs) {
      if (materialJobMissingRequiredOutput(job, assetIds)) {
        missing.push({
          code: 'material_output_missing',
          description: `镜头 ${job.scene_id} 的素材任务没有可用产物。`,
        })
        continue
      }
      if (job.status === 'failed') {
        missing.push({
          code: 'material_generation_failed',
          description: `镜头 ${job.scene_id} 的素材任务已经失败，需要修订或重新规划后再执行。`,
        })
        continue
      }
      if (job.status === 'fulfilled') {
        continue
      }
      if (job.type === 'request_user_material') {
        missing.push({ code: 'user_material_required', description: `镜头 ${job.scene_id} 仍需要用户素材。` })
        continue
      }
      if (job.type !== 'generate_video') continue
      const fallbackAsset = job.fallback_asset_id ? assetById.get(job.fallback_asset_id) : undefined
      const hasFallback = fallbackAsset?.type === 'video' || fallbackAsset?.type === 'image'
      if (hasFallback) continue
      if (env.v2VideoGenerationProvider !== 'ark-seedance') {
        missing.push({ code: 'generation_provider_unavailable', description: `镜头 ${job.scene_id} 需要生成视频，但当前未配置视频生成 Provider。` })
      }
      if (!job.input_asset_id) continue
      const asset = assetById.get(job.input_asset_id)
      if (!asset) {
        missing.push({ code: 'generation_input_missing', description: `镜头 ${job.scene_id} 引用的生成输入素材不存在。` })
        continue
      }
      const publication = evaluateExternalPublicationReadiness(asset.src)
      if (!publication.ready) {
        missing.push({ code: 'generation_input_unreachable', description: `${job.input_asset_id}：${publication.reason}` })
      }
    }
    if (missing.length > 0) {
      return {
        toolId: input.toolId,
        status: 'blocked',
        missing,
        alternatives: ['修改方案中的素材生成方式', '配置外部素材发布后重试'],
      }
    }
  }
  if (tool.requiresExplicitAuthorization && !input.authorizationGranted) {
    return { toolId: input.toolId, status: 'needs_authorization', missing: [], alternatives: [] }
  }
  return { toolId: input.toolId, status: 'ready', missing: [], alternatives: [] }
}

export function bindV2AgentToolArguments(input: {
  modelArguments: Record<string, unknown>
  context: DirectorContext
  workspace: Pick<DirectorWorkspaceState, 'draftId' | 'baseRevision' | 'selectedItemId'>
  userId: number
}) {
  return {
    semantic: input.modelArguments,
    system: {
      userId: input.userId,
      sampleId: input.context.sampleVideo?.id,
      materialIds: input.context.materials.map((item) => item.id),
      draftId: input.workspace.draftId,
      revision: input.workspace.baseRevision,
      selectedTimelineItemId: input.workspace.selectedItemId,
    },
  }
}

export const V2_AGENT_TOOLS: readonly V2AgentToolDefinition[] = [
  { id: 'sample.analyze', name: '分析样例', summary: '读取用户明确选择的样例，提取可复用的结构、节奏和风格事实。', status: 'available', effect: 'read', cost: 'low', skills: ['sample-reference-analysis'], inputSchema: sampleAnalyzeInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: false, recovery: '确认样例有效后重试，或继续无样例规划。' },
  { id: 'material.inspect', name: '检查素材', summary: '检查已上传的 V2 候选素材与可用角色。', status: 'available', effect: 'read', cost: 'none', skills: ['v2-timeline-authoring'], inputSchema: materialInspectInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: false, recovery: '补充可用素材或继续文生视频。' },
  { id: 'timeline.plan', name: '创建方案', summary: '根据当前 V2 输入创建完整可编辑时间线草稿。', status: 'available', effect: 'draft', cost: 'low', skills: ['v2-timeline-authoring', 'sample-reference-analysis'], inputSchema: timelinePlanInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: false, recovery: '保留当前会话事实，修正要求后重新规划。' },
  { id: 'timeline.patch', name: '局部修订', summary: `按 V2 范围修订已有草稿：字幕（subtitle）、单镜头与相邻转场（scene）、连续镜头结构调整（structure）、单镜头视觉策略（visual_strategy）、一个或多个明确转场（transition）、整案重写（global）。内置转场为 ${REMOTION_TIMELINE_TRANSITION_TYPES.join('、')}；其他效果使用已注册或新创作的 transition custom_render。`, status: 'available', effect: 'draft', cost: 'low', skills: ['v2-timeline-authoring', 'subtitle-track-authoring'], inputSchema: timelinePatchInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: false, recovery: '保持基础版本，缩小或澄清修订范围后重试。' },
  { id: 'timeline.render', name: '正式渲染', summary: '按已保存 V2 版本执行素材解析与 Remotion 交付。', status: 'available', effect: 'delivery', cost: 'external', skills: ['v2-render-delivery'], inputSchema: timelineRenderInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: true, recovery: '保留草稿与失败原因，修复后由用户重新确认。' },
  { id: 'audio.plan', name: '规划音频', summary: '未来独立音频轨规划接口。', status: 'planned', effect: 'draft', cost: 'low', skills: [], inputSchema: emptyInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'audio.generate_tts', name: '生成旁白', summary: '未来 TTS 旁白生成接口。', status: 'planned', effect: 'delivery', cost: 'external', skills: [], inputSchema: emptyInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'audio.align', name: '对齐旁白', summary: '未来字幕型旁白时序对齐接口。', status: 'planned', effect: 'draft', cost: 'low', skills: [], inputSchema: emptyInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'audio.mix', name: '混音', summary: '未来项目级音频混音接口。', status: 'planned', effect: 'delivery', cost: 'external', skills: [], inputSchema: emptyInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'render.author', name: '创建渲染组件', summary: '当 preset 和已注册组件都无法满足效果时，提交用户使用的简短效果名、scene/transition 类型、效果说明和可逐项验证的验收条件；服务端编码 Agent 生成、审计、试渲染、视觉验收并生成组件 ID。', status: 'available', effect: 'draft', cost: 'low', skills: ['v2-render-delivery'], inputSchema: renderAuthorInputSchema, outputSchema: objectOutputSchema, requiresExplicitAuthorization: false, recovery: '缩小或澄清效果说明与验收条件后重试；组件源码由服务端编码 Agent 负责。' },
]

export function findV2AgentTool(id: string) {
  return V2_AGENT_TOOLS.find((tool) => tool.id === id)
}

export function listV2AgentToolCards() {
  return V2_AGENT_TOOLS
    .filter((tool) => tool.status === 'available')
    .map(({ id, name, summary, effect, cost, skills, inputSchema, requiresExplicitAuthorization }) => ({
      id,
      name,
      summary,
      effect,
      effectiveMode: effect === 'delivery' ? 'execute' as const : 'preview' as const,
      cost,
      skills,
      inputSchema,
      requiresExplicitAuthorization,
    }))
}

export function validateV2AgentToolRequest(
  request: { callId: string; toolId: string; skillId: string; arguments: Record<string, unknown>; requestedMode: V2AgentToolMode },
  options: { selectedSkillIds?: ReadonlySet<string> } = {},
) {
  const tool = findV2AgentTool(request.toolId)
  if (!tool || tool.status !== 'available') return { ok: false as const, reason: 'unknown or unavailable V2 tool' }
  if (!tool.skills.includes(request.skillId)) return { ok: false as const, reason: 'skill is not allowed to request this tool' }
  if (options.selectedSkillIds && !options.selectedSkillIds.has(request.skillId)) {
    return { ok: false as const, reason: 'tool skill was not selected for this turn' }
  }
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(request.callId)) return { ok: false as const, reason: 'invalid tool call id' }
  const parsedArguments = toolArgumentSchemas[tool.id]?.safeParse(request.arguments)
  if (!parsedArguments?.success) {
    return {
      ok: false as const,
      reason: `invalid tool arguments: ${parsedArguments?.error.issues.map((issue) => issue.message).join('; ') ?? 'no argument schema'}`,
    }
  }
  if (tool.effect === 'delivery' && request.requestedMode !== 'execute') return { ok: false as const, reason: 'delivery tools require execute mode' }
  const effectiveMode: V2AgentToolMode =
    tool.effect === 'delivery' ? 'execute' : 'preview'
  return {
    ok: true as const,
    tool,
    arguments: parsedArguments.data,
    effectiveMode,
    modeNormalized: request.requestedMode !== effectiveMode,
  }
}
