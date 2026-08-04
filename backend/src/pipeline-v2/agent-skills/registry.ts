import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { V2AgentToolProposal, V2AgentToolRequest } from '../agent-tools/dispatcher.js'
import { validateV2AgentToolRequest } from '../agent-tools/registry.js'
import { manifest as timelineAuthoringManifest } from './v2-timeline-authoring/manifest.js'
import { manifest as sampleReferenceManifest } from './sample-reference-analysis/manifest.js'
import { manifest as subtitleAuthoringManifest } from './subtitle-track-authoring/manifest.js'
import { manifest as renderDeliveryManifest } from './v2-render-delivery/manifest.js'

export type V2SkillStatus = 'available' | 'planned' | 'disabled'
export type V2SkillSource = 'v2_official' | 'official_remotion'

export interface V2AgentSkillManifest {
  id: string
  version: string
  source: V2SkillSource
  sourcePath: string
  status: V2SkillStatus
  card: string
  stage: 'analysis' | 'authoring' | 'delivery' | 'maintenance' | 'future'
  allowedTools: string[]
  dependencies?: string[]
  loadLevel: 'agent_selectable' | 'controlled_reference' | 'maintainer_only'
  prerequisites?: readonly string[]
  requiredFacts?: readonly string[]
  outputRequirements?: readonly string[]
  validation?: readonly string[]
  recovery?: string
}

export interface LoadedV2AgentSkill {
  id: string
  version: string
  source: V2SkillSource
  stage: V2AgentSkillManifest['stage']
  loadLevel: V2AgentSkillManifest['loadLevel']
  content: string
  hash: string
}

export interface V2AgentExecutionStage {
  primarySkill: LoadedV2AgentSkill & { purpose: string }
  references: LoadedV2AgentSkill[]
  toolRequest: V2AgentToolRequest
  modeResolution: {
    requestedMode: V2AgentToolRequest['requestedMode']
    effectiveMode: V2AgentToolRequest['requestedMode']
    normalized: boolean
  }
}

export interface V2AgentExecutionPlan {
  toolRequests: V2AgentToolRequest[]
  selectedSkills: Array<{ skillId: string; purpose: string }>
  loadedSkills: LoadedV2AgentSkill[]
  rejectedSkills: Array<{ skillId: string; reason: string }>
  rejectedTools: Array<{ callId: string; toolId: string; reason: string }>
  stages: V2AgentExecutionStage[]
}

function canonicalToolCallId(input: {
  workspaceSessionId: string
  turnRequestId: string
  ordinal: number
}): string {
  const digest = createHash('sha256')
    .update(`${input.workspaceSessionId}\u0000${input.turnRequestId}\u0000${input.ordinal}`)
    .digest('hex')
    .slice(0, 24)
  return `v2call_${digest}`
}

function canonicalizeToolProposals(input: {
  proposals: V2AgentToolProposal[] | undefined
  workspaceSessionId: string
  turnRequestId: string
}): V2AgentToolRequest[] {
  return (input.proposals ?? []).map((proposal, ordinal) => ({
    ...proposal,
    callId: canonicalToolCallId({
      workspaceSessionId: input.workspaceSessionId,
      turnRequestId: input.turnRequestId,
      ordinal,
    }),
  }))
}

const directory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(directory, '../../../..')

type LocalSkillPackageManifest =
  | typeof timelineAuthoringManifest
  | typeof sampleReferenceManifest
  | typeof subtitleAuthoringManifest
  | typeof renderDeliveryManifest

const local = (manifest: LocalSkillPackageManifest): V2AgentSkillManifest => ({
  id: manifest.id,
  version: manifest.version,
  source: 'v2_official',
  sourcePath: path.join(directory, manifest.id, 'SKILL.md'),
  status: 'available',
  card: manifest.card,
  stage: manifest.stage,
  allowedTools: [...manifest.tools],
  dependencies: [...manifest.dependencies],
  loadLevel: 'agent_selectable',
  prerequisites: manifest.prerequisites,
  requiredFacts: manifest.requiredFacts,
  outputRequirements: manifest.outputRequirements,
  validation: manifest.validation,
  recovery: manifest.recovery,
})

