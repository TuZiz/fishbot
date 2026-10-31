param([int]$Port=8765)
$ErrorActionPreference='Stop'
$result=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
$result | ConvertTo-Json -Depth 5
if(!$result.ok){exit 1}
