/**
 * 视频理解结果归一化：把模型可能输出的近似字段、中文描述或简略结构，收敛成严格的 VideoUnderstandingResult。
 */
import type { VideoInput } from '../video-input.js';
import type { VideoUnderstandingResult } from '../schemas/video-understanding.schema.js';

type JsonRecord = Record<string, unknown>;

export function normalizeVideoUnderstandingResult(
  candidate: unknown,
  video: VideoInput,
): VideoUnderstandingResult {
  const source = isRecord(candidate) ? candidate : {};
  const metadata = isRecord(source.metadata) ? source.metadata : {};
  const processingStrategy = isRecord(source.processing_strategy) ? source.processing_strategy : {};
  const videoDna = isRecord(source.video_dna) ? source.video_dna : {};
  const rhythmStructure = isRecord(source.rhythm_structure) ? source.rhythm_structure : {};
  const physicalTracks = isRecord(source.physical_tracks) ? source.physical_tracks : {};
  const qualityAndReview = isRecord(source.quality_and_review) ? source.quality_and_review : {};

  return {
    metadata: normalizeMetadata(metadata, video),
    processing_strategy: normalizeProcessingStrategy(processingStrategy),
    video_dna: normalizeVideoDna(videoDna),
    rhythm_structure: normalizeRhythmStructure(rhythmStructure),
    semantic_anchors: normalizeSemanticAnchors(source.semantic_anchors),
    physical_tracks: normalizePhysicalTracks(physicalTracks),
    quality_and_review: normalizeQualityAndReview(qualityAndReview),
  };
}

function normalizeMetadata(metadata: JsonRecord, video: VideoInput): VideoUnderstandingResult['metadata'] {
  const audioStatus = metadata.audio_stems ?? metadata.audio_separation_status;
  const audioStems = isRecord(audioStatus) ? audioStatus : {};
  const resolution = isRecord(metadata.resolution) ? metadata.resolution : {};

  return {
    video_id: stringValue(metadata.video_id, video.originalName),
    duration_sec: numberValue(metadata.duration_sec ?? metadata.duration_seconds, 0),
    fps: numberValue(metadata.fps, 0),
    resolution: {
      width: integerValue(resolution.width, 0),
      height: integerValue(resolution.height, 0),
    },
    source_platform: stringValue(metadata.source_platform, 'Unknown'),
    content_category: stringValue(metadata.content_category ?? metadata.content_title, 'unknown'),
    audio_stems: {
      vocal_separated: booleanValue(audioStems.vocal_separated, false),
      bgm_sfx_separated: booleanValue(audioStems.bgm_sfx_separated, false),
    },
  };
}

