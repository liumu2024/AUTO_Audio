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
