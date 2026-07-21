import { getAnchorLabel, type SemanticAnchor } from '@/types/migration-protocol'

const GAP_SEGMENT_LABELS: Record<string, string> = {
  hook: '开场 Hook 镜头',
  pain_amplify: '痛点引入镜头',
  product_demo: '产品演示镜头',
  demo: '产品演示镜头',
  cta: '结尾 CTA 镜头',
}

export function getGapSegmentLabel(anchor: SemanticAnchor): string {
  const role = anchor.logic_intent.marketing_role
  return GAP_SEGMENT_LABELS[role] ?? `${getAnchorLabel(anchor)} 镜头`
}

export function getGapWarningMessage(anchor: SemanticAnchor): string {
  return `检测到结构缺口：缺少 [${getGapSegmentLabel(anchor)}]`
}
