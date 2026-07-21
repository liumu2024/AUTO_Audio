import WebSocket, { WebSocketServer } from 'ws'

import type { TaskProgressPayload } from '../../shared/types.js'
import type {
  AgentTracePhase,
  AgentTraceStatus,
} from '../../../../shared/types/agent-trace.v1.js'
import { recordAgentTraceEvent } from '../agent-trace/writer.js'

type TaskSubscription = Set<WebSocket>

const taskSubscribers = new Map<string, TaskSubscription>()
const progressTraceCache = new Map<string, string>()
let wss: WebSocketServer | null = null

function phaseFromProgressStage(stage: string): AgentTracePhase {
  const lower = stage.toLowerCase()
  if (lower.includes('quality')) return 'quality_gate'
  if (lower.includes('render')) return 'render'
  if (lower.includes('generat')) return 'render_plan'
  if (
    lower.includes('analy') ||
    lower.includes('understanding') ||
    lower.includes('upload') ||
    lower.includes('preprocess')
  ) {
    return 'sample_understanding'
  }
  return 'task'
}

function statusFromProgressPayload(payload: TaskProgressPayload): AgentTraceStatus {
  const lower = payload.stage.toLowerCase()
  if (lower.includes('failed')) return 'failed'
  if (lower.includes('cancelled')) return 'skipped'
  if (lower.includes('completed')) return 'success'
  if (payload.progress >= 100) return 'success'
  return 'started'
}

function recordProgressTrace(taskId: string, payload: TaskProgressPayload): void {
  const progressBucket = Math.floor(payload.progress)
  const cacheKey = `${payload.stage}:${progressBucket}`
  if (progressTraceCache.get(taskId) === cacheKey) return
  progressTraceCache.set(taskId, cacheKey)

  recordAgentTraceEvent({
    taskId,
    phase: phaseFromProgressStage(payload.stage),
    actor: 'system',
    event: 'progress',
    status: statusFromProgressPayload(payload),
    summary: payload.log ?? payload.stage,
    metrics: { progress: payload.progress },
    data: { stage: payload.stage },
  })
}

export function attachWebSocketServer(server: WebSocketServer): void {
  wss = server

  server.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const taskId = url.searchParams.get('taskId')

    if (taskId) {
      subscribeTask(socket, taskId)
    }

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; taskId?: string }
        if (msg.type === 'subscribe' && msg.taskId) {
          subscribeTask(socket, msg.taskId)
        }
      } catch {
        /* ignore malformed */
      }
    })

    socket.on('close', () => {
      for (const subs of taskSubscribers.values()) {
        subs.delete(socket)
      }
    })
  })
}

function subscribeTask(socket: WebSocket, taskId: string): void {
  let subs = taskSubscribers.get(taskId)
  if (!subs) {
    subs = new Set()
    taskSubscribers.set(taskId, subs)
  }
  subs.add(socket)
  socket.send(
    JSON.stringify({
      event: 'task:connected',
      taskId,
    }),
  )
}

export function broadcastTaskProgress(
  taskId: string,
  payload: TaskProgressPayload,
): void {
  recordProgressTrace(taskId, payload)

  const message = JSON.stringify({
    event: 'task:progress',
    taskId,
    ...payload,
  })

  const subs = taskSubscribers.get(taskId)
  if (subs) {
    for (const socket of subs) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message)
      }
    }
  }

  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && !subs?.has(client)) {
        client.send(message)
      }
    })
  }
}
