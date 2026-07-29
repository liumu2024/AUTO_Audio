export const manifest = {
  id: 'subtitle-track-authoring',
  version: '1.1.0',
  card: '创作或局部修订多段字幕轨；区分可见文案与展示约束。',
  stage: 'authoring',
  tools: ['timeline.patch'],
  dependencies: ['official.remotion-captions'],
  prerequisites: ['当前 V2 草稿版本'],
  requiredFacts: ['现有可见字幕', '目标镜头/字幕段', '本轮文案与展示要求'],
  outputRequirements: ['只修改 caption_tracks 与 caption overlays'],
  validation: ['字幕在镜头时间内', '同轨重叠合法', '内部说明与素材名不上屏'],
  recovery: '保留基础版本，缩小字幕范围或澄清要显示的文案。',
} as const