function normalizeProcessingStrategy(
  strategy: JsonRecord,
): VideoUnderstandingResult['processing_strategy'] {
  const dominant = isRecord(strategy.dominant_track_strategy)
    ? strategy.dominant_track_strategy
    : {};
  const alignment = isRecord(strategy.alignment_policy) ? strategy.alignment_policy : {};
  const windows = isRecord(alignment.absorption_windows_sec) ? alignment.absorption_windows_sec : {};
  const hierarchical = isRecord(strategy.hierarchical_processing)
    ? strategy.hierarchical_processing
    : {};
  const overlay = isRecord(strategy.overlay_tracking_policy) ? strategy.overlay_tracking_policy : {};

  return {
    video_structure_type: enumValue(strategy.video_structure_type, VIDEO_STRUCTURE_TYPES, 'unknown'),
    dominant_track_strategy: {
      dominant_track: enumValue(dominant.dominant_track, DOMINANT_TRACKS, 'unknown'),
      dominant_reason: stringValue(dominant.dominant_reason, ''),
      fallback_tracks: enumArrayValue(dominant.fallback_tracks, DOMINANT_TRACKS),
      default_absorption_window_sec: numberValue(dominant.default_absorption_window_sec, 0.5),
      local_dominant_track_allowed: booleanValue(dominant.local_dominant_track_allowed, true),
    },
    alignment_policy: {
      use_tolerance_absorption: booleanValue(alignment.use_tolerance_absorption, true),
      absorption_windows_sec: {
        asr_dominant: numberValue(windows.asr_dominant, 0.5),
        ocr_overlay_dominant: numberValue(windows.ocr_overlay_dominant, 0.3),
        vision_action_dominant: numberValue(windows.vision_action_dominant, 0.5),
        beat_sfx_cut_dominant: numberValue(windows.beat_sfx_cut_dominant, 0.2),
      },
      orphan_signal_policy: stringValue(alignment.orphan_signal_policy, ''),
      fragment_merge_policy: stringValue(alignment.fragment_merge_policy, ''),
    },
    hierarchical_processing: {
      enabled: booleanValue(hierarchical.enabled, false),
      local_window_sec: numberValue(hierarchical.local_window_sec, 10),
      window_overlap_sec: numberValue(hierarchical.window_overlap_sec, 1),
      local_outputs: stringArrayValue(hierarchical.local_outputs),
      global_aggregation_inputs: stringArrayValue(hierarchical.global_aggregation_inputs),
      cross_window_merge_policy: stringValue(hierarchical.cross_window_merge_policy, ''),
    },
    overlay_tracking_policy: {
      tracking_goal: stringValue(overlay.tracking_goal, ''),
      bbox_precision_required: enumValue(overlay.bbox_precision_required, ['none', 'rough', 'moderate'], 'rough'),
      motion_representation: enumValue(
        overlay.motion_representation,
        ['enum_classification', 'numeric_tracking', 'hybrid'],
        'enum_classification',
      ),
      noise_handling: stringValue(overlay.noise_handling, ''),
    },
  } as VideoUnderstandingResult['processing_strategy'];
}

function normalizeVideoDna(videoDna: JsonRecord): VideoUnderstandingResult['video_dna'] {
  return {
    core_hook_formula: stringValue(videoDna.core_hook_formula, ''),
    content_structure_summary: stringValue(videoDna.content_structure_summary, ''),
    conversion_logic: stringValue(videoDna.conversion_logic, ''),
    emotional_curve: stringValue(videoDna.emotional_curve, ''),
    color_palette_vibe: stringValue(videoDna.color_palette_vibe, ''),
    pacing_strategy: stringValue(videoDna.pacing_strategy, ''),
    replication_core: stringValue(videoDna.replication_core, ''),
    derived_from_window_summaries: booleanValue(videoDna.derived_from_window_summaries, false),
  } as VideoUnderstandingResult['video_dna'];
}

function normalizeRhythmStructure(
  rhythm: JsonRecord,
): VideoUnderstandingResult['rhythm_structure'] {
  return {
    overall_pacing: enumValue(rhythm.overall_pacing, ['very_fast', 'fast', 'medium', 'slow', 'mixed'], 'mixed'),
    avg_shot_duration_sec: numberValue(rhythm.avg_shot_duration_sec, 0),
    cut_density: numberValue(rhythm.cut_density, 0),
    speech_rate: numberValue(rhythm.speech_rate, 0),
    beat_sync_style: enumValue(
      rhythm.beat_sync_style,
      ['heavy_sync', 'partial_sync', 'dialogue_driven', 'no_clear_sync'],
      'no_clear_sync',
    ),
    high_energy_segments: arrayValue(rhythm.high_energy_segments).map((item) => {
      const record = isRecord(item) ? item : {};
      return {
        start_sec: numberValue(record.start_sec, 0),
        end_sec: numberValue(record.end_sec, 0),
        reason: stringValue(record.reason, ''),
        source_window_id: nullableStringValue(record.source_window_id),
      };
    }),
    window_level_rhythm_notes: arrayValue(rhythm.window_level_rhythm_notes).map((item, index) => {
      const record = isRecord(item) ? item : {};
      return {
        window_id: stringValue(record.window_id, `window-${index + 1}`),
        start_sec: numberValue(record.start_sec, 0),
        end_sec: numberValue(record.end_sec, 0),
        rhythm_summary: stringValue(record.rhythm_summary, ''),
      };
    }),
    rhythm_pattern_summary: stringValue(rhythm.rhythm_pattern_summary, ''),
  } as VideoUnderstandingResult['rhythm_structure'];
}

