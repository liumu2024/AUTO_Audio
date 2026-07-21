# Desktop Development

The desktop entry keeps the existing backend, frontend, and Remotion renderer
intact, but starts the app from one command.

```powershell
npm install
npm run desktop:dev
```

If PowerShell blocks `npm.ps1`, use the equivalent `.cmd` entry:

```powershell
npm.cmd install
npm.cmd --prefix backend run build:shared
npm.cmd run desktop:dev
```

`desktop:dev` will:

1. Use desktop local mode by default, so PostgreSQL, Redis, and Prisma setup are
   not required.
2. Open Electron.
3. Let Electron start the backend API and Vite frontend with matching local
   ports.
4. Let the backend run analyzer and generator jobs in-process.

The local desktop database is a JSON file under Electron's user data directory.
Keep real Ark keys in `backend/.env`; the desktop launcher reuses the same
backend configuration as local web development.

If you edit files under `shared/`, regenerate shared runtime artifacts before
starting desktop mode:

```powershell
npm.cmd --prefix backend run build:shared
```

See `../docs/DESKTOP_BOUNDARIES.md` for the responsibility split between the
desktop shell, frontend, backend API, local store, job runner, and Remotion.
