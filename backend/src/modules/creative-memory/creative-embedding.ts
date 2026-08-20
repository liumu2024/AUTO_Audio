import { env as transformersEnv, pipeline } from '@huggingface/transformers'
import { createHash } from 'node:crypto'

import { env } from '../../config/env.js'
import { prisma } from '../../shared/prisma.service.js'

export const CREATIVE_EMBEDDING_MODEL = 'Xenova/bge-small-zh-v1.5'
export const CREATIVE_EMBEDDING_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781'
export const CREATIVE_EMBEDDING_DIMENSIONS = 512
const CREATIVE_EMBEDDING_VERSION = `${CREATIVE_EMBEDDING_MODEL}@${CREATIVE_EMBEDDING_REVISION}`

type Extractor = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>

let extractorPromise: Promise<Extractor> | undefined

async function extractor(): Promise<Extractor> {
  transformersEnv.remoteHost = env.creativeEmbeddingRemoteHost
  extractorPromise ??= pipeline('feature-extraction', CREATIVE_EMBEDDING_MODEL, {
    dtype: 'q8',
    revision: CREATIVE_EMBEDDING_REVISION,
  })
  return extractorPromise
}

export async function embedCreativeTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  const output = await (await extractor())(texts, { pooling: 'mean', normalize: true })
  const vectors = output.tolist() as number[][]
  if (vectors.some((vector) => vector.length !== CREATIVE_EMBEDDING_DIMENSIONS)) {
    throw new Error('Creative embedding model returned an unexpected vector size.')
  }
  return vectors
}

export type CreativeEmbeddingEntityType = 'memory' | 'knowledge'

function contentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

export async function scoreCreativeSemantics(input: {
  entityType: CreativeEmbeddingEntityType
  rows: Array<{ id: string; text: string }>
  query: string
}): Promise<Map<string, number>> {
  if (!input.rows.length) return new Map()
  const queryText = `为这个句子生成表示以用于检索相关文章：${input.query}`
  if (process.env.DPL304_LOCAL_MODE === 'true') {
    const [queryVector, ...rowVectors] = await embedCreativeTexts([queryText, ...input.rows.map((row) => row.text)])
    return new Map(input.rows.map((row, index) => [
      row.id,
      queryVector!.reduce((sum, value, dimension) => sum + value * rowVectors[index]![dimension]!, 0),
    ]))
  }

  const hashes = new Map(input.rows.map((row) => [row.id, contentHash(row.text)]))
  const existing = await prisma.$queryRawUnsafe<Array<{ entity_id: string; content_hash: string }>>(
    `SELECT entity_id, content_hash
       FROM creative_retrieval_embeddings
      WHERE entity_type = $1
        AND model = $2
        AND entity_id = ANY($3::text[])`,
    input.entityType,
    CREATIVE_EMBEDDING_VERSION,
    input.rows.map((row) => row.id),
  )
  const current = new Map(existing.map((row) => [row.entity_id, row.content_hash]))
  const stale = input.rows.filter((row) => current.get(row.id) !== hashes.get(row.id))
  if (stale.length) {
    const vectors = await embedCreativeTexts(stale.map((row) => row.text))
    await Promise.all(stale.map((row, index) => prisma.$executeRawUnsafe(
      `INSERT INTO creative_retrieval_embeddings
         (entity_type, entity_id, content_hash, model, embedding, updated_at)
       VALUES ($1, $2, $3, $4, $5::vector, NOW())
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         model = EXCLUDED.model,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()`,
      input.entityType,
      row.id,
      hashes.get(row.id),
      CREATIVE_EMBEDDING_VERSION,
      vectorLiteral(vectors[index]!),
    )))
  }
  const [queryVector] = await embedCreativeTexts([queryText])
  const scored = await prisma.$queryRawUnsafe<Array<{ entity_id: string; similarity: number }>>(
    `SELECT entity_id, 1 - (embedding <=> $1::vector) AS similarity
       FROM creative_retrieval_embeddings
      WHERE entity_type = $2
        AND model = $3
        AND entity_id = ANY($4::text[])`,
    vectorLiteral(queryVector!),
    input.entityType,
    CREATIVE_EMBEDDING_VERSION,
    input.rows.map((row) => row.id),
  )
  return new Map(scored.map((row) => [row.entity_id, Number(row.similarity)]))
}
