import os from 'node:os'
import path from 'node:path'

const CLI_TMP_SUBDIR = 'dpl304'

/** 与 analyzer_cli.py 约定的跨平台结果文件路径（Windows / Linux 通用） */
export function getCliResultPath(taskId: string): string {
  return path.join(os.tmpdir(), CLI_TMP_SUBDIR, `${taskId}_result.json`)
}
