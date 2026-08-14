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
        addLog('[创作服务] 当前未启用在线创作能力。')
        return
      }

      try {
        await api.healthCheck()
        if (cancelled) return
        setBackendReady(true)
        setBootstrapError(null)
        addLog('[服务] 视频创作服务已连接。')
      } catch (e) {
        if (cancelled) return

        if (isBackendUnreachable(e)) {
          setBootstrapError(
            '创作服务暂时无法连接，请确认本地服务已经启动后重试。',
          )
          addLog('[创作服务] 暂时无法连接。')
          console.warn('[usePipelineBootstrap] backend unreachable')
          return
        }

        setBootstrapError('创作服务启动失败，请稍后重试。')
        addLog('[创作服务] 启动失败，请稍后重试。')
        console.error('[usePipelineBootstrap]', e)
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])
}
