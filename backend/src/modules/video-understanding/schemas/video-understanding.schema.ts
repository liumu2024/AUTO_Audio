/**
 * 视频理解结果运行时 Schema：对应根目录的“视频理解.json”，用于校验模型返回是否符合协议。
 */
import { z } from 'zod';

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const ConfidenceSchema = z.number().min(0).max(1);
const NullableStringSchema = z.string().nullable();
const NullableNumberSchema = z.number().nullable();

const VideoStructureTypeSchema = z.enum([
  'speech_driven',
  'overlay_driven',
  'visual_action_driven',
  'beat_driven',
  'mixed',
  'unknown',
]);

const DominantTrackSchema = z.enum([
  'asr',
  'ocr_overlay',
  'vision_action',
  'beat_sfx_cut',
  'mixed',
  'unknown',
]);

const SignalTypeSchema = z.enum(['asr', 'ocr', 'vision', 'sfx', 'beat', 'scene_cut']);
const AnchorTypeSchema = z.enum([
  'speech_driven',
  'overlay_driven',
  'visual_action_driven',
  'beat_driven',
  'transition_driven',
  'mixed',
]);

const ReplicationPrioritySchema = z.enum(['high', 'medium', 'low']);
const QualityLevelSchema = z.enum(['high', 'medium', 'low']);

const MetadataSchema = strictObject({
  video_id: z.string(),
  duration_sec: z.number(),
  fps: z.number(),
  resolution: strictObject({
    width: z.number().int(),
    height: z.number().int(),
  }),
  source_platform: z.string(),
  content_category: z.string(),
  audio_stems: strictObject({
    vocal_separated: z.boolean(),
    bgm_sfx_separated: z.boolean(),
  }),
});

const ProcessingStrategySchema = strictObject({
  video_structure_type: VideoStructureTypeSchema,
  dominant_track_strategy: strictObject({
    dominant_track: DominantTrackSchema,
    dominant_reason: z.string(),
    fallback_tracks: z.array(DominantTrackSchema),
    default_absorption_window_sec: z.number(),
    local_dominant_track_allowed: z.boolean(),
  }),
  alignment_policy: strictObject({
    use_tolerance_absorption: z.boolean(),
    absorption_windows_sec: strictObject({
      asr_dominant: z.number(),
      ocr_overlay_dominant: z.number(),
      vision_action_dominant: z.number(),
      beat_sfx_cut_dominant: z.number(),
    }),
    orphan_signal_policy: z.string(),
    fragment_merge_policy: z.string(),
  }),
  hierarchical_processing: strictObject({
    enabled: z.boolean(),
    local_window_sec: z.number(),
    window_overlap_sec: z.number(),
    local_outputs: z.array(z.string()),
    global_aggregation_inputs: z.array(z.string()),
    cross_window_merge_policy: z.string(),
  }),
  overlay_tracking_policy: strictObject({
    tracking_goal: z.string(),
    bbox_precision_required: z.enum(['none', 'rough', 'moderate']),
    motion_representation: z.enum(['enum_classification', 'numeric_tracking', 'hybrid']),
    noise_handling: z.string(),
  }),
});

const VideoDnaSchema = strictObject({
  core_hook_formula: z.string(),
  content_structure_summary: z.string(),
  conversion_logic: z.string(),
  emotional_curve: z.string(),
  color_palette_vibe: z.string(),
  pacing_strategy: z.string(),
  replication_core: z.string(),
  derived_from_window_summaries: z.boolean(),
});

const RhythmStructureSchema = strictObject({
  overall_pacing: z.enum(['very_fast', 'fast', 'medium', 'slow', 'mixed']),
  avg_shot_duration_sec: z.number(),
  cut_density: z.number(),
  speech_rate: z.number(),
  beat_sync_style: z.enum(['heavy_sync', 'partial_sync', 'dialogue_driven', 'no_clear_sync']),
  high_energy_segments: z.array(
    strictObject({
      start_sec: z.number(),
      end_sec: z.number(),
      reason: z.string(),
      source_window_id: NullableStringSchema,
    }),
  ),
  window_level_rhythm_notes: z.array(
    strictObject({
      window_id: z.string(),
      start_sec: z.number(),
      end_sec: z.number(),
      rhythm_summary: z.string(),
    }),
  ),
  rhythm_pattern_summary: z.string(),
});

