# Read-only UI Automation availability probe. Does not invoke controls, modify settings or read chat text.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FishBotWindowProbe {
 public delegate bool Callback(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback,IntPtr param);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd,StringBuilder value,int count);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
}
"@
$clients=@(Get-Process Weixin -ErrorAction SilentlyContinue)
$ids=@($clients | ForEach-Object {$_.Id})
$handles=[Collections.Generic.List[IntPtr]]::new()
$callback=[FishBotWindowProbe+Callback]{param($handle,$param)
 [uint32]$ownerId=0
 [void][FishBotWindowProbe]::GetWindowThreadProcessId($handle,[ref]$ownerId)
 if($ids -contains $ownerId){$handles.Add($handle)}
 return $true
}
[void][FishBotWindowProbe]::EnumWindows($callback,[IntPtr]::Zero)
$results=@()
foreach($handle in $handles) {
 $className=[Text.StringBuilder]::new(256)
 [void][FishBotWindowProbe]::GetClassName($handle,$className,256)
 if($className.ToString() -notmatch '^(mmui::|Qt)'){continue}
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 $children=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
 $types=@{};$count=0
 foreach($child in $children){
  $type=$child.Current.ControlType.ProgrammaticName
  if(!$types.ContainsKey($type)){$types[$type]=0};$types[$type]++
  $count+=$child.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition).Count
 }
 $results+=@{visible=[FishBotWindowProbe]::IsWindowVisible($handle);rootClass=$className.ToString();directChildren=$children.Count;secondLevelCount=$count;childControlTypes=$types}
}
@{checkedAt=[DateTimeOffset]::UtcNow.ToString('o');clientVersions=@($clients|ForEach-Object {$_.MainModule.FileVersionInfo.FileVersion}|Select-Object -Unique);readOnly=$true;chatTextRead=$false;results=$results}|ConvertTo-Json -Depth 6
