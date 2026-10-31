# Read process/module metadata only. Never changes login or client state.
$ErrorActionPreference = 'Stop'
$clients = @()
$denied = 0
foreach ($candidate in @(Get-Process -Name Weixin -ErrorAction SilentlyContinue)) {
  try {
    $modules = @($candidate.Modules | Where-Object { $_.ModuleName -eq 'Weixin.dll' })
    foreach ($module in $modules) {
      $clients += @{
        pid = $candidate.Id
        module = $module.FileName
        version = $module.FileVersionInfo.FileVersion
        baseAddress = ('0x{0:x}' -f $module.BaseAddress.ToInt64())
        moduleSize = $module.ModuleMemorySize
      }
    }
  } catch { $denied++ }
}
if ($clients.Count -gt 1) { throw 'Multiple native WeChat clients; refuse ambiguous attachment' }
if ($clients.Count -eq 0) {
  @{status = 'unavailable'; inspectionFailures = $denied} | ConvertTo-Json -Compress
} else {
  @{status = 'found'; client = $clients[0]} | ConvertTo-Json -Depth 3 -Compress
}