const SemanticAnchorSchema = strictObject({
  anchor_id: z.number().int(),
  source_window_id: NullableStringSchema,
  anchor_type: AnchorTypeSchema,
  start_sec: z.number(),
  end_sec: z.number(),
  boundary_source: z.enum([
    'dominant_track',
    'absorbed_signal',
    'merged_fragment',
    'manual_review',
    'unknown',
  ]),
  dominant_track: DominantTrackSchema,
  absorption_window_sec: z.number(),
  primary_signal: SignalTypeSchema,
  absorbed_signals: z.array(
    strictObject({
      signal_type: SignalTypeSchema,
      evidence_id: z.string(),
      time_offset_to_anchor_sec: z.number(),
      absorption_reason: z.string(),
      confidence: ConfidenceSchema,
    }),
  ),
  supporting_signals: z.array(
    strictObject({
      signal_type: SignalTypeSchema,
      evidence_id: z.string(),
      confidence: ConfidenceSchema,
      evidence_summary: z.string(),
    }),
  ),
  asr_script: NullableStringSchema,
  ocr_texts: z.array(z.string()),
  visual_summary: z.string(),
  logic_intent: strictObject({
    marketing_role: z.enum([
      'hook',
      'pain_point',
      'solution',
      'product_demo',
      'proof',
      'comparison',
      'offer',
      'urgency',
      'CTA',
      'transition',
      'entertainment',
      'knowledge_point',
    ]),
    emotion_vibe: z.enum([
      'anxiety',
      'surprise',
      'trust',
      'desire',
      'urgency',
      'relief',
      'curiosity',
      'authority',
      'humor',
      'neutral',
    ]),
    viewer_psychology: z.string(),
  }),
  structure_role: strictObject({
    position_role: z.enum(['opening', 'setup', 'escalation', 'proof', 'conversion', 'ending']),
    narrative_function: z.string(),
    replication_priority: ReplicationPrioritySchema,
  }),
  replication_instructions: strictObject({
    content_rewrite_instruction: z.string(),
    visual_generation_prompt: z.string(),
    overlay_rewrite_instruction: z.string(),
    audio_style_instruction: z.string(),
  }),
  associated_physical_events: strictObject({
    shot_ids: z.array(z.number().int()),
    overlay_ids: z.array(z.string()),
    sfx_ids: z.array(z.string()),
    beat_ids: z.array(z.string()),
  }),
  alignment_notes: z.string(),
  confidence: ConfidenceSchema,
});

