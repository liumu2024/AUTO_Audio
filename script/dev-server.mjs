import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const npmCommand = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm'
const npmPrefix = isWindows ? ['/d', '/s', '/c', 'npm.cmd'] : []

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code ?? 'unknown'}).`))
    })
  })
}

function start(label, args) {
  const child = spawn(npmCommand, [...npmPrefix, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
  })
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  return { label, child, exited }
}

function stop({ child }) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    child.kill('SIGTERM')
  }
}

let services = []
let stopping = false

function stopServices() {
  if (stopping) return
  stopping = true
  for (const service of services) stop(service)
}

try {
  console.log('[server:dev] 启动 PostgreSQL 与 Redis...')
  await run('docker', ['compose', 'up', '-d', '--wait'])

  console.log('[server:dev] 应用数据库迁移...')
  await run(npmCommand, [...npmPrefix, '--prefix', 'backend', 'run', 'db:deploy'])

  console.log('[server:dev] 启动后端与前端；按 Ctrl+C 停止应用进程。')
  services = [
    start('后端', ['--prefix', 'backend', 'run', 'dev']),
    start('前端', ['--prefix', 'fonted', 'run', 'dev']),
  ]
  process.once('SIGINT', stopServices)
  process.once('SIGTERM', stopServices)

  const { service, result } = await Promise.race(services.map(async (service) => ({
    service,
    result: await service.exited,
  })))
  if (!stopping) {
    throw new Error(`${service.label}进程意外退出（${result.signal ?? result.code ?? 'unknown'}）。`)
  }
  await Promise.allSettled(services.map((service) => service.exited))
} catch (error) {
  stopServices()
  console.error(`[server:dev] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
