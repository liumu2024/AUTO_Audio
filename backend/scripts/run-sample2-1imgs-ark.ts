import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ArkFilesResponsesAnalyzer } from '../src/modules/video-understanding/ark/ark-files-responses.analyzer.js'
import { remotionRenderer } from '../src/modules/render-engine/remotion-renderer.service.js'
import { stageLocalAssetsForRemotion } from '../../experiments/remotion-render-lab/src/plan-utils.js'
import { analyzeAssetHeuristically } from '../../shared/lib/asset-analysis-heuristic.js'
import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import { templateToMigrationProtocolV12 } from '../../shared/lib/template-to-migration.adapter.js'
import type { UserMaterialDto } from '../../shared/types/pipeline.js'

const repoRoot = path.resolve(process.cwd(), '..')
const taskId = `sample2_1imgs_ark_${Date.now()}`
const samplePath = path.join(
  repoRoot,
  'experiments/remotion-render-lab/example_videos/2.mp4',
)
const imageDir = path.join(
  repoRoot,
  'experiments/remotion-render-lab/example_videos/1imgs',
)
const remotionRoot = path.join(repoRoot, 'remotion')
const outDir = path.join(
  repoRoot,
  'experiments/remotion-render-lab/runs',
  taskId,
)
const propsDir = path.join(outDir, 'props')

function numericImageSort(left: string, right: string): number {
  const leftNumber = Number.parseInt(path.basename(left, path.extname(left)), 10)
  const rightNumber = Number.parseInt(path.basename(right, path.extname(right)), 10)
  return leftNumber - rightNumber
}

async function loadImageMaterials(): Promise<UserMaterialDto[]> {
  const files = (await readdir(imageDir))
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .sort(numericImageSort)

  return files.map((file, index) => {
    const id = `sample2_img_${String(index + 1).padStart(2, '0')}`
    const url = path.join(imageDir, file)
    const tags = [
      'landscape',
      'travel',
      'scenery',
      'montage',
      index % 3 === 0 ? 'wide_shot' : 'broll',
    ]
    return {
      id,
      material_type: 'IMAGE',
      oss_url: url,
      label: file,
      ai_tags: tags,
      asset_analysis: analyzeAssetHeuristically({
        id,
        type: 'IMAGE',
        name: file,
        url,
        tags,
        duration_sec: 1.2,
      }),
      status: 'READY',
    }
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  await mkdir(propsDir, { recursive: true })

  const materials = await loadImageMaterials()
  const sampleInfo = await stat(samplePath)
  const analyzer = new ArkFilesResponsesAnalyzer()

  const understanding = await analyzer.analyze(
    {
      storageKind: 'local',
      localPath: samplePath,
      originalName: path.basename(samplePath),
      mimeType: 'video/mp4',
      sizeBytes: sampleInfo.size,
      createdAt: new Date(),
    },
    {
      taskId,
      videoUrl: samplePath,
      globalPrompt:
        'Use the sample video only as editing structure, timing, rhythm, and visual style reference. Fill the final video with the provided landscape image materials. Keep the output suitable for Remotion execution.',
      materials,
      reportProgress: ({ progress, stage }) => {
        console.info(`[ark] ${progress}% ${stage}`)
      },
    },
  )

  const structure = {
    ...templateToMigrationProtocolV12(understanding.template, {
      taskId,
      videoUrl: samplePath,
      materials,
    }),
    director_grounding: understanding.director_grounding,
  }

  const renderPlan = buildRenderPlanFromStructure({
    taskId,
    structure,
    materials,
    aspectRatio: '4:3',
    sampleReference: {
      id: 'sample2_reference_audio',
      name: '2.mp4 reference audio',
      url: samplePath,
      duration_sec: structure.metadata.duration_sec,
    },
  })
  const stagedPlan = await stageLocalAssetsForRemotion(renderPlan, remotionRoot)

  await writeFile(
    path.join(outDir, `${taskId}.sample-understanding.json`),
    `${JSON.stringify(understanding, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    path.join(outDir, `${taskId}.migration-protocol.v1.2.json`),
    `${JSON.stringify(structure, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    path.join(outDir, `${taskId}.render-plan.json`),
    `${JSON.stringify(stagedPlan, null, 2)}\n`,
    'utf8',
  )

  const result = await remotionRenderer.renderMedia(stagedPlan, {
    outputDir: outDir,
    propsDir,
    remotionRoot,
    publicBaseUrl: 'http://localhost:3001',
    requireRender: true,
  })

  console.info(
    JSON.stringify(
      {
        taskId,
        outputPath: result.outputPath,
        finalVideoUrl: result.finalVideoUrl,
        propsPath: result.propsPath,
        understandingPath: path.join(outDir, `${taskId}.sample-understanding.json`),
        structurePath: path.join(outDir, `${taskId}.migration-protocol.v1.2.json`),
        renderPlanPath: path.join(outDir, `${taskId}.render-plan.json`),
        durationSec: stagedPlan.duration_sec,
        sceneCount: stagedPlan.scenes.length,
        assetCount: stagedPlan.assets.length,
        strategy: stagedPlan.strategy,
      },
      null,
      2,
    ),
  )
}

await main()
