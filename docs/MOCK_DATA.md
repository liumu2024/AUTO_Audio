# Sample Data

Development sample files live in `shared/mocks/`. They are used for local
hydration tests, smoke tests, and understanding-flow debugging. They are not a
final-video generation fallback.

## Files

| File | Purpose |
| --- | --- |
| `01-video-ingest.json` | Sample video metadata and URL |
| `02-analysis-result.v1.2.json` | Example `MigrationProtocolV12` structure |
| `03-user-materials.json` | Example user material library |
| `05-copilot-command.sample.json` | Example task progress and command payload |

Timeline, outline, and render plan are derived from structure and materials by
shared library code. There is no standalone generated-video sample result.

## Main Consumers

| Consumer | Use |
| --- | --- |
| backend smoke scripts | Build render plans and test Remotion paths |
| frontend test fixtures | Validate stores, timeline derivation, and editor sync |
| local analyzer fallback | Development-only structure fixture |

## Editing Guidelines

- Keep fixture JSON schema-compatible with the current shared types.
- Treat the sample video as structure evidence only.
- Use user materials for renderable assets.
- Do not add real API keys, signed private URLs, or generated private media.

## Quick Check

```powershell
cd backend
npm run build:shared
npm run test:smoke:render-recipe
```
