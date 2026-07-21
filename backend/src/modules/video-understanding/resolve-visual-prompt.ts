const ROLE_DEFAULTS: Record<string, string> = {
  hook: '特写镜头，快速吸引注意力的开场画面',
  product_demo: '产品功能演示特写，清晰展示卖点',
  cta: '行动号召画面，品牌 Logo 与购买引导',
  pain_amplify: '痛点场景再现，引发观众共鸣',
  entertainment: '轻松有趣的生活方式场景镜头',
  trust: '真实可信的使用场景，建立品牌信任',
}

function isPlaceholder(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'boolean') return false
  if (typeof value === 'number') return false
  if (typeof value !== 'string') return false

  const text = value.trim()
  if (!text) return true
  if (text.startsWith('[')) {
    const close = text.indexOf(']')
    if (close >= 0 && close < 24) return true
  }
  return ['[String]', '[Float]', '[Integer]', '[Enum]', '[Boolean]'].includes(text)
}

export function defaultVisualForRole(role: unknown): string {
  if (typeof role === 'string' && ROLE_DEFAULTS[role]) {
    return ROLE_DEFAULTS[role]
  }
  return '产品展示画面，明亮清晰，适合短视频广告'
}

/** 从多个候选字段中选取第一个非空视觉描述（空字符串不算有效值） */
export function pickVisualPrompt(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && !isPlaceholder(candidate)) {
      return candidate.trim()
    }
  }
  return defaultVisualForRole(undefined)
}
