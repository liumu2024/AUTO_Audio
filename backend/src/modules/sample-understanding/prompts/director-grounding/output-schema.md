## 输出 JSON 结构

字段名保持英文；自然语言内容使用简体中文。

```json
{
  "schema_version": "director_grounding.v1",
  "task_id": "{{task_id}}",
  "content_domain": "landscape_montage|product_ad|music_visual|motion_graphics|talking_head|unknown",
  "source": {
    "sample_video": {"id": "sample_video", "name": "string", "role": "structure_source"},
    "reference_materials": [{"id": "string", "name": "string", "type": "video|image|audio", "role": "slot_candidate", "tags": ["string"]}]
  },
  "intent": {
    "raw_text": "string",
    "goal": "string",
    "product_or_topic": "string",
    "target_audience": "string",
    "style_keywords": ["string"],
    "must_keep": ["string"],
    "must_change": ["string"],
    "generation_directive": "string"
  },
  "audio_visual_evidence": {
    "duration_sec": 0,
    "fps": 0,
    "key_observations": ["string"],
    "beat_summary": "string"
  },
  "visual_phenomena": [{
    "id": "phen_001",
    "start_sec": 0,
    "end_sec": 0,
    "type": "string",
    "mechanism": "motion_driver|mask_reveal|distortion|color_transform|texture_grade|layout|overlay|audio_driver",
    "description": "string",
    "evidence": "string",
    "confidence": 0
  }],
  "shot_events": [{
    "id": "shot_001",
    "start_sec": 0,
    "end_sec": 0,
    "visual_summary": "string",
    "camera_motion": "string",
    "visual_change_intensity": 0,
    "evidence_refs": ["phen_001"],
    "confidence": 0,
    "linked_temporal_event_id": "seg_001"
  }],
  "transition_observations": [{
    "id": "obs_tr_001",
    "at_sec": 0,
    "from_shot_id": "shot_001",
    "to_shot_id": "shot_002",
    "type": "cut|fade|dissolve|flash|slide|wipe|zoom|whip|mask|motion_match|unknown",
    "duration_sec": 0,
    "visual_mechanism": "string",
    "sync": "string",
    "evidence_refs": ["phen_001"],
    "confidence": 0
  }],
  "temporal_events": [{
    "id": "seg_001",
    "start_sec": 0,
    "end_sec": 0,
    "creative_role": "opening|build|climax|afterglow|hook|demo|cta|...",
    "description": "string",
    "visual_prompt": "string",
    "overlay_text": "string",
    "emotion_vibe": "string",
    "camera": "string",
    "motion": "string",
    "evidence_refs": ["phen_001"],
    "confidence": 0,
    "visual_motion": {
      "preset": "static|zoom_in|push_in|pan|shake",
      "intensity": 0,
      "easing": "string",
      "driver": "useCurrentFrame"
    },
    "slot_tags": ["string"],
    "accepted_material_types": ["video", "image", "audio", "text"]
  }],
  "style_summary": {
    "style_family": "string",
    "editing_pattern": "string",
    "audio_sync_logic": "string",
    "visual_style": "string",
    "pace": "string"
  },
  "remotion_capability_plan": {
    "matched_plugins": [{"preset": "supported_preset", "plugin_id": "string", "reason": "string", "segment_ids": ["seg_001"]}],
    "capability_layers": [{
      "segment_id": "seg_001",
      "layers": [{
        "plugin_id": "beat_cut_driver",
        "layer": "audio_driver",
        "preset": "primitive_beat_pulse",
        "reason": "string",
        "confidence": 0
      }]
    }],
    "missing_capabilities": [{
      "id": "string",
      "description": "string",
      "suggested_contract": {"target_layer": "effect|overlay", "segment_ids": ["seg_001"]}
    }],
    "plugin_authoring_skill": {
      "enabled": false,
      "purpose": "string",
      "candidate_plugin_ids": ["string"]
    }
  },
  "effect_intents": [
    {
      "intent_id": "grayscale_color_unlock",
      "segment_id": "seg_001",
      "evidence_refs": ["phen_001"],
      "style": "beat_synced_reveal",
      "motion_subject": "none",
      "unlock_mode": "radial_reveal",
      "sync": {
        "driver": "audio_beat",
        "peak_policy": "unlock_on_strong_beat"
      }
    },
    {
      "intent_id": "orb_driven_color_wave",
      "segment_id": "seg_002",
      "evidence_refs": ["phen_002"],
      "motion_subject": "orb",
      "motion_pattern": "continuous_probe",
      "reveal_mode": "directional_wave",
      "sync": { "driver": "audio_beat" }
    }
  ],
  "render_recipe": {
    "style_family": "string",
    "global_effects": ["primitive_texture_grade", "primitive_vignette_overlay", "primitive_grain_overlay"],
    "scene_effects": [],
    "audio_driver": {
      "beat_times": [0],
      "strong_beats": [0],
      "energy_peaks": [{"time": 0, "intensity": 0, "duration_sec": 0}],
      "waveform": [{"time": 0, "value": 0}]
    }
  },
  "critique": {
    "likely_failure_points": ["string"],
    "repair_notes": ["string"],
    "final_decision": "string"
  }
}
```

## 校验规则

- `task_id` 必须恰好为 `{{task_id}}`。
- `content_domain` 必须反映样例真实类型；风光/旅拍用 `landscape_montage`，不要用营销结构。
- 非广告样例的 `creative_role` 使用 `opening` / `build` / `climax` / `afterglow` 等叙事角色，**禁止** Hook/Demo/CTA。
- `temporal_events` 按时间顺序覆盖样例主时长。
- `temporal_events[].id` 使用 `seg_001` 这类字符串。
- `shot_events` records visible shot boundaries and should usually be finer-grained than `temporal_events`.
- `shot_events[].id` uses `shot_001` style ids and may link to `linked_temporal_event_id`.
- `transition_observations` records observed edits between adjacent shots. It is evidence, not an executable transition plan.
- `transition_observations[].from_shot_id` and `to_shot_id` should reference `shot_events[].id` when visible.
- `end_sec` 必须大于 `start_sec`。
- **`effect_intents[].segment_id` 必须引用 `temporal_events[].id`。**
- **`effect_intents` 禁止出现 `preset` / `plugin_id` / `effect_id`；只写语义意图字段。**
- `render_recipe.scene_effects` 必须为 `[]`；插件组合由系统 Capability Graph + Composition Recipe 编译。
- `missing_capabilities[].suggested_contract.segment_ids` 必须引用 `temporal_events[].id`。
- `render_recipe.global_effects` 只能写 primitive preset，例如 `primitive_texture_grade`、`primitive_vignette_overlay`。
- 若 `sample_hints.audio_features` 存在，应把 `beat_times`、`strong_beats`、`energy_peaks`、`waveform` 写入 `render_recipe.audio_driver`（除非有明确理由不这样做）。
