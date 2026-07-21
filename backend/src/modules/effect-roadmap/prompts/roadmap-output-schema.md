# EffectRoadmap 输出 JSON 结构

```json
{
  "schema_version": "effect_roadmap.v1",
  "task_id": "{{task_id}}",
  "segments": [
    {
      "segment_id": "seg_001",
      "start_sec": 0,
      "end_sec": 3.2,
      "motif": {
        "id": "motif_portal_001",
        "family": "color_portal_unlock",
        "evidence_refs": ["phen_001"],
        "confidence": 0.88,
        "must_match": {
          "geometry.mask_shape": "circle",
          "style.color_transform": "grayscale_to_color"
        },
        "can_adapt": ["duration", "color_grade", "asset_crop"],
        "loss_risk": [],
        "atom_ids": ["atom_gray", "atom_mask", "atom_ring"],
        "description": "从黑白底通过圆形 portal 解锁彩色"
      },
      "atoms": [
        {
          "id": "atom_gray",
          "layerKind": "color_transform",
          "capability_query": "画面保持黑白底，等待 portal 解锁后再呈现彩色",
          "required_params": ["transform", "base_filter"],
          "evidence_refs": ["phen_001"]
        },
        {
          "id": "atom_mask",
          "layerKind": "mask_reveal",
          "capability_query": "圆形 mask 从中心扩张，露出彩色内容",
          "required_params": ["mask.radius_pct_keyframes", "mask.position_keyframes"]
        },
        {
          "id": "atom_ring",
          "layerKind": "motion_driver",
          "capability_query": "portal 圆环跟随 mask 中心路径",
          "required_params": ["ring.center_path", "ring.radius_pct_keyframes"]
        }
      ],
      "bindings": [
        {
          "source": "mask.center_path",
          "target": "ring.center_path",
          "source_atom_id": "atom_mask",
          "target_atom_id": "atom_ring"
        }
      ]
    }
  ],
  "loss_ledger": []
}
```

## 校验规则

- `schema_version` 必须恰好为 `effect_roadmap.v1`。
- `task_id` 必须恰好为 `{{task_id}}`。
- `segments[].segment_id` 必须引用 director grounding 的 `temporal_events[].id`。
- **禁止**输出 `preset`、`plugin_id`、`effect_id` 字段。
- 每个 `motif` 必须包含：`evidence_refs`（非空）、`confidence`（0~1）、`must_match`（对象）、`can_adapt`（数组）。
- 若样例几何不可被 registry 支持，写 `motif.loss_risk[]`，并在 `loss_ledger[]` 追加对应记录；**禁止**静默改 shape。
- `kinetic_orb_reveal` 至少包含 color_transform、mask_reveal(wave)、motion_driver(orb)、motion_driver(ring) 四类 atom 语义。
- `layout_collage` 若样例为三角形拼接，`must_match.geometry.cell_shape` 必须为 `triangle`。
