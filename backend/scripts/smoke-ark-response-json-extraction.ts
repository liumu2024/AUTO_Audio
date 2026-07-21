import assert from 'node:assert/strict'

import { ArkFilesResponsesAnalyzer } from '../src/modules/video-understanding/ark/ark-files-responses.analyzer.js'

const analyzer = new ArkFilesResponsesAnalyzer() as unknown as {
  extractJsonCandidate(raw: unknown): unknown
}

const grounding = {
  schema_version: 'director_grounding.v1',
  task_id: 'smoke_ark_extract',
  source: {
    sample_video: { id: 'sample', role: 'structure_source' },
    reference_materials: [],
  },
  intent: { raw_text: 'test' },
  temporal_events: [],
  render_recipe: { global_effects: [], scene_effects: [] },
}

const cases: unknown[] = [
  {
    output_text: `\`\`\`json\n${JSON.stringify(grounding)}\n\`\`\``,
  },
  {
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: `Here is the JSON:\n${JSON.stringify(grounding)}`,
          },
        ],
      },
    ],
  },
  {
    data: {
      response: {
        choices: [
          {
            message: {
              content: `prefix\n${JSON.stringify(grounding)}\nsuffix`,
            },
          },
        ],
      },
    },
  },
  {
    output: [
      {
        content: [
          {
            type: 'output_json',
            json: grounding,
          },
        ],
      },
    ],
  },
]

for (const raw of cases) {
  const extracted = analyzer.extractJsonCandidate(raw) as typeof grounding
  assert.equal(extracted.schema_version, 'director_grounding.v1')
  assert.equal(extracted.task_id, 'smoke_ark_extract')
}

console.info('[smoke-ark-response-json-extraction] OK', { cases: cases.length })
