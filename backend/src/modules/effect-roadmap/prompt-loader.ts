import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const templateCache = new Map<string, string>()

function resolvePromptsRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  if (existsSync(path.join(moduleDir, 'prompts', 'system.md'))) {
    return path.join(moduleDir, 'prompts')
  }

  const fromCwd = path.join(process.cwd(), 'src/modules/effect-roadmap/prompts')
  if (existsSync(path.join(fromCwd, 'system.md'))) {
    return fromCwd
  }

  throw new Error(
    'Effect roadmap prompt templates not found. Expected backend/src/modules/effect-roadmap/prompts',
  )
}

export function loadEffectRoadmapPromptTemplate(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\//, '')
  const cached = templateCache.get(normalized)
  if (cached !== undefined) return cached

  const fullPath = path.join(resolvePromptsRoot(), normalized)
  const content = readFileSync(fullPath, 'utf8')
  templateCache.set(normalized, content)
  return content
}

export function clearEffectRoadmapPromptTemplateCache(): void {
  templateCache.clear()
}

function resolveIncludes(text: string, stack = new Set<string>()): string {
  return text.replace(/\{\{include:([^}]+)\}\}/g, (_match, includePath: string) => {
    const normalized = String(includePath).trim().replace(/\\/g, '/')
    if (stack.has(normalized)) {
      throw new Error(`Circular prompt include detected: ${normalized}`)
    }
    stack.add(normalized)
    const included = resolveIncludes(loadEffectRoadmapPromptTemplate(normalized), stack)
    stack.delete(normalized)
    return included
  })
}

export function renderEffectRoadmapPromptTemplate(
  relativePath: string,
  variables: Record<string, string> = {},
): string {
  let text = resolveIncludes(loadEffectRoadmapPromptTemplate(relativePath))

  for (const [key, value] of Object.entries(variables)) {
    text = text.replaceAll(`{{${key}}}`, value)
  }

  const unresolved = text.match(/\{\{[a-zA-Z0-9_./-]+\}\}/g)
  if (unresolved?.length) {
    const unique = [...new Set(unresolved)]
    throw new Error(
      `Unresolved prompt variables in ${relativePath}: ${unique.join(', ')}`,
    )
  }

  return text.trim()
}
