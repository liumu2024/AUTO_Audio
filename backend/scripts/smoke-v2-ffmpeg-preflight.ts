import assert from 'node:assert/strict'
import path from 'node:path'

import '../src/config/env.js'
import { runV2FfmpegPreflight } from '../src/pipeline-v2/ffmpeg-preflight.js'

const report = await runV2FfmpegPreflight({
  outputDir: path.resolve(process.cwd(), 'tmp', 'v2-ffmpeg-preflight'),
  requireFullFfmpeg: process.env.V2_REQUIRE_FULL_FFMPEG === '1',
})

assert.equal(report.ok, true, JSON.stringify(report, null, 2))

console.info('[smoke-v2-ffmpeg-preflight] OK')
console.info(JSON.stringify(report, null, 2))
