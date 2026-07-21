const { app, BrowserWindow } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

const DEFAULT_BACKEND_PORT = 3001
const DEFAULT_FRONTEND_PORT = 5173
const STARTUP_TIMEOUT_MS = 90_000

const projectRoot =
  process.env.DPL304_DESKTOP_PROJECT_ROOT ||
  path.resolve(__dirname, '..')

const managedChildren = []

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function log(name, text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    console.info(`[${name}] ${line}`)
  }
}

function spawnManaged(name, args, options) {
  const child = spawn(npmCommand(), args, {
    cwd: options.cwd,
    env: options.env,
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  managedChildren.push({ name, child })

  child.stdout.on('data', (chunk) => log(name, chunk))
  child.stderr.on('data', (chunk) => log(name, chunk))
  child.on('exit', (code, signal) => {
    if (app.isQuitting) return
    console.warn(`[${name}] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
  })

  return child
}

function waitForHttp(url, label, timeoutMs = STARTUP_TIMEOUT_MS) {
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) {
          resolve()
          return
        }
        retry()
      })
      req.on('error', retry)
      req.setTimeout(2500, () => {
        req.destroy()
        retry()
      })
    }

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`${label} did not become ready at ${url}`))
        return
      }
      setTimeout(tick, 750)
    }

    tick()
  })
}

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

async function findAvailablePort(preferredPort, host = '127.0.0.1') {
  for (let port = preferredPort; port < preferredPort + 50; port += 1) {
    if (await isPortFree(port, host)) return port
  }
  throw new Error(`No available port near ${preferredPort}`)
}

function killProcessTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    return
  }
  child.kill('SIGTERM')
}

function stopManagedServices() {
  for (const item of managedChildren.splice(0).reverse()) {
    killProcessTree(item.child)
  }
}

async function startManagedServices() {
  const backendPort = await findAvailablePort(
    Number(process.env.DPL304_BACKEND_PORT || DEFAULT_BACKEND_PORT),
  )
  const frontendPort = await findAvailablePort(
    Number(process.env.DPL304_FRONTEND_PORT || DEFAULT_FRONTEND_PORT),
  )
  const backendBase = `http://127.0.0.1:${backendPort}`
  const wsBase = `ws://127.0.0.1:${backendPort}`
  const frontendUrl = `http://127.0.0.1:${frontendPort}`
  const localDataDir = path.join(app.getPath('userData'), 'backend')

  const backendEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(backendPort),
    PUBLIC_BASE_URL: backendBase,
    DPL304_LOCAL_MODE: 'true',
    DPL304_LOCAL_DATA_DIR: localDataDir,
  }
  const frontendEnv = {
    ...process.env,
    VITE_USE_BACKEND: 'true',
    VITE_API_BASE: backendBase,
    VITE_WS_BASE: wsBase,
    VITE_WS_PATH: process.env.VITE_WS_PATH || '/ws/tasks',
    VITE_USER_ID: process.env.VITE_USER_ID || '1',
  }

  spawnManaged('backend', ['run', 'dev'], {
    cwd: path.join(projectRoot, 'backend'),
    env: backendEnv,
  })
  console.info('[desktop] local mode: backend will run analyzer/generator jobs in-process')
  spawnManaged(
    'frontend',
    [
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      String(frontendPort),
      '--strictPort',
    ],
    {
      cwd: path.join(projectRoot, 'fonted'),
      env: frontendEnv,
    },
  )

  await Promise.all([
    waitForHttp(`${backendBase}/health`, 'Backend'),
    waitForHttp(frontendUrl, 'Frontend'),
  ])

  return frontendUrl
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0f1115',
    title: 'AI Video Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`
        <html>
          <body style="margin:0;background:#0f1115;color:#f8fafc;font-family:system-ui;display:grid;place-items:center;height:100vh">
            <div>
              <div style="font-size:20px;font-weight:700">Starting AI Video Studio...</div>
              <div style="margin-top:10px;color:#94a3b8">Preparing local services.</div>
            </div>
          </body>
        </html>
      `),
  )

  return win
}

app.whenReady().then(async () => {
  const win = createWindow()
  try {
    const url =
      process.env.DPL304_DESKTOP_MANAGE_SERVICES === 'false'
        ? process.env.DPL304_DESKTOP_URL || `http://127.0.0.1:${DEFAULT_FRONTEND_PORT}`
        : await startManagedServices()
    await win.loadURL(url)
    const smokeMs = Number(process.env.DPL304_DESKTOP_SMOKE_MS || 0)
    if (Number.isFinite(smokeMs) && smokeMs > 0) {
      setTimeout(() => app.quit(), smokeMs)
    }
  } catch (error) {
    console.error('[desktop] startup failed', error)
    const message = error instanceof Error ? error.message : String(error)
    await win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`
          <html>
            <body style="margin:0;background:#170f12;color:#ffe4e6;font-family:system-ui;display:grid;place-items:center;height:100vh;padding:40px">
              <div style="max-width:760px">
                <div style="font-size:22px;font-weight:800">Desktop startup failed</div>
                <pre style="white-space:pre-wrap;margin-top:16px;color:#fecdd3">${message}</pre>
                <div style="margin-top:16px;color:#fda4af">Check the terminal logs for the first failing service.</div>
              </div>
            </body>
          </html>
        `),
    )
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopManagedServices()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
