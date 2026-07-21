import { randomUUID } from 'node:crypto'
import path from 'node:path'

import multer from 'multer'

import { ensureUploadDir } from './upload.service.js'

/** 直接落盘到 backend/uploads，避免 Windows 跨盘 rename (EXDEV) */
export const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        const dir = await ensureUploadDir()
        cb(null, dir)
      } catch (e) {
        cb(e as Error, '')
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ''
      cb(null, `${randomUUID()}${ext}`)
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
})
