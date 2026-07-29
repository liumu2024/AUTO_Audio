import assert from 'node:assert/strict'

import { createDefaultDirectorSlots } from '../../shared/lib/director-understanding.js'
import { buildDirectorContextFromUI } from '../../fonted/src/services/director/directorDecisionContext.js'

const context = buildDirectorContextFromUI({
  sampleUrl: '',
  attachments: [],
  aspectRatio: '16:9',
  styleIntensity: 'medium',
  explicitUiControls: { aspectRatio: '16:9' },
  isSampleParsed: false,
  existing: {
    materials: [],
    userIntent: {
      aspectRatio: '9:16',
      styleIntensity: 'medium',
    },
    slots: createDefaultDirectorSlots(),
  },
})

assert.equal(context.explicitUiControls?.aspectRatio, '16:9')
assert.equal(context.slots.aspectRatio, '16:9')
assert.equal(context.userIntent.aspectRatio, '16:9')

const untouchedContext = buildDirectorContextFromUI({
  sampleUrl: '',
  attachments: [],
  aspectRatio: '9:16',
  styleIntensity: 'medium',
  isSampleParsed: false,
})
assert.equal(untouchedContext.userIntent.aspectRatio, undefined)

console.log('V2 director UI constraints smoke passed')
