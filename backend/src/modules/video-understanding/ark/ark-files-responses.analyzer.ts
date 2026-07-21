import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
  AnalyzerCallError,
  AnalyzerConfigurationError,
  AnalyzerResponseError,
} from '../errors.js';
import type { SampleUnderstandingResult } from '../../sample-understanding/sample-understanding.schema.js';
import { parseSampleUnderstandingResult } from '../../sample-understanding/parse-sample-understanding.js';
import { extractAudioVisualUnderstandingHints } from '../../sample-understanding/preprocessor/audio-visual-feature-extractor.js';
import {
  buildDirectorGroundingStructuringPrompt,
  buildDirectorObservationPrompt,
  buildDirectorGroundingRepairPrompt,
} from '../../sample-understanding/director-grounding/director-grounding-prompt.js';
import { parseDirectorGroundingResult } from '../../sample-understanding/director-grounding/parse-director-grounding.js';
import { directorGroundingToSampleUnderstanding } from '../../sample-understanding/director-grounding/director-grounding-to-template.js';
import { auditDirectorGroundingPromptClauses } from '../../sample-understanding/director-grounding/prompt-clause-registry.js';
import { buildDirectorGroundingSummary } from '../../sample-understanding/director-grounding/summary-policy.js';
import type { VideoInput } from '../video-input.js';
import { understandingEnv } from '../understanding-env.js';
import {
  agentTraceArtifactsDir,
  resolveAgentTraceBaseDir,
} from '../../agent-trace/paths.js';
import {
  artifactRefForPath,
  recordAgentTraceEvent,
} from '../../agent-trace/writer.js';
import {
  extractStructuredJsonCandidate,
  extractTextCandidate as extractStructuredTextCandidate,
  parseJsonFromText as parseStructuredJsonFromText,
  type StructuredJsonExtractionResult,
} from '../../agent-tools/structured-json-tool.js';

export interface AnalyzerProgressEvent {
  progress: number;
  stage: string;
}

export interface VideoAnalyzerContext {
  taskId: string
  videoUrl?: string
  globalPrompt?: string
  materials?: import('../../../../../shared/types/pipeline.js').UserMaterialDto[];
  sampleHints?: import('../../../../../shared/types/sample-understanding-skills.js').AudioVisualUnderstandingHints;
  onSampleHints?: (
    hints: import('../../../../../shared/types/sample-understanding-skills.js').AudioVisualUnderstandingHints,
  ) => void;
  reportProgress?: (event: AnalyzerProgressEvent) => Promise<void> | void;
}

type JsonRecord = Record<string, unknown>;

function isAnalyzerResponseError(error: unknown): error is AnalyzerResponseError {
  return error instanceof AnalyzerResponseError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ANALYZER_RESPONSE_ERROR');
}

/** 火山方舟 Files + Responses 视频理解（从 test_module/understanding 重构） */
export class ArkFilesResponsesAnalyzer {
  private readonly apiKey: string | undefined;
  private readonly filesUrl: string;
  private readonly responsesUrl: string;
  private readonly model: string;
  private readonly preprocessVideoFps: number;
  private readonly timeoutMs: number;
  private readonly fileReadyTimeoutMs: number;
  private readonly fileReadyPollIntervalMs: number;
  private readonly debugArtifactDir: string;

  constructor() {
    this.apiKey = understandingEnv.apiKey;
    this.filesUrl = understandingEnv.filesUrl;
    this.responsesUrl = understandingEnv.responsesUrl;
    this.model = understandingEnv.model;
    this.preprocessVideoFps = understandingEnv.preprocessVideoFps;
    this.timeoutMs = understandingEnv.timeoutMs;
    this.fileReadyTimeoutMs = understandingEnv.fileReadyTimeoutMs;
    this.fileReadyPollIntervalMs = understandingEnv.fileReadyPollIntervalMs;
    this.debugArtifactDir = understandingEnv.debugArtifactDir;
  }