export const V2_AGENT_SKILLS: readonly V2AgentSkillManifest[] = [
  local(timelineAuthoringManifest),
  local(sampleReferenceManifest),
  local(subtitleAuthoringManifest),
  local(renderDeliveryManifest),
  {
    id: 'official.remotion-captions', version: 'repository', source: 'official_remotion',
    sourcePath: path.join(repoRoot, 'official-skills', 'skills', 'remotion-captions', 'SKILL.md'), status: 'available',
    card: 'Remotion 官方字幕时序与 Caption 数据参考；只读，不授予 JSX 或依赖安装权限。', stage: 'authoring', allowedTools: [], loadLevel: 'controlled_reference',
  },
  {
    id: 'official.remotion-render', version: 'repository', source: 'official_remotion',
    sourcePath: path.join(repoRoot, 'official-skills', 'skills', 'remotion-render', 'SKILL.md'), status: 'available',
    card: 'Remotion 官方渲染交付参考；只读，固定 V2 渲染器仍禁止自定义组件。', stage: 'delivery', allowedTools: [], loadLevel: 'controlled_reference',
  },
  {
    id: 'official.remotion-markup', version: 'repository', source: 'official_remotion',
    sourcePath: path.join(repoRoot, 'official-skills', 'skills', 'remotion-markup', 'SKILL.md'), status: 'disabled',
    card: '固定渲染器维护参考，不进入导演可选目录。', stage: 'maintenance', allowedTools: [], loadLevel: 'maintainer_only',
  },
  {
    id: 'official.remotion-best-practices', version: 'repository', source: 'official_remotion',
    sourcePath: path.join(repoRoot, 'official-skills', 'skills', 'remotion-best-practices', 'SKILL.md'), status: 'disabled',
    card: '固定渲染器维护参考，不进入导演可选目录。', stage: 'maintenance', allowedTools: [], loadLevel: 'maintainer_only',
  },
]

export function listV2AgentSkillCards() {
  return V2_AGENT_SKILLS
    .filter((skill) => skill.status === 'available' && skill.loadLevel === 'agent_selectable')
    .map(({ id, version, card, stage, allowedTools, dependencies }) => ({ id, version, card, stage, allowedTools, dependencies: dependencies ?? [] }))
}

export function findV2AgentSkill(id: string) {
  return V2_AGENT_SKILLS.find((skill) => skill.id === id)
}

export async function loadControlledSkillReference(id: string): Promise<LoadedV2AgentSkill | null> {
  const skill = findV2AgentSkill(id)
  if (!skill || skill.status !== 'available' || skill.loadLevel === 'maintainer_only') return null
  const sourceContent = await readFile(skill.sourcePath, 'utf8')
  const runtimeContract = skill.source === 'v2_official'
    ? [
        '## Runtime contract',
        JSON.stringify({
          prerequisites: skill.prerequisites ?? [],
          required_facts: skill.requiredFacts ?? [],
          output_requirements: skill.outputRequirements ?? [],
          validation: skill.validation ?? [],
          recovery: skill.recovery ?? null,
        }, null, 2),
      ].join('\n')
    : ''
  const content = [sourceContent.trim(), runtimeContract].filter(Boolean).join('\n\n')
  return {
    id,
    version: skill.version,
    source: skill.source,
    stage: skill.stage,
    loadLevel: skill.loadLevel,
    content,
    hash: createHash('sha256').update(content).digest('hex'),
  }
}

export function resolveV2SkillRequests(requests: Array<{ skillId: string; purpose: string }> | undefined) {
  const accepted: Array<{ skillId: string; purpose: string }> = []
  const rejected: Array<{ skillId: string; reason: string }> = []
  for (const request of requests ?? []) {
    const skill = findV2AgentSkill(request.skillId)
    if (!skill || skill.status !== 'available' || skill.loadLevel !== 'agent_selectable') {
      rejected.push({ skillId: request.skillId, reason: 'skill is not available to the V2 director' })
      continue
    }
    accepted.push({ skillId: skill.id, purpose: request.purpose.trim().slice(0, 240) })
  }
  return { accepted, rejected }
}

async function loadSkillTree(
  skillId: string,
  loaded: Map<string, LoadedV2AgentSkill>,
  stack = new Set<string>(),
): Promise<void> {
  if (stack.has(skillId)) throw new Error(`cyclic skill dependency: ${skillId}`)
  if (loaded.has(skillId)) return
  const manifest = findV2AgentSkill(skillId)
  if (!manifest || manifest.status !== 'available' || manifest.loadLevel === 'maintainer_only') {
    throw new Error(`skill dependency is unavailable: ${skillId}`)
  }
  const nextStack = new Set(stack).add(skillId)
  const skill = await loadControlledSkillReference(skillId)
  if (!skill) throw new Error(`skill instructions could not be loaded: ${skillId}`)
  loaded.set(skillId, skill)
  for (const dependency of manifest.dependencies ?? []) {
    await loadSkillTree(dependency, loaded, nextStack)
  }
}

function dependencyClosure(skillId: string, result = new Set<string>()): Set<string> {
  const manifest = findV2AgentSkill(skillId)
  for (const dependency of manifest?.dependencies ?? []) {
    if (result.has(dependency)) continue
    result.add(dependency)
    dependencyClosure(dependency, result)
  }
  return result
}

