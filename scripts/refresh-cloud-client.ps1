# Refresh process metadata only. Does not launch WeChat, change login or retry sends.
param(
  [string]$NativeRoot = 'C:\wx\tools\fishbot-frida-research-17.25.0',
  [string]$BackupRoot = 'C:\wx\fishbot\data\deploy'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$expected = 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556'
$clients = @()
foreach ($process in @(Get-Process Weixin -ErrorAction SilentlyContinue)) {
  foreach ($module in @($process.Modules | Where-Object ModuleName -eq 'Weixin.dll')) {
    $clients += @{ pid=$process.Id; module=$module.FileName; version=$module.FileVersionInfo.FileVersion }
  }
}
if ($clients.Count -ne 1) { throw 'Expected exactly one Weixin.dll process; no profile changed' }
$client = $clients[0]
if ($client.version -ne '4.1.15.56' -or (Get-FileHash -LiteralPath $client.module -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
  throw 'Unsupported live WeChat fingerprint; no profile changed'
}
$updates = @()
foreach ($name in @('cloud-profile.json','cloud-all-profile.json')) {
  $path = Join-Path $NativeRoot $name
  $text = [IO.File]::ReadAllText($path)
  $config = $text | ConvertFrom-Json
  if ($config.sha256.ToLowerInvariant() -ne $expected -or !$config.agent.targets.Count) { throw 'Profile validation failed; no profile changed' }
  $config.pid = $client.pid
  $config.module = $client.module
  $updates += @{ name=$name; path=$path; original=$text; updated=($config | ConvertTo-Json -Depth 40 -Compress) }
}
$backup = Join-Path $BackupRoot ('client-process-before-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
[void](New-Item -ItemType Directory -Path $backup)
foreach ($update in $updates) {
  [IO.File]::WriteAllText((Join-Path $backup $update.name),$update.original,[Text.UTF8Encoding]::new($false))
  $temporary = $update.path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllText($temporary,$update.updated,[Text.UTF8Encoding]::new($false))
  $check = [IO.File]::ReadAllText($temporary) | ConvertFrom-Json
  if ($check.pid -ne $client.pid -or $check.sha256 -ne $expected) { throw 'Profile temporary-file verification failed; original retained' }
  Move-Item -LiteralPath $temporary -Destination $update.path -Force
}
@{ updatedProfiles=$updates.Count; clientPid=$client.pid; version=$client.version; fingerprintMatched=$true; loginChanged=$false; sends=0 } | ConvertTo-Json -Compress
