import { randomUUID, timingSafeEqual } from 'node:crypto'

import type { Request, Response } from 'express'

import { env } from '../../config/env.js'
import {
  createManualCreativeKnowledgeCandidate,
  CreativeKnowledgeAlreadyExistsError,
  deleteCreativeKnowledge,
  getCreativeKnowledgeById,
  listCreativeKnowledgePage,
  searchCreativeKnowledge as searchKnowledge,
  updateCreativeKnowledge,
  type CreativeKnowledgeStatus,
} from './creative-knowledge.service.js'

function userIdFrom(req: Request): number {
  const value = Number(req.headers['x-user-id'] ?? 1)
  return Number.isInteger(value) && value > 0 ? value : 1
}

function status(value: unknown): CreativeKnowledgeStatus | undefined {
  return value === 'active' || value === 'candidate' || value === 'revoked' ? value : undefined
}

function adminAuthorized(req: Request): boolean {
  const configured = env.creativeKnowledgeAdminToken
  const authorization = req.headers.authorization
  if (!configured || !authorization?.startsWith('Bearer ')) return false
  const supplied = authorization.slice('Bearer '.length)
  const expectedBuffer = Buffer.from(configured)
  const suppliedBuffer = Buffer.from(supplied)
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer)
}

function requireAdmin(req: Request, res: Response): boolean {
  if (adminAuthorized(req)) return true
  res.status(403).json({ error: 'Creative knowledge administrator authorization is required.' })
  return false
}

export async function getCreativeKnowledge(req: Request, res: Response) {
  const requestedStatus = status(req.query.status)
  const isAdmin = adminAuthorized(req)
  if (!isAdmin && requestedStatus === 'revoked') {
    res.status(403).json({ error: 'Creative knowledge administrator authorization is required.' })
    return
  }
  const page = await listCreativeKnowledgePage({
    status: requestedStatus ?? (isAdmin ? undefined : 'active'),
    ...(!isAdmin && requestedStatus === 'candidate' ? { createdByUserId: userIdFrom(req) } : {}),
    offset: Number(req.query.offset) || undefined,
    limit: Number(req.query.limit) || undefined,
  })
  res.json({ knowledge: page.items, total: page.total, offset: page.offset, limit: page.limit })
}

export async function postCreativeKnowledge(req: Request, res: Response) {
  try {
    const knowledge = await createManualCreativeKnowledgeCandidate({
      userId: userIdFrom(req),
      statement: typeof req.body?.statement === 'string' ? req.body.statement : '',
      applicability: typeof req.body?.applicability === 'string' ? req.body.applicability : '',
      sourceId: `manual:${userIdFrom(req)}:${randomUUID()}`,
      sourceTitle: '用户提交的待审核方法',
    })
    res.status(201).json({ knowledge })
  } catch (error) {
    if (error instanceof CreativeKnowledgeAlreadyExistsError) {
      res.status(409).json({ error: 'Creative knowledge already exists.' })
      return
    }
    throw error
  }
}

export async function searchCreativeKnowledge(req: Request, res: Response) {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) {
    res.status(400).json({ error: 'q is required.' })
    return
  }
  const requestedStatus = status(req.query.status)
  const isAdmin = adminAuthorized(req)
  if (!isAdmin && requestedStatus === 'revoked') {
    res.status(403).json({ error: 'Creative knowledge administrator authorization is required.' })
    return
  }
  res.json(await searchKnowledge({
    query,
    limit: Number(req.query.limit) || undefined,
    statuses: requestedStatus
      ? [requestedStatus]
      : isAdmin ? ['active', 'candidate', 'revoked'] : ['active'],
    requireReviewed: !isAdmin,
    ...(!isAdmin && requestedStatus === 'candidate' ? { createdByUserId: userIdFrom(req) } : {}),
  }))
}

export async function patchCreativeKnowledge(req: Request, res: Response) {
  const nextStatus = req.body?.status === undefined ? undefined : status(req.body.status)
  if (req.body?.status !== undefined && !nextStatus) {
    res.status(400).json({ error: 'Invalid creative knowledge status.' })
    return
  }
  const id = String(req.params.knowledgeId)
  const current = await getCreativeKnowledgeById(id)
  if (!current) {
    res.status(404).json({ error: 'Creative knowledge not found.' })
    return
  }
  const isAdmin = adminAuthorized(req)
  const ownerMayEditCandidate = current.status === 'candidate'
    && current.createdByUserId === userIdFrom(req)
    && nextStatus === undefined
  if (!isAdmin && !ownerMayEditCandidate) {
    requireAdmin(req, res)
    return
  }
  res.json({ knowledge: await updateCreativeKnowledge({
    id,
    statement: typeof req.body?.statement === 'string' ? req.body.statement : undefined,
    applicability: typeof req.body?.applicability === 'string' ? req.body.applicability : undefined,
    status: nextStatus,
    editedByUserId: userIdFrom(req),
    ...(nextStatus === 'active' ? { reviewedBy: `admin-user:${userIdFrom(req)}` } : {}),
  }) })
}

export async function removeCreativeKnowledge(req: Request, res: Response) {
  const id = String(req.params.knowledgeId)
  const current = await getCreativeKnowledgeById(id)
  if (!current) {
    res.status(404).json({ error: 'Creative knowledge not found.' })
    return
  }
  const ownerMayDeleteCandidate = current.status === 'candidate'
    && current.createdByUserId === userIdFrom(req)
  if (!adminAuthorized(req) && !ownerMayDeleteCandidate) {
    requireAdmin(req, res)
    return
  }
  if (!await deleteCreativeKnowledge(id)) {
    res.status(409).json({ error: 'Creative knowledge changed before deletion.' })
    return
  }
  res.json({ deleted: true })
}
