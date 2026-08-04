import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'

import { env } from './config/env.js'
import {
  getDirectorWorkspace,
  postDirectorAgentChat,
  postDirectorWorkspaceOutcome,
} from './modules/director-agent/director-agent.controller.js'
import { postUpload } from './modules/upload/upload.controller.js'
import { uploadMiddleware } from './modules/upload/upload.middleware.js'
import { ensureUploadDir } from './modules/upload/upload.service.js'
import { authMiddleware } from './modules/auth/auth.middleware.js'
import {
  getCreativeMemories,
  patchCreativeMemory,
  postCreativeMemory,
  removeCreativeMemory,
  searchCreativeMemories,
} from './modules/creative-memory/creative-memory.controller.js'
import {
  postV2SampleAnalyze,
  postV2TimelinePreview,
  postV2TimelineRun,
} from './pipeline-v2/controller.js'
import {
  deleteV2TimelineDraft,
  getV2TimelineDraft,
  getV2TimelineDrafts,
  postV2TimelineDraftPreview,
  postV2TimelineDraftRun,
  putV2TimelineDraft,
} from './pipeline-v2/timeline-draft-controller.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(authMiddleware)

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'dpl304-backend' })
})

void ensureUploadDir()
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')))
app.post(
  '/api/uploads',
  uploadMiddleware.single('file'),
  postUpload,
)

app.post('/api/director/chat', postDirectorAgentChat)
app.get('/api/director/workspaces/:workspaceSessionId', getDirectorWorkspace)
app.post('/api/director/workspaces/:workspaceSessionId/outcomes', postDirectorWorkspaceOutcome)
app.get('/api/creative-memories', getCreativeMemories)
app.get('/api/creative-memories/search', searchCreativeMemories)
app.post('/api/creative-memories', postCreativeMemory)
app.patch('/api/creative-memories/:memoryId', patchCreativeMemory)
app.delete('/api/creative-memories/:memoryId', removeCreativeMemory)
app.use('/v2-renders', express.static(path.resolve(process.cwd(), 'v2-renders')))
app.post('/api/v2/sample/analyze', postV2SampleAnalyze)
app.post('/api/v2/timeline-drafts/preview', postV2TimelineDraftPreview)
app.get('/api/v2/timeline-drafts', getV2TimelineDrafts)
app.get('/api/v2/timeline-drafts/:draftId', getV2TimelineDraft)
app.put('/api/v2/timeline-drafts/:draftId', putV2TimelineDraft)
app.post('/api/v2/timeline-drafts/:draftId/runs', postV2TimelineDraftRun)
app.delete('/api/v2/timeline-drafts/:draftId', deleteV2TimelineDraft)
app.post('/api/v2/timeline/preview', postV2TimelinePreview)
app.post('/api/v2/timeline/run', postV2TimelineRun)

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err)
    res.status(500).json({ error: err.message ?? 'Internal Server Error' })
  },
)

const httpServer = createServer(app)

httpServer.listen(env.port, () => {
  console.info(`[app] HTTP  http://localhost:${env.port}`)
})
