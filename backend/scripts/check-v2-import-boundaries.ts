import { readFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(process.cwd(), '..')

const checkedFiles = [
  'backend/src/pipeline-v2/trace.ts',
  'backend/src/pipeline-v2/v2-input.ts',
  'backend/src/pipeline-v2/ark-seedance-adapter.ts',
  'backend/src/pipeline-v2/configured-material-adapter.ts',
  'backend/src/pipeline-v2/ffmpeg-binary.ts',
  'backend/src/pipeline-v2/ffmpeg-preflight.ts',
  'backend/src/pipeline-v2/material-generation-adapter.ts',
  'backend/src/pipeline-v2/media-standardizer.ts',
  'backend/src/pipeline-v2/remotion-timeline-material-resolver.ts',
  'backend/src/pipeline-v2/remotion-timeline-llm-planner.ts',
  'backend/src/pipeline-v2/remotion-timeline-planner.ts',
  'backend/src/pipeline-v2/remotion-timeline-renderer.ts',
  'backend/src/pipeline-v2/remotion-timeline-review.ts',
  'backend/src/pipeline-v2/remotion-timeline-service.ts',
  'backend/src/pipeline-v2/controller.ts',
  'backend/scripts/smoke-v2-ffmpeg-preflight.ts',
  'backend/scripts/smoke-v2-remotion-timeline-spec.ts',
  'backend/scripts/smoke-v2-remotion-timeline-planner.ts',
  'backend/scripts/smoke-v2-remotion-timeline-material-resolver.ts',
  'backend/scripts/smoke-v2-remotion-timeline-render.ts',
  'backend/scripts/smoke-v2-remotion-timeline-service.ts',
  'backend/scripts/smoke-v2-material-adapter.ts',
  'backend/scripts/smoke-v2-ark-seedance-adapter.ts',
  'remotion/src/timeline/TimelineComposition.tsx',
  'remotion/src/timeline/SceneRenderer.tsx',
  'remotion/src/timeline/OverlayRendererV2.tsx',
  'remotion/src/timeline/TransitionRenderer.tsx',
  'remotion/src/timeline/defaultTimelineProps.ts',
  'remotion/scripts/render-timeline-video.mjs',
  'shared/types/remotion-timeline-spec.v1.ts',
  'shared/lib/external-url-access.ts',
  'shared/lib/remotion-timeline-fixtures.ts',
  'shared/lib/remotion-timeline-validator.ts',
]

const forbiddenPatterns = [
  {
    pattern: /render-plan\.v1/,
    reason: 'v2 must not depend on old RenderPlanV1.',
  },
  {
    pattern: /modules\/(?:effect-roadmap|effect-composition|render-plan|generator\/remotion-generator)/,
    reason: 'v2 must not import old planning/render orchestration modules.',
  },
  {
    pattern: /RenderPlanVideo/,
    reason: 'v2 overlay renderer must stay independent from the old full-video renderer.',
  },
  {
    pattern: /generated_component|component-authoring|remotion-component-authoring/,
    reason: 'component authoring is not part of the v2 MVP execution path.',
  },
]

const violations: Array<{ file: string; reason: string; match: string }> = []

for (const relativeFile of checkedFiles) {
  const file = path.join(repoRoot, relativeFile)
  const content = await readFile(file, 'utf8')
  for (const item of forbiddenPatterns) {
    const match = content.match(item.pattern)
    if (match) {
      violations.push({
        file: relativeFile,
        reason: item.reason,
        match: match[0],
      })
    }
  }
}

if (violations.length) {
  console.error('[check-v2-import-boundaries] failed')
  console.error(JSON.stringify(violations, null, 2))
  process.exit(1)
}

console.info('[check-v2-import-boundaries] OK')
