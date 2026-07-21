import type { Request, Response } from 'express'

import { streamDirectorAgentChat } from './director-agent.service.js'
import type { DirectorAgentChatRequest } from './director-agent.types.js'

function writeSse(res: Response, event: unknown) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

export async function postDirectorAgentChat(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })

  try {
    const payload = req.body as DirectorAgentChatRequest
    for await (const event of streamDirectorAgentChat(payload)) {
      if (res.destroyed) return
      writeSse(res, event)
    }
  } catch (error) {
    writeSse(res, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    res.end()
  }
}
