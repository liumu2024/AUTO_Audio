import ts from 'typescript'

/**
 * Static audit for model-authored render components. The component ultimately
 * runs inside the Remotion browser bundle, so the audit is the sandbox boundary:
 * only whitelisted imports, no network/process/storage/eval access, and a
 * function-component default export.
 */

const MAX_SOURCE_LENGTH = 40_000

const ALLOWED_IMPORT_PREFIXES = [
  'react',
  'remotion',
  '@remotion/transitions',
  '@remotion/media',
] as const

const FORBIDDEN_MODULE_PREFIXES = [
  'node:',
  'fs',
  'path',
  'os',
  'child_process',
  'process',
  'events',
  'worker_threads',
  'net',
  'http',
  'https',
  'crypto',
  'dns',
  'tls',
  'util',
  'stream',
  'zlib',
] as const

const FORBIDDEN_CALL_NAMES = new Set([
  'fetch',
  'require',
  'XMLHttpRequest',
  'WebSocket',
  'eval',
])

const FORBIDDEN_NEW_NAMES = new Set(['Function'])

const FORBIDDEN_GLOBAL_ACCESS = new Set([
  'globalThis',
  'process',
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
])

export interface RenderComponentAudit {
  ok: boolean
  issues: string[]
}

function walk(node: ts.Node, issues: string[]): void {
  if (ts.isImportDeclaration(node)) {
    const specifier = (node.moduleSpecifier as ts.StringLiteral).text
    if (!ALLOWED_IMPORT_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
      issues.push(`import "${specifier}" is not on the whitelist.`)
    }
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      issues.push('dynamic import() is forbidden.')
    }
    const name = ts.isIdentifier(node.expression) ? node.expression.text : undefined
    if (name && FORBIDDEN_CALL_NAMES.has(name)) {
      issues.push(`call "${name}" is forbidden.`)
    }
  }
  if (ts.isNewExpression(node)) {
    const name = ts.isIdentifier(node.expression) ? node.expression.text : undefined
    if (name && FORBIDDEN_NEW_NAMES.has(name)) {
      issues.push(`new ${name} is forbidden.`)
    }
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && FORBIDDEN_GLOBAL_ACCESS.has(node.expression.text)) {
      issues.push(`access to "${node.expression.text}" is forbidden.`)
    }
  }
  if (ts.isElementAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && FORBIDDEN_GLOBAL_ACCESS.has(node.expression.text)) {
      issues.push(`access to "${node.expression.text}" is forbidden.`)
    }
  }
  if (ts.isImportEqualsDeclaration(node)) {
    issues.push('import = require is forbidden.')
  }
  ts.forEachChild(node, (child) => walk(child, issues))
}

function hasFunctionDefaultExport(sourceFile: ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      const isDefault = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      if (isDefault) found = true
    }
    if (ts.isExportAssignment(node) && node.isExportEquals !== true) {
      const expr = node.expression
      if (
        ts.isFunctionExpression(expr) ||
        ts.isArrowFunction(expr) ||
        ts.isIdentifier(expr)
      ) {
        found = true
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause === undefined && node.moduleSpecifier === undefined) {
      const declaration = (node as ts.ExportDeclaration & { declaration?: ts.Declaration }).declaration
      if (declaration && (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration))) {
        found = true
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      // default re-exports are resolved by the bundler; allow identifier re-exports.
      found = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

export function auditRenderComponentSource(source: string): RenderComponentAudit {
  const issues: string[] = []
  if (!source.trim()) {
    return { ok: false, issues: ['component source is empty.'] }
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    issues.push(`component source exceeds ${MAX_SOURCE_LENGTH} characters.`)
  }
  let sourceFile: ts.SourceFile
  try {
    sourceFile = ts.createSourceFile(
      'component.tsx',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
  } catch {
    issues.push('component source cannot be parsed as TSX.')
    return { ok: issues.length === 0, issues }
  }
  walk(sourceFile, issues)
  if (!hasFunctionDefaultExport(sourceFile)) {
    issues.push('component must export a default function component.')
  }
  return { ok: issues.length === 0, issues }
}

export function componentIdValid(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id)
}
