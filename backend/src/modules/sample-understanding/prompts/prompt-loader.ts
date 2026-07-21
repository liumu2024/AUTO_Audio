import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const templateCache = new Map<string, string>()

function resolvePromptsRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  if (existsSync(path.join(moduleDir, 'director-grounding', 'observation-system.md'))) {
    return moduleDir
  }

  const fromCwd = path.join(
    process.cwd(),
    'src/modules/sample-understanding/prompts',
  )
  if (existsSync(path.join(fromCwd, 'director-grounding', 'observation-system.md'))) {
    return fromCwd
  }

  throw new Error(
    'Prompt templates not found. Expected backend/src/modules/sample-understanding/prompts',
  )
}

export function loadPromptTemplate(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\//, '')
  const cached = templateCache.get(normalized)
  if (cached !== undefined) return cached

  const fullPath = path.join(resolvePromptsRoot(), normalized)
  const content = readFileSync(fullPath, 'utf8')
  templateCache.set(normalized, content)
  return content
}

export function clearPromptTemplateCache(): void {
  templateCache.clear()
}

function resolveIncludes(text: string, stack = new Set<string>()): string {
  return text.replace(/\{\{include:([^}]+)\}\}/g, (_match, includePath: string) => {
    const normalized = String(includePath).trim().replace(/\\/g, '/')
    if (stack.has(normalized)) {
      throw new Error(`Circular prompt include detected: ${normalized}`)
    }
    stack.add(normalized)
    const included = resolveIncludes(loadPromptTemplate(normalized), stack)
    stack.delete(normalized)
    return included
  })
}

export function renderPromptTemplate(
  relativePath: string,
  variables: Record<string, string> = {},
): string {
  let text = resolveIncludes(loadPromptTemplate(relativePath))

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