  async analyze(video: VideoInput, context: VideoAnalyzerContext): Promise<SampleUnderstandingResult> {
    if (!this.apiKey) {
      throw new AnalyzerConfigurationError('VIDEO_UNDERSTANDING_API_KEY is required.');
    }

    await this.report(context, 10, 'uploading_video_file');
    const fileId = await this.uploadVideoFile(video, context);

    try {
      await this.report(context, 25, 'waiting_file_preprocess');
      await this.waitForFileReady(fileId, context);

      await this.report(context, 38, 'extracting_audio_visual_hints');
      const sampleHints = await extractAudioVisualUnderstandingHints(video);
      await this.writeDebugJson(context, 'sample-audio-visual-hints.json', sampleHints);
      context.onSampleHints?.(sampleHints);

      await this.report(context, 45, 'observing_sample_video');
      const promptContext = {
        ...context,
        sampleHints,
      };
      const observationPrompt = buildDirectorObservationPrompt(video, promptContext);
      await this.writeDebugText(
        context,
        '01-director-observation-prompt.md',
        `${observationPrompt}\n`,
      );
      const observationRawResponse = await this.callResponsesApi({
        promptText: observationPrompt,
        fileId,
        context,
        debugPrefix: '01-director-observation',
      });
      const observationBrief = this.extractObservationBrief(
        observationRawResponse,
        context.taskId,
      );
      await this.writeDebugJson(context, '01-director-observation-brief.json', observationBrief);

      await this.report(context, 62, 'structuring_director_grounding');
      const structuringPrompt = buildDirectorGroundingStructuringPrompt({
        video,
        context: promptContext,
        observationBrief,
      });
      await this.writeDebugText(
        context,
        '02-director-grounding-structuring-prompt.md',
        `${structuringPrompt}\n`,
      );
      const rawResponse = await this.callResponsesApi({
        promptText: structuringPrompt,
        context,
        debugPrefix: '02-director-grounding-structuring',
      });

      await this.report(context, 78, 'validating_director_grounding_json');
      const groundingExtraction = this.extractJsonCandidateWithReport(rawResponse);
      await this.writeDebugJson(
        context,
        'director-grounding-extraction-report.json',
        groundingExtraction.report,
      );
      const groundingCandidate = this.ensureTaskId(
        (groundingExtraction.candidate ?? groundingExtraction.repairInput) as JsonRecord,
        context.taskId,
      );
      const grounding = await this.parseOrRepairDirectorGrounding({
        video,
        fileId,
        context,
        candidate: groundingCandidate,
      });
      const normalizationDiff = this.buildNormalizationDiffSummary(
        groundingCandidate,
        grounding,
      );
      if (normalizationDiff.changed) {
        await this.writeDebugJson(
          context,
          'director-grounding-normalization-diff.json',
          normalizationDiff,
        );
      }
      await this.writeDebugJson(context, 'director-grounding-validated.json', grounding);
      const promptClauseAudit = auditDirectorGroundingPromptClauses({
        taskId: context.taskId,
        grounding,
        sampleHints,
        materialCount: context.materials?.length,
      });
      await this.writeDebugJson(
        context,
        'prompt-clause-audit.json',
        promptClauseAudit,
      );
      await this.writeDebugJson(
        context,
        'director-grounding-summary.json',
        buildDirectorGroundingSummary({
          taskId: context.taskId,
          grounding,
          promptClauseAudit,
        }),
      );

      await this.report(context, 88, 'adapting_director_grounding_to_template');
      const sampleUnderstandingCandidate = this.enrichCandidateWithAudioHints(
        directorGroundingToSampleUnderstanding({
          grounding,
          taskId: context.taskId,
          videoUrl: context.videoUrl ?? video.localPath,
          materials: context.materials,
          sampleHints,
        }) as unknown as JsonRecord,
        sampleHints,
      );
      await this.writeDebugJson(
        context,
        'sample-understanding-adapter-summary.json',
        this.buildSampleUnderstandingAdapterSummary(sampleUnderstandingCandidate, grounding),
      );
      if (this.shouldWriteVerboseTrace()) {
        await this.writeDebugJson(
          context,
          'sample-understanding-from-director-grounding.verbose.json',
          sampleUnderstandingCandidate,
        );
      }
      const validated = parseSampleUnderstandingResult(sampleUnderstandingCandidate, {
        taskId: context.taskId,
      });

      await this.report(context, 95, 'understanding_json_validated');
      return validated;
    } finally {
      await this.deleteUploadedFile(fileId, context);
    }
  }

