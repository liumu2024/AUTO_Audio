import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

const editorHeader = source('fonted/src/components/layout/EditorHeader.tsx')
assert.equal(editorHeader.includes('useRenderPlanStore'), false)
assert.equal(editorHeader.includes('patchTaskRenderPlan'), false)
assert.equal(editorHeader.includes('patchTaskStructure'), false)
assert.match(editorHeader, /saveV2DirectorTimelineDraft/)
assert.match(editorHeader, /useDirectorChatStore\(\(s\) => s\.isSending\)/)
assert.match(editorHeader, /newDraftDisabled[\s\S]*isDirectorSending[\s\S]*isAnalyzing/)

const directorChatPanel = source('fonted/src/components/sidebar/DirectorChatPanel.tsx')
const attachmentUploads = source('fonted/src/services/director/attachmentUploads.ts')
assert.match(
  directorChatPanel,
  /const requestWorkspaceSessionId = browserWorkspaceSessionId\(\)[\s\S]*workspaceSessionId: requestWorkspaceSessionId/,
)
assert.match(
  directorChatPanel,
  /browserWorkspaceSessionId\(\) !== requestWorkspaceSessionId[\s\S]*return/,
)
assert.match(
  directorChatPanel,
  /if \(browserWorkspaceSessionId\(\) !== workspaceSessionId\) return/,
)

const chatInput = source('fonted/src/components/sidebar/ChatInput.tsx')
assert.match(chatInput, /const draft = useCreationStore\(\(s\) => s\.inputText\)/)
assert.match(chatInput, /const setDraft = useCreationStore\(\(s\) => s\.setInputText\)/)
assert.match(chatInput, /ingestAttachmentFiles/)
assert.match(chatInput, /retryAttachmentFileUpload/)
assert.match(directorChatPanel, /ingestAttachmentFiles/)
assert.doesNotMatch(chatInput, /addFromFileWithHash|beginAttachmentUpload|completeAttachmentUpload/)
assert.doesNotMatch(directorChatPanel, /addFromFileWithHash|beginAttachmentUpload|completeAttachmentUpload/)
assert.match(
  attachmentUploads,
  /addFromFileWithHash[\s\S]*browserWorkspaceSessionId\(\) !== workspaceSessionId[\s\S]*completeAttachmentUpload/,
)
assert.match(attachmentUploads, /beginAttachmentUpload[\s\S]*uploadAttachment/)
assert.match(chatInput, /attachmentUploads\.length > 0/)

const propertyEditor = source('fonted/src/components/layout/PropertyEditorPanel.tsx')
assert.match(propertyEditor, /镜头备注（不会自动执行）/)
assert.match(propertyEditor, /将备注带入对话/)

const timelinePanel = source('fonted/src/components/layout/TimelinePanel.tsx')
assert.equal(timelinePanel.includes('useRenderPlanStore'), false)
assert.equal(timelinePanel.includes('useCreationStore'), false)
assert.match(timelinePanel, /hasV2Sample/)

const editableTimeline = source('fonted/src/components/timeline/EditableTimeline.tsx')
assert.match(editableTimeline, /V2SampleTimeline/)
assert.match(editableTimeline, /useV2TimelineStore/)
assert.equal(editableTimeline.includes('useTimelineStore'), false)
assert.equal(editableTimeline.includes('useRenderPlanStore'), false)

const migrationCanvas = source('fonted/src/components/canvas/MigrationCanvas.tsx')
assert.match(migrationCanvas, /V2SamplePlayer/)
assert.equal(migrationCanvas.includes('useMigrationProjectStore'), false)
assert.equal(migrationCanvas.includes("from '@/components/canvas/SamplePlayer'"), false)

assert.equal(existsSync(resolve(root, 'fonted/src/services/pipeline/restoreTask.ts')), false)
assert.equal(existsSync(resolve(root, 'fonted/src/components/shell/V2TimelineView.tsx')), false)

console.info('[smoke-v2-editor-route-isolation] OK')
