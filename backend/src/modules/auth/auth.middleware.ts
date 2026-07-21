import type { Request, Response, NextFunction } from 'express'

/**
 * 鉴权占位：生产环境应校验 JWT / userIdHash
 */
export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.headers['x-user-id']) {
    req.headers['x-user-id'] = '1'
  }
  next()
}
