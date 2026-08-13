import type { V2AgentToolAuthorizationGrant } from './dispatcher.js'

/**
 * Delivery permission is derived from the core model's coherent decision for
 * the current user turn. It never depends on the model copying an exact phrase
 * from the prompt and it never authorizes read/draft Tools.
 */
export function deliveryAuthorizationFromDirectorDecision(input: {
  prompt: string
  intent?: 'chat' | 'create' | 'revise' | 'execute' | 'clarify'
  requestsDelivery: boolean
}): V2AgentToolAuthorizationGrant | undefined {
  if (
    !input.requestsDelivery ||
    input.intent !== 'execute' ||
    !input.prompt.trim()
  ) {
    return undefined
  }
  return { granted: true, evidence: input.prompt.trim() }
}

/** A pending edit is discarded only by a coherent user-authorized turn. */
export function pendingDismissalAuthorizationFromDirectorDecision(input: {
  prompt: string
  intent?: 'chat' | 'create' | 'revise' | 'execute' | 'clarify'
  requestedCallId?: string
  pendingRevisions: ReadonlyArray<{ callId: string }>
}): V2AgentToolAuthorizationGrant | undefined {
  const prompt = input.prompt.trim()
  const explicitlyAbandonsPendingChange = prompt
    .split(/[，。；！？,.;!?\n]/u)
    .some((clause) => {
      const trimmed = clause.trim()
      if (!trimmed) return false
      if (/(?:不想|不要|不能|别|不应|不可|并非|不是).{0,8}(?:放弃|取消|作废|忽略|清除)/u.test(trimmed)) return false
      if (/\b(?:do not|don't|not|never)\b.{0,24}\b(?:abandon|discard|cancel|dismiss)\b/iu.test(trimmed)) return false
      if (/(?:如果|假如|若是|要是|是否|能否|可否|为什么|怎么|怎样|会不会|想知道|考虑是否|(?:\bwhat|\bwhy|\bhow|\bwould|\bcould|\bshould|\bif|\bwhether|\bwonder)\b)/iu.test(trimmed)) return false
      if (/[？?]/u.test(input.prompt)) return false
      const abandons = /^(?:(?:请|我要|我决定|我选择|现在|直接|明确|确认)[，,\s]*){0,2}(?:放弃|取消|作废|忽略|清除)|^(?:(?:please|i (?:want|choose|decide) to|now|explicitly|confirm)[,\s]*){0,2}(?:abandon|discard|cancel|dismiss)\b/iu.test(trimmed)
      const targetsPending = /(?:失败|未完成|待处理|挂起).{0,12}(?:修改|修订|要求|任务|操作|事项|项)|(?:修改|修订|要求|任务|操作|事项|项).{0,12}(?:失败|未完成|待处理|挂起)|\b(?:failed|pending|unfinished).{0,24}(?:edit|revision|request|task|change)\b|\b(?:edit|revision|request|task|change).{0,24}(?:failed|pending|unfinished)\b/iu.test(trimmed)
      return abandons && targetsPending
    })
  if (
    input.pendingRevisions.length !== 1
    || input.pendingRevisions[0]?.callId !== input.requestedCallId
    || (input.intent !== 'revise' && input.intent !== 'execute')
    || !explicitlyAbandonsPendingChange
  ) return undefined
  return { granted: true, evidence: prompt }
}