function normalizeReplicationBlock(raw: unknown): JsonRecord {
  if (typeof raw === 'string') {
    const text = raw.trim()
    return text
      ? {
          visual_generation_prompt: text,
          content_rewrite_instruction: text,
          overlay_rewrite_instruction: text,
        }
      : {}
  }
  if (!isRecord(raw)) return {}
  return raw
}

function normalizeSemanticAnchors(raw: unknown): VideoUnderstandingResult['semantic_anchors'] {
  return arrayValue(raw).map((item, index) => {
    const anchor = isRecord(item) ? item : {};
    const timeBoundary = isRecord(anchor.time_boundary) ? anchor.time_boundary : {};
    const logic = isRecord(anchor.logic_intent) ? anchor.logic_intent : {};
    const structure = isRecord(anchor.structure_role)
      ? anchor.structure_role
      : isRecord(anchor.structural_role)
        ? anchor.structural_role
        : {};
    const replication = normalizeReplicationBlock(
      anchor.replication_instructions ??
        anchor.replication_instruction ??
        anchor.replication_instruction_text,
    );
    const physical = isRecord(anchor.associated_physical_events)
      ? anchor.associated_physical_events
      : isRecord(anchor.associated_physical_event)
        ? anchor.associated_physical_event
        : {};

    return {
      anchor_id: integerValue(anchor.anchor_id, index + 1),
      source_window_id: nullableStringValue(anchor.source_window_id),
      anchor_type: enumValue(anchor.anchor_type, ANCHOR_TYPES, 'mixed'),
      start_sec: numberValue(anchor.start_sec ?? timeBoundary.start_sec ?? timeBoundary.start_time, 0),
      end_sec: numberValue(anchor.end_sec ?? timeBoundary.end_sec ?? timeBoundary.end_time, 0),
      boundary_source: enumValue(anchor.boundary_source, BOUNDARY_SOURCES, 'unknown'),
      dominant_track: enumValue(anchor.dominant_track, DOMINANT_TRACKS, 'unknown'),
      absorption_window_sec: numberValue(anchor.absorption_window_sec, 0.5),
      primary_signal: enumValue(anchor.primary_signal, SIGNAL_TYPES, 'vision'),
      absorbed_signals: normalizeSignalEvidence(anchor.absorbed_signals ?? anchor.adsorption_signal),
      supporting_signals: normalizeSupportingSignals(anchor.supporting_signals),
      asr_script: nullableStringValue(anchor.asr_script),
      ocr_texts: stringArrayValue(anchor.ocr_texts),
      visual_summary: stringValue(anchor.visual_summary ?? anchor.event, ''),
      logic_intent: {
        marketing_role: enumValue(logic.marketing_role, MARKETING_ROLES, 'entertainment'),
        emotion_vibe: enumValue(logic.emotion_vibe, EMOTION_VIBES, 'neutral'),
        viewer_psychology: stringValue(logic.viewer_psychology, stringValue(anchor.logic_intent, '')),
      },
      structure_role: {
        position_role: enumValue(structure.position_role, POSITION_ROLES, 'setup'),
        narrative_function: stringValue(structure.narrative_function, stringValue(anchor.structure_role, '')),
        replication_priority: enumValue(structure.replication_priority, QUALITY_LEVELS, 'medium'),
      },
      replication_instructions: {
        content_rewrite_instruction: stringValue(
          replication.content_rewrite_instruction ?? replication.content_rewrite,
          '',
        ),
        visual_generation_prompt: stringValue(
          replication.visual_generation_prompt ??
            replication.visual_prompt ??
            replication.visual_summary ??
            anchor.visual_summary,
          '',
        ),
        overlay_rewrite_instruction: stringValue(
          replication.overlay_rewrite_instruction ?? replication.overlay_rewrite,
          '',
        ),
        audio_style_instruction: stringValue(replication.audio_style_instruction, ''),
      },
      associated_physical_events: {
        shot_ids: integerArrayValue(physical.shot_ids),
        overlay_ids: stringArrayValue(physical.overlay_ids),
        sfx_ids: stringArrayValue(physical.sfx_ids),
        beat_ids: stringArrayValue(physical.beat_ids),
      },
      alignment_notes: stringValue(anchor.alignment_notes, ''),
      confidence: confidenceValue(anchor.confidence, 0.6),
    };
  });
}

