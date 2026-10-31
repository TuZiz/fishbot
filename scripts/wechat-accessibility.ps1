param([ValidateSet('Check','Enable','Restore')][string]$Action='Check')
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FishBotAccessibility {
 [DllImport("user32.dll",SetLastError=true)] public static extern bool SystemParametersInfo(uint action,uint value,ref int data,uint flags);
}
"@
$registry='HKCU:\SOFTWARE\Microsoft\Narrator\NoRoam'
$backup=Join-Path $PSScriptRoot '../data/wechat/accessibility-backup.json'
[int]$flag=0
if(![FishBotAccessibility]::SystemParametersInfo(0x0046,0,[ref]$flag,0)){throw 'Cannot read Windows screen-reader flag'}
$property=Get-ItemProperty -LiteralPath $registry -Name RunningState -ErrorAction SilentlyContinue
$current=@{schemaVersion=1;active=$true;screenReader=($flag -ne 0);registryExisted=($null -ne $property);runningState=if($property){[int]$property.RunningState}else{0}}
if($Action -eq 'Check'){@{screenReader=$current.screenReader;runningState=$current.runningState;registryExisted=$current.registryExisted}|ConvertTo-Json;exit}
if($Action -eq 'Enable'){
 if(!(Test-Path -LiteralPath $backup) -or !((Get-Content -LiteralPath $backup -Raw|ConvertFrom-Json).active)){$current|ConvertTo-Json|Set-Content -LiteralPath $backup -Encoding utf8}
 New-Item -Path $registry -Force|Out-Null
 New-ItemProperty -LiteralPath $registry -Name RunningState -Value 1 -PropertyType DWord -Force|Out-Null
 [int]$ignored=0
 if(![FishBotAccessibility]::SystemParametersInfo(0x0047,1,[ref]$ignored,2)){throw 'Windows screen-reader flag update failed; use Restore'}
 'Accessibility flags enabled. WeChat has not been restarted.'
}else{
 if(!(Test-Path -LiteralPath $backup)){throw 'No backup exists'}
 $original=Get-Content -LiteralPath $backup -Raw|ConvertFrom-Json
 if(!$original.active){'Already restored';exit}
 if($original.registryExisted){New-ItemProperty -LiteralPath $registry -Name RunningState -Value ([int]$original.runningState) -PropertyType DWord -Force|Out-Null}else{Remove-ItemProperty -LiteralPath $registry -Name RunningState -ErrorAction SilentlyContinue}
 [int]$ignored=0
 if(![FishBotAccessibility]::SystemParametersInfo(0x0047,[int][bool]$original.screenReader,[ref]$ignored,2)){throw 'Cannot restore screen-reader flag'}
 $original.active=$false;$original|ConvertTo-Json|Set-Content -LiteralPath $backup -Encoding utf8
 'Accessibility flags restored.'
}
