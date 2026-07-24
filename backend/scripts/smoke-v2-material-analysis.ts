import assert from 'node:assert/strict'

import { analyzeMaterialHeuristically } from '../../shared/lib/material-analysis-heuristic.js'

const analysis = analyzeMaterialHeuristically({
  id: 'material_smoke_video',
  type: 'video',
  name: 'product demo hook.mp4',
  url: 'https://example.test/product-demo.mp4',
  tags: ['cinematic'],
  duration_sec: 8,
})

assert.equal(analysis.schema_version, 'material_analysis.v1')
assert.equal(analysis.material_id, 'material_smoke_video')
assert.equal(analysis.type, 'video')
assert.equal(analysis.segments.length, 2)
assert.equal(analysis.segments.every((segment) => segment.material_id === analysis.material_id), true)
assert.equal(analysis.tags.includes('product'), true)
assert.equal(analysis.tags.includes('demo'), true)

console.info('[smoke-v2-material-analysis] OK')
