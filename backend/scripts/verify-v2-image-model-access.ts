import { existsSync } from 'node:fs'
import path from 'node:path'

import { env } from '../src/config/env.js'
import {
  deleteArkImageFile,
  uploadArkImageFile,
  waitForArkImageFileReady,
} from '../src/pipeline-v2/ark-file-input.js'
import { createV2TraceWriter } from '../src/pipeline-v2/trace.js'

const imagePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(process.cwd(), '..', 'example_videos', 'img', '1.png')

if (!existsSync(imagePath)) throw new Error(`Image does not exist: ${imagePath}`)
if (!env.directorAgentApiKey) throw new Error('DIRECTOR_AGENT_API_KEY is not configured.')

const trace = createV2TraceWriter({ taskId: `v2_image_model_access_${Date.now()}` })
let fileId: string | undefined
try {
  const uploaded = await uploadArkImageFile({ localPath: imagePath })
  fileId = uploaded.fileId
  await waitForArkImageFileReady(fileId)

  const response = await fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.directorAgentApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.directorAgentModel,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', file_id: fileId },
          { type: 'input_text', text: '请仅回答“已读取图片”。' },
        ],
      }],
    }),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Responses image input returned ${response.status}: ${text.slice(0, 500)}`)
  const payload = JSON.parse(text) as Record<string, unknown>
  const hasModelOutput =
    typeof payload.output_text === 'string' ||
    (Array.isArray(payload.output) && payload.output.length > 0)
  if (!hasModelOutput) throw new Error('Responses image input succeeded but contained no model output.')

  await trace.writeJson('02-planning', 'image-model-access.json', {
    source_file: path.basename(imagePath),
    ark_file_upload: 'accepted',
    model_image_input: 'accepted',
    model_output_present: true,
    temporary_file_deletion_requested: true,
  })
  console.info(`[verify-v2-image-model-access] OK ${trace.rootDir}`)
} finally {
  if (fileId) await deleteArkImageFile(fileId)
}
