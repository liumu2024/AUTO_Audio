# Stop and remove volumes (wipe data)
# Usage: .\script\docker\db-reset.ps1

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

$confirm = Read-Host 'Delete all local Postgres/Redis data? Type yes to confirm'
if ($confirm -ne 'yes') {
    Write-Host 'Cancelled'
    exit 0
}

Write-Host '==> Removing containers and volumes...' -ForegroundColor Yellow
$exitCode = Invoke-Docker compose down -v
if ($exitCode -ne 0) { exit $exitCode }
Write-Host '[OK] Reset complete. Run db-up.ps1 and npm run db:deploy again.' -ForegroundColor Green
