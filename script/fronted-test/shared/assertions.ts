export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT FAILED [${label}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

export function section(title: string): void {
  console.log(`\n━━ ${title} ━━`)
}

export function pass(name: string): void {
  console.log(`  ✓ ${name}`)
}

export function runSuite(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => section(name))
    .then(fn)
    .then(() => pass(`${name} — 全部通过`))
}
