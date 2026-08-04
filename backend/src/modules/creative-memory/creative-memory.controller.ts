import type { Request, Response } from 'express'

import {
  createCreativeMemory,
  deleteCreativeMemory,
  listCreativeMemories,
  searchCreativeMemories as searchCreativeMemoriesService,
  updateCreativeMemory,
  type CreativeMemoryScope,
  type CreativeMemoryStatus,
} from './creative-memory.service.js'

function userIdFrom(req: Request): number {
  const value = Number(req.headers['x-user-id'] ?? 1)
  return Number.isInteger(value) && value > 0 ? value : 1
}

function scope(value: unknown): CreativeMemoryScope | undefined {
  return value === 'user' || value === 'draft' ? value : undefined
}

function status(value: unknown): CreativeMemoryStatus | undefined {
  return value === 'active' || value === 'candidate' || value === 'revoked'
    ? value
    : undefined
}

export async function getCreativeMemories(req: Request, res: Response) {
  const records = await listCreativeMemories({
    userId: userIdFrom(req),
    draftId: typeof req.query.draftId === 'string' ? req.query.draftId : undefined,
    scopeType: scope(req.query.scopeType),
    status: status(req.query.status),
    limit: Number(req.query.limit) || undefined,
  })
  res.json({ memories: records })
}

export async function searchCreativeMemories(req: Request, res: Response) {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) {
    res.status(400).json({ error: 'q is required.' })
    return
  }
  const result = await searchCreativeMemoriesService({
    userId: userIdFrom(req),
    draftId: typeof req.query.draftId === 'string' ? req.query.draftId : undefined,
    query,
    activeLimit: Number(req.query.activeLimit) || undefined,
    candidateLimit: Number(req.query.candidateLimit) || undefined,
  })
  res.json(result)
}

export async function postCreativeMemory(req: Request, res: Response) {
  const scopeType = scope(req.body?.scopeType)
  if (!scopeType) {
    res.status(400).json({ error: 'scopeType must be user or draft.' })
    return
  }
  const memory = await createCreativeMemory({
    userId: userIdFrom(req),
    scopeType,
    draftId: typeof req.body?.draftId === 'string' ? req.body.draftId : undefined,
    statement: typeof req.body?.statement === 'string' ? req.body.statement : '',
    status: 'active',
    origin: 'explicit',
    sourceWorkspaceSessionId:
      typeof req.body?.sourceWorkspaceSessionId === 'string'
        ? req.body.sourceWorkspaceSessionId
        : undefined,
    sourceTurnIds: [],
    sourceExcerpt: typeof req.body?.statement === 'string' ? req.body.statement : undefined,
  })
  res.status(201).json({ memory })
}

export async function patchCreativeMemory(req: Request, res: Response) {
  const nextStatus = req.body?.status === undefined ? undefined : status(req.body.status)
  if (req.body?.status !== undefined && !nextStatus) {
    res.status(400).json({ error: 'Invalid creative memory status.' })
    return
  }
  const memory = await updateCreativeMemory({
    userId: userIdFrom(req),
    id: String(req.params.memoryId),
    statement: typeof req.body?.statement === 'string' ? req.body.statement : undefined,
    status: nextStatus,
  })
  res.json({ memory })
}

export async function removeCreativeMemory(req: Request, res: Response) {
  const deleted = await deleteCreativeMemory({
    userId: userIdFrom(req),
    id: String(req.params.memoryId),
  })
  if (!deleted) {
    res.status(404).json({ error: 'Creative memory not found.' })
    return
  }
  res.json({ deleted: true })
}
