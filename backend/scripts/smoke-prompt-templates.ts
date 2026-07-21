import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildDirectorGroundingPrompt,
  buildDirectorGroundingRepairPrompt,
} from '../src/modules/sample-understanding/director-grounding/director-grounding-prompt.js'
import { PROMPT_CLAUSE_REGISTRY } from '../src/modules/sample-understanding/director-grounding/prompt-clause-registry.js'
import { renderPromptTemplate } from '../src/modules/sample-understanding/prompts/prompt-loader.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readBackendFile(...parts: string[]): string {
  return readFileSync(path.join(backendRoot, ...parts), 'utf8')
}

function assertIncludes(text: string, expected: string, label: string): void {
  assert.ok(text.includes(expected), `${label}: missing "${expected}"`)
}

function assertUtf8Healthy(text: string, label: string): void {
  assert.ok(!text.includes('\uFFFD'), `${label}: contains replacement character`)
  assert.ok(!text.includes('Ã'), `${label}: contains Latin-1 mojibake marker`)
  assert.ok(!text.includes('Â'), `${label}: contains Latin-1 mojibake marker`)
}

function assertPromptFile(
  relativePath: string,
  phrases: string[],
): void {
  const text = readBackendFile(...relativePath.split('/'))
  assertUtf8Healthy(text, relativePath)
  for (const phrase of phrases) {
    assertIncludes(text, phrase, relativePath)
  }
}

const fakeVideo = {
  originalName: 'sample.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1024,
  localPath: '/tmp/sample.mp4',
}

const prompt = buildDirectorGroundingPrompt(fakeVideo, {
  taskId: 'smoke_prompt_task',
  globalPrompt: '解析西湖风光样例',
  materials: [
    {
      id: 'mat_1',
      material_type: 'IMAGE',
      oss_url: 'https://example.com/a.jpg',
      label: '用户图片',
      ai_tags: ['landscape'],
      status: 'READY',
    },
  ],
})

assert.ok(prompt.includes('Director Grounding Observation Layer'), 'includes observation system title')
assert.ok(prompt.includes('Global Redlines'), 'includes global redlines')
assert.ok(prompt.includes('prompt_clauses') || prompt.includes('sample_material_boundary'), 'includes prompt clause registry')
assert.ok(prompt.includes('shot_events'), 'includes shot events schema')
assert.ok(prompt.includes('transition_observations'), 'includes transition observations schema')
assert.ok(prompt.includes('missing_capabilities'), 'includes missing capability policy')
assert.ok(prompt.includes('smoke_prompt_task'), 'includes task id')
assert.ok(prompt.includes('reference_materials'), 'includes materials context')
assert.ok(!prompt.includes('\\u'), 'no unicode escape artifacts')
assert.ok(!prompt.includes('supported_remotion_plugins'), 'does not include full remotion plugin registry')
assert.ok(!prompt.includes('supported_render_plugins'), 'does not include full render plugin registry')
assert.ok(PROMPT_CLAUSE_REGISTRY.some((clause) => clause.id === 'shot_events_required'))

const systemOnly = renderPromptTemplate('director-grounding/observation-system.md', {
  task_id: 't1',
  supported_presets_list: 'primitive_texture_grade, primitive_vignette_overlay, primitive_grain_overlay',
  prompt_clauses: '[]',
})
assert.ok(systemOnly.includes('Global Redlines'), 'global redlines included in observation system')
assert.ok(systemOnly.includes('render_recipe.scene_effects'), 'scene effects redline included')

const repair = buildDirectorGroundingRepairPrompt({
  taskId: 't1',
  validationError: 'test error',
  previousJson: { task_id: 't1' },
})
assert.ok(repair.includes('previous_json='), 'repair appends json block')

const promptFiles: Array<[string, string[]]> = [
  [
    'src/modules/sample-understanding/prompts/global/redlines.md',
    [
      'Global Redlines',
      'The sample video is evidence',
      'Do not write a final RenderPlan',
    ],
  ],
  [
    'src/modules/sample-understanding/prompts/director-grounding/observation-system.md',
    [
      'Director Grounding Observation Layer',
      '{{include:global/redlines.md}}',
      '{{prompt_clauses}}',
    ],
  ],
  [
    'src/modules/sample-understanding/prompts/director-grounding/output-schema.md',
    [
      '"schema_version": "director_grounding.v1"',
      '"shot_events"',
      '"transition_observations"',
      '"effect_intents"',
      '"remotion_capability_plan"',
      '"critique"',
    ],
  ],
  [
    'src/modules/sample-understanding/prompts/director-grounding/repair.md',
    ['Return exactly one JSON object', '{{validation_error}}'],
  ],
  [
    'src/modules/effect-roadmap/prompts/system.md',
    [
      'Effect Roadmap Agent',
      '只返回一个可被 `JSON.parse` 解析的 JSON 对象',
      '禁止',
      '不要替换',
    ],
  ],
  [
    'src/modules/effect-roadmap/prompts/roadmap-output-schema.md',
    [
      '"schema_version": "effect_roadmap.v1"',
      '禁止',
      'must_match',
      'triangle',
    ],
  ],
]

for (const [relativePath, phrases] of promptFiles) {
  assertPromptFile(relativePath, phrases)
}

const directorRouter = readBackendFile(
  'src/modules/director-agent/llm-intent-router.ts',
)
assertUtf8Healthy(directorRouter, 'director-agent/llm-intent-router.ts')
assertIncludes(directorRouter, '业务边界必须遵守', 'director intent router')
assertIncludes(directorRouter, '不得生成或渲染', 'director intent router')
assertIncludes(directorRouter, '不写 RenderPlan', 'director intent router')
assertIncludes(directorRouter, '不要暴露私密推理链', 'director intent router')

const seedPrompt = readBackendFile(
  'src/modules/effect-roadmap/seed-authoring-prompt.ts',
)
assertUtf8Healthy(seedPrompt, 'effect-roadmap/seed-authoring-prompt.ts')
assertIncludes(seedPrompt, 'Do NOT rewrite must_match geometry constraints', 'seed prompt')
assertIncludes(seedPrompt, 'fallback must stay null', 'seed prompt')

const componentAuthoring = readBackendFile(
  'src/modules/remotion-component-authoring/capability-resolver.ts',
)
assertUtf8Healthy(componentAuthoring, 'remotion component authoring prompt')
assertIncludes(componentAuthoring, 'Generate exactly ONE layer-kind behavior', 'component authoring prompt')
assertIncludes(componentAuthoring, 'The TSX file must import only from "remotion"', 'component authoring prompt')

const renderPlanReview = readBackendFile(
  'src/modules/render-plan/render-plan-review.service.ts',
)
assertUtf8Healthy(renderPlanReview, 'render-plan-review prompt')
assertIncludes(renderPlanReview, 'Hard boundaries:', 'render-plan-review prompt')
assertIncludes(renderPlanReview, 'Do not invent assets', 'render-plan-review prompt')
assertIncludes(renderPlanReview, 'Do not suggest AI video generation as a fix', 'render-plan-review prompt')

console.log('smoke-prompt-templates: passed')
console.log(`assembled prompt length: ${prompt.length} chars`)
