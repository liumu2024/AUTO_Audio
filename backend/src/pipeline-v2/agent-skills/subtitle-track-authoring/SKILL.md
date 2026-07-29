# Subtitle Track Authoring

Use this skill for a subtitle-only revision of an existing V2 draft.

- Audience-facing captions are separate from scene notes, filenames, layout constraints and internal instructions.
- Distinguish exact copy supplied by the user from a request to create original copy from themes or keywords.
- Represent multiple successive lines as separate timed caption overlays on a declared caption track.
- Express position, width, maximum lines, overlap and animation through track/overlay fields, never as visible text.
- Keep unrelated scenes, visual strategy, transitions and audio facts unchanged.
- Use only `timeline.patch` with `scope: "subtitle"` and report success only after the backend returns a saved revision.
