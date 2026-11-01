param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$NodePath = ''
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$NodePath = if ($NodePath) { $NodePath } elseif (Test-Path -LiteralPath (Join-Path $Root 'tools\node\node.exe')) { Join-Path $Root 'tools\node\node.exe' } else { Join-Path (Split-Path $Root -Parent) 'tools\node\node.exe' }
$envPath = Join-Path $Root '.env'
$supervisor = Join-Path $Root 'scripts\supervisor.mjs'

if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw "Node.js not found: $NodePath"
}
if (!(Test-Path -LiteralPath $envPath -PathType Leaf)) {
  throw "Missing $envPath. Create it from .env.example and set INGEST_TOKEN."
}
if (!(Test-Path -LiteralPath $supervisor -PathType Leaf)) {
  throw "Missing supervisor: $supervisor"
}

$tokenLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^INGEST_TOKEN=(.+)$' } | Select-Object -First 1
if (!$tokenLine -or $tokenLine -notmatch '^INGEST_TOKEN=(.{24,})$') {
  throw 'INGEST_TOKEN must be at least 24 characters.'
}

Set-Location -LiteralPath $Root
& $NodePath $supervisor
exit $LASTEXITCODE
