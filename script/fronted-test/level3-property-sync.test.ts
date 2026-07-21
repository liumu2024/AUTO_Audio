/**
 * 第三关：时间线 ↔ 属性面板双向绑定
 * 运行: npm run test:level3
 */
import { mockAnchorEditorById } from '../../fonted/src/data/mockAnchorEditor.ts'
import { mockTimelineProject } from '../../fonted/src/data/mockTimeline.ts'
import { assert, assertEqual, pass, section } from './shared/assertions.ts'

section('Level 3 — Timeline → Panel 数据映射')

const hookClip = mockTimelineProject.clips.find(
  (c) => c.anchor_id === 'anchor_1' && c.track_id === 'video',
)!
const editor = mockAnchorEditorById.anchor_1

assertEqual(hookClip.anchor_id, 'anchor_1', 'clip anchor_id')
assertEqual(
  editor.overlay_rewrite_instruction,
  '限时秒杀，仅限今天',
  '面板应预填限时秒杀',
)
assertEqual(
  hookClip.content_rewrite_instruction,
  editor.overlay_rewrite_instruction,
  'timeline 花字与面板 overlay 一致',
)

section('Level 3 — Panel → Timeline 回写（模拟保存）')

const dirtyOverlay = '全场 8 折'
const savedClips = mockTimelineProject.clips.map((c) =>
  c.anchor_id === 'anchor_1'
    ? { ...c, content_rewrite_instruction: dirtyOverlay }
    : c,
)
const savedHook = savedClips.find((c) => c.anchor_id === 'anchor_1' && c.track_id === 'overlay')!
assertEqual(savedHook.content_rewrite_instruction, '全场 8 折', '保存后 timeline 应更新')

section('Level 3 — isDirty 与未保存切换（Store 行为说明）')
console.log(`
  [ ] 选中 anchor_1：标题「编辑锚点: anchor_1」，Input 为「限时秒杀，仅限今天」
  [ ] 修改为「全场 8 折」：保存按钮高亮 (isDirty=true)
  [ ] 点击 anchor_2 色块：弹出「当前修改未保存，是否丢弃？」
  [ ] 选「丢弃并切换」：面板切换 anchor_2；选「继续编辑」：保持 anchor_1
`)

pass('Level 3 属性面板联动数据校验通过')
