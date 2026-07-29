export const manifest = {
  id: 'sample-reference-analysis',
  version: '1.1.0',
  card: '将用户选中的样例仅作为节奏、结构与风格参考，不复制画面或文案。',
  stage: 'analysis',
  tools: ['sample.analyze', 'timeline.plan'],
  dependencies: [],
  prerequisites: ['用户明确选中的样例视频'],
  requiredFacts: ['样例 ID 与可读取地址', '用户希望借鉴的维度'],
  outputRequirements: ['样例理解事实或引用这些事实的 V2 时间线草稿'],
  validation: ['样例不得成为成片素材', '无样例不得阻断其他 V2 创建分支'],
  recovery: '样例不可用时保留用户目标，并允许继续 text_to_video 或 material_brief。',
} as const
