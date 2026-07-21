/**
 * 运行全部前端 Mock 联调测试
 * cd script/fronted-test && npm install && npm test
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const levels = [
  'level1-mock-data.test.ts',
  'level2-gap-resolution.test.ts',
  'level3-property-sync.test.ts',
  'level4-task-websocket.test.ts',
]

let failed = 0

console.log('╔══════════════════════════════════════╗')
console.log('║  fonted 前端 Mock 联调测试 (4 关)    ║')
console.log('╚══════════════════════════════════════╝')

for (const file of levels) {
  const res = spawnSync('npx', ['tsx', join(dir, file)], {
    stdio: 'inherit',
    shell: true,
    cwd: dir,
  })
  if (res.status !== 0) failed += 1
}

if (failed > 0) {
  console.error(`\n✗ ${failed} 个关卡失败`)
  process.exit(1)
}

console.log('\n✓ 全部 4 关自动化校验通过')
console.log('  请在浏览器打开 fonted (npm run dev) 完成各关「手动验证清单」')
