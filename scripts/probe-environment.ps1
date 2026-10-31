param()
$ErrorActionPreference='Stop'
$processes=@(Get-Process Weixin,WeChat -ErrorAction SilentlyContinue)
$clients=@($processes | Where-Object Path | Select-Object -ExpandProperty Path -Unique | ForEach-Object {
  $info=(Get-Item -LiteralPath $_).VersionInfo
  @{path=$_;version=$info.FileVersion;target41=($info.FileVersion -like '4.1.*')}
})
$report=@{checkedAt=[DateTimeOffset]::UtcNow.ToString('o');clients=$clients;operation='process and file version only';realTransportTested=$false;capabilities=@{listen='pending';privateSendReceive='pending';groupSendReceive='pending';groupId='pending';memberIdentity='pending';mention='pending';quote='pending';messageIdTimestamp='pending';disconnectRecovery='pending';restartReconnect='pending'}}
New-Item -ItemType Directory -Force "$PSScriptRoot/../data" | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content "$PSScriptRoot/../data/environment-probe.json" -Encoding utf8
$report | ConvertTo-Json -Depth 8
