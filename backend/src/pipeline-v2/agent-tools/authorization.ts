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
