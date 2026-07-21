import { useState } from 'react'

import { CreationInputComposer } from '@/components/sidebar/CreationInputComposer'
import { Button } from '@/components/ui/button'
import { env } from '@/config/env'
import { runFullCreationPipeline } from '@/services/pipeline/runFullPipeline'
import { useCreationStore } from '@/stores/creationStore'
import { useEditorStore } from '@/stores/editorStore'
import { usePipelineStore } from '@/stores/pipelineStore'
import { useTaskStore } from '@/stores/taskStore'

export function CreationConfigPanel() {
  const sampleUrl = useCreationStore((s) => s.sampleUrl)
  const sampleName = useCreationStore((s) => s.sampleName)
  const inputText = useCreationStore((s) => s.inputText)
  const attachments = useCreationStore((s) => s.attachments)
  const isAnalyzing = useCreationStore((s) => s.isAnalyzing)
  const isGenerating = useTaskStore((s) => s.isTaskRunning)
  const setAnalyzing = useCreationStore((s) => s.setAnalyzing)
  const setSidebarTab = useEditorStore((s) => s.setSidebarTab)
  const hasPipeline = usePipelineStore((s) => Boolean(s.bundle))

  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    setError(null)

    if (!env.useBackend) {
      setError('请设置 VITE_USE_BACKEND=true 并启动 backend 后再解析')
      return
    }

    if (!sampleUrl.trim()) {
      setError('请先上传样例视频')
      return
    }

    setAnalyzing(true)
    try {
      await runFullCreationPipeline({
        sampleVideoUrl: sampleUrl,
        sampleVideoName: sampleName || 'sample-video.mp4',
        globalPrompt: inputText,
        materials: attachments.map((att) => ({
          id: att.materialId ?? att.id.replace(/^att_/, ''),
          name: att.name,
          type: att.type,
          url: att.url,
          tags: att.tags,
        })),
      })
      setSidebarTab('structure')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="scroll-area-y flex min-h-0 flex-1 flex-col gap-5 pr-1 pb-1">
      <CreationInputComposer />

      {error && <p className="text-xs text-red-400">{error}</p>}

      {hasPipeline && (
        <p className="text-[10px] text-emerald-500/90">
          已加载解析结果；刷新页面后会自动恢复上次任务与成片。
        </p>
      )}

      <div className="mt-auto shrink-0 pt-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={isAnalyzing || isGenerating || !sampleUrl.trim()}
          onClick={() => void handleAnalyze()}
        >
          {isAnalyzing
            ? '解析样例中…'
            : isGenerating
              ? 'Remotion 渲染中…'
              : '解析样例'}
        </Button>
      </div>
    </div>
  )
}