function normalizeSignalEvidence(raw: unknown): VideoUnderstandingResult['semantic_anchors'][number]['absorbed_signals'] {
  return arrayValue(raw).map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      signal_type: enumValue(record.signal_type, SIGNAL_TYPES, 'vision'),
      evidence_id: stringValue(record.evidence_id, `evidence-${index + 1}`),
      time_offset_to_anchor_sec: numberValue(record.time_offset_to_anchor_sec, 0),
      absorption_reason: stringValue(record.absorption_reason, stringValue(item, '')),
      confidence: confidenceValue(record.confidence, 0.6),
    };
  });
}

function normalizeSupportingSignals(raw: unknown): VideoUnderstandingResult['semantic_anchors'][number]['supporting_signals'] {
  return arrayValue(raw).map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      signal_type: enumValue(record.signal_type, SIGNAL_TYPES, 'vision'),
      evidence_id: stringValue(record.evidence_id, `support-${index + 1}`),
      confidence: confidenceValue(record.confidence, 0.6),
      evidence_summary: stringValue(record.evidence_summary, stringValue(item, '')),
    };
  });
}

function normalizePhysicalTracks(tracks: JsonRecord): VideoUnderstandingResult['physical_tracks'] {
  return {
    video_main_track: arrayValue(tracks.video_main_track).filter(isRecord).map((shot, index) => ({
      shot_id: integerValue(shot.shot_id, index + 1),
      start_sec: numberValue(shot.start_sec, 0),
      end_sec: numberValue(shot.end_sec, 0),
      duration_sec: numberValue(shot.duration_sec, 0),
      shot_scale: enumValue(shot.shot_scale, ['ECU', 'CU', 'MS', 'WS', 'Unknown'], 'Unknown'),
      camera_movement: enumValue(shot.camera_movement, ['Static', 'PushIn', 'PullOut', 'Pan', 'Tilt', 'Handheld', 'Unknown'], 'Unknown'),
      original_subject: stringValue(shot.original_subject, ''),
      subject_action: stringValue(shot.subject_action, ''),
      scene_context: stringValue(shot.scene_context, ''),
      composition_style: stringValue(shot.composition_style, ''),
      visual_role: enumValue(shot.visual_role, VISUAL_ROLES, 'filler_visual'),
      replication_value: stringValue(shot.replication_value, ''),
      replaceability: enumValue(shot.replaceability, ['must_replace', 'can_replace', 'can_omit'], 'can_replace'),
      confidence: confidenceValue(shot.confidence, 0.6),
    })),
    visual_overlay_track: arrayValue(tracks.visual_overlay_track).filter(isRecord).map((overlay, index) => ({
      overlay_id: stringValue(overlay.overlay_id, `overlay-${index + 1}`),
      type: enumValue(overlay.type, OVERLAY_TYPES, 'Unknown'),
      text_content: stringValue(overlay.text_content, ''),
      start_sec: numberValue(overlay.start_sec, 0),
      end_sec: numberValue(overlay.end_sec, 0),
      screen_region: enumValue(overlay.screen_region, ['top', 'center', 'bottom', 'left', 'right', 'full_screen', 'unknown'], 'unknown'),
      approx_bbox: null,
      motion_trajectory: {
        motion_type: 'unknown',
        motion_description: '',
        emphasis_pattern: 'unknown',
        tracking_reliability: 'low',
        numeric_tracking_used: false,
      },
      text_role: enumValue(overlay.text_role, TEXT_ROLES, 'decoration'),
      emphasis_level: enumValue(overlay.emphasis_level, QUALITY_LEVELS, 'medium'),
      sync_relation: {
        sync_with_asr: false,
        sync_with_sfx: false,
        sync_with_beat: false,
        related_word_or_phrase: '',
        sync_offset_sec: null,
      },
      replication_instruction: stringValue(overlay.replication_instruction, ''),
      confidence: confidenceValue(overlay.confidence, 0.6),
    })),
    audio_vocal_track: arrayValue(tracks.audio_vocal_track).filter(isRecord).map((vocal) => ({
      word_or_phrase: stringValue(vocal.word_or_phrase, ''),
      start_sec: numberValue(vocal.start_sec, 0),
      end_sec: numberValue(vocal.end_sec, 0),
      confidence: confidenceValue(vocal.confidence, 0.6),
    })),
    audio_sfx_track: arrayValue(tracks.audio_sfx_track).filter(isRecord).map((sfx, index) => ({
      sfx_id: stringValue(sfx.sfx_id, `sfx-${index + 1}`),
      sfx_type: enumValue(sfx.sfx_type, SFX_TYPES, 'Unknown'),
      time_sec: numberValue(sfx.time_sec, 0),
      energy_peak: numberValue(sfx.energy_peak, 0),
      sync_target_type: enumValue(sfx.sync_target_type, SYNC_TARGET_TYPES, 'unknown'),
      sync_target_id: stringValue(sfx.sync_target_id, ''),
      time_relation_to_target: enumValue(sfx.time_relation_to_target, ['before', 'aligned', 'after', 'unknown'], 'unknown'),
      offset_to_target_sec: nullableNumberValue(sfx.offset_to_target_sec),
      rhythm_role: enumValue(sfx.rhythm_role, SFX_RHYTHM_ROLES, 'emphasis'),
      replication_instruction: stringValue(sfx.replication_instruction, ''),
      confidence: confidenceValue(sfx.confidence, 0.6),
    })),
    audio_beat_track: arrayValue(tracks.audio_beat_track).filter(isRecord).map((beat, index) => ({
      beat_id: stringValue(beat.beat_id, `beat-${index + 1}`),
      time_sec: numberValue(beat.time_sec, 0),
      beat_strength: numberValue(beat.beat_strength, 0),
      sync_with_cut: booleanValue(beat.sync_with_cut, false),
      sync_with_overlay: booleanValue(beat.sync_with_overlay, false),
      sync_offset_sec: nullableNumberValue(beat.sync_offset_sec),
      rhythm_role: enumValue(beat.rhythm_role, ['pacing_support', 'transition', 'highlight', 'no_clear_role'], 'no_clear_role'),
      confidence: confidenceValue(beat.confidence, 0.6),
    })),
  } as VideoUnderstandingResult['physical_tracks'];
}

