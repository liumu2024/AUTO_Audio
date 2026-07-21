# fonted 前端 Mock 联调测试

四关测试对应赛题 P0 功能：**Truth Source → Gap 补全 → 属性双向绑定 → AI 任务流**。

## 快速运行

```bash
cd script/fronted-test
npm install
npm test          # 运行全部 4 关
npm run test:level1
npm run test:level2
npm run test:level3
npm run test:level4
```

> 自动化脚本校验 **数据结构与状态机逻辑**；带 `[ ]` 的条目需在浏览器中手动验证 UI。

## 第一关：Truth Source (`mockProjectData`)

- 文件：`fonted/src/data/mockMigrationProject.ts`
- 导出：`mockProjectData`（别名 `mockMigrationProject`）
- 混合状态：`anchor_1` matched + `anchor_2` gap（`asset_name: null`）
- 对齐：`mockTimeline.ts` 15s 时间线

## 第二关：Gap Resolution Flow

- 钩子：`useGapDetection` — 播放到 gap 且未提示 → `pause` + `gapResolverStore.openDialog`
- 应用：`gapResolverStore.applyStrategy` → `migrationProjectStore.resolveGapAnchor` + `timelineStore.addAigcClipForAnchor` + 恢复播放
- UI：Matched 绿边 / Gap 红边（`MappingIndicator`）

## 第三关：Property Editor Sync

- 选中时间线片段 → `propertyEditorStore.requestLoad`
- 脏数据 → `UnsavedChangesDialog`「丢弃并切换 / 继续编辑」
- 保存 → 回写 `migrationProjectStore` + `timelineStore`

## 第四关：AI Task WebSocket Mock

- `useTaskWebSocket`：由 `taskStore.activeTaskId` 驱动，每 500ms 进度 +5%
- 阶段：解析指令 → 匹配锚点 → AIGC 补全 → 渲染合成 → 完成
- UI：`ProgressOverlay` 全屏进度与日志

## 启动前端

```bash
cd fonted
npm run dev
```
