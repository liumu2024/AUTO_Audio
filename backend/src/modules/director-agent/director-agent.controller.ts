import type { Request, Response } from 'express'

import {
  getDirectorWorkspaceSession,
  recordDirectorWorkspaceOutcome,
  streamDirectorAgentChat,
} from './director-agent.service.js'
import type { DirectorAgentChatRequest } from './director-agent.types.js'

function writeSse(res: Response, event: unknown) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function userIdFrom(req: Request): number {
  const value = Number(req.headers['x-user-id'] ?? 1)
  return Number.isInteger(value) && value > 0 ? value : 1
}

export async function postDirectorAgentChat(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })

  try {
    const payload = {
      ...(req.body as DirectorAgentChatRequest),
      userId: userIdFrom(req),
    }
    for await (const event of streamDirectorAgentChat(payload)) {
      if (res.destroyed) return
      writeSse(res, event)
    }
  } catch (error) {
    writeSse(res, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    res.end()
  }
}

export async function getDirectorWorkspace(req: Request, res: Response) {
  const sessionId = String(req.params.workspaceSessionId ?? '').trim()
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId)) {
    res.status(400).json({ error: 'Invalid V2 director workspace session id.' })
    return
  }
  const session = await getDirectorWorkspaceSession({
    workspaceSessionId: sessionId,
    userId: userIdFrom(req),
  })
  if (!session) {
    res.status(404).json({ error: 'V2 director workspace session not found.' })
    return
  }
  res.json({ workspaceSessionId: session.id, state: session.state, updatedAt: session.updatedAt })
}

export async function postDirectorWorkspaceOutcome(req: Request, res: Response) {
  const sessionId = String(req.params.workspaceSessionId ?? '').trim()
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId)) {
    res.status(400).json({ error: 'Invalid V2 director workspace session id.' })
    return
  }
  const body = req.body as {
    action?: unknown
    ok?: unknown
    outcome?: unknown
    traceDir?: unknown
    currentTimeline?: DirectorAgentChatRequest['context']['currentTimeline']
  }
  const saved = await recordDirectorWorkspaceOutcome({
    workspaceSessionId: sessionId,
    userId: userIdFrom(req),
    action: typeof body.action === 'string' ? body.action : 'V2_ACTION',
    ok: body.ok !== false,
    outcome: typeof body.outcome === 'string' ? body.outcome : 'V2 action completed.',
    traceDir: typeof body.traceDir === 'string' ? body.traceDir : undefined,
    currentTimeline: body.currentTimeline,
  })
  if (!saved) {
    res.status(404).json({ error: 'V2 director workspace session not found.' })
    return
  }
  res.json({ workspaceSessionId: sessionId, state: saved.state, traceDir: saved.traceDir })
}
