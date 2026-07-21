import {
  runPipelineAnalysis,
  type RunPipelineAnalysisInput,
} from '@/services/pipeline/runAnalysis'

/** Analyze the sample and stop. Final generation is only triggered explicitly. */
export async function runFullCreationPipeline(
  input: RunPipelineAnalysisInput,
): Promise<void> {
  await runPipelineAnalysis(input)
}