  private async parseOrRepairDirectorGrounding(input: {
    video: VideoInput;
    fileId: string;
    context: VideoAnalyzerContext;
    candidate: unknown;
  }) {
    try {
      return parseDirectorGroundingResult(input.candidate, input.context.taskId);
    } catch (error) {
      if (!isAnalyzerResponseError(error)) throw error;
      await this.report(input.context, 82, 'repairing_director_grounding_json');
      const repairPrompt = buildDirectorGroundingRepairPrompt({
        taskId: input.context.taskId,
        validationError: error.message,
        previousJson: input.candidate,
      });
      const repairRaw = await this.callResponsesApi({
        promptText: repairPrompt,
        fileId: input.fileId,
        context: input.context,
        debugPrefix: 'director-grounding-repair',
      });
      await this.writeDebugJson(input.context, 'director-grounding-repair-raw-response.json', repairRaw);
      const repairExtraction = this.extractJsonCandidateWithReport(repairRaw);
      await this.writeDebugJson(
        input.context,
        'director-grounding-repair-extraction-report.json',
        repairExtraction.report,
      );
      if (!repairExtraction.candidate) {
        throw new AnalyzerResponseError(
          `DirectorGrounding repair did not return parseable JSON. initial_error=${error.message}; repair_extraction=${JSON.stringify(repairExtraction.report)}`,
        );
      }
      const repaired = this.ensureTaskId(
        repairExtraction.candidate as JsonRecord,
        input.context.taskId,
      );
      await this.writeDebugJson(input.context, 'director-grounding-repaired.json', repaired);
      return parseDirectorGroundingResult(repaired, input.context.taskId);
    }
  }

  private enrichCandidateWithAudioHints(
    candidate: JsonRecord,
    sampleHints: NonNullable<VideoAnalyzerContext['sampleHints']>,
  ): JsonRecord {
    const template = candidate.template;
    if (!template || typeof template !== 'object' || Array.isArray(template)) return candidate;

    const templateRecord = template as JsonRecord;
    const renderRecipe =
      templateRecord.render_recipe && typeof templateRecord.render_recipe === 'object'
        ? (templateRecord.render_recipe as JsonRecord)
        : {};
    const audioDriver =
      renderRecipe.audio_driver && typeof renderRecipe.audio_driver === 'object'
        ? (renderRecipe.audio_driver as JsonRecord)
        : {};

    templateRecord.render_recipe = {
      ...renderRecipe,
      audio_driver: {
        ...audioDriver,
        beat_times: sampleHints.audio_features.beats,
        strong_beats: sampleHints.audio_features.strong_beats,
        energy_peaks: sampleHints.audio_features.energy_peaks,
        waveform: sampleHints.audio_features.waveform,
      },
    };

    return candidate;
  }

