import type { ComponentGapReport } from './component-knowledge.js'

export const COMPONENT_AUTHORING_SKILL = {
  name: 'remotion_component_authoring',
  version: 'component_authoring_skill.v1',
  ordered_steps: [
    'build_component_knowledge_base',
    'retrieve_component_capabilities',
    'build_gap_report',
    'reuse_or_fallback_when_possible',
    'generate_only_after_gap_report_allows',
    'validate_generated_component',
    'persist_validation_summary',
  ],
  hard_rules: [
    'Do not generate a component without a gap_report decision of generate.',
    'Do not use generated components that are not verified.',
    'Do not promote a generated component without typecheck, render, and effect validation.',
    'Use stable layer fallback when existing candidates are below reuse threshold.',
  ],
} as const

export interface ComponentAuthoringGate {
  allow: boolean
  decision: ComponentGapReport['decision']
  reason: string
}

export function evaluateComponentAuthoringGate(input: {
  authoringEnabled: boolean
  gapReport: ComponentGapReport
}): ComponentAuthoringGate {
  if (!input.authoringEnabled) {
    return {
      allow: false,
      decision: input.gapReport.decision,
      reason: 'Component authoring is disabled.',
    }
  }
  if (input.gapReport.decision !== 'generate') {
    return {
      allow: false,
      decision: input.gapReport.decision,
      reason: `gap_report decision is ${input.gapReport.decision}; generation is not allowed.`,
    }
  }
  return {
    allow: true,
    decision: 'generate',
    reason: 'gap_report allows component generation.',
  }
}

