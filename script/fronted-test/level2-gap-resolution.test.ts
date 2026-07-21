/**
 * 第二关：缺口补全状态机联调（Store 级）
 * 运行: npm run test:level2
 */
import { mockProjectData } from '../../fonted/src/data/mockMigrationProject.ts'
import { findActiveAnchor } from '../../fonted/src/types/migration-protocol.ts'
import { assert, assertEqual, pass, section } from './shared/assertions.ts'

section('Level 2 — 播放进度触发 Gap 判定')

const anchors = mockProjectData.semantic_anchors

const at3 = findActiveAnchor(anchors, 3)
assertEqual(at3?.anchor_id, 'anchor_1', 't=3s 应在 Hook')
assertEqual(at3?.match.status, 'matched', 'Hook 为 matched')

const at51 = findActiveAnchor(anchors, 5.1)
assertEqual(at51?.anchor_id, 'anchor_2', 't=5.1s 应进入 anchor_2')
assertEqual(at51?.match.status, 'gap', 'anchor_2 为 gap')

section('Level 2 — 补全后状态迁移（模拟 applyStrategy）')

const resolved = anchors.map((a) =>
  a.anchor_id === 'anchor_2'
    ? {
        ...a,
        match: { status: 'matched' as const, asset_name: 'AIGC生成片段.mp4' },
      }
    : a,
)

const afterGap = findActiveAnchor(resolved, 8)
assertEqual(afterGap?.match.status, 'matched', '补全后 gap 应变为 matched')
assertEqual(afterGap?.match.asset_name, 'AIGC生成片段.mp4', 'AIGC 素材名')

section('Level 2 — UI 手动验证清单（浏览器）')
console.log(`
  [ ] 播放 0-5s：中间 MappingIndicator 第一张卡片为绿色 (border-emerald-500)
  [ ] 播放到 5.1s：双视频自动暂停，右侧弹出 GapResolverPanel
  [ ] 选择「AIGC 画面生成」→ 确认应用
  [ ] 时间线出现「AIGC生成片段.mp4」；中间卡片变绿；视频继续播放
`)

pass('Level 2 Gap 状态机逻辑校验通过')
