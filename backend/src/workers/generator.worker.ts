import { Worker } from 'bullmq'

import { getBullmqConnection, QUEUE_NAMES } from '../config/redis.js'
import {
  processGenerationJob,
  type GenerationJobData,
} from '../modules/generator/generation-job.processor.js'

export async function processGeneratorJobData(
  data: GenerationJobData,
  jobName = 'local',
): Promise<void> {
  console.info(`[generator.worker] ${data.taskId} start job=${jobName}`)
  const output = await processGenerationJob(data)
  console.info(
    `[generator.worker] ${data.taskId} done finalVideoUrl=${output.finalVideoUrl}`,
  )
}

if (process.env.DPL304_LOCAL_MODE !== 'true') {
  const worker = new Worker(
    QUEUE_NAMES.GENERATOR,
    async (job) => processGeneratorJobData(job.data as GenerationJobData, job.name),
    { connection: getBullmqConnection() },
  )

  worker.on('failed', (job, err) => {
    console.error(`[generator.worker] job ${job?.id} failed:`, err)
  })

  console.info('[generator.worker] listening on', QUEUE_NAMES.GENERATOR)
  console.info('[generator.worker] mode: remotion')
}
