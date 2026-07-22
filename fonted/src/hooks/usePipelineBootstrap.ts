import { useEffect, useRef } from 'react'

import { env } from '@/config/env'
import * as api from '@/lib/api'
import { useTaskStore } from '@/stores/taskStore'

function isBackendUnreachable(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('failed to fetch') || msg.includes('network')
}

/**
 * 启动时检查后端连通性，并恢复上次任务（解析结果 / 成片 URL）。
 */
export function usePipelineBootstrap() {
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    let cancelled = false
    const { setBackendReady, setBootstrapError, addLog } = useTaskStore.getState()

    async function bootstrap() {
      if (!env.useBackend) {
        addLog('[前端] 未开启后端联调，请在创作配置上传样例并解析')
        return
      }

      try {
        await api.healthCheck()
        if (cancelled) return
        setBackendReady(true)
        setBootstrapError(null)
        addLog(`[联调] 后端已连接 (${env.apiBase})，主编辑器将使用 V2 Timeline 链路。`)
      } catch (e) {
        if (cancelled) return

        if (isBackendUnreachable(e)) {
          setBootstrapError(
            `后端 ${env.apiBase} 未连接。请先启动 backend，或直接运行 npm.cmd run desktop:dev。`,
          )
          addLog('[联调] 后端不可达')
          console.warn('[usePipelineBootstrap] backend unreachable')
          return
        }

        const msg = e instanceof Error ? e.message : String(e)
        setBootstrapError(msg)
        addLog(`[联调] 启动失败: ${msg}`)
        console.error('[usePipelineBootstrap]', e)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])
}