const PhysicalTracksSchema = strictObject({
  video_main_track: z.array(
    strictObject({
      shot_id: z.number().int(),
      start_sec: z.number(),
      end_sec: z.number(),
      duration_sec: z.number(),
      shot_scale: z.enum(['ECU', 'CU', 'MS', 'WS', 'Unknown']),
      camera_movement: z.enum(['Static', 'PushIn', 'PullOut', 'Pan', 'Tilt', 'Handheld', 'Unknown']),
      original_subject: z.string(),
      subject_action: z.string(),
      scene_context: z.string(),
      composition_style: z.string(),
      visual_role: z.enum([
        'hook_visual',
        'pain_visual',
        'product_demo',
        'proof_visual',
        'transition_visual',
        'reaction_visual',
        'filler_visual',
      ]),
      replication_value: z.string(),
      replaceability: z.enum(['must_replace', 'can_replace', 'can_omit']),
      confidence: ConfidenceSchema,
    }),
  ),
  visual_overlay_track: z.array(
    strictObject({
      overlay_id: z.string(),
      type: z.enum([
        'TitleCard',
        'Sticker',
        'Subtitle',
        'PriceTag',
        'EmphasisText',
        'CTA',
        'ComparisonLabel',
        'Unknown',
      ]),
      text_content: z.string(),
      start_sec: z.number(),
      end_sec: z.number(),
      screen_region: z.enum(['top', 'center', 'bottom', 'left', 'right', 'full_screen', 'unknown']),
      approx_bbox: z.array(z.number()).length(4).nullable(),
      motion_trajectory: strictObject({
        motion_type: z.enum([
          'static',
          'pop',
          'bounce',
          'slide_in',
          'zoom_in',
          'shake',
          'fade',
          'unknown',
        ]),
        motion_description: z.string(),
        emphasis_pattern: z.enum([
          'none',
          'appear_emphasis',
          'repeated_emphasis',
          'reveal_emphasis',
          'transition_emphasis',
          'unknown',
        ]),
        tracking_reliability: QualityLevelSchema,
        numeric_tracking_used: z.boolean(),
      }),
      text_role: z.enum([
        'hook',
        'pain_point',
        'selling_point',
        'proof',
        'price',
        'urgency',
        'instruction',
        'CTA',
        'subtitle',
        'decoration',
      ]),
      emphasis_level: ReplicationPrioritySchema,
      sync_relation: strictObject({
        sync_with_asr: z.boolean(),
        sync_with_sfx: z.boolean(),
        sync_with_beat: z.boolean(),
        related_word_or_phrase: z.string(),
        sync_offset_sec: NullableNumberSchema,
      }),
      replication_instruction: z.string(),
      confidence: ConfidenceSchema,
    }),
  ),
  audio_vocal_track: z.array(
    strictObject({
      word_or_phrase: z.string(),
      start_sec: z.number(),
      end_sec: z.number(),
      confidence: ConfidenceSchema,
    }),
  ),
  audio_sfx_track: z.array(
    strictObject({
      sfx_id: z.string(),
      sfx_type: z.enum(['Boom', 'Whoosh', 'Ding', 'Drop', 'Pop', 'Click', 'Transition', 'Unknown']),
      time_sec: z.number(),
      energy_peak: z.number(),
      sync_target_type: z.enum([
        'overlay',
        'shot_cut',
        'product_reveal',
        'price_reveal',
        'emotion_turn',
        'CTA',
        'unknown',
      ]),
      sync_target_id: z.string(),
      time_relation_to_target: z.enum(['before', 'aligned', 'after', 'unknown']),
      offset_to_target_sec: NullableNumberSchema,
      rhythm_role: z.enum([
        'attention_grab',
        'transition_mark',
        'emphasis',
        'reveal',
        'comedic_punch',
        'conversion_push',
      ]),
      replication_instruction: z.string(),
      confidence: ConfidenceSchema,
    }),
  ),
  audio_beat_track: z.array(
    strictObject({
      beat_id: z.string(),
      time_sec: z.number(),
      beat_strength: z.number(),
      sync_with_cut: z.boolean(),
      sync_with_overlay: z.boolean(),
      sync_offset_sec: NullableNumberSchema,
      rhythm_role: z.enum(['pacing_support', 'transition', 'highlight', 'no_clear_role']),
      confidence: ConfidenceSchema,
    }),
  ),
});

const QualityAndReviewSchema = strictObject({
  overall_confidence: ConfidenceSchema,
  structure_replication_readiness: QualityLevelSchema,
  alignment_quality: strictObject({
    score: ConfidenceSchema,
    dominant_track_reliability: QualityLevelSchema,
    fragmentation_risk: QualityLevelSchema,
    misalignment_risk_notes: z.array(z.string()),
  }),
  context_processing_quality: strictObject({
    hierarchical_processing_used: z.boolean(),
    window_count: z.number().int(),
    cross_window_conflict_count: z.number().int(),
    context_overload_risk: QualityLevelSchema,
  }),
  overlay_tracking_quality: strictObject({
    precision_mode: z.enum(['semantic_enum', 'rough_bbox', 'numeric_tracking', 'hybrid']),
    bbox_noise_risk: QualityLevelSchema,
    manual_review_needed: z.boolean(),
  }),
  low_confidence_segments: z.array(
    strictObject({
      start_sec: z.number(),
      end_sec: z.number(),
      reason: z.string(),
    }),
  ),
  manual_review_suggestions: z.array(z.string()),
  recommended_replication_strategy: z.string(),
});

export const VideoUnderstandingResultSchema = strictObject({
  metadata: MetadataSchema,
  processing_strategy: ProcessingStrategySchema,
  video_dna: VideoDnaSchema,
  rhythm_structure: RhythmStructureSchema,
  semantic_anchors: z.array(SemanticAnchorSchema),
  physical_tracks: PhysicalTracksSchema,
  quality_and_review: QualityAndReviewSchema,
});

export type VideoUnderstandingResult = z.infer<typeof VideoUnderstandingResultSchema>;
