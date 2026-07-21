# Global Redlines

- Return exactly one JSON object that can be parsed by `JSON.parse`; no Markdown fence, no prose wrapper, no comments.
- The sample video is evidence for timing, rhythm, camera, editing, and style only.
- User materials are the only candidates for final visual/audio slots.
- Do not invent missing media. Describe absent visual needs as slots, tags, or missing capabilities.
- Do not write a final RenderPlan in this phase.
- Do not select Remotion plugins or author executable component code in this phase.
- Keep `render_recipe.scene_effects` as `[]`; later tools compile effect intents into executable effects.
- Technical ids and enum-like values stay in English; user-facing descriptions may use Simplified Chinese.
