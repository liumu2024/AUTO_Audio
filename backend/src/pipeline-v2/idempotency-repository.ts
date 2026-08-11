import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'

import { prisma } from '../shared/prisma.service.js'

export type V2IdempotencyStatus = 'running' | 'completed' | 'failed'
export type V2IdempotencyPhase = 'reserved' | 'submitting' | 'polling' | 'rendering'

export interface V2IdempotencyReceiptRecord {
  id: string
  userId: number
  draftId?: string
  operation: string
  idempotencyKey: string
  resourceKey: string
  requestHash: string
  status: V2IdempotencyStatus
  phase?: V2IdempotencyPhase
  resultRef?: string
  resultJson?: unknown
  providerTaskId?: string
  failure?: { code: string; message: string }
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
}

export class V2IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different request.')
  }
}

export class V2IdempotencyOperationFailedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'V2IdempotencyOperationFailedError'
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function v2IdempotencyRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function fromRow(row: Record<string, unknown>): V2IdempotencyReceiptRecord {
  return {
    id: String(row.id),
    userId: Number(row.userId),
    draftId: row.draftId == null ? undefined : String(row.draftId),
    operation: String(row.operation),
    idempotencyKey: String(row.idempotencyKey),
    resourceKey: String(row.resourceKey),
    requestHash: String(row.requestHash),
    status: row.status as V2IdempotencyStatus,
    phase: (row.phase as V2IdempotencyPhase | null) ?? undefined,
    resultRef: (row.resultRef as string | null) ?? undefined,
    resultJson: row.resultJson ?? undefined,
    providerTaskId: (row.providerTaskId as string | null) ?? undefined,
    failure: (row.failureJson as V2IdempotencyReceiptRecord['failure'] | null) ?? undefined,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    completedAt: (row.completedAt as Date | null) ?? undefined,
  }
}

export interface V2IdempotencyRepository {
  reserve(input: {
    userId: number
    draftId?: string
    operation: string
    idempotencyKey: string
    resourceKey: string
    requestHash: string
    resultRef?: string
  }): Promise<{ kind: 'reserved' | 'replay'; receipt: V2IdempotencyReceiptRecord }>
  get(input: { userId: number; operation: string; idempotencyKey: string }): Promise<V2IdempotencyReceiptRecord | null>
  update(input: {
    id: string
    status?: V2IdempotencyStatus
    phase?: V2IdempotencyPhase
    resultRef?: string
    resultJson?: unknown
    providerTaskId?: string
    failure?: V2IdempotencyReceiptRecord['failure']
  }): Promise<V2IdempotencyReceiptRecord>
}

export type V2JsonIdempotentOperationResult<T> =
  | { kind: 'executed' | 'replayed'; value: T; receipt: V2IdempotencyReceiptRecord }
  | { kind: 'running'; receipt: V2IdempotencyReceiptRecord }
  | { kind: 'failed'; value?: T; receipt: V2IdempotencyReceiptRecord }

function storedJsonValue<T>(value: unknown): T | undefined {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'value')) return undefined
  return (value as { value: T }).value
}

export async function executeV2JsonIdempotentOperation<T>(input: {
  repository?: V2IdempotencyRepository
  reservation: Parameters<V2IdempotencyRepository['reserve']>[0]
  execute: () => Promise<T>
  failureFromResult?: (value: T) => V2IdempotencyReceiptRecord['failure'] | undefined
}): Promise<V2JsonIdempotentOperationResult<T>> {
  const repository = input.repository ?? createV2IdempotencyRepository()
  const reservation = await repository.reserve(input.reservation)
  if (reservation.kind === 'replay') {
    const value = storedJsonValue<T>(reservation.receipt.resultJson)
    if (reservation.receipt.status === 'running') {
      return { kind: 'running', receipt: reservation.receipt }
    }
    if (reservation.receipt.status === 'failed') {
      if (value === undefined) {
        throw new V2IdempotencyOperationFailedError(
          reservation.receipt.failure?.code ?? 'operation_failed',
          reservation.receipt.failure?.message ?? 'The idempotent operation failed.',
        )
      }
      return { kind: 'failed', ...(value === undefined ? {} : { value }), receipt: reservation.receipt }
    }
    if (value === undefined) {
      throw new Error(`Idempotent result ${reservation.receipt.id} is missing resultJson.`)
    }
    return { kind: 'replayed', value, receipt: reservation.receipt }
  }

  try {
    const value = await input.execute()
    const failure = input.failureFromResult?.(value)
    const receipt = await repository.update({
      id: reservation.receipt.id,
      status: failure ? 'failed' : 'completed',
      resultJson: { value },
      ...(failure ? { failure } : {}),
    })
    return failure
      ? { kind: 'failed', value, receipt }
      : { kind: 'executed', value, receipt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = { code: 'operation_failed', message }
    await repository.update({
      id: reservation.receipt.id,
      status: 'failed',
      failure,
    })
    throw new V2IdempotencyOperationFailedError(failure.code, failure.message)
  }
}

export function createV2IdempotencyRepository(): V2IdempotencyRepository {
  return {
    async get(input) {
      const row = await prisma.v2IdempotencyReceipt.findFirst({
        where: {
          userId: input.userId,
          operation: input.operation,
          idempotencyKey: input.idempotencyKey,
        },
      })
      return row ? fromRow(row as unknown as Record<string, unknown>) : null
    },
    async reserve(input) {
      try {
        const row = await prisma.v2IdempotencyReceipt.create({
          data: {
            id: `v2_idem_${randomUUID()}`,
            ...input,
            status: 'running',
            phase: 'reserved',
          },
        })
        return { kind: 'reserved', receipt: fromRow(row as unknown as Record<string, unknown>) }
      } catch (error) {
        const existing = await this.get(input)
        if (!existing) throw error
        if (existing.requestHash !== input.requestHash || existing.resourceKey !== input.resourceKey || existing.draftId !== input.draftId) {
          throw new V2IdempotencyConflictError()
        }
        return { kind: 'replay', receipt: existing }
      }
    },
    async update(input) {
      const row = await prisma.v2IdempotencyReceipt.update({
        where: { id: input.id },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.phase ? { phase: input.phase } : {}),
          ...(input.resultRef ? { resultRef: input.resultRef } : {}),
          ...(Object.prototype.hasOwnProperty.call(input, 'resultJson')
            ? { resultJson: input.resultJson as Prisma.InputJsonValue }
            : {}),
          ...(input.providerTaskId ? { providerTaskId: input.providerTaskId } : {}),
          ...(input.failure ? { failureJson: input.failure } : {}),
          ...(input.status === 'completed' || input.status === 'failed' ? { completedAt: new Date() } : {}),
        },
      })
      return fromRow(row as unknown as Record<string, unknown>)
    },
  }
}
