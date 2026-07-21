import type { Request, Response, NextFunction } from 'express'
import path from 'node:path'

import { publishUploadedAsset } from './asset-publisher.js'

function booleanish(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'required'
}

export async function postUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'file is required (multipart field "file")' })
      return
    }

    const requirePublicUrl =
      booleanish(req.body?.requirePublicUrl) ||
      req.body?.publication === 'external'
    const publication = await publishUploadedAsset(file, { requirePublicUrl })
    res.status(201).json({
      url: publication.publicUrl ?? publication.localUrl,
      publicUrl: publication.publicUrl,
      localUrl: publication.localUrl,
      localPath: file.path,
      filename: path.basename(file.path),
      size: file.size,
      mimetype: file.mimetype,
      publication,
    })
  } catch (e) {
    next(e)
  }
}