  private async uploadVideoFile(video: VideoInput, context: VideoAnalyzerContext): Promise<string> {
    const buffer = await readFile(video.localPath);
    const form = new FormData();
    form.append('purpose', 'user_data');
    form.append('file', new Blob([buffer], { type: video.mimeType }), video.originalName);
    form.append('preprocess_configs[video][fps]', String(this.preprocessVideoFps));
    await this.writeDebugText(context, 'ark-files-upload.curl.txt', this.buildFilesUploadCurl(video));

    let response: Response;
    try {
      response = await fetch(this.filesUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AnalyzerCallError('Failed to upload video through Ark Files API.', error);
    }

    const responseText = await response.text();
    await this.writeDebugText(context, 'ark-files-upload-raw-response.txt', responseText);
    if (!response.ok) {
      throw new AnalyzerCallError(
        `Files API returned ${response.status}: ${responseText.slice(0, 1000)}`,
      );
    }

    const payload = this.parseJsonResponse(responseText, 'Files API returned non-JSON response.');
    await this.writeDebugJson(context, 'ark-files-upload-response.json', payload);
    return this.extractFileId(payload);
  }

  private async callResponsesApi(input: {
    promptText: string;
    fileId?: string;
    context: VideoAnalyzerContext;
    debugPrefix: string;
  }): Promise<unknown> {
    const content: Array<Record<string, string>> = [];
    if (input.fileId) {
      content.push({
        type: 'input_video',
        file_id: input.fileId,
      });
    }
    content.push({
      type: 'input_text',
      text: input.promptText,
    });

    const payload = {
      model: this.model,
      input: [
        {
          role: 'user',
          content,
        },
      ],
    };
    await this.writeDebugJson(input.context, `${input.debugPrefix}-request.json`, payload);
    await this.writeDebugText(
      input.context,
      `${input.debugPrefix}-request.curl.txt`,
      this.buildResponsesCurl(payload),
    );

    let response: Response;
    try {
      response = await fetch(this.responsesUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AnalyzerCallError(
        `Failed to call Ark Responses API. ${this.describeError(error)}`,
        error,
      );
    }

    const responseText = await response.text();
    await this.writeDebugText(input.context, `${input.debugPrefix}-raw-response.txt`, responseText);
    if (!response.ok) {
      throw new AnalyzerCallError(
        `Responses API returned ${response.status}: ${responseText.slice(0, 1000)}`,
      );
    }

    const payloadResponse = this.parseJsonResponse(
      responseText,
      'Responses API returned non-JSON response.',
    );
    return payloadResponse;
  }

  private extractFileId(raw: unknown): string {
    if (!this.isRecord(raw)) {
      throw new AnalyzerResponseError('Files API response is not an object.');
    }

    const candidates = [raw.id, raw.file_id];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }

    if (this.isRecord(raw.data)) {
      const nested = [raw.data.id, raw.data.file_id];
      for (const candidate of nested) {
        if (typeof candidate === 'string' && candidate.length > 0) {
          return candidate;
        }
      }
    }

    throw new AnalyzerResponseError('Could not locate file_id in Files API response.');
  }

  private ensureTaskId(candidate: unknown, taskId: string): unknown {
    if (!this.isRecord(candidate) || typeof candidate.task_id === 'string') {
      return candidate;
    }

    return {
      ...candidate,
      task_id: taskId,
    };
  }

  private extractObservationBrief(raw: unknown, taskId: string): JsonRecord {
    const text = this.extractTextCandidate(raw).trim();
    const parsed = text.length > 0 ? this.parseJsonFromText(text) : raw;
    const brief = this.isRecord(parsed)
      ? parsed
      : {
          raw_text: text || this.safePreview(raw),
        };

    return {
      schema_version: 'director_observation_brief.v1',
      ...brief,
      task_id: typeof brief.task_id === 'string' ? brief.task_id : taskId,
    };
  }

  private buildNormalizationDiffSummary(before: unknown, after: unknown): JsonRecord {
    const beforeText = this.stableJson(before);
    const afterText = this.stableJson(after);
    return {
      schema_version: 'director_grounding_normalization_diff.v1',
      changed: beforeText !== afterText,
      before_kind: this.describeJsonShape(before),
      after_kind: this.describeJsonShape(after),
      note: 'Only the shape and change flag are stored here to avoid duplicating full DirectorGrounding payloads. The final normalized payload is director-grounding-validated.json.',
    };
  }

  private buildSampleUnderstandingAdapterSummary(
    sampleUnderstandingCandidate: JsonRecord,
    grounding: unknown,
  ): JsonRecord {
    const template = this.isRecord(sampleUnderstandingCandidate.template)
      ? sampleUnderstandingCandidate.template
      : {};
    const renderRecipe = this.isRecord(template.render_recipe)
      ? (template.render_recipe as JsonRecord)
      : {};
    const structure = Array.isArray(template.structure) ? template.structure : [];
    const transitions = Array.isArray(template.transitions) ? template.transitions : [];
    const sceneEffects = Array.isArray(renderRecipe.scene_effects)
      ? renderRecipe.scene_effects
      : [];

    return {
      schema_version: 'sample_understanding_adapter_summary.v1',
      source_ref: 'director-grounding-validated.json',
      full_payload_omitted: true,
      top_level_keys: Object.keys(sampleUnderstandingCandidate),
      template_keys: Object.keys(template),
      counts: {
        template_structure_segments: structure.length,
        template_transitions: transitions.length,
        render_recipe_scene_effects: sceneEffects.length,
      },
      director_grounding_shape: this.describeJsonShape(grounding),
      note: 'The full adapter payload is kept in memory for validation. Set AGENT_TRACE_VERBOSE=true to write sample-understanding-from-director-grounding.verbose.json.',
    };
  }

  private shouldWriteVerboseTrace(): boolean {
    const value = process.env.AGENT_TRACE_VERBOSE?.trim().toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
  }

  private describeJsonShape(value: unknown): JsonRecord {
    if (Array.isArray(value)) {
      return { type: 'array', length: value.length };
    }
    if (this.isRecord(value)) {
      return { type: 'object', keys: Object.keys(value).sort() };
    }
    return { type: typeof value };
  }

  private stableJson(value: unknown): string {
    try {
      return JSON.stringify(value, Object.keys(this.collectJsonKeys(value)).sort());
    } catch {
      return String(value);
    }
  }

  private collectJsonKeys(value: unknown, keys = new Set<string>()): Record<string, true> {
    if (Array.isArray(value)) {
      for (const item of value) this.collectJsonKeys(item, keys);
      return Object.fromEntries([...keys].map((key) => [key, true]));
    }
    if (this.isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        this.collectJsonKeys(child, keys);
      }
    }
    return Object.fromEntries([...keys].map((key) => [key, true]));
  }

