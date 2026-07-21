// 注册 Remotion 根组件，使 Studio 和 CLI 渲染能发现 Dpl304Video 合成。
import { registerRoot } from 'remotion'

import { RemotionRoot } from './Root'

registerRoot(RemotionRoot)
