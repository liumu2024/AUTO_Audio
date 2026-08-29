export function normalizeCreativeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function tokenizeCreativeText(value: string): string[] {
  const normalized = normalizeCreativeText(value)
  const ascii = normalized.match(/[a-z0-9]+/g) ?? []
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? []
  const han = hanRuns.flatMap((run) => {
    const chars = [...run]
    if (chars.length < 2) return chars
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)
  })
  return [...ascii, ...han]
}

export function longestSharedCreativeHanPhrase(left: string, right: string): string {
  const runs = normalizeCreativeText(left).match(/[\p{Script=Han}]+/gu) ?? []
  let best = ''
  for (const run of runs) {
    const chars = [...run]
    for (let length = Math.min(chars.length, 12); length >= 4; length -= 1) {
      if (length <= [...best].length) break
      for (let index = 0; index + length <= chars.length; index += 1) {
        const phrase = chars.slice(index, index + length).join('')
        if (normalizeCreativeText(right).includes(phrase)) {
          best = phrase
          break
        }
      }
    }
  }
  return best
}

export function rankCreativeTextRows<T>(input: {
  rows: T[]
  id: (row: T) => string
  text: (row: T) => string
  updatedAt: (row: T) => Date
  query: string
  limit: number
  minimumScore?: number
}) {
  const minimumScore = input.minimumScore ?? 1.5
  const queryTokens = [...new Set(tokenizeCreativeText(input.query))]
  if (!queryTokens.length) return {
    items: [] as Array<{ row: T; score: number; matchedTerms: string[]; rank: number }>,
    audit: input.rows.map((row) => ({
      row,
      score: 0,
      matchedTerms: [] as string[],
      selected: false,
      reason: 'below_threshold' as const,
    })),
  }
  const documents = input.rows.map((row) => ({ row, terms: tokenizeCreativeText(input.text(row)) }))
  const averageLength = documents.reduce((sum, item) => sum + item.terms.length, 0) / Math.max(1, documents.length)
  const documentFrequencies = new Map<string, number>()
  for (const document of documents) {
    for (const term of new Set(document.terms)) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1)
    }
  }
  const queryText = normalizeCreativeText(input.query)
  const scored = documents.map(({ row, terms }) => {
    const frequencies = new Map<string, number>()
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
    let score = 0
    const matchedTerms: string[] = []
    for (const term of queryTokens) {
      const frequency = frequencies.get(term) ?? 0
      if (!frequency) continue
      matchedTerms.push(term)
      const documentFrequency = documentFrequencies.get(term) ?? 0
      const idf = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5))
      const denominator = frequency + 1.2 * (0.25 + 0.75 * terms.length / Math.max(1, averageLength))
      score += idf * (frequency * 2.2) / denominator
    }
    const rowText = normalizeCreativeText(input.text(row))
    if (rowText.includes(queryText) || queryText.includes(rowText)) score += 3
    const sharedPhrase = longestSharedCreativeHanPhrase(input.text(row), input.query)
    if (sharedPhrase) {
      score += Math.min(3, [...sharedPhrase].length * 0.5)
      matchedTerms.push(sharedPhrase)
    }
    return { row, score, matchedTerms }
  })
  scored.sort((left, right) =>
    right.score - left.score
    || input.updatedAt(right.row).getTime() - input.updatedAt(left.row).getTime()
    || input.id(left.row).localeCompare(input.id(right.row)),
  )
  const eligible = scored.filter((item) => item.score >= minimumScore)
  const items = eligible.slice(0, input.limit).map((item, index) => ({
    row: item.row,
    score: Number(item.score.toFixed(6)),
    matchedTerms: item.matchedTerms,
    rank: index + 1,
  }))
  const selectedIds = new Set(items.map((item) => input.id(item.row)))
  const eligibleRanks = new Map(eligible.map((item, index) => [input.id(item.row), index + 1]))
  return {
    items,
    audit: scored.map((item) => {
      const eligibleRank = eligibleRanks.get(input.id(item.row))
      const selected = selectedIds.has(input.id(item.row))
      return {
        row: item.row,
        score: Number(item.score.toFixed(6)),
        matchedTerms: item.matchedTerms,
        ...(eligibleRank ? { rank: eligibleRank } : {}),
        selected,
        reason: selected
          ? 'selected' as const
          : item.score < minimumScore
            ? 'below_threshold' as const
            : 'top_k_cutoff' as const,
      }
    }),
  }
}

