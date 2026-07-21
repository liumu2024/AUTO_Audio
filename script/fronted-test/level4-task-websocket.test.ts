/**
 * 第四关：模拟 WebSocket 异步任务流
 * 运行: npm run test:level4
 */
import { assert, pass, section } from './shared/assertions.ts'

const MOCK_STAGES = [
  { p: 10, stage: '解析指令', log: '正在提取自然语言意图...' },
  { p: 30, stage: '匹配锚点', log: '正在重组 Hook 与 CTA 段落...' },
  { p: 60, stage: 'AIGC 补全', log: '调用视觉模型生成缺失画面...' },
  { p: 90, stage: '渲染合成', log: 'FFmpeg 正在混流处理花字...' },
  { p: 100, stage: '完成', log: '新视频生成完毕！' },
]

section('Level 4 — 进度阶段序列')

function simulateTask() {
  let currentProgress = 0
  const logs: string[] = []
  let lastStage = ''

  while (currentProgress < 100) {
    currentProgress += 5
    const stage = MOCK_STAGES.find(
      (s) => currentProgress >= s.p && currentProgress < s.p + 10,
    )
    if (stage) {
      lastStage = stage.stage
      logs.push(stage.log)
    }
  }
  return { progress: currentProgress, lastStage, logs }
}

const result = simulateTask()
assert(result.progress >= 100, '进度应达到 100')
assert(result.lastStage === '完成', '最终阶段应为完成')
assert(result.logs.length >= 4, '应产生多条日志')

section('Level 4 — UI 手动验证清单')
console.log(`
  [ ] 在底部 AI 指令台输入任意指令并发送
  [ ] 全屏 ProgressOverlay 出现，进度每 500ms +5%
  [ ] 依次显示：解析指令 → 匹配锚点 → AIGC 补全 → 渲染合成 → 完成
  [ ] 日志区实时追加；100% 后遮罩关闭
`)

pass('Level 4 WebSocket Mock 任务流校验通过')
