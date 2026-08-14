import assert from 'node:assert/strict'

import { createDefaultDirectorSlots } from '../../shared/lib/director-understanding.js'
import {
  buildDirectorContextFromUI,
  buildDirectorSampleVideoFromUI,
} from '../../fonted/src/services/director/directorDecisionContext.js'
import { useCreationStore } from '../../fonted/src/stores/creationStore.js'
import { readFile } from 'node:fs/promises'

const directorPanelSource = await readFile(
  new URL('../../fonted/src/components/sidebar/DirectorChatPanel.tsx', import.meta.url),
  'utf8',
)
const directorStoreSource = await readFile(
  new URL('../../fonted/src/stores/directorChatStore.ts', import.meta.url),
  'utf8',
)
const chatMessageSource = await readFile(
  new URL('../../fonted/src/components/sidebar/DirectorChatMessage.tsx', import.meta.url),
  'utf8',
)
assert.doesNotMatch(
  directorPanelSource,
  /revisionReceipt:\s*\{\s*\.\.\.event\.revisionIntent/s,
  'the UI must not fabricate a terminal receipt from a proposal intent',
)
assert.match(directorPanelSource, /timelineRevisionDecision/)
assert.match(
  directorPanelSource,
  /if \(!timelineRevisionDecision && creationSnapshot\.attachmentUploads\.length > 0\) return/,
  'confirming a persisted revision proposal must not be blocked by an unrelated upload',
)
assert.match(
  directorPanelSource,
  /const setRevisionDecisionMessages =[\s\S]*message\.revisionConfirmationId === confirmationId/,
  'one decision must update every revision card in the same persisted proposal',
)
assert.doesNotMatch(
  directorPanelSource,
  /if \(event\.revisionReceipt\) \{[\s\S]{0,240}revisionDecisionCommitted = true/,
  'one tool receipt must not commit a multi-tool confirmation group',
)
assert.match(
  directorPanelSource,
  /unresolvedOnly[\s\S]*!message\.revisionReceipt/,
  'a terminal workspace acknowledgement must only fail proposal cards that have no tool receipt',
)
assert.equal(
  (directorPanelSource.match(/'确认(?:未被服务端确认|失败)[^']*'[\s\S]{0,120}unresolvedOnly: true/g) ?? []).length,
  2,
  'stream completion and transport failure must only reset unresolved cards in a multi-tool confirmation',
)
assert.match(
  directorPanelSource,
  /timelineRevisionDecision\?\.action === 'confirm'[\s\S]*pendingTimelineRevisionConfirmation\?\.confirmationId !== timelineRevisionDecision\.confirmationId[\s\S]*'failed'/,
  'a server-cleared stale confirmation must leave the proposal card in a terminal failed state',
)
assert.match(directorStoreSource, /revisionDecisionStatus\?:[^\n]*'failed'/)
assert.match(chatMessageSource, /revisionDecisionStatus === 'failed'[\s\S]*修改提案已失效/)
assert.match(
  directorPanelSource,
  /if \(!timelineRevisionDecision\) clearInputTray\(\)/,
  'a revision decision must not consume the normal chat input tray',
)

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

const parsedSample = {
  id: 'parsed_sample', url: '/uploads/old-sample.mp4', name: 'old-sample.mp4',
  reference: { style: 'old style' },
  sampleUnderstanding: { schema_version: 'v2_sample_understanding.v2' as const },
}
assert.equal(
  buildDirectorSampleVideoFromUI({
    sampleUrl: '/uploads/new-sample.mp4', sampleName: 'new-sample.mp4', existing: parsedSample,
  })?.sampleUnderstanding,
  undefined,
  'a different sample URL must not inherit analysis from the previous sample',
)
assert.equal(
  buildDirectorSampleVideoFromUI({
    sampleUrl: '/uploads/old-sample.mp4', sampleName: 'old-sample.mp4', existing: parsedSample,
  })?.sampleUnderstanding,
  parsedSample.sampleUnderstanding,
  'the same sample keeps its persisted analysis',
)

useCreationStore.setState({
  sampleUrl: '', sampleName: '', isSampleParsed: false,
  attachmentUploads: [],
  attachments: [{
    id: 'att_uploaded_sample', materialId: 'uploaded_sample', name: 'sample.mp4',
    type: 'video', url: '/uploads/sample.mp4', source: 'upload',
  }],
  pendingAttachmentIds: ['att_uploaded_sample'],
  materialsSnapshotAuthoritative: true,
})

useCreationStore.getState().beginAttachmentUpload({
  id: 'upload_slow_image',
  name: 'slow-image.png',
  type: 'image',
})
assert.equal(
  useCreationStore.getState().attachmentUploads[0]?.status,
  'uploading',
  'a selected file must become visible as uploading before the network request starts',
)
useCreationStore.getState().failAttachmentUpload('upload_slow_image', 'network unavailable')
assert.equal(useCreationStore.getState().attachmentUploads[0]?.status, 'failed')
useCreationStore.getState().retryAttachmentUpload('upload_slow_image')
assert.equal(useCreationStore.getState().attachmentUploads[0]?.status, 'uploading')
useCreationStore.getState().completeAttachmentUpload('upload_slow_image')
assert.deepEqual(useCreationStore.getState().attachmentUploads, [])
useCreationStore.getState().acceptServerSample({
  id: 'uploaded_sample', url: '/uploads/sample.mp4', name: 'sample.mp4', parsed: true,
})
const selectedSampleState = useCreationStore.getState()
assert.equal(selectedSampleState.sampleUrl, '/uploads/sample.mp4')
assert.equal(selectedSampleState.isSampleParsed, true)
assert.deepEqual(selectedSampleState.attachments, [])
assert.deepEqual(selectedSampleState.pendingAttachmentIds, [])
assert.equal(selectedSampleState.materialsSnapshotAuthoritative, true)
useCreationStore.setState({ materialsSnapshotAuthoritative: false })
useCreationStore.getState().acceptServerSample({
  id: 'restored_sample', url: '/uploads/restored.mp4', name: 'restored.mp4', parsed: true,
})
assert.equal(
  useCreationStore.getState().materialsSnapshotAuthoritative,
  false,
  'restoring a server sample must not make an incomplete local material list authoritative',
)
useCreationStore.getState().acceptServerSample(undefined)
assert.equal(useCreationStore.getState().sampleUrl, '')
assert.equal(
  useCreationStore.getState().sampleSnapshotAuthoritative,
  false,
  'restoring a workspace with no sample must clear stale UI state without becoming a user clear action',
)
useCreationStore.getState().clearSample()
assert.equal(useCreationStore.getState().sampleSnapshotAuthoritative, true)

useCreationStore.setState({
  attachments: [],
  pendingAttachmentIds: [],
  materialsSnapshotAuthoritative: false,
})
useCreationStore.getState().acceptServerMaterials([{
  id: 'restored_landscape',
  name: 'landscape.png',
  type: 'image',
  url: '/uploads/landscape.png',
  tags: ['landscape'],
}])
const restoredMaterialState = useCreationStore.getState()
assert.deepEqual(restoredMaterialState.attachments, [{
  id: 'att_restored_landscape',
  materialId: 'restored_landscape',
  name: 'landscape.png',
  type: 'image',
  url: '/uploads/landscape.png',
  source: 'library',
  tags: ['landscape'],
}])
assert.equal(
  restoredMaterialState.materialsSnapshotAuthoritative,
  false,
  'restoring server materials must hydrate the UI without claiming a user-authored material snapshot',
)

useCreationStore.getState().addAttachment({
  id: 'att_local_new', materialId: 'local_new', name: 'new.png',
  type: 'image', url: '/uploads/new.png', source: 'upload',
})
useCreationStore.getState().acceptServerMaterials([{
  id: 'restored_landscape', name: 'landscape.png', type: 'image', url: '/uploads/landscape.png',
}])
assert.deepEqual(
  useCreationStore.getState().attachments.map((item) => item.materialId),
  ['restored_landscape', 'local_new'],
  'a delayed server snapshot must not overwrite locally edited materials',
)
assert.equal(useCreationStore.getState().materialsSnapshotAuthoritative, true)
useCreationStore.getState().acceptServerMaterials([
  { id: 'restored_landscape', name: 'landscape.png', type: 'image', url: '/uploads/landscape.png' },
  { id: 'local_new', name: 'new.png', type: 'image', url: '/uploads/new.png' },
], true)
assert.equal(
  useCreationStore.getState().materialsSnapshotAuthoritative,
  false,
  'an identical server snapshot acknowledges the local material edit',
)

useCreationStore.setState({
  attachments: [{
    id: 'att_same', materialId: 'same', name: 'same.png', type: 'image',
    url: '/uploads/same.png', source: 'library',
  }],
  pendingAttachmentIds: ['att_same'],
  materialsSnapshotAuthoritative: true,
})
useCreationStore.getState().acceptServerMaterials([
  { id: 'same', name: 'same.png', type: 'image', url: '/uploads/same.png' },
])
assert.deepEqual(
  useCreationStore.getState().pendingAttachmentIds,
  ['att_same'],
  'an unrelated delayed snapshot cannot acknowledge a same-value attachment selected for this turn',
)
useCreationStore.getState().acceptServerMaterials([
  { id: 'same', name: 'same.png', type: 'image', url: '/uploads/same.png' },
], true)
assert.deepEqual(useCreationStore.getState().pendingAttachmentIds, [])

useCreationStore.getState().setSampleUrl('/uploads/local-sample.mp4', 'local-sample.mp4')
useCreationStore.getState().acceptServerSample({
  id: 'old_sample', url: '/uploads/old-sample.mp4', name: 'old-sample.mp4', parsed: true,
})
assert.equal(useCreationStore.getState().sampleUrl, '/uploads/local-sample.mp4')
assert.equal(useCreationStore.getState().sampleSnapshotAuthoritative, true)
useCreationStore.getState().acceptServerSample({
  id: 'local_sample', url: '/uploads/local-sample.mp4', name: 'local-sample.mp4', parsed: true,
}, true)
assert.equal(useCreationStore.getState().isSampleParsed, true)
assert.equal(useCreationStore.getState().sampleSnapshotAuthoritative, false)
useCreationStore.getState().setSampleUrl('/uploads/replacement-sample.mp4', 'replacement-sample.mp4')
assert.equal(
  useCreationStore.getState().isSampleParsed,
  false,
  'selecting a different sample requires fresh analysis',
)

const chatPanelSource = await readFile(
  new URL('../../fonted/src/components/sidebar/DirectorChatPanel.tsx', import.meta.url),
  'utf8',
)
const frontendApiSource = await readFile(
  new URL('../../fonted/src/lib/api.ts', import.meta.url),
  'utf8',
)
const editorHeaderSource = await readFile(
  new URL('../../fonted/src/components/layout/EditorHeader.tsx', import.meta.url),
  'utf8',
)
const chatInputSource = await readFile(
  new URL('../../fonted/src/components/sidebar/ChatInput.tsx', import.meta.url),
  'utf8',
)
const propertyEditorSource = await readFile(
  new URL('../../fonted/src/components/layout/PropertyEditorPanel.tsx', import.meta.url),
  'utf8',
)
const generatedPlayerSource = await readFile(
  new URL('../../fonted/src/components/canvas/GeneratedPlayer.tsx', import.meta.url),
  'utf8',
)
assert.match(
  chatInputSource,
  /attachmentUploads\.length > 0[\s\S]*handleSend[\s\S]*attachmentUploads\.length > 0/,
  'sending must wait until every queued upload is either available or explicitly removed',
)
assert.match(chatInputSource, /上传中[\s\S]*重试/)
assert.match(propertyEditorSource, /镜头备注（不会自动执行）/)
assert.match(propertyEditorSource, /将备注带入对话/)
assert.match(propertyEditorSource, /setInputText/)
assert.doesNotMatch(propertyEditorSource, /我的修改要求/)
assert.match(chatPanelSource, /event\.revisionIntent[\s\S]*revisionReceipt/)
assert.match(chatMessageSource, /实际变化[\s\S]*actualDiff/)
assert.match(chatMessageSource, /纠正修改理解[\s\S]*setInputText/)
assert.match(
  generatedPlayerSource,
  /scenes\.map[\s\S]*v2DeliveryStateLabel\(scene\.deliveryState\)/,
  'the all-scenes navigation must expose each scene delivery state without requiring selection',
)
assert.match(
  chatMessageSource,
  /revisionDecisionStatus === 'rejected'[\s\S]*修改提案已取消/,
  'a server-confirmed rejected proposal must be passive instead of retaining execution buttons',
)
assert.match(
  chatPanelSource,
  /event\.toolId === 'timeline\.render'[\s\S]*event\.result[\s\S]*setResult/,
  'Director render receipts must update the existing V2 result store',
)
assert.match(
  chatPanelSource,
  /\n      if \(timelineRevisionDecision\?\.action === 'reject' && !revisionDecisionCommitted\) \{[\s\S]*setRevisionDecisionMessages\([\s\S]*'pending'[\s\S]*\n      \}\n\n      if \(streamErrorMessage\)/,
  'an error+done SSE response without a workspace acknowledgement must restore the proposal to pending',
)
assert.match(chatPanelSource, /总用时.*秒/, 'render progress must label elapsed seconds as total elapsed time')
assert.match(
  frontendApiSource,
  /MAX_DIRECTOR_REPLAY_POLLS[\s\S]*await sendDirectorTurn[\s\S]*turnReceiptRunning/,
  'a disconnected or still-running Director turn must poll with the same payload instead of leaving the UI pending',
)
assert.match(
  frontendApiSource,
  /MAX_IDEMPOTENCY_POLL_ATTEMPTS[\s\S]*idempotentJsonRequest[\s\S]*still running/,
  'preview and save polling must terminate instead of leaving the UI pending forever',
)
assert.match(
  frontendApiSource,
  /runV2TimelineDraft[\s\S]*MAX_IDEMPOTENCY_POLL_ATTEMPTS[\s\S]*still running/,
  'render polling must use the same finite boundary',
)
assert.match(
  frontendApiSource,
  /AbortSignal\.timeout\(IDEMPOTENT_HTTP_TIMEOUT_MS\)/,
  'each idempotent HTTP attempt must have a finite network timeout',
)
assert.match(
  frontendApiSource,
  /sendDirectorTurn[\s\S]*directorRequestSignal\(signal,\s*deadline - Date\.now\(\)\)/,
  'each Director SSE attempt must combine caller cancellation with a finite request timeout',
)

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
assert.match(
  timelineStoreSource,
  /pendingTimelineRevisions[\s\S]*setPendingTimelineRevisions/,
  'the UI timeline store must retain the server-confirmed pending revision gate',
)
assert.match(
  timelineStoreSource,
  /openPersistedDraft:[\s\S]*pendingTimelineRevisions:\s*draft\.pendingTimelineRevisions\s*\?\?\s*state\.pendingTimelineRevisions/,
  'opening an SSE draft without pending metadata must preserve the server workspace pending gate',
)
assert.match(
  chatPanelSource,
  /applyDirectorWorkspaceContext\([\s\S]*event\.state\.pendingTimelineRevisions/,
  'workspace synchronization must deliver the pending revision gate to direct UI export',
)
assert.match(editorHeaderSource, /getV2TimelineDraftReadiness[\s\S]*预飞检查/)
assert.match(editorHeaderSource, /未保存修改[\s\S]*已保存 v/)
assert.match(chatPanelSource, /停止等待本轮结果[\s\S]*后台模型或工具可能仍在执行/)
assert.doesNotMatch(chatPanelSource, /导演分析已中止/)

console.log('V2 director UI constraints smoke passed')
