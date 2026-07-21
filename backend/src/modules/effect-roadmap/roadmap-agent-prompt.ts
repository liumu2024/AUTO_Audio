import type { AudioVisualUnderstandingHints } from '../../../../shared/types/sample-understanding-skills.js'
import type { DirectorGroundingResult } from '../sample-understanding/director-grounding/director-grounding.schema.js'
import { renderEffectRoadmapPromptTemplate } from './prompt-loader.js'
import {
  buildRoadmapPluginRegistrySnapshot,
  type RoadmapPluginRegistrySnapshot,
} from './roadmap-plugin-registry-snapshot.js'

export interface RoadmapAgentPromptInput {
  taskId: string
  directorGrounding: DirectorGroundingResult | Record<string, unknown>
  sampleHints?: AudioVisualUnderstandingHints
  pluginRegistrySnapshot?: RoadmapPluginRegistrySnapshot
}

function buildInputContextSection(input: RoadmapAgentPromptInput): string {
  return [
    '## 编排输入上下文',
    `task_id=${input.taskId}`,
    `director_grounding=${JSON.stringify(input.directorGrounding, null, 2)}`,
    `sample_hints=${JSON.stringify(input.sampleHints ?? null, null, 2)}`,
    `local_plugin_registry_snapshot=${JSON.stringify(
      input.pluginRegistrySnapshot ?? buildRoadmapPluginRegistrySnapshot(),
      null,
      2,
    )}`,
  ].join('\n')
}

export function buildRoadmapAgentPrompt(input: RoadmapAgentPromptInput): string {
  return [
    renderEffectRoadmapPromptTemplate('system.md', {
      task_id: input.taskId,
    }),
    buildInputContextSection(input),
  ].join('\n\n')
}

export function buildRoadmapAgentRepairPrompt(input: {
  taskId: string
  validationError: string
  previousJson?: unknown
  previousRawText?: string
}): string {
  const sections = [
    'You are EffectRoadmapRepairAgent.',
    'Return ONLY valid effect_roadmap.v1 JSON. No Markdown.',
    `task_id=${input.taskId}`,
    `validation_error=${input.validationError}`,
  ]
  if (input.previousJson !== undefined) {
    sections.push(`previous_json=${JSON.stringify(input.previousJson, null, 2)}`)
  }
  if (input.previousRawText) {
    sections.push(`previous_raw_text=${input.previousRawText}`)
  }
  return sections.join('\n\n')
}
