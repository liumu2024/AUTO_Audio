import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..', '..')

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function commandForBin(name) {
  if (process.platform === 'win32') return `${name}.cmd`
  return name
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    child.on('error', (error) => {
      if (options.allowFailure) {
        resolve(1)
        return
      }
      reject(error)
    })
    child.on('exit', (code) => {
      if (code === 0 || options.allowFailure) {
        resolve(code ?? 0)
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

async function startElectron() {
  const electronBin = path.join(
    projectRoot,
    'node_modules',
    '.bin',
    commandForBin('electron'),
  )
  if (!existsSync(electronBin)) {
    throw new Error('Electron is not installed. Run npm install at the project root first.')
  }

  await run(npmCommand(), ['exec', '--', 'electron', '.'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DPL304_DESKTOP_PROJECT_ROOT: projectRoot,
    },
  })
}

try {
  console.info('[desktop:dev] Using desktop local mode; PostgreSQL, Redis, and Prisma setup are not required.')
  await startElectron()
} catch (error) {
  console.error('[desktop:dev] Failed to start desktop app.')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
