param([string]$TaskName='FishBot',[string]$NodePath=(Get-Command node -ErrorAction Stop).Source)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(!(Test-Path -LiteralPath (Join-Path $root '.env'))){throw 'Create .env with INGEST_TOKEN and DEEPSEEK_API_KEY first.'}
$runner=Join-Path $PSScriptRoot 'supervisor.mjs'
$action=New-ScheduledTaskAction -Execute $NodePath -Argument ('"'+$runner+'"') -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'FishBot local supervisor; starts when this user logs in'
