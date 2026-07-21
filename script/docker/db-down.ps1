# Stop DB containers (keep volumes)
# Usage: .\script\docker\db-down.ps1

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

Write-Host '==> Stopping dpl304 DB containers...' -ForegroundColor Cyan
$exitCode = Invoke-Docker compose down
if ($exitCode -ne 0) { exit $exitCode }
Write-Host '[OK] Stopped (volumes preserved)' -ForegroundColor Green
