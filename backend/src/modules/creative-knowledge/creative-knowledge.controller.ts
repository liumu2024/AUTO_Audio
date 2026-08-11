import type { Request, Response } from 'express'

import {
  deleteCreativeKnowledge,
  listCreativeKnowledge,
  searchCreativeKnowledge as searchKnowledge,
  updateCreativeKnowledge,
  type CreativeKnowledgeStatus,
} from './creative-knowledge.service.js'

function status(value: unknown): CreativeKnowledgeStatus | undefined {
  return value === 'active' || value === 'candidate' || value === 'revoked' ? value : undefined
}

export async function getCreativeKnowledge(req: Request, res: Response) {
  res.json({ knowledge: await listCreativeKnowledge({
    status: status(req.query.status),
    limit: Number(req.query.limit) || undefined,
  }) })
}

export async function searchCreativeKnowledge(req: Request, res: Response) {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) {
    res.status(400).json({ error: 'q is required.' })
    return
  }
  res.json(await searchKnowledge({ query, limit: Number(req.query.limit) || undefined }))
}

export async function patchCreativeKnowledge(req: Request, res: Response) {
  const nextStatus = req.body?.status === undefined ? undefined : status(req.body.status)
  if (req.body?.status !== undefined && !nextStatus) {
    res.status(400).json({ error: 'Invalid creative knowledge status.' })
    return
  }
  res.json({ knowledge: await updateCreativeKnowledge({
    id: String(req.params.knowledgeId),
    statement: typeof req.body?.statement === 'string' ? req.body.statement : undefined,
    applicability: typeof req.body?.applicability === 'string' ? req.body.applicability : undefined,
    status: nextStatus,
  }) })
}

export async function removeCreativeKnowledge(req: Request, res: Response) {
  if (!await deleteCreativeKnowledge(String(req.params.knowledgeId))) {
    res.status(404).json({ error: 'Creative knowledge not found.' })
    return
  }
  res.json({ deleted: true })
}
