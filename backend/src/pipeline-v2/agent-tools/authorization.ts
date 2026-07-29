function groundedEvidence(prompt: string, evidence: string | undefined): string | undefined {
  const candidate = evidence?.trim()
  if (!candidate) return undefined
  return prompt.includes(candidate) ? candidate : undefined
}

export function bindToolAuthorizationEvidence<
  T extends { authorizationEvidence?: string },
>(input: {
  prompt: string
  decisionAuthorizationEvidence?: string
  requests: T[]
}): T[] {
  const decisionEvidence = groundedEvidence(
    input.prompt,
    input.decisionAuthorizationEvidence,
  )

  return input.requests.map((request) => ({
    ...request,
    authorizationEvidence:
      groundedEvidence(input.prompt, request.authorizationEvidence) ??
      decisionEvidence,
  }))
}
