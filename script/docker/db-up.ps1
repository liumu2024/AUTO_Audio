# Start PostgreSQL + Redis (Docker Compose)
# Usage: .\script\docker\db-up.ps1

[CmdletBinding()]
param()

# Docker writes progress to stderr; avoid PowerShell treating it as terminating errors
function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Args)

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    $output = & docker @Args 2>&1
    $exitCode = $LASTEXITCODE

    foreach ($line in $output) {
        if ($line -is [System.Management.Automation.ErrorRecord]) {
            Write-Host $line.ToString()
        } else {
            Write-Host $line
        }
    }

    $ErrorActionPreference = $prevEap
    return $exitCode
}

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $ProjectRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error 'docker not found. Install Docker Desktop and ensure it is running.'
    exit 1
}

Write-Host ''
Write-Host '==> Starting dpl304 DB containers (postgres + redis)...' -ForegroundColor Cyan

$exitCode = Invoke-Docker compose up -d --wait
if ($exitCode -ne 0) {
    Write-Host '    --wait failed or unsupported, retry without --wait...' -ForegroundColor Yellow
    $exitCode = Invoke-Docker compose up -d
    if ($exitCode -ne 0) {
        Write-Error "docker compose up failed (exit $exitCode). Run: docker compose logs"
        exit $exitCode
    }

    $max = 30
    for ($i = 1; $i -le $max; $i++) {
        $pg = (Invoke-Docker inspect -f '{{.State.Health.Status}}' dpl304-postgres) | Select-Object -Last 1
        $rd = (Invoke-Docker inspect -f '{{.State.Health.Status}}' dpl304-redis) | Select-Object -Last 1
        if ($pg -eq 'healthy' -and $rd -eq 'healthy') { break }
        Write-Host "    waiting for health... ($i/$max) postgres=$pg redis=$rd"
        Start-Sleep -Seconds 2
        if ($i -eq $max) {
            Write-Error 'Health check timeout. Run: docker compose ps ; docker compose logs'
            exit 1
        }
    }
}

Write-Host ''
Write-Host '[OK] Database is ready' -ForegroundColor Green
Write-Host ''
Write-Host 'Connection strings (backend/.env):' -ForegroundColor White
Write-Host '  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/dpl304?schema=public'
Write-Host '  REDIS_URL=redis://127.0.0.1:6379'
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor White
Write-Host '  cd backend'
Write-Host '  copy .env.example .env'
Write-Host '  npm run db:deploy'
Write-Host '  npm run db:seed'
Write-Host '  npm run dev'
Write-Host '  # new terminal: npm run worker:analyzer'
Write-Host ''

exit 0
