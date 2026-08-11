import type { Request, Response } from 'express'

import {
  getDirectorWorkspaceSession,
  streamDirectorAgentChat,
} from './director-agent.service.js'
import type { DirectorAgentChatRequest } from './director-agent.types.js'
import {
  prepareDirectorTurn,
  streamPreparedDirectorTurn,
} from './director-turn-idempotency.js'
import { V2IdempotencyConflictError } from '../../pipeline-v2/idempotency-repository.js'

function writeSse(res: Response, event: unknown) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function userIdFrom(req: Request): number {
  const value = Number(req.headers['x-user-id'] ?? 1)
  return Number.isInteger(value) && value > 0 ? value : 1
}

export async function postDirectorAgentChat(req: Request, res: Response) {
  let prepared: Awaited<ReturnType<typeof prepareDirectorTurn>>
  try {
    prepared = await prepareDirectorTurn({
      ...(req.body as DirectorAgentChatRequest),
      userId: userIdFrom(req),
    })
  } catch (error) {
    res.status(error instanceof V2IdempotencyConflictError ? 409 : 500).json({
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })

  for await (const event of streamPreparedDirectorTurn(
    prepared,
    () => streamDirectorAgentChat(prepared.request),
  )) {
    if (!res.destroyed) writeSse(res, event)
  }
  res.end()
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
