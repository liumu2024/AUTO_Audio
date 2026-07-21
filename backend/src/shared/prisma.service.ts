import { PrismaClient } from '@prisma/client'

import { localPrisma } from './local-prisma.service.js'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
}

export const prisma: PrismaClient =
  process.env.DPL304_LOCAL_MODE === 'true'
    ? (localPrisma as unknown as PrismaClient)
    : globalForPrisma.prisma ??
      new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      })

if (process.env.NODE_ENV !== 'production' && process.env.DPL304_LOCAL_MODE !== 'true') {
  globalForPrisma.prisma = prisma
}