export async function rankHybridCreativeTextRows<T>(input: {
  entityType: 'memory' | 'knowledge'
  rows: T[]
  id: (row: T) => string
  text: (row: T) => string
  updatedAt: (row: T) => Date
  query: string
  limit: number
  minimumScore?: number
}) {
  const candidateLimit = Math.min(input.rows.length, Math.max(input.limit * 3, input.limit + 1))
  const lexical = rankCreativeTextRows({
    ...input,
    limit: candidateLimit,
  })
  if (!input.rows.length) return lexical

  const { scoreCreativeSemantics } = await import('./creative-embedding.js')
  const similarities = await scoreCreativeSemantics({
    entityType: input.entityType,
    rows: input.rows.map((row) => ({ id: input.id(row), text: input.text(row) })),
    query: input.query,
  })
  const semantic = input.rows.map((row) => ({
    row,
    similarity: similarities.get(input.id(row)) ?? -1,
  })).sort((left, right) =>
    right.similarity - left.similarity
    || input.updatedAt(right.row).getTime() - input.updatedAt(left.row).getTime()
    || input.id(left.row).localeCompare(input.id(right.row)),
  )

  const lexicalById = new Map(lexical.audit.map((item) => [input.id(item.row), item]))
  const lexicalRanks = new Map(lexical.items.map((item) => [input.id(item.row), item.rank]))
  const semanticRanks = new Map(semantic.slice(0, candidateLimit)
    .map((item, index) => [input.id(item.row), index + 1]))
  const rrfConstant = 60
  const maximumRrfScore = 2 / (rrfConstant + 1)
  const consensusRankWindow = Math.min(candidateLimit, Math.max(input.limit * 2, input.limit + 1))
  const consensusRrfMinimum = 2 / (rrfConstant + Math.max(1, consensusRankWindow))
  const singleRouteRrfMinimum = 1 / (rrfConstant + Math.max(1, input.limit))
  const minimumSemanticSimilarity = 0.58
  const semanticOnlyMinimumSimilarity = 0.65
  const hasStrongLexicalEvidence = (terms: string[]) => {
    const unique = [...new Set(terms)]
    return unique.length >= 2 || unique.some((term) => {
      const hanLength = term.match(/[\p{Script=Han}]/gu)?.length ?? 0
      return hanLength >= 4 || (/^[a-z0-9]+$/i.test(term) && term.length >= 3)
    })
  }
  const eligible = semantic.map((item) => {
    const id = input.id(item.row)
    const lexicalRank = lexicalRanks.get(id)
    const semanticRank = semanticRanks.get(id)
    const rrfScore = (lexicalRank ? 1 / (rrfConstant + lexicalRank) : 0)
      + (semanticRank ? 1 / (rrfConstant + semanticRank) : 0)
    const matchedTerms = lexicalById.get(id)?.matchedTerms ?? []
    const strongLexicalEvidence = hasStrongLexicalEvidence(matchedTerms)
    const recalledByBoth = lexicalRank !== undefined && semanticRank !== undefined
    const recalledByLexicalOnly = lexicalRank !== undefined && semanticRank === undefined
    const recalledBySemanticOnly = lexicalRank === undefined && semanticRank !== undefined
    const accepted = recalledByBoth
      ? rrfScore >= consensusRrfMinimum
        && (item.similarity >= minimumSemanticSimilarity || strongLexicalEvidence)
      : recalledByLexicalOnly
        ? rrfScore >= singleRouteRrfMinimum && strongLexicalEvidence
        : recalledBySemanticOnly
          ? rrfScore >= singleRouteRrfMinimum && item.similarity >= semanticOnlyMinimumSimilarity
          : false
    return {
      row: item.row,
      score: rrfScore / maximumRrfScore,
      similarity: item.similarity,
      matchedTerms,
      accepted,
    }
  }).filter((item) => item.accepted)
    .sort((left, right) => right.score - left.score
      || right.similarity - left.similarity
      || input.updatedAt(right.row).getTime() - input.updatedAt(left.row).getTime()
      || input.id(left.row).localeCompare(input.id(right.row)))

  const items = eligible.slice(0, input.limit).map((item, index) => ({
    row: item.row,
    score: Number((item.score * 100).toFixed(6)),
    matchedTerms: item.matchedTerms,
    rank: index + 1,
  }))
  const selectedIds = new Set(items.map((item) => input.id(item.row)))
  const eligibleRanks = new Map(eligible.map((item, index) => [input.id(item.row), index + 1]))
  return {
    items,
    audit: semantic.map((item) => {
      const id = input.id(item.row)
      const fused = eligible.find((candidate) => input.id(candidate.row) === id)
      const rank = eligibleRanks.get(id)
      const selected = selectedIds.has(id)
      return {
        row: item.row,
        score: fused ? Number((fused.score * 100).toFixed(6)) : 0,
        matchedTerms: lexicalById.get(id)?.matchedTerms ?? [],
        ...(rank ? { rank } : {}),
        selected,
        reason: selected
          ? 'selected' as const
          : rank
            ? 'top_k_cutoff' as const
            : 'below_threshold' as const,
      }
    }),
  }
}

export async function rankConfiguredCreativeTextRows<T>(input: Parameters<typeof rankCreativeTextRows<T>>[0] & {
  entityType: 'memory' | 'knowledge'
}) {
  const { env } = await import('../../config/env.js')
  if (env.creativeRetrievalMode !== 'hybrid') return rankCreativeTextRows(input)
  try {
    return await rankHybridCreativeTextRows(input)
  } catch (error) {
    console.warn('[creative-retrieval] Vector ranking unavailable; using BM25.', error)
    return rankCreativeTextRows(input)
  }
}
