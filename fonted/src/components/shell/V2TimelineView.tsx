import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Film,
  Loader2,
  Play,
  Upload,
  WandSparkles,
} from 'lucide-react'

import * as api from '@/lib/api'
import { env } from '@/config/env'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { classifyExternalUrlAccess } from '@shared/lib/external-url-access'

function positiveNumber(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function absoluteResultUrl(result: api.V2TimelineRunResult | null): string | undefined {
  if (!result?.outputUrl) return undefined
  if (/^https?:\/\//i.test(result.outputUrl)) return result.outputUrl
  return `${env.apiBase}${result.outputUrl}`
}

function metric(review: api.V2TimelinePlanningReview | undefined, key: string): number {
  return Number(review?.metrics[key] ?? 0)
}

export function V2TimelineView() {
  const [mainVideoPath, setMainVideoPath] = useState('../example_videos/9.mp4')
  const [imageSrc, setImageSrc] = useState('../example_videos/img/1.png')
  const [inputImageUrl, setInputImageUrl] = useState(
    'https://ark-project.tos-cn-beijing.volces.com/doc_image/seepro_i2v.png',
  )
  const [prompt, setPrompt] = useState('用参考素材做一条节奏清楚的产品展示短片，突出开场、卖点和收束。')
  const [durationSec, setDurationSec] = useState('6')
  const [plannerMode, setPlannerMode] = useState<'deterministic' | 'llm'>('deterministic')
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<api.V2TimelinePreviewResult | null>(null)
  const [specText, setSpecText] = useState('')
  const [result, setResult] = useState<api.V2TimelineRunResult | null>(null)
  const [reviewedSignature, setReviewedSignature] = useState<string | null>(null)

  const payloadSignature = useMemo(
    () =>
      JSON.stringify({
        mainVideoPath,
        imageSrc: imageSrc.trim() || undefined,
        inputImageUrl: inputImageUrl.trim() || undefined,
        prompt,
        durationSec: positiveNumber(durationSec),
        plannerMode,
        canvas: { width: 720, height: 1280, fps: 24 },
      }),
    [durationSec, imageSrc, inputImageUrl, mainVideoPath, plannerMode, prompt],
  )
  const isCurrentPlanReviewed = Boolean(preview && reviewedSignature === payloadSignature)
  const outputUrl = useMemo(() => absoluteResultUrl(result), [result])
  const inputImageAccess = useMemo(
    () => classifyExternalUrlAccess(inputImageUrl.trim() || undefined),
    [inputImageUrl],
  )

  const basePayload = (): api.V2TimelinePayload => ({
    mainVideoPath,
    imageSrc: imageSrc.trim() || undefined,
    inputImageUrl: inputImageUrl.trim() || undefined,
    prompt,
    plannerMode,
    durationSec: positiveNumber(durationSec),
    canvas: {
      width: 720,
      height: 1280,
      fps: 24,
    },
  })

  const previewTimeline = async () => {
    setPreviewing(true)
    setError(null)
    try {
      const next = await api.previewV2Timeline(basePayload())
      setPreview(next)
      setSpecText(JSON.stringify(next.spec, null, 2))
      setReviewedSignature(payloadSignature)
      setResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewing(false)
    }
  }

  const runTimeline = async () => {
    if (!isCurrentPlanReviewed) {
      setError('请先基于当前输入生成并审查 Timeline 方案。')
      return
    }

    setRunning(true)
    setError(null)
    try {
      const timelineSpecOverride = specText.trim() ? JSON.parse(specText) : undefined
      const next = await api.runV2Timeline({
        ...basePayload(),
        timelineSpecOverride,
      })
      setResult(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const uploadInputImage = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await api.uploadFile(file, { requirePublicUrl: true })
      const publicUrl = uploaded.publicUrl ?? uploaded.url
      const publicAccess = classifyExternalUrlAccess(publicUrl)
      if (!publicAccess.ok) {
        throw new Error(
          `Uploaded image is not externally reachable: ${publicAccess.reason}`,
        )
      }
      setInputImageUrl(publicUrl)
      if (uploaded.localPath) setImageSrc(uploaded.localPath)
      setPreview(null)
      setResult(null)
      setReviewedSignature(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-600/15 text-blue-300">
            <Film className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold">V2 Timeline</h1>
            <p className="text-sm text-zinc-500">结构化分镜审查、素材补全、Remotion 多镜头渲染</p>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[400px_minmax(0,1fr)] overflow-hidden">
        <section className="min-h-0 overflow-y-auto border-r border-zinc-800 p-5">
          <div className="space-y-5">
            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase text-zinc-500">本地主视频路径</span>
              <Input value={mainVideoPath} onChange={(event) => setMainVideoPath(event.target.value)} />
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase text-zinc-500">Remotion 参考图片路径</span>
              <Input value={imageSrc} onChange={(event) => setImageSrc(event.target.value)} />
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase text-zinc-500">外部图生视频图片 URL</span>
              <Input value={inputImageUrl} onChange={(event) => setInputImageUrl(event.target.value)} />
              <label className="inline-flex">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploading || previewing || running}
                  onChange={(event) => void uploadInputImage(event.target.files?.[0])}
                />
                <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-200 hover:bg-zinc-800">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                  上传图片
                </span>
              </label>
              {!inputImageAccess.ok && inputImageAccess.kind !== 'empty' ? (
                <p className="text-xs leading-5 text-amber-300">{inputImageAccess.reason}</p>
              ) : null}
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase text-zinc-500">创作意图</span>
              <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-2">
                <span className="text-xs font-medium uppercase text-zinc-500">时长</span>
                <Input value={durationSec} onChange={(event) => setDurationSec(event.target.value)} />
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium uppercase text-zinc-500">规划器</span>
                <select
                  value={plannerMode}
                  onChange={(event) => setPlannerMode(event.target.value as 'deterministic' | 'llm')}
                  className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <option value="deterministic">deterministic</option>
                  <option value="llm">llm</option>
                </select>
              </label>
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-900/70 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-400">审查状态</span>
                <span className={isCurrentPlanReviewed ? 'text-emerald-300' : 'text-amber-300'}>
                  {isCurrentPlanReviewed ? '当前方案已生成' : '需要生成方案'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                修改路径、URL、提示词、时长或规划模式后，需要重新生成方案，再进入渲染。
              </p>
            </div>

            <div className="grid gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={previewing || running || !mainVideoPath.trim()}
                onClick={() => void previewTimeline()}
              >
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileJson className="h-4 w-4" aria-hidden />}
                生成 Timeline 方案
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={previewing || running || !isCurrentPlanReviewed}
                onClick={() => void runTimeline()}
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                确认并渲染
              </Button>
            </div>
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto p-6">
          {error ? (
            <div className="mb-4 flex items-start gap-3 rounded-md border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
            <div className="space-y-5">
              {preview ? (
                <section className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-zinc-200">中文审查摘要</h2>
                    <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{preview.review.risk_level}</span>
                  </div>
                  <p className="text-sm leading-6 text-zinc-300">{preview.review.summary_zh}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-zinc-500">规划来源</dt>
                      <dd className="font-mono text-zinc-100">{preview.plannerSource}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">镜头数</dt>
                      <dd className="font-mono text-zinc-100">{metric(preview.review, 'scene_count')}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">转场数</dt>
                      <dd className="font-mono text-zinc-100">{metric(preview.review, 'transition_count')}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Remotion 镜头</dt>
                      <dd className="font-mono text-zinc-100">{metric(preview.review, 'remotion_scene_count')}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">AI 视频镜头</dt>
                      <dd className="font-mono text-zinc-100">{metric(preview.review, 'ai_video_scene_count')}</dd>
                    </div>
                  </dl>
                  <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
                    {preview.review.scenes.map((scene) => (
                      <div key={scene.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-zinc-100">{scene.id}</span>
                          <span className="text-xs text-zinc-500">
                            {scene.start_sec}s - {Number((scene.start_sec + scene.duration_sec).toFixed(3))}s
                          </span>
                        </div>
                        <div className="mt-2 text-zinc-300">{scene.role_zh}</div>
                        <div className="mt-1 text-xs text-zinc-500">{scene.source_zh}</div>
                      </div>
                    ))}
                  </div>
                  {preview.review.warnings_zh.length ? (
                    <div className="mt-4 space-y-2 text-sm text-amber-200">
                      {preview.review.warnings_zh.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-4 break-all text-xs text-zinc-500">traceDir: {preview.traceDir}</p>
                </section>
              ) : (
                <section className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-zinc-800 text-sm text-zinc-500">
                  <div className="flex items-center gap-2">
                    <WandSparkles className="h-4 w-4" aria-hidden />
                    <span>先生成 Timeline 方案，再审查和编辑。</span>
                  </div>
                </section>
              )}

              {result ? (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    <span>渲染完成：{result.taskId}</span>
                  </div>
                  {outputUrl ? (
                    <video
                      key={outputUrl}
                      src={outputUrl}
                      controls
                      className="aspect-[9/16] max-h-[72vh] w-auto rounded-md border border-zinc-800 bg-black"
                    />
                  ) : null}
                  <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-zinc-500">输出</dt>
                    <dd className="break-all font-mono text-zinc-300">{result.outputPath}</dd>
                    <dt className="text-zinc-500">规划来源</dt>
                    <dd className="font-mono text-zinc-300">{result.plannerSource}</dd>
                    <dt className="text-zinc-500">trace</dt>
                    <dd className="break-all font-mono text-zinc-300">{result.traceDir}</dd>
                    <dt className="text-zinc-500">标准化素材</dt>
                    <dd className="font-mono text-zinc-300">{result.standardizedAssets.length}</dd>
                  </dl>
                </section>
              ) : null}
            </div>

            <label className="block min-h-[560px] space-y-2">
              <span className="text-xs font-medium uppercase text-zinc-500">可编辑 Timeline JSON</span>
              <Textarea
                value={specText}
                onChange={(event) => setSpecText(event.target.value)}
                spellCheck={false}
                className="h-[calc(100vh-220px)] min-h-[560px] resize-none font-mono text-xs leading-5"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  )
}
