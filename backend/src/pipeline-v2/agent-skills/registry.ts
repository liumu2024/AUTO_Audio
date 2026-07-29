import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
}

const directory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(directory, '../../../..')

const local = (id: string, stage: V2AgentSkillManifest['stage'], card: string, allowedTools: string[], dependencies?: string[]): V2AgentSkillManifest => ({
  id,
  version: '1.0.0',
  source: 'v2_official',
  sourcePath: path.join(directory, id, 'SKILL.md'),
  status: 'available',
  card,
  stage,
  allowedTools,
  dependencies,
  loadLevel: 'agent_selectable',
})

export const V2_AGENT_SKILLS: readonly V2AgentSkillManifest[] = [
  local('v2-timeline-authoring', 'authoring', '创建或整体修订 V2 时间线；逐镜头决定 AI、Remotion 或混合视觉策略。', ['timeline.plan', 'timeline.patch']),
  local('sample-reference-analysis', 'analysis', '将用户选中的样例仅作为节奏、结构与风格参考，不复制画面或文案。', ['sample.analyze', 'timeline.plan']),
  local('subtitle-track-authoring', 'authoring', '创作或局部修订多段字幕轨；区分可见文案与展示约束。', ['timeline.patch'], ['official.remotion-captions']),
  local('v2-render-delivery', 'delivery', '检查当前 V2 草稿、授权与交付条件后提交正式渲染。', ['timeline.render'], ['official.remotion-render']),
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

export async function loadControlledSkillReference(id: string): Promise<{ id: string; content: string; hash: string } | null> {
  const skill = findV2AgentSkill(id)
  if (!skill || skill.status !== 'available' || skill.loadLevel === 'maintainer_only') return null
  const content = await readFile(skill.sourcePath, 'utf8')
  return { id, content, hash: createHash('sha256').update(content).digest('hex') }
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
