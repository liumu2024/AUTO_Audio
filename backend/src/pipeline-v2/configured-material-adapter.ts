import path from 'node:path'

import { env } from '../config/env.js'
import { createArkSeedanceMaterialGenerationAdapter } from './ark-seedance-adapter.js'
import {
  createNoopMaterialGenerationAdapter,
  type V2MaterialGenerationAdapter,
} from './material-generation-adapter.js'

export function createConfiguredV2MaterialGenerationAdapter(input: {
  outputDir: string
}): V2MaterialGenerationAdapter {
  if (env.v2VideoGenerationProvider === 'ark-seedance') {
    return createArkSeedanceMaterialGenerationAdapter({
      outputDir: path.join(input.outputDir, 'ark-seedance-downloads'),
    })
  }

  return createNoopMaterialGenerationAdapter()
}