/**
 * Resolves one authoritative, model-selected execution plan. A Tool can only
 * run through a primary Skill selected in this turn; declared dependencies are
 * loaded as read-only references and never become independent Tool authority.
 */
export async function resolveV2AgentExecutionPlan(input: {
  intent: 'chat' | 'create' | 'revise' | 'execute' | 'clarify'
  skillRequests: Array<{ skillId: string; purpose: string }> | undefined
  toolRequests: V2AgentToolProposal[] | undefined
  callIdContext: {
    workspaceSessionId: string
    turnRequestId: string
  }
  stateActionRefs?: string[]
}): Promise<V2AgentExecutionPlan> {
  const toolRequests = canonicalizeToolProposals({
    proposals: input.toolRequests,
    ...input.callIdContext,
  })
  const explicitSkillIds = new Set((input.skillRequests ?? []).map((request) => request.skillId))
  const resolved = resolveV2SkillRequests([
    ...(input.skillRequests ?? []),
    ...toolRequests
      .filter((request) => !explicitSkillIds.has(request.skillId))
      .map((request) => ({ skillId: request.skillId, purpose: `Primary Skill for ${request.toolId}` })),
  ])
  const loaded = new Map<string, LoadedV2AgentSkill>()
  const selectedSkills: Array<{ skillId: string; purpose: string }> = []
  const rejectedSkills = [...resolved.rejected]

  for (const selected of resolved.accepted) {
    if (selectedSkills.some((item) => item.skillId === selected.skillId)) continue
    try {
      await loadSkillTree(selected.skillId, loaded)
      selectedSkills.push(selected)
    } catch (error) {
      rejectedSkills.push({
        skillId: selected.skillId,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const selectedIds = new Set(selectedSkills.map((item) => item.skillId))
  const rejectedTools: V2AgentExecutionPlan['rejectedTools'] = []
  const stages: V2AgentExecutionStage[] = []
  const knownRefs = new Set(input.stateActionRefs ?? [])
  for (const request of toolRequests) {
    if (knownRefs.has(request.ref)) {
      rejectedTools.push({ callId: request.callId, toolId: request.toolId, reason: `duplicate action ref: ${request.ref}` })
      continue
    }
    const missingDependency = request.dependsOn.find((ref) => !knownRefs.has(ref))
    knownRefs.add(request.ref)
    if (missingDependency) {
      rejectedTools.push({ callId: request.callId, toolId: request.toolId, reason: `unknown or forward dependency: ${missingDependency}` })
      continue
    }
    const requestedSkill = findV2AgentSkill(request.skillId)
    if (!requestedSkill?.allowedTools.includes(request.toolId)) {
      rejectedTools.push({
        callId: request.callId,
        toolId: request.toolId,
        reason: 'selected Skill manifest does not allow this Tool',
      })
      continue
    }
    const checked = validateV2AgentToolRequest(request, { selectedSkillIds: selectedIds })
    if (!checked.ok) {
      rejectedTools.push({ callId: request.callId, toolId: request.toolId, reason: checked.reason })
      continue
    }
    if (input.intent === 'chat' || input.intent === 'clarify') {
      rejectedTools.push({ callId: request.callId, toolId: request.toolId, reason: `${input.intent} intent does not authorize Tool execution` })
      continue
    }
    if (input.intent !== 'execute' && checked.tool.effect === 'delivery') {
      rejectedTools.push({ callId: request.callId, toolId: request.toolId, reason: 'delivery Tool requires execute intent' })
      continue
    }
    const selected = selectedSkills.find((item) => item.skillId === request.skillId)
    const primary = loaded.get(request.skillId)
    const manifest = findV2AgentSkill(request.skillId)
    if (!selected || !primary || !manifest) {
      rejectedTools.push({ callId: request.callId, toolId: request.toolId, reason: 'selected skill instructions are unavailable' })
      continue
    }
    const references = [...dependencyClosure(manifest.id)]
      .map((id) => loaded.get(id))
      .filter((item): item is LoadedV2AgentSkill => Boolean(item))
    stages.push({
      primarySkill: { ...primary, purpose: selected.purpose },
      references,
      toolRequest: {
        ...request,
        arguments: checked.arguments,
        requestedMode: checked.effectiveMode,
      },
      modeResolution: {
        requestedMode: request.requestedMode,
        effectiveMode: checked.effectiveMode,
        normalized: checked.modeNormalized,
      },
    })
  }

  return {
    toolRequests,
    selectedSkills,
    loadedSkills: [...loaded.values()],
    rejectedSkills,
    rejectedTools,
    stages,
  }
}
