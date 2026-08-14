import assert from 'node:assert/strict'

import { mapV2TimelineDraftHistoryCard } from '../../shared/lib/v2-timeline-draft-history.js'

const textDraft = mapV2TimelineDraftHistoryCard({
  draftId: 'v2_draft_text',
  creationMode: 'text_to_video',
  title: 'Rainy commute safety guide',
  summary: 'A concise safety reminder for evening commuters.',
  aspectRatio: '9:16',
  durationSec: 15,
  sceneCount: 3,
  visibleTextCount: 5,
  revision: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})
assert.deepEqual(textDraft, {
  id: 'v2_draft_text',
  summary: 'A concise safety reminder for evening commuters.',
  modeLabel: '文生视频方案',
  aspectRatio: '9:16',
  durationSec: 15,
  sceneCount: 3,
  visibleTextCount: 5,
  revision: 2,
  title: 'Rainy commute safety guide',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  previewUrl: undefined,
})

const renderedMaterialDraft = mapV2TimelineDraftHistoryCard({
  draftId: 'v2_draft_material',
  creationMode: 'material_brief',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  latestRun: { status: 'completed', outputUrl: '/v2-renders/material.mp4' },
})
assert.equal(renderedMaterialDraft.title, '素材成片方案')
assert.equal(renderedMaterialDraft.status, 'completed')
assert.equal(renderedMaterialDraft.previewUrl, '/v2-renders/material.mp4')

const runningSampleDraft = mapV2TimelineDraftHistoryCard({
  draftId: 'v2_draft_sample',
  creationMode: 'sample_replicate',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
  latestRun: { status: 'running' },
})
assert.equal(runningSampleDraft.title, '样例参考创作')
assert.equal(runningSampleDraft.modeLabel, '样例参考创作')
assert.equal(runningSampleDraft.status, 'running')
assert.equal(runningSampleDraft.previewUrl, undefined)

console.info('[smoke-v2-timeline-draft-history-ui] OK')