function normalizeQualityAndReview(quality: JsonRecord): VideoUnderstandingResult['quality_and_review'] {
  return {
    overall_confidence: confidenceValue(quality.overall_confidence, 0.6),
    structure_replication_readiness: enumValue(quality.structure_replication_readiness, QUALITY_LEVELS, 'medium'),
    alignment_quality: {
      score: confidenceValue(isRecord(quality.alignment_quality) ? quality.alignment_quality.score : quality.alignment_quality, 0.6),
      dominant_track_reliability: enumValue(isRecord(quality.alignment_quality) ? quality.alignment_quality.dominant_track_reliability : undefined, QUALITY_LEVELS, 'medium'),
      fragmentation_risk: enumValue(isRecord(quality.alignment_quality) ? quality.alignment_quality.fragmentation_risk : undefined, QUALITY_LEVELS, 'medium'),
      misalignment_risk_notes: stringArrayValue(isRecord(quality.alignment_quality) ? quality.alignment_quality.misalignment_risk_notes : undefined),
    },
    context_processing_quality: {
      hierarchical_processing_used: booleanValue(isRecord(quality.context_processing_quality) ? quality.context_processing_quality.hierarchical_processing_used : undefined, false),
      window_count: integerValue(isRecord(quality.context_processing_quality) ? quality.context_processing_quality.window_count : undefined, 0),
      cross_window_conflict_count: integerValue(isRecord(quality.context_processing_quality) ? quality.context_processing_quality.cross_window_conflict_count : undefined, 0),
      context_overload_risk: enumValue(isRecord(quality.context_processing_quality) ? quality.context_processing_quality.context_overload_risk : undefined, QUALITY_LEVELS, 'medium'),
    },
    overlay_tracking_quality: {
      precision_mode: 'semantic_enum',
      bbox_noise_risk: 'medium',
      manual_review_needed: false,
    },
    low_confidence_segments: arrayValue(quality.low_confidence_segments ?? quality.low_confidence_interval).filter(isRecord).map((segment) => ({
      start_sec: numberValue(segment.start_sec, 0),
      end_sec: numberValue(segment.end_sec, 0),
      reason: stringValue(segment.reason, ''),
    })),
    manual_review_suggestions: stringArrayValue(quality.manual_review_suggestions ?? quality.manual_review_suggestion),
    recommended_replication_strategy: stringValue(quality.recommended_replication_strategy, ''),
  };
}

