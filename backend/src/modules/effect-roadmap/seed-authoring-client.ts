import type {
  SeedAuthoringClient,
  SeedAuthoringInvokeResult,
  SeedPluginAuthoringRequestPayload,
} from './seed-plugin-mapper.js'

export function createUnavailableSeedAuthoringClient(
  reason = 'Seed authoring service unavailable',
): SeedAuthoringClient {
  return {
    invoke: async (): Promise<SeedAuthoringInvokeResult> => ({
      available: false,
      raw_response: `${reason}\n`,
      proposals: [],
      unavailable_reason: reason,
    }),
  }
}

export function createMockSeedAuthoringClient(
  result: SeedAuthoringInvokeResult,
): SeedAuthoringClient {
  return {
    invoke: async (input: {
      taskId: string
      request: SeedPluginAuthoringRequestPayload
    }): Promise<SeedAuthoringInvokeResult> => ({
      ...result,
      raw_response: result.raw_response.replace('{{task_id}}', input.taskId),
    }),
  }
}
