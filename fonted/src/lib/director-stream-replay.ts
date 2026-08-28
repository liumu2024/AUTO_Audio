import type { DirectorAgentStreamEvent } from '../../../shared/types/director-stream.js'

interface DirectorStreamReplayInput<TPayload> {
  payload: TPayload
  send: (payload: TPayload, signal: AbortSignal) => Promise<Response>
  onEvent: (event: DirectorAgentStreamEvent) => void
  signal?: AbortSignal
  connectTimeoutMs: number
  replayTimeoutMs: number
  pollDelayMs: number
  maxPolls?: number
}

function combinedSignal(signals: AbortSignal[]) {
  return signals.length === 1 ? signals[0]! : AbortSignal.any(signals)
}

/** Keeps a connected SSE body alive while replaying the same idempotent turn after transport loss. */
export async function streamDirectorEventsWithReplay<TPayload>(
  input: DirectorStreamReplayInput<TPayload>,
) {
  const deadline = Date.now() + input.replayTimeoutMs
  const maxPolls = input.maxPolls ?? 300

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break

    let response: Response
    try {
      const connectController = new AbortController()
      const connectTimer = setTimeout(
        () => connectController.abort(new Error('director connection timeout')),
        Math.max(1, Math.min(input.connectTimeoutMs, remainingMs)),
      )
      const signals = [connectController.signal, AbortSignal.timeout(remainingMs)]
      if (input.signal) signals.push(input.signal)

      try {
        response = await input.send(input.payload, combinedSignal(signals))
      } finally {
        clearTimeout(connectTimer)
      }
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error
      if (Date.now() >= deadline || attempt === maxPolls - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, input.pollDelayMs))
      continue
    }
    if (!response.ok) throw new Error('对话服务暂时不可用，请稍后重试。')

    let turnReceiptRunning = false
    let finalResultSeen = false
    let doneSeen = false
    let transportError: unknown
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        let result: ReadableStreamReadResult<Uint8Array>
        try {
          result = await reader.read()
        } catch (error) {
          transportError = error
          break
        }
        if (result.done) break
        buffer += decoder.decode(result.value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((item) => item.startsWith('data: '))
          if (!line) continue
          const json = line.slice('data: '.length).trim()
          if (!json) continue
          const event = JSON.parse(json) as DirectorAgentStreamEvent
          if (event.type === 'turn_receipt' && event.status === 'running') turnReceiptRunning = true
          if (event.type === 'assistant_reply' || event.type === 'workspace_session' || event.type === 'error') {
            finalResultSeen = true
          }
          if (event.type === 'done') doneSeen = true
          input.onEvent(event)
        }
      }
    }

    if (transportError) {
      if (input.signal?.aborted) throw input.signal.reason ?? transportError
      if (Date.now() >= deadline || attempt === maxPolls - 1) throw transportError
      await new Promise((resolve) => setTimeout(resolve, input.pollDelayMs))
      continue
    }

    if (doneSeen && (!turnReceiptRunning || finalResultSeen)) return
    if (input.signal?.aborted) throw input.signal.reason
    await new Promise((resolve) => setTimeout(resolve, input.pollDelayMs))
  }
  throw new Error('这轮处理仍在继续，请稍后再查看结果。')
}
