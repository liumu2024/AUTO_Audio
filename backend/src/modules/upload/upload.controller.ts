import type { Request, Response, NextFunction } from 'express'
import path from 'node:path'

import { publicUrlForUploadedFile } from './upload.service.js'

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

    const url = publicUrlForUploadedFile(file)
    res.status(201).json({
      url,
      filename: path.basename(file.path),
      size: file.size,
      mimetype: file.mimetype,
    })
  } catch (e) {
    next(e)
  }
}