  private safePreview(value: unknown): string {
    try {
      return JSON.stringify(value).slice(0, 2000);
    } catch {
      return String(value).slice(0, 2000);
    }
  }

  private async waitForFileReady(fileId: string, context: VideoAnalyzerContext): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= this.fileReadyTimeoutMs) {
      const metadata = await this.retrieveFileMetadata(fileId);
      const status = this.extractFileStatus(metadata);

      if (status === 'active' || status === 'processed') {
        return;
      }

      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new AnalyzerResponseError(
          `Files API preprocessing failed for ${fileId}. status=${status}`,
        );
      }

      const elapsed = Date.now() - startedAt;
      const progress = Math.min(44, 25 + Math.floor((elapsed / this.fileReadyTimeoutMs) * 19));
      await this.report(context, progress, `waiting_file_preprocess:${status ?? 'unknown'}`);
      await this.sleep(this.fileReadyPollIntervalMs);
    }

    throw new AnalyzerCallError(
      `Timed out waiting for Files API preprocessing. file_id=${fileId}`,
    );
  }

  private async retrieveFileMetadata(fileId: string): Promise<unknown> {
    const url = `${this.filesUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileId)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AnalyzerCallError('Failed to retrieve file metadata from Ark Files API.', error);
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new AnalyzerCallError(
        `Files retrieve API returned ${response.status}: ${responseText.slice(0, 1000)}`,
      );
    }

    return this.parseJsonResponse(responseText, 'Files retrieve API returned non-JSON response.');
  }

  private async deleteUploadedFile(fileId: string, context: VideoAnalyzerContext): Promise<void> {
    const url = `${this.filesUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileId)}`;
    await this.writeDebugText(context, 'ark-files-delete.curl.txt', this.buildFilesDeleteCurl(fileId));

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const responseText = await response.text();
      await this.writeDebugText(context, 'ark-files-delete-raw-response.txt', responseText);
      if (!response.ok) {
        console.warn(
          `[ark-files] failed to delete uploaded file ${fileId}: ${response.status} ${responseText.slice(0, 300)}`,
        );
      }
    } catch (error) {
      console.warn(
        `[ark-files] failed to delete uploaded file ${fileId}: ${this.describeError(error)}`,
      );
    }
  }

  private extractFileStatus(raw: unknown): string | undefined {
    if (!this.isRecord(raw)) {
      return undefined;
    }

    const candidates = [raw.status, raw.state];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        return candidate;
      }
    }

    if (this.isRecord(raw.data)) {
      const nested = [raw.data.status, raw.data.state];
      for (const candidate of nested) {
        if (typeof candidate === 'string') {
          return candidate;
        }
      }
    }

    return undefined;
  }

  private extractJsonCandidate(raw: unknown): unknown {
    const extraction = this.extractJsonCandidateWithReport(raw);
    if (extraction.candidate) return extraction.candidate;

    throw new AnalyzerResponseError(
      `Could not locate DirectorGroundingResult JSON in Responses API response. extraction=${JSON.stringify(extraction.report)}`,
    );
  }

  private extractJsonCandidateOrRepairInput(raw: unknown): unknown {
    const extraction = this.extractJsonCandidateWithReport(raw);
    return extraction.candidate ?? extraction.repairInput;
  }

  private extractJsonCandidateWithReport(raw: unknown): StructuredJsonExtractionResult {
    return extractStructuredJsonCandidate(raw, (value) =>
      this.looksLikeDirectorGroundingCandidate(value),
    );
  }

  private parseCandidate(candidate: unknown): unknown {
    if (this.looksLikeDirectorGroundingCandidate(candidate)) {
      return candidate;
    }

    if (typeof candidate === 'string') {
      const parsed = this.parseJsonFromText(candidate);
      return this.findDirectorGroundingCandidate(parsed) ?? parsed;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const parsed = this.parseCandidate(item);
        if (this.looksLikeDirectorGroundingCandidate(parsed)) {
          return parsed;
        }
      }
      const text = candidate
        .map((item) => this.extractTextCandidate(item))
        .filter(Boolean)
        .join('\n');

      return text ? this.parseJsonFromText(text) : candidate;
    }

    if (this.isRecord(candidate)) {
      const text = this.extractTextCandidate(candidate);
      return text ? this.parseJsonFromText(text) : candidate;
    }

    return candidate;
  }

  private findDirectorGroundingCandidate(raw: unknown, depth = 0): unknown | null {
    if (depth > 10) return null;

    const parsed = typeof raw === 'string' ? this.parseJsonFromText(raw) : raw;
    if (this.looksLikeDirectorGroundingCandidate(parsed)) {
      return parsed;
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const found = this.findDirectorGroundingCandidate(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (!this.isRecord(parsed)) return null;

    const preferredKeys = [
      'output_text',
      'text',
      'content',
      'json',
      'parsed',
      'arguments',
      'data',
      'result',
      'response',
      'message',
      'choices',
      'output',
    ];
    for (const key of preferredKeys) {
      if (!(key in parsed)) continue;
      const found = this.findDirectorGroundingCandidate(parsed[key], depth + 1);
      if (found) return found;
    }

    for (const value of Object.values(parsed)) {
      const found = this.findDirectorGroundingCandidate(value, depth + 1);
      if (found) return found;
    }

    return null;
  }

  private extractTextCandidate(candidate: unknown): string {
    return extractStructuredTextCandidate(candidate);
  }

  private parseJsonFromText(text: string): unknown {
    return parseStructuredJsonFromText(text);
  }

  private parseJsonResponse(text: string, message: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new AnalyzerResponseError(message, error);
    }
  }

  private describeError(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }

    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      return `${error.name}: ${error.message}; cause=${cause.name}: ${cause.message}`;
    }
    if (cause && typeof cause === 'object') {
      return `${error.name}: ${error.message}; cause=${JSON.stringify(cause)}`;
    }
    return `${error.name}: ${error.message}`;
  }

  private looksLikeDirectorGroundingCandidate(value: unknown): boolean {
    if (!this.isRecord(value)) return false;
    if (value.schema_version === 'director_grounding.v1') return true;
    return (
      this.isRecord(value.source) &&
      this.isRecord(value.intent) &&
      Array.isArray(value.temporal_events) &&
      this.isRecord(value.render_recipe)
    );
  }

  private isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async report(
    context: VideoAnalyzerContext,
    progress: number,
    stage: string,
  ): Promise<void> {
    await context.reportProgress?.({ progress, stage });
  }

  private readNumber(_key: string, fallback: number): number {
    return fallback;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private buildFilesUploadCurl(video: VideoInput): string {
    return [
      `curl -X POST ${this.shellQuote(this.filesUrl)} \\`,
      '  -H "Authorization: Bearer $ARK_API_KEY" \\',
      "  -F 'purpose=user_data' \\",
      `  -F ${this.shellQuote(`file=@${video.localPath}`)} \\`,
      `  -F ${this.shellQuote(`preprocess_configs[video][fps]=${this.preprocessVideoFps}`)}`,
      '',
    ].join('\n');
  }

  private buildFilesDeleteCurl(fileId: string): string {
    const url = `${this.filesUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileId)}`;
    return [
      `curl -X DELETE ${this.shellQuote(url)} \\`,
      '  -H "Authorization: Bearer $ARK_API_KEY"',
      '',
    ].join('\n');
  }

  private buildResponsesCurl(payload: unknown): string {
    return [
      `curl -X POST ${this.shellQuote(this.responsesUrl)} \\`,
      '  -H "Authorization: Bearer $ARK_API_KEY" \\',
      "  -H 'Content-Type: application/json' \\",
      `  -d ${this.shellQuote(JSON.stringify(payload, null, 2))}`,
      '',
    ].join('\n');
  }

  private async writeDebugJson(
    context: VideoAnalyzerContext,
    fileName: string,
    payload: unknown,
  ): Promise<void> {
    await this.writeDebugText(context, fileName, `${JSON.stringify(payload, null, 2)}\n`);
  }

  private async writeDebugText(
    context: VideoAnalyzerContext,
    fileName: string,
    content: string,
  ): Promise<void> {
    if (!this.debugArtifactDir.trim()) {
      return;
    }

    const dir = agentTraceArtifactsDir(
      context.taskId,
      'sample_understanding',
      this.debugArtifactDir,
    );
    const latestDir = path.join(
      resolveAgentTraceBaseDir(this.debugArtifactDir),
      'latest',
      'sample_understanding',
    );
    const artifactPath = path.join(dir, fileName);

    await mkdir(dir, { recursive: true });
    await writeFile(artifactPath, content, 'utf8');
    await mkdir(latestDir, { recursive: true });
    await writeFile(path.join(latestDir, fileName), content, 'utf8');
    await writeFile(path.join(latestDir, 'task-id.txt'), `${context.taskId}\n`, 'utf8');

    const artifact = await artifactRefForPath({
      taskId: context.taskId,
      path: artifactPath,
      label: fileName,
    });
    await recordAgentTraceEvent({
      taskId: context.taskId,
      phase: 'sample_understanding',
      actor: fileName.includes('ark-responses') ||
        fileName.includes('director-grounding') ||
        fileName.includes('director-observation')
        ? 'llm'
        : 'tool',
      event: 'artifact',
      status: 'success',
      summary: `Sample understanding artifact written: ${fileName}`,
      artifactRefs: [artifact],
      data: { file_name: fileName },
    });
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, "'\"'\"'")}'`;
  }
}
