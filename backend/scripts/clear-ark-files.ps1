param(
  [string]$EnvPath = (Resolve-Path (Join-Path $PSScriptRoot '..\.env')).Path
)

function Read-DotEnvValue {
  param([string]$Key)
  if (-not (Test-Path -LiteralPath $EnvPath)) {
    throw "Env file not found: $EnvPath"
  }
  $pattern = "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$"
  $line = Get-Content -LiteralPath $EnvPath -Encoding UTF8 |
    Where-Object { $_ -match $pattern -and $_ -notmatch '^\s*#' } |
    Select-Object -Last 1
  if (-not $line) { return $null }
  $value = ($line -replace $pattern, '$1').Trim().Trim('"').Trim("'")
  if ($value -match '\s+#') {
    $value = ($value -split '\s+#', 2)[0].Trim()
  }
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  return $value
}

$apiKey = Read-DotEnvValue 'VIDEO_UNDERSTANDING_API_KEY'
if (-not $apiKey) {
  $apiKey = Read-DotEnvValue 'ARK_API_KEY'
}
if (-not $apiKey) {
  throw "VIDEO_UNDERSTANDING_API_KEY or ARK_API_KEY not found or empty in: $EnvPath"
}

$filesUrl = Read-DotEnvValue 'VIDEO_UNDERSTANDING_FILES_URL'
if (-not $filesUrl) {
  $filesUrl = 'https://ark.cn-beijing.volces.com/api/v3/files'
}
$filesUrl = $filesUrl.TrimEnd('/')

$headers = @{ Authorization = "Bearer $apiKey" }
$resp = Invoke-RestMethod -Method Get -Uri $filesUrl -Headers $headers
$ids = @($resp.data | ForEach-Object { $_.id })

foreach ($id in $ids) {
  Invoke-RestMethod -Method Delete -Uri "$filesUrl/$id" -Headers $headers
  Write-Host "deleted $id"
}

Write-Host "deleted total: $($ids.Count)"
