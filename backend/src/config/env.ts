import 'dotenv/config'

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim()
  return value || undefined
}

function readNumber(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function readStructuredOutputMode(key: string): 'auto' | 'off' {
  return readEnv(key) === 'off' ? 'off' : 'auto'
}

/**
 * API keys are managed by backend/.env.
 * Final video output is rendered locally through Remotion.
 */
const arkApiKey = readEnv('ARK_API_KEY')
const arkApiKeyName = readEnv('ARK_API_KEY_NAME')
const defaultArkModel = 'doubao-seed-2-0-lite-260428'
const defaultV2VideoGenerationModel = 'doubao-seedance-1-5-pro-251215'
const defaultAgentTraceDir = readEnv('AGENT_TRACE_DIR') ?? 'tmp/agent-trace'

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? '',
  creativeKnowledgeAdminToken: readEnv('CREATIVE_KNOWLEDGE_ADMIN_TOKEN'),
  creativeRetrievalMode:
    readEnv('CREATIVE_RETRIEVAL_MODE') === 'hybrid' ? 'hybrid' as const : 'bm25' as const,
  creativeEmbeddingRemoteHost:
    readEnv('CREATIVE_EMBEDDING_REMOTE_HOST') ?? 'https://huggingface.co/',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  wsPath: process.env.WS_PATH ?? '/ws/tasks',
  isDev: process.env.NODE_ENV !== 'production',
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`,
  publicAssetBaseUrl:
    readEnv('PUBLIC_ASSET_BASE_URL') ??
    readEnv('PUBLIC_UPLOAD_BASE_URL') ??
    process.env.PUBLIC_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3001}`,
  assetPublisherProvider:
    readEnv('ASSET_PUBLISHER_PROVIDER') === 'tos' ? 'tos' : 'local',
  assetPublisherPublicBaseUrl:
    readEnv('ASSET_PUBLISHER_PUBLIC_BASE_URL') ??
    readEnv('TOS_PUBLIC_BASE_URL') ??
    readEnv('PUBLIC_ASSET_BASE_URL') ??
    readEnv('PUBLIC_UPLOAD_BASE_URL'),
  assetPublisherVerifyPublicUrl:
    readEnv('ASSET_PUBLISHER_VERIFY_PUBLIC_URL') !== 'false',
  assetPublisherVerifyTimeoutMs: readNumber(
    'ASSET_PUBLISHER_VERIFY_TIMEOUT_MS',
    10_000,
  ),
  tosAccessKeyId:
    readEnv('TOS_ACCESS_KEY_ID') ??
    readEnv('VOLCENGINE_ACCESS_KEY_ID'),
  tosAccessKeySecret:
    readEnv('TOS_ACCESS_KEY_SECRET') ??
    readEnv('VOLCENGINE_ACCESS_KEY_SECRET'),
  tosRegion: readEnv('TOS_REGION') ?? 'cn-beijing',
  tosEndpoint: readEnv('TOS_ENDPOINT'),
  tosBucket: readEnv('TOS_BUCKET'),
  tosObjectPrefix: readEnv('TOS_OBJECT_PREFIX') ?? 'dpl304/uploads',

  /** API keys from backend/.env. */
  arkApiKeyName,
  arkApiKey,
  videoUnderstandingApiKey:
    readEnv('VIDEO_UNDERSTANDING_API_KEY') ?? arkApiKey,

  /** Ark Files + Responses video understanding. */
  videoUnderstandingModel:
    readEnv('VIDEO_UNDERSTANDING_MODEL') ?? defaultArkModel,
  videoUnderstandingFilesUrl:
    readEnv('VIDEO_UNDERSTANDING_FILES_URL') ??
    'https://ark.cn-beijing.volces.com/api/v3/files',
  videoUnderstandingResponsesUrl:
    readEnv('VIDEO_UNDERSTANDING_RESPONSES_URL') ??
    'https://ark.cn-beijing.volces.com/api/v3/responses',
  videoUnderstandingPreprocessFps: readNumber(
    'VIDEO_UNDERSTANDING_PREPROCESS_VIDEO_FPS',
    0.3,
  ),
  videoUnderstandingTimeoutMs: readNumber(
    'VIDEO_UNDERSTANDING_TIMEOUT_MS',
    300_000,
  ),
  videoUnderstandingFileReadyTimeoutMs: readNumber(
    'VIDEO_UNDERSTANDING_FILE_READY_TIMEOUT_MS',
    180_000,
  ),
  videoUnderstandingFileReadyPollIntervalMs: readNumber(
    'VIDEO_UNDERSTANDING_FILE_READY_POLL_INTERVAL_MS',
    2_000,
  ),
  videoUnderstandingDebugArtifactDir:
    readEnv('VIDEO_UNDERSTANDING_DEBUG_ARTIFACT_DIR') ??
    defaultAgentTraceDir,
  /** Prefer provider JSON Schema output; retry once without it when unsupported. */
  videoUnderstandingStructuredOutputMode: readStructuredOutputMode(
    'VIDEO_UNDERSTANDING_STRUCTURED_OUTPUT_MODE',
  ),

  /** Local Remotion rendering. */
  remotionRoot: readEnv('REMOTION_ROOT') ?? '../remotion',
  remotionCompositionId: readEnv('REMOTION_COMPOSITION_ID') ?? 'V2TimelineVideo',
  renderOutputDir: readEnv('RENDER_OUTPUT_DIR') ?? 'renders',
  directorAgentApiKey:
    readEnv('DIRECTOR_AGENT_API_KEY') ??
    readEnv('VIDEO_UNDERSTANDING_API_KEY') ??
    arkApiKey,
  directorAgentModel:
    readEnv('DIRECTOR_AGENT_MODEL') ??
    readEnv('VIDEO_UNDERSTANDING_MODEL') ??
    defaultArkModel,
  directorAgentResponsesUrl:
    readEnv('DIRECTOR_AGENT_RESPONSES_URL') ??
    readEnv('VIDEO_UNDERSTANDING_RESPONSES_URL') ??
    'https://ark.cn-beijing.volces.com/api/v3/responses',
  directorAgentFilesUrl:
    readEnv('DIRECTOR_AGENT_FILES_URL') ??
    readEnv('VIDEO_UNDERSTANDING_FILES_URL') ??
    'https://ark.cn-beijing.volces.com/api/v3/files',
  directorAgentTimeoutMs: readNumber('DIRECTOR_AGENT_TIMEOUT_MS', 120_000),
  directorAgentFileReadyTimeoutMs: readNumber(
    'DIRECTOR_AGENT_FILE_READY_TIMEOUT_MS',
    readNumber('VIDEO_UNDERSTANDING_FILE_READY_TIMEOUT_MS', 180_000),
  ),
  directorAgentFileReadyPollIntervalMs: readNumber(
    'DIRECTOR_AGENT_FILE_READY_POLL_INTERVAL_MS',
    readNumber('VIDEO_UNDERSTANDING_FILE_READY_POLL_INTERVAL_MS', 2_000),
  ),
  directorAgentEnabled: readEnv('DIRECTOR_AGENT_ENABLED') !== 'false',
  /** Enable only after the configured Responses provider accepts previous_response_id. */
  directorAgentResponseContinuity:
    readEnv('DIRECTOR_AGENT_RESPONSE_CONTINUITY') === 'true',
  /** Prefer provider JSON Schema output; retry once without it when unsupported. */
  directorAgentStructuredOutputMode: readStructuredOutputMode(
    'DIRECTOR_AGENT_STRUCTURED_OUTPUT_MODE',
  ),

  /** V2 generated material adapter. Provider-specific API shapes stay behind this boundary. */
  v2VideoGenerationProvider:
    readEnv('V2_VIDEO_GENERATION_PROVIDER') ?? 'none',
  v2VideoGenerationApiKey:
    readEnv('V2_VIDEO_GENERATION_API_KEY') ?? arkApiKey,
  v2VideoGenerationModel:
    readEnv('V2_VIDEO_GENERATION_MODEL') ?? defaultV2VideoGenerationModel,
  v2VideoGenerationSubmitUrl:
    readEnv('V2_VIDEO_GENERATION_SUBMIT_URL') ??
    'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
  v2VideoGenerationStatusUrlTemplate:
    readEnv('V2_VIDEO_GENERATION_STATUS_URL_TEMPLATE') ??
    'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}',
  v2VideoGenerationDownloadUrlTemplate:
    readEnv('V2_VIDEO_GENERATION_DOWNLOAD_URL_TEMPLATE'),
  v2VideoGenerationDefaultImageUrl:
    readEnv('V2_VIDEO_GENERATION_DEFAULT_IMAGE_URL'),
  v2VideoGenerationTimeoutMs: readNumber(
    'V2_VIDEO_GENERATION_TIMEOUT_MS',
    180_000,
  ),
  v2VideoGenerationPollIntervalMs: readNumber(
    'V2_VIDEO_GENERATION_POLL_INTERVAL_MS',
    3_000,
  ),
  v2MaterialGenerationConcurrency: readNumber(
    'V2_MATERIAL_GENERATION_CONCURRENCY',
    3,
  ),
  v2GeneratedVideoWidth: readNumber('V2_GENERATED_VIDEO_WIDTH', 1080),
  v2GeneratedVideoHeight: readNumber('V2_GENERATED_VIDEO_HEIGHT', 1920),
  v2GeneratedVideoFps: readNumber('V2_GENERATED_VIDEO_FPS', 30),
}

/** Warn early when an Ark API key looks like the wrong console value. */
export function warnIfArkApiKeyFormatSuspicious(
  key: string | undefined,
  label = 'ARK_API_KEY',
): void {
  if (!key) return
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
  if (uuidLike) return
  if (!key.startsWith('ark-')) {
    console.warn(
      `[env] ${label} does not look like an Ark API key. Use the provider's API key value, not an endpoint or AK/SK pair.`,
    )
    return
  }

  const keySegments = key.split('-')
  if (key.length < 50 || keySegments.length < 5) {
    console.warn(
      `[env] ${label} length is ${key.length}; it may be incomplete. Click Copy in the Ark console and update backend/.env with the full key.`,
    )
    return
  }

}

warnIfArkApiKeyFormatSuspicious(env.arkApiKey)
warnIfArkApiKeyFormatSuspicious(env.videoUnderstandingApiKey, 'VIDEO_UNDERSTANDING_API_KEY')
