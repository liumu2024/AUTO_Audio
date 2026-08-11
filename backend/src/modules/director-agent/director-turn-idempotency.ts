import { randomUUID } from 'node:crypto'

import type { DirectorAgentStreamEvent } from '../../../../shared/types/director-stream.js'
import {
  createV2IdempotencyRepository,
  type V2IdempotencyRepository,
  v2IdempotencyRequestHash,
} from '../../pipeline-v2/idempotency-repository.js'
import type { DirectorAgentChatRequest } from './director-agent.types.js'

type NormalizedDirectorTurnRequest = DirectorAgentChatRequest & {
  userId: number
  workspaceSessionId: string
  turnRequestId: string
}

export interface PreparedDirectorTurn {
  request: NormalizedDirectorTurnRequest
  repository: V2IdempotencyRepository
  reservation: Awaited<ReturnType<V2IdempotencyRepository['reserve']>>
}

const workspaceTurnTails = new Map<string, Promise<void>>()

async function acquireWorkspaceTurn(key: string): Promise<() => void> {
  const previous = workspaceTurnTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  workspaceTurnTails.set(key, tail)
  await previous
  return () => {
    release()
    if (workspaceTurnTails.get(key) === tail) workspaceTurnTails.delete(key)
  }
}

export function normalizeDirectorWorkspaceId(value: string | undefined): string {
  const candidate = value?.trim()
  return candidate && /^[a-zA-Z0-9_-]{8,100}$/.test(candidate)
    ? candidate
    : `v2_director_${randomUUID()}`
}

function replayEvents(value: unknown): DirectorAgentStreamEvent[] {
  if (!value || typeof value !== 'object') return []
  const events = (value as { events?: unknown }).events
  return Array.isArray(events) ? events as DirectorAgentStreamEvent[] : []
}

function isFinalEvent(event: DirectorAgentStreamEvent): boolean {
  return event.type === 'assistant_reply'
    || event.type === 'workspace_session'
    || event.type === 'done'
    || event.type === 'error'
}

export async function prepareDirectorTurn(
  input: DirectorAgentChatRequest,
  repository = createV2IdempotencyRepository(),
): Promise<PreparedDirectorTurn> {
  const request: NormalizedDirectorTurnRequest = {
    ...input,
    userId: input.userId ?? 1,
    workspaceSessionId: normalizeDirectorWorkspaceId(input.workspaceSessionId),
    turnRequestId: input.turnRequestId?.trim().slice(0, 200) || randomUUID(),
  }
  const { turnRequestId, workspaceSessionId, userId, ...requestBody } = request
  const reservation = await repository.reserve({
    userId,
    draftId: request.context.currentTimeline?.draftId,
    operation: 'director.turn',
    idempotencyKey: turnRequestId,
    resourceKey: workspaceSessionId,
    requestHash: v2IdempotencyRequestHash({
      workspaceSessionId,
      workspaceStateRevision: request.workspaceStateRevision ?? 0,
      request: requestBody,
    }),
  })
  return { request, repository, reservation }
}

export async function* streamPreparedDirectorTurn(
  prepared: PreparedDirectorTurn,
  execute: () => AsyncGenerator<DirectorAgentStreamEvent>,
): AsyncGenerator<DirectorAgentStreamEvent> {
  const { receipt } = prepared.reservation
  const turnRequestId = prepared.request.turnRequestId

  if (prepared.reservation.kind === 'replay') {
    if (receipt.status === 'running') {
      yield { type: 'turn_receipt', turnRequestId, status: 'running' }
      yield { type: 'done' }
      return
    }
    const events = replayEvents(receipt.resultJson)
    yield {
      type: 'turn_receipt',
      turnRequestId,
      status: receipt.status === 'completed' ? 'replayed' : 'failed',
    }
    if (events.length) {
      for (const event of events) yield event
      return
    }
    yield { type: 'error', message: receipt.failure?.message ?? 'The stored Director result is unavailable.' }
    yield { type: 'done' }
    return
  }

  yield { type: 'turn_receipt', turnRequestId, status: 'running' }
  const releaseWorkspace = await acquireWorkspaceTurn(
    `${prepared.request.userId}:${prepared.request.workspaceSessionId}`,
  )
  try {
    const finalEvents: DirectorAgentStreamEvent[] = []
    try {
      for await (const event of execute()) {
        if (isFinalEvent(event)) finalEvents.push(event)
        else yield event
      }
      const errorEvent = finalEvents.find((event) => event.type === 'error')
      await prepared.repository.update({
        id: receipt.id,
        status: errorEvent ? 'failed' : 'completed',
        resultJson: { events: finalEvents },
        ...(errorEvent
          ? { failure: { code: 'request_rejected', message: errorEvent.message } }
          : {}),
      })
      for (const event of finalEvents) yield event
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const events: DirectorAgentStreamEvent[] = [{ type: 'error', message }, { type: 'done' }]
      await prepared.repository.update({
        id: receipt.id,
        status: 'failed',
        failure: { code: 'director_turn_failed', message },
        resultJson: { events },
      })
      for (const event of events) yield event
    }
  } finally {
    releaseWorkspace()
  }
}
