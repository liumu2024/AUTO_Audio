import type { ConnectionOptions } from 'bullmq'
import { Redis } from 'ioredis'

import { env } from './env.js'

let redisClient: Redis | null = null

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.redisUrl, {
      maxRetriesPerRequest: null,
    })
  }
  return redisClient
}

export function getBullmqConnection(): ConnectionOptions {
  return {
    host: new URL(env.redisUrl).hostname,
    port: Number(new URL(env.redisUrl).port || 6379),
  }
}

export const QUEUE_NAMES = {
  ANALYZER: 'video-analyzer-queue',
  GENERATOR: 'video-generator-queue',
} as const
