import assert from 'node:assert/strict'

import { createDefaultDirectorSlots } from '../../shared/lib/director-understanding.js'
import { buildDirectorContextFromUI } from '../../fonted/src/services/director/directorDecisionContext.js'
import { readFile } from 'node:fs/promises'

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

const chatPanelSource = await readFile(
  new URL('../../fonted/src/components/sidebar/DirectorChatPanel.tsx', import.meta.url),
  'utf8',
)
assert.match(
  chatPanelSource,
  /event\.toolId === 'timeline\.render'[\s\S]*event\.result[\s\S]*setResult/,
  'Director render receipts must update the existing V2 result store',
)
assert.match(chatPanelSource, /总用时.*秒/, 'render progress must label elapsed seconds as total elapsed time')

const materialLibrarySource = await readFile(
  new URL('../../fonted/src/stores/materialLibraryStore.ts', import.meta.url),
  'utf8',
)
assert.match(materialLibrarySource, /addFromFileWithHash: async[\s\S]*await uploadFile\(file\)/)
assert.match(
  materialLibrarySource,
  /publication\?\.externallyReachable[\s\S]*publicUrl/,
  'an unverified public URL must not replace the local server-readable upload URL',
)
assert.doesNotMatch(
  materialLibrarySource.match(/addFromFileWithHash: async[\s\S]*?updateMaterial:/)?.[0] ?? '',
  /URL\.createObjectURL/,
  'hashed attachment ingestion must persist files instead of retaining browser-only blob URLs',
)
assert.match(
  chatPanelSource,
  /currentTurnMaterialIds:[\s\S]*messageAttachments/,
  'the Director request must identify this turn attachments instead of retransmitting all images',
)

const timelineStoreSource = await readFile(
  new URL('../../fonted/src/stores/v2TimelineStore.ts', import.meta.url),
  'utf8',
)
assert.match(
  timelineStoreSource,
  /latestRun\?\.status === 'completed'[\s\S]*latestRun\.outputUrl/,
  'opening a persisted draft must restore its latest completed output URL',
)
assert.match(
  timelineStoreSource,
  /setPersistedDraft:[\s\S]*result\?\.draftRevision === draft\.revision[\s\S]*renderedOutputUrl/,
  'saving a new revision must not keep a rendered output from an older revision',
)

console.log('V2 director UI constraints smoke passed')
