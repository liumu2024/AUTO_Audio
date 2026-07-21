// 配置 Remotion CLI 渲染：支持指定浏览器可执行文件，并允许重复渲染时覆盖输出。
import { Config } from '@remotion/cli/config'

const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE

if (browserExecutable) {
  Config.setBrowserExecutable(browserExecutable)
}

Config.setOverwriteOutput(true)
