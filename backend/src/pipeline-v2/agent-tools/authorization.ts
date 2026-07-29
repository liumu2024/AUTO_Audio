import type { V2AgentToolAuthorizationGrant } from './dispatcher.js'

/**
 * Delivery permission is derived from the core model's coherent decision for
 * the current user turn. It never depends on the model copying an exact phrase
 * from the prompt and it never authorizes read/draft Tools.
 */
export function deliveryAuthorizationFromDirectorDecision(input: {
  prompt: string
  executionEffect: 'none' | 'workspace_change' | 'draft_change' | 'delivery'
  nextAction: string
  conversationIntent?: 'chat' | 'create' | 'revise' | 'execute' | 'clarify'
}): V2AgentToolAuthorizationGrant | undefined {
  if (
    input.executionEffect !== 'delivery' ||
    input.nextAction !== 'RENDER' ||
    input.conversationIntent !== 'execute' ||
    !input.prompt.trim()
  ) {
    return undefined
  }
  return { granted: true, evidence: input.prompt.trim() }
}
