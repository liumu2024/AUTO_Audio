import ts from 'typescript'

export const RENDER_COMPONENT_SANDBOX_POLICY_VERSION = 'render_component_sandbox.v1'

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

const FORBIDDEN_IDENTIFIERS = new Set([
  'fetch',
  'require',
  'XMLHttpRequest',
  'WebSocket',
  'eval',
  'Function',
  'random',
  'globalThis',
  'self',
  'process',
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
  'crypto',
  'Image',
  'EventSource',
  'Worker',
  'SharedWorker',
  'Audio',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Date',
  'performance',
])

const FORBIDDEN_RESOURCE_TAGS = new Set(['img', 'audio', 'video', 'source', 'iframe', 'script', 'link', 'object', 'embed'])
const FORBIDDEN_WALL_CLOCK_STYLE_PROPERTIES = new Set([
  'animation', 'animationName', 'animationDuration', 'animationDelay',
  'transition', 'transitionProperty', 'transitionDuration', 'transitionDelay',
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
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    const specifier = node.moduleSpecifier.text
    if (!ALLOWED_IMPORT_PREFIXES.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
      issues.push(`re-export from "${specifier}" is not on the whitelist.`)
    }
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      issues.push('dynamic import() is forbidden.')
    }
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === 'Math' && node.name.text === 'random') {
      issues.push('Math.random is forbidden; Remotion output must be deterministic.')
    }
  }
  if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
    issues.push(`identifier "${node.text}" is forbidden.`)
  }
  if (ts.isStringLiteralLike(node) && /(?:https?:)?\/\//i.test(node.text)) {
    issues.push('network URL literals are forbidden; use authoritative timeline assets.')
  }
  if (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && ts.isIdentifier(node.tagName)
    && FORBIDDEN_RESOURCE_TAGS.has(node.tagName.text)
  ) {
    issues.push(`resource-loading JSX tag "${node.tagName.text}" is forbidden; use Remotion media components with timeline assets.`)
  }
  if (ts.isPropertyAssignment(node)) {
    const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined
    if (name && FORBIDDEN_WALL_CLOCK_STYLE_PROPERTIES.has(name)) {
      issues.push(`wall-clock CSS property "${name}" is forbidden; derive animation from Remotion frame hooks.`)
    }
  }
  if (ts.isImportEqualsDeclaration(node)) {
    issues.push('import = require is forbidden.')
  }
  ts.forEachChild(node, (child) => walk(child, issues))
}

function hasFunctionDefaultExport(sourceFile: ts.SourceFile): boolean {
  const functionBindings = new Set<string>()
  for (const statement of sourceFile.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      functionBindings.add(statement.name.text)
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.initializer
          && (ts.isArrowFunction(declaration.initializer)
            || ts.isFunctionExpression(declaration.initializer)
            || ts.isClassExpression(declaration.initializer))
        ) functionBindings.add(declaration.name.text)
      }
    }
  }
  return sourceFile.statements.some((statement) => {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
    }
    if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
      const expression = statement.expression
      return ts.isFunctionExpression(expression)
        || ts.isArrowFunction(expression)
        || ts.isClassExpression(expression)
        || (ts.isIdentifier(expression) && functionBindings.has(expression.text))
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      return statement.exportClause.elements.some((element) => {
        const localName = element.propertyName?.text
        return element.name.text === 'default' && Boolean(localName && functionBindings.has(localName))
      })
    }
    return false
  })
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