const VIDEO_STRUCTURE_TYPES = ['speech_driven', 'overlay_driven', 'visual_action_driven', 'beat_driven', 'mixed', 'unknown'] as const;
const DOMINANT_TRACKS = ['asr', 'ocr_overlay', 'vision_action', 'beat_sfx_cut', 'mixed', 'unknown'] as const;
const ANCHOR_TYPES = ['speech_driven', 'overlay_driven', 'visual_action_driven', 'beat_driven', 'transition_driven', 'mixed'] as const;
const BOUNDARY_SOURCES = ['dominant_track', 'absorbed_signal', 'merged_fragment', 'manual_review', 'unknown'] as const;
const SIGNAL_TYPES = ['asr', 'ocr', 'vision', 'sfx', 'beat', 'scene_cut'] as const;
const QUALITY_LEVELS = ['high', 'medium', 'low'] as const;
const MARKETING_ROLES = ['hook', 'pain_point', 'solution', 'product_demo', 'proof', 'comparison', 'offer', 'urgency', 'CTA', 'transition', 'entertainment', 'knowledge_point'] as const;
const EMOTION_VIBES = ['anxiety', 'surprise', 'trust', 'desire', 'urgency', 'relief', 'curiosity', 'authority', 'humor', 'neutral'] as const;
const POSITION_ROLES = ['opening', 'setup', 'escalation', 'proof', 'conversion', 'ending'] as const;
const VISUAL_ROLES = ['hook_visual', 'pain_visual', 'product_demo', 'proof_visual', 'transition_visual', 'reaction_visual', 'filler_visual'] as const;
const OVERLAY_TYPES = ['TitleCard', 'Sticker', 'Subtitle', 'PriceTag', 'EmphasisText', 'CTA', 'ComparisonLabel', 'Unknown'] as const;
const TEXT_ROLES = ['hook', 'pain_point', 'selling_point', 'proof', 'price', 'urgency', 'instruction', 'CTA', 'subtitle', 'decoration'] as const;
const SFX_TYPES = ['Boom', 'Whoosh', 'Ding', 'Drop', 'Pop', 'Click', 'Transition', 'Unknown'] as const;
const SYNC_TARGET_TYPES = ['overlay', 'shot_cut', 'product_reveal', 'price_reveal', 'emotion_turn', 'CTA', 'unknown'] as const;
const SFX_RHYTHM_ROLES = ['attention_grab', 'transition_mark', 'emphasis', 'reveal', 'comedic_punch', 'conversion_push'] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerValue(value: unknown, fallback: number): number {
  return Math.round(numberValue(value, fallback));
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function confidenceValue(value: unknown, fallback: number): number {
  const number = numberValue(value, fallback);
  return Math.min(1, Math.max(0, number));
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return typeof value === 'string' ? [value] : [];
}

function integerArrayValue(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number').map((item) => Math.round(item))
    : [];
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function enumArrayValue<T extends readonly string[]>(value: unknown, allowed: T): T[number][] {
  return Array.isArray(value)
    ? value.filter((item): item is T[number] => typeof item === 'string' && allowed.includes(item))
    : [];
}
