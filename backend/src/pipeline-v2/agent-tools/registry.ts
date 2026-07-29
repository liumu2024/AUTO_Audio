import { findV2AgentSkill } from '../agent-skills/registry.js'

export type V2AgentToolStatus = 'available' | 'planned' | 'disabled'
export type V2AgentToolMode = 'preview' | 'execute'
export type V2AgentToolEffect = 'read' | 'draft' | 'delivery'

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

const objectSchema = { type: 'object' } as const

export const V2_AGENT_TOOLS: readonly V2AgentToolDefinition[] = [
  { id: 'sample.analyze', name: '分析样例', summary: '读取用户明确选择的样例，提取可复用的结构、节奏和风格事实。', status: 'available', effect: 'read', cost: 'low', skills: ['sample-reference-analysis'], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '确认样例有效后重试，或继续无样例规划。' },
  { id: 'material.inspect', name: '检查素材', summary: '检查已上传的 V2 候选素材与可用角色。', status: 'available', effect: 'read', cost: 'none', skills: ['v2-timeline-authoring'], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: false, recovery: '补充可用素材或继续文生视频。' },
  { id: 'timeline.plan', name: '创建方案', summary: '根据当前 V2 输入创建完整可编辑时间线草稿。', status: 'available', effect: 'draft', cost: 'low', skills: ['v2-timeline-authoring', 'sample-reference-analysis'], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '保留当前会话事实，修正要求后重新规划。' },
  { id: 'timeline.patch', name: '局部修订', summary: '按 V2 范围修订已有草稿；当前只开放字幕范围。', status: 'available', effect: 'draft', cost: 'low', skills: ['v2-timeline-authoring', 'subtitle-track-authoring'], inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global', 'scene', 'subtitle', 'audio', 'visual_strategy'] } }, required: ['scope'] }, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '保持基础版本，缩小或澄清修订范围后重试。' },
  { id: 'timeline.render', name: '正式渲染', summary: '按已保存 V2 版本执行素材解析与 Remotion 交付。', status: 'available', effect: 'delivery', cost: 'external', skills: ['v2-render-delivery'], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '保留草稿与失败原因，修复后由用户重新确认。' },
  { id: 'memory.search', name: '检索创作记忆', summary: '未来长期创作记忆检索接口。', status: 'planned', effect: 'read', cost: 'low', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: false, recovery: '当前未启用。' },
  { id: 'memory.propose_write', name: '沉淀创作记忆', summary: '未来待确认偏好/模板沉淀接口。', status: 'planned', effect: 'draft', cost: 'none', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'audio.plan', name: '规划音频', summary: '未来独立音频轨规划接口。', status: 'planned', effect: 'draft', cost: 'low', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'audio.generate_tts', name: '生成旁白', summary: '未来 TTS 旁白生成接口。', status: 'planned', effect: 'delivery', cost: 'external', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'audio.align', name: '对齐旁白', summary: '未来字幕型旁白时序对齐接口。', status: 'planned', effect: 'draft', cost: 'low', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'audio.mix', name: '混音', summary: '未来项目级音频混音接口。', status: 'planned', effect: 'delivery', cost: 'external', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '当前未启用。' },
  { id: 'component.sandbox_preview', name: '沙箱组件预览', summary: '未来受限 Remotion 组件沙箱接口。', status: 'disabled', effect: 'draft', cost: 'low', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '当前固定渲染器不支持自定义组件。' },
  { id: 'component.promote', name: '沉淀组件', summary: '未来审核通过的组件提升接口。', status: 'disabled', effect: 'draft', cost: 'low', skills: [], inputSchema: objectSchema, outputSchema: objectSchema, requiresExplicitAuthorization: true, recovery: '当前固定渲染器不支持自定义组件。' },
]

export function findV2AgentTool(id: string) {
  return V2_AGENT_TOOLS.find((tool) => tool.id === id)
}

export function listV2AgentToolCards() {
  return V2_AGENT_TOOLS.filter((tool) => tool.status === 'available').map(({ id, name, summary, effect, cost, skills, requiresExplicitAuthorization }) => ({ id, name, summary, effect, cost, skills, requiresExplicitAuthorization }))
}

export function validateV2AgentToolRequest(request: { callId: string; toolId: string; skillId: string; arguments: Record<string, unknown>; requestedMode: V2AgentToolMode }) {
  const tool = findV2AgentTool(request.toolId)
  if (!tool || tool.status !== 'available') return { ok: false as const, reason: 'unknown or unavailable V2 tool' }
  const skill = findV2AgentSkill(request.skillId)
  if (!skill || skill.status !== 'available' || !tool.skills.includes(skill.id)) return { ok: false as const, reason: 'skill is not allowed to request this tool' }
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(request.callId)) return { ok: false as const, reason: 'invalid tool call id' }
  if (tool.id === 'timeline.patch' && request.arguments.scope !== 'subtitle') return { ok: false as const, reason: 'only subtitle scope is currently available for timeline.patch' }
  if (tool.effect === 'delivery' && request.requestedMode !== 'execute') return { ok: false as const, reason: 'delivery tools require execute mode' }
  return { ok: true as const, tool }
}
