import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'
import { WebSocketServer } from 'ws'

import { env } from './config/env.js'
import { postDirectorAgentChat } from './modules/director-agent/director-agent.controller.js'
import { postUpload } from './modules/upload/upload.controller.js'
import { uploadMiddleware } from './modules/upload/upload.middleware.js'
import { ensureUploadDir } from './modules/upload/upload.service.js'
import { authMiddleware } from './modules/auth/auth.middleware.js'
import { getTaskPipeline } from './modules/pipeline/pipeline.controller.js'
import {
  getRenderPlan,
  patchRenderPlan,
} from './modules/render-plan/render-plan.controller.js'
import {
  getLatestTask,
  getTask,
  getTasksList,
  cancelTask,
  deleteTask,
  patchTaskStructure,
} from './modules/video-task/task.controller.js'
import { attachWebSocketServer } from './modules/websocket/ws.gateway.js'
import {
  postV2TimelinePreview,
  postV2TimelineRun,
} from './pipeline-v2/controller.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(authMiddleware)

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'dpl304-backend' })
})

void ensureUploadDir()
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')))
app.use('/renders', express.static(path.resolve(process.cwd(), env.renderOutputDir)))
app.post(
  '/api/uploads',
  uploadMiddleware.single('file'),
  postUpload,
)

app.post('/api/director/chat', postDirectorAgentChat)
app.get('/api/tasks', getTasksList)
app.get('/api/tasks/latest', getLatestTask)
app.get('/api/tasks/:taskId/pipeline', getTaskPipeline)
app.get('/api/tasks/:taskId/render-plan', getRenderPlan)
app.get('/api/tasks/:taskId', getTask)
app.patch('/api/tasks/:taskId/structure', patchTaskStructure)
app.patch('/api/tasks/:taskId/render-plan', patchRenderPlan)
app.post('/api/tasks/:taskId/cancel', cancelTask)
app.delete('/api/tasks/:taskId', deleteTask)
app.use('/v2-renders', express.static(path.resolve(process.cwd(), 'v2-renders')))
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
const wss = new WebSocketServer({ server: httpServer, path: env.wsPath })
attachWebSocketServer(wss)

httpServer.listen(env.port, () => {
  console.info(`[app] HTTP  http://localhost:${env.port}`)
  console.info(`[app] WS    ws://localhost:${env.port}${env.wsPath}?taskId=<id>`)
})
