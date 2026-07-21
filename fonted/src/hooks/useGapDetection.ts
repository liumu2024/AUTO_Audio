import { useEffect } from 'react'

import { useGapResolverStore } from '@/stores/gapResolverStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import {
  findActiveAnchor,
  type SemanticAnchor,
} from '@/types/migration-protocol'

/**
 * 监听播放进度：进入 gap 锚点且未提示过时暂停并弹出补全面板。
 * @see script/fronted-test/level2-gap-resolution.test.ts
 */
export function useGapDetection(anchors: SemanticAnchor[]) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const openDialog = useGapResolverStore((s) => s.openDialog)
  const hasPromptedGap = useGapResolverStore((s) => s.hasPromptedGap)
  const markPrompted = useGapResolverStore((s) => s.markPrompted)

  useEffect(() => {
    if (!isPlaying) return

    const currentAnchor = findActiveAnchor(anchors, currentTime)
    if (
      currentAnchor?.match.status === 'gap' &&
      !hasPromptedGap(currentAnchor.anchor_id)
    ) {
      markPrompted(currentAnchor.anchor_id)
      openDialog(currentAnchor)
    }
  }, [
    anchors,
    currentTime,
    isPlaying,
    openDialog,
    hasPromptedGap,
    markPrompted,
  ])
}
