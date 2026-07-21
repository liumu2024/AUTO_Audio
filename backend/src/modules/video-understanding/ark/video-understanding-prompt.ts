/**
 * 样例理解 Prompt 构造：唯一输入视频是结构来源；参考素材只作为槽位候选。
 */
import type { UserMaterialDto } from '../../../../../shared/types/pipeline.js';
import type { AudioVisualUnderstandingHints } from '../../../../../shared/types/sample-understanding-skills.js';
import type { VideoInput } from '../video-input.js';

export interface VideoUnderstandingPromptContext {
  taskId: string
  globalPrompt?: string
  materials?: UserMaterialDto[]
  sampleHints?: AudioVisualUnderstandingHints
}

export function buildVideoUnderstandingPrompt(
  video: VideoInput,
  context: VideoUnderstandingPromptContext,
): string {
  const creativeIntent = context.globalPrompt?.trim() || '未提供，保持样例结构并生成可复用模板'
  const materials = (context.materials ?? []).map((m) => ({
    id: m.id,
    name: m.label,
    type: m.material_type.toLowerCase(),
    tags: m.ai_tags ?? [],
  }))
  const transitionExample = JSON.stringify({
    id: 'tr_001',
    from_segment_id: 'seg_001',
    to_segment_id: 'seg_002',
    at_sec: 2,
    presentation: 'fade',
    duration_sec: 0.3,
    timing: { type: 'linear', easing: 'ease-in-out' },
    direction: 'from-right',
    overlay: { type: 'none' },
    reason: '样例在该切点使用柔和溶转衔接相邻画面',
  })
  const sequenceExample = JSON.stringify({
    from_sec: 0,
    duration_sec: 2,
    layout: 'fill',
    premount_sec: 0.5,
  })
  const visualMotionExample = JSON.stringify({
    preset: 'push_in',
    intensity: 0.45,
    easing: 'ease-out',
    driver: 'useCurrentFrame',
  })

  return [
    '你是一个短视频导演与样例理解专家。',
    '分析 file_id 引用的视频，只返回可被 JSON.parse 解析的 JSON 对象；不要 Markdown、代码块、解释或省略字段。',

    [
      '重要边界：',
      '1. input_video 是「样例视频」，只用于拆解结构、节奏、镜头、营销意图，不得把它当成用户素材。',
      '2. reference_materials 是「参考素材 / 填槽候选」，只能用于 slots 的 default_material_id 或 tags 匹配。',
      '3. 左侧导演助理需要展示清晰的结构拆解与意图识别，所以每个分段必须有 purpose、intent_summary、slot。',
      '4. 转场必须输出可执行结构，不要只写“自然衔接”“高级转场”等一句风格描述。',
      '5. 片段时序和视觉运动必须输出可执行参数，不要只写自然语言运镜。',
    ].join('\n'),

    [
      '任务信息：',
      `- taskId: ${context.taskId}`,
      `- creative_intent_raw: ${creativeIntent}`,
      `- reference_materials: ${JSON.stringify(materials, null, 2)}`,
    ].join('\n'),

    [
      '样例视频文件信息：',
      `- originalName: ${video.originalName}`,
      `- mimeType: ${video.mimeType}`,
      `- sizeBytes: ${video.sizeBytes}`,
    ].join('\n'),

    [
      'AUDIO-AWARE SAMPLE HINTS:',
      'Use these timing hints as primary evidence for cut boundaries, layout changes, transition accents, and Remotion effect triggers.',
      `sample_hints=${JSON.stringify(context.sampleHints ?? null, null, 2)}`,
      'Rules:',
      '- beats/strong_beats indicate likely cut or pulse timing; energy_peaks indicate effect accents or layout reveal points.',
      '- visual_keyframes are the frames to reason about; explain segment boundaries around these keyframes instead of guessing from uniform frames only.',
      '- For landscape/editorial montage, do not force marketing Hook/Demo/CTA labels; use creative roles like cinematic_open, horizontal_collage, color_peak, triptych_collage, closing_frame.',
      '- Choose executable Remotion presets when visible: primitive_color_transform, primitive_mask_reveal, primitive_ring_overlay, primitive_orb_motion, primitive_orb_ring_overlay, primitive_directional_wave_reveal, primitive_texture_grade, primitive_light_sweep_overlay, primitive_beat_pulse, primitive_slice_reveal, primitive_collage_layout, primitive_ripple_displacement.',
    ].join('\n'),

    [
      '必须输出 SampleUnderstandingResult JSON，顶层字段只能包含：',
      'schema_version, task_id, source, intent, sample_analysis, template',
    ].join('\n'),

    [
      '字段要求：',
      '1. schema_version 固定为 "sample_understanding.v1"。',
      `2. task_id 固定为 "${context.taskId}"，必须输出在顶层。`,
      '3. source.sample_video.role 固定为 "structure_source"；source.reference_materials[].role 固定为 "slot_candidate"。',
      '4. intent 必须把 creative_intent_raw 解析为 raw_text, goal, product_or_topic, target_audience, style_keywords, must_keep, must_change, generation_directive。',
      '5. sample_analysis 必须描述 hook_formula、narrative_arc、conversion_logic、audience_trigger、reusable_pattern。',
      '6. template.schema_version 固定为 "1.0"，template 是可编辑导演模板。',
      '7. template.structure[] 是左侧结构拆解的展示来源，每段必须包含 id, name, start, end, sequence, purpose, intent_summary, emotion, subtitle, camera, motion, visual_motion, slot。',
      '8. template.slots[] 是显式填槽定义。需要用户素材替换的槽位 source 必须是 "reference_material"；不允许把样例视频 id 写入 default_material_id。',
      '9. 如果 reference_materials 中有合适素材，可以把 slots[].default_material_id 设为对应素材 id；如果没有合适素材，保留槽位但不要伪造素材。',
      '10. template.reference_materials[] 只能来自上面的 reference_materials，不要从样例视频生成素材。',
      '11. 时间单位统一为秒，start/end 必须覆盖主要片段且不重叠。',
      '12. template 必须包含 structure, slots, transitions, style_features, viral_points。',
      '13. template.style_features 必须是对象，只放整体风格摘要；建议包含 visual_style, pace, transition, bgm, subtitle_style，字段值必须是字符串。',
    ].join('\n'),

    [
      'Remotion 片段结构要求（对应 Sequence + useCurrentFrame）：',
      '1. 每个 structure item 必须包含 sequence={from_sec,duration_sec,layout,premount_sec}；from_sec=start，duration_sec=end-start。',
      '2. sequence.layout 只能是 "fill" 或 "none"；普通全屏画面用 "fill"，内联元素才用 "none"。',
      '3. premount_sec 默认 0.5，用于预加载相邻片段。',
      '4. 每个 structure item 必须包含 visual_motion={preset,intensity,easing,driver}。',
      '5. visual_motion.preset 只能是 "static", "zoom_in", "push_in", "pan", "shake"；intensity 范围 0 到 1；driver 固定为 "useCurrentFrame"。',
      `6. sequence 示例：${sequenceExample}`,
      `7. visual_motion 示例：${visualMotionExample}`,
    ].join('\n'),

    [
      '可执行转场结构要求（遵循 Remotion TransitionSeries 思路）：',
      '1. template.transitions[] 必须描述相邻画面之间的转场，数量应等于 max(template.structure.length - 1, 0)。',
      '2. 每个 transition 必须包含 id, from_segment_id, to_segment_id, at_sec, presentation, duration_sec, timing。',
      '3. from_segment_id 和 to_segment_id 必须引用相邻的 template.structure[].id；不要跨段连接。',
      '4. at_sec 必须等于前一段 end，也等于后一段 start；如果原片有重叠转场，也记录视觉切点秒数。',
      '5. presentation 只能是 "cut", "fade", "slide", "wipe", "flip", "clock_wipe"。',
      '6. 硬切使用 presentation="cut" 且 duration_sec=0；非硬切 duration_sec 必须大于 0，建议 0.2 到 0.6 秒。',
      '7. timing.type 只能是 "linear" 或 "spring"；linear 可给 easing，spring 可给 damping/stiffness。',
      '8. slide/wipe/clock_wipe 如有方向，direction 只能是 "from-left", "from-right", "from-top", "from-bottom"。',
      '9. overlay 可选；type 只能是 "none", "light_leak", "flash", "color_wash"。overlay 表示叠加效果，不改变时间线长度。',
      `10. transition 示例：${transitionExample}`,
      '11. 不要输出 CSS transition、Tailwind animate 类名或自然语言伪字段；必须输出上述可被程序映射的字段。',
    ].join('\n'),

    [
      '输出结构速查：',
      'source.sample_video={id,name,role:"structure_source"}; source.reference_materials=[{id,name,type,role:"slot_candidate",tags}]',
      'intent={raw_text,goal,product_or_topic,target_audience,style_keywords,must_keep,must_change,generation_directive}',
      'sample_analysis={hook_formula,narrative_arc,conversion_logic,audience_trigger,reusable_pattern}',
      'template={schema_version:"1.0",id,title,duration,style,sample_video,reference_materials,creative_intent,sample_understanding,structure,slots,transitions,style_features,viral_points,source_video_id,render_recipe?}',
      'template.render_recipe={style_family,global_effects,scene_effects,audio_driver}',
      'structure item={id,name,start,end,sequence,purpose,intent_summary,emotion,subtitle,camera,motion,visual_motion,slot}',
      'slot item={id,type,required,tags,description,source,accepted_material_types,default_material_id?}',
      'viral point item={time,type,reason}',
    ].join('\n'),

    [
      'STRICT JSON FIELD RULES:',
      `- Top-level task_id MUST be exactly "${context.taskId}".`,
      '- Every id field MUST be a string, never a number. Use ids like "seg_001", "slot_001", "tr_001".',
      '- template.style MUST be a non-empty string. Summarize the reusable visual/audio/editing style in one concise phrase.',
      '- Every template.structure[].slot MUST equal an existing template.slots[].id exactly. Do not put slot names/descriptions in template.structure[].slot.',
      '- Every template.slots[] item MUST include required as a boolean. Use true when unsure.',
      '- Every template.slots[] type MUST be exactly one of "video", "image", "audio", "text".',
      '- Every template.slots[].accepted_material_types[] item MUST also be exactly one of "video", "image", "audio", "text".',
      '- Every template.slots[] source MUST be exactly "sample_video" or "reference_material".',
      '- Use "reference_material" for all user-provided assets/materials. Do not output "user_material", "asset", "material", or "reference_materials".',
      '- Every template.structure[] item MUST include sequence and visual_motion objects.',
      '- visual_motion.driver MUST be "useCurrentFrame"; never output CSS transition, CSS animation, or Tailwind animate classes.',
      '- template.transitions MUST be an array of objects, never strings.',
      '- Every transition object MUST connect adjacent segment ids and use a supported presentation.',
      '- template.style_features MUST be an object record with string values, never an array.',
      '- template.viral_points MUST be an array of objects, never strings.',
      '- Every viral point object MUST be shaped as {"time": number, "type": string, "reason": string}.',
      '- template.render_recipe is optional but strongly recommended for style samples. scene_effects[] items MUST be {"segment_id": string, "preset": string, "params": object}.',
      '- Supported render_recipe preset values: primitive_color_transform, primitive_mask_reveal, primitive_ring_overlay, primitive_orb_motion, primitive_orb_ring_overlay, primitive_directional_wave_reveal, primitive_texture_grade, primitive_vignette_overlay, primitive_grain_overlay, primitive_bloom_overlay, primitive_light_sweep_overlay, primitive_beat_pulse, primitive_beat_flash_overlay, primitive_slice_reveal, primitive_collage_layout, primitive_ripple_displacement, primitive_ripple_ring_overlay.',
      '- If audio_features show beat-driven editing, include audio_driver={beat_times, strong_beats, energy_peaks} and scene_effects rows with plugin_id beat_cut_driver + preset primitive_beat_pulse.',
    ].join('\n'),
  ].join('\n\n').trim();
}
