import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'

import { env, pythonSubprocessEnv } from '../../config/env.js'
import { broadcastTaskProgress } from '../websocket/ws.gateway.js'

const PROGRESS_RE =
  /PROGRESS:\s*(\d+)\s*\|\s*STAGE:\s*(.*?)\s*\|\s*MSG:\s*(.*)/

export async function runPythonCli(
  scriptName: string,
  args: string[],
  taskId: string,
): Promise<'SUCCESS'> {
  const scriptPath = path.isAbsolute(scriptName)
    ? scriptName
    : path.resolve(process.cwd(), scriptName)

  try {
    await access(scriptPath)
  } catch {
    return runMockCliProgress(taskId)
  }

  return new Promise((resolve, reject) => {
    const child = spawn(env.pythonBin, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: pythonSubprocessEnv(),
    })

    child.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n')
      for (const line of lines) {
        const match = line.match(PROGRESS_RE)
        if (match) {
          broadcastTaskProgress(taskId, {
            progress: parseInt(match[1], 10),
            stage: match[2].trim(),
            log: match[3].trim(),
          })
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      console.error(`[cli:${taskId}]`, chunk.toString())
    })

    child.on('close', (code) => {
      if (code === 0) resolve('SUCCESS')
      else reject(new Error(`CLI exited with code ${code}`))
    })
  })
}

/** 无 Python 脚本时的开发态 Mock 进度 */
async function runMockCliProgress(taskId: string): Promise<'SUCCESS'> {
  const stages = [
    { p: 10, stage: '解析指令', log: '正在提取自然语言意图...' },
    { p: 30, stage: '匹配锚点', log: '正在重组 Hook 与 CTA 段落...' },
    { p: 60, stage: 'AIGC 补全', log: '调用视觉模型生成缺失画面...' },
    { p: 90, stage: '渲染合成', log: 'FFmpeg 正在混流处理花字...' },
    { p: 100, stage: '完成', log: '结构分析完成' },
  ]

  for (const s of stages) {
    broadcastTaskProgress(taskId, {
      progress: s.p,
      stage: s.stage,
      log: s.log,
    })
    await new Promise((r) => setTimeout(r, 400))
  }

  return 'SUCCESS'
}
