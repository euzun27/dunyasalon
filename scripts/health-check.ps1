<#
.SYNOPSIS
  Yerel sunucunun sağlık kontrolü: API, senkronizasyon kuyruğu ve disk.
  -Restart verilirse API yanıt vermediğinde sunucu görevi yeniden başlatılır.
#>
param(
  [string]$Root = 'C:\DUNYATEK\WeddingERP',
  [int]$Port = 8787,
  [switch]$Restart
)
$log = Join-Path $Root 'logs\health.log'
function Write-Log($msg) { "$(Get-Date -Format s) $msg" | Add-Content -Encoding UTF8 $log; Write-Output $msg }

try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
  $s = $h.sync
  $syncText = if ($s.enabled) { "bulut=$(if ($s.online) {'bağlı'} else {'YOK'}) bekleyen=$($s.pending) hatalı=$($s.failed)" } else { 'bulut=kapalı' }
  Write-Log "OK $syncText"
  if ($s.enabled -and $s.pending -gt 1000) { Write-Log 'UYARI: senkronizasyon kuyruğu büyüyor (internet bağlantısını kontrol edin)' }
} catch {
  Write-Log "HATA: API yanıt vermiyor ($($_.Exception.Message))"
  if ($Restart) {
    Stop-ScheduledTask -TaskName 'DUNYATEK WeddingERP Sunucu' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
      Where-Object { $_.CommandLine -like '*dist\index.mjs*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-ScheduledTask -TaskName 'DUNYATEK WeddingERP Sunucu'
    Write-Log 'Sunucu yeniden başlatıldı'
  }
}

$drive = Get-PSDrive -Name ($Root.Substring(0, 1))
$freeGb = [math]::Round($drive.Free / 1GB, 1)
if ($freeGb -lt 10) { Write-Log "UYARI: diskte $freeGb GB boş alan kaldı" }

try {
  $disk = Get-PhysicalDisk | Where-Object { $_.HealthStatus -ne 'Healthy' }
  if ($disk) { Write-Log "UYARI: disk sağlığı: $($disk.FriendlyName) $($disk.HealthStatus)" }
} catch { }
