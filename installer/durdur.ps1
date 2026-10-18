<#
.SYNOPSIS
  Kurulum ve kaldırma sırasında çalışan sunucuyu durdurur. -Remove ile görevleri ve güvenlik duvarı kuralını da siler.
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [switch]$Remove
)
$tasks = 'DUNYATEK WeddingERP Sunucu', 'DUNYATEK WeddingERP Yedek', 'DUNYATEK WeddingERP Saglik'
foreach ($t in $tasks) {
  Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if ($Remove) { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue }
}
$appDir = Join-Path $Root 'app'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*dist\index.mjs*' -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($appDir, 'OrdinalIgnoreCase')) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($Remove) {
  Get-NetFirewallRule -DisplayName 'DUNYATEK WeddingERP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
Start-Sleep -Seconds 2
exit 0
