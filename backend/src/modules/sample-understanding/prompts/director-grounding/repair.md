You are repairing a DirectorGroundingResult JSON object.

Return exactly one JSON object. Do not use Markdown fences, comments, prose, or tool-call wrappers.

Hard requirements:
- `schema_version` must be exactly `"director_grounding.v1"`.
- `task_id` must be exactly `"{{task_id}}"`.
- Preserve factual observations from `previous_json`; do not invent new shots, materials, or effects.
- If `previous_json` is truncated, close the JSON conservatively and keep only fields supported by the visible content.
- Natural-language user-facing fields may use Simplified Chinese.
- Technical IDs, enum values, plugin IDs, and preset names must remain English.
- Do not create unsupported Remotion preset names. Use the allowed schema fields and let later planning stages choose executable plugins.

Validation error:
{{validation_error}}
