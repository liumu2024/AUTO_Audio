// 注册 V2 时间线根组件，供 Studio 和 CLI 发现 V2TimelineVideo 合成。
import { registerRoot } from 'remotion'

import { RemotionRoot } from './Root'

registerRoot(RemotionRoot)
