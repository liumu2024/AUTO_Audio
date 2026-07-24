import type { Request, Response, NextFunction } from 'express'
import path from 'node:path'

import { publishUploadedAsset } from './asset-publisher.js'
import { resolveUploadedFileIdentity } from './upload.service.js'

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

    const identity = await resolveUploadedFileIdentity(file)
    const canonicalFile = {
      ...file,
      path: identity.filePath,
      filename: identity.filename,
    }
    const requirePublicUrl =
      booleanish(req.body?.requirePublicUrl) ||
      req.body?.publication === 'external'
    const publication = await publishUploadedAsset(canonicalFile, { requirePublicUrl })
    res.status(201).json({
      url: publication.publicUrl ?? publication.localUrl,
      publicUrl: publication.publicUrl,
      localUrl: publication.localUrl,
      localPath: identity.filePath,
      filename: path.basename(identity.filePath),
      size: file.size,
      mimetype: file.mimetype,
      contentHash: identity.contentHash,
      duplicateOf: identity.duplicateOf,
      publication,
    })
  } catch (e) {
    next(e)
  }
}
