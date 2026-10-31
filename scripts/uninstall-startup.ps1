param([string]$TaskName='FishBot')
$ErrorActionPreference='Stop'
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
