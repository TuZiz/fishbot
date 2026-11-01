# Passive research only: no sends, argument reads, UI operations or login changes.
param(
  [string]$Root = 'C:\wx\fishbot',
  [string]$Python = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python313\python.exe',
  [string]$Dependencies = 'C:\wx\tools\fishbot-frida-research-17.25.0',
  [ValidateRange(5,600)][int]$Seconds = 600,
  [switch]$Backtrace,
  [ValidatePattern('^[0-9]{5,20}@chatroom$')][string]$ImageTarget
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($ImageTarget) { throw 'Image metadata hooks quarantined after client crash; offline analysis only' }
if ($Seconds % 5) { throw 'Seconds must be a multiple of 5' }
$research = Join-Path $Root 'data\research\native'
$observer = Join-Path $research 'observe-cloud-input.py'
$specs = Join-Path $research 'image-download-candidates.json'
foreach ($file in @($Python,$observer,$specs)) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Research prerequisites missing' }
}
$clients = @()
foreach ($p in @(Get-Process Weixin -ErrorAction SilentlyContinue)) {
  foreach ($m in @($p.Modules | Where-Object ModuleName -eq 'Weixin.dll')) {
    $clients += @{ pid=$p.Id; module=$m.FileName }
  }
}
if ($clients.Count -ne 1) { throw 'Expected exactly one Weixin.dll process' }
$existing = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.Name -match '^python(w)?\.exe$' -and
  $_.CommandLine.Contains('observe-cloud-input.py')
})
if ($existing.Count) { throw 'Another passive observer exists; do not attach twice' }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$stdout = Join-Path $research "image-download-observe-$stamp.stdout.log"
$stderr = Join-Path $research "image-download-observe-$stamp.stderr.log"
$evidence = Join-Path $research "image-download-observe-$stamp.json"
$observerArgs = @(('"'+$observer+'"'),'--pid',$clients[0].pid,'--module',('"'+$clients[0].module+'"'),
  '--dependencies',('"'+$Dependencies+'"'),'--candidates',('"'+$specs+'"'),
  '--seconds',$Seconds,'--output',('"'+$evidence+'"'))
$observerArgs += @('--stop-file',('"'+$evidence+'.stop"'))
if ($Backtrace) { $observerArgs += '--backtrace' }
if ($ImageTarget) { $observerArgs += @('--image-target',$ImageTarget) }
$child = Start-Process -FilePath $Python -ArgumentList $observerArgs -WorkingDirectory $Root `
  -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
# Retain the native process handle while it exists; otherwise Windows PowerShell
# can report a null ExitCode after the process has already left the process table.
$observerHandle = $child.Handle
Start-Sleep -Seconds 2
$child.Refresh()
if ($child.HasExited) { throw 'Observer exited; inspect its sanitized stderr' }
$lines = @(Get-Content -LiteralPath $stdout)
$ready = @($lines | Where-Object { $_.StartsWith('{') } | ForEach-Object { ($_ | ConvertFrom-Json).payload } | Where-Object event -eq 'ready')
if ($ready.Count -ne 1 -or $ready[0].canSend -or $ready[0].readsArguments -ne [bool]$ImageTarget -or !$ready[0].selfHits) {
  throw 'Observer readiness not confirmed; no user action requested'
}
@{ ready=$true; observerPid=$child.Id; clientPid=$clients[0].pid; seconds=$Seconds;
  readsArguments=[bool]$ImageTarget; canSend=$false; evidence=$evidence; stdout=$stdout; stderr=$stderr } | ConvertTo-Json -Compress
# Windows OpenSSH may terminate children when the owning SSH job exits. Keep this
# session open for the bounded observation instead of claiming detached persistence.
$child.WaitForExit()
$child.Refresh()
if ($null -eq $child.ExitCode -or $child.ExitCode -ne 0) { throw 'Passive observer failed; inspect its sanitized evidence' }
$report = Get-Content -LiteralPath $evidence -Raw | ConvertFrom-Json
@{ finished=$true; deadlineCompleted=[bool]$report.completed; stoppedBySignal=[bool]$report.stoppedBySignal; evidence=$evidence } | ConvertTo-Json -Compress
