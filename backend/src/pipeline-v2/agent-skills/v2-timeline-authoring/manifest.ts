export const manifest = {
  id: 'v2-timeline-authoring',
  version: '1.1.0',
  card: '创建或整体修订 V2 时间线；逐镜头决定 AI、Remotion 或混合视觉策略。',
  stage: 'authoring',
  tools: ['material.inspect', 'timeline.plan', 'timeline.patch'],
  dependencies: [],
  prerequisites: ['当前用户目标与 V2 输入事实'],
  requiredFacts: ['有效画幅与时长', '样例/素材真实可用状态', '当前草稿版本（修订时）'],
  outputRequirements: ['只通过 V2 Tool 生成或修订 RemotionTimelineSpecV1 草稿'],
  validation: ['V2 结构校验', '修订语义审查', '未要求范围保持不变'],
  recovery: '保留当前会话和基础草稿，修正要求或协议后重试。',
} as const
