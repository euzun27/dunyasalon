<#
.SYNOPSIS
  Bir yedekten veritabanını geri yükler. Sunucu durdurulur, mevcut veritabanı
  "pre-restore" adıyla saklanır, yedek yerine konur ve sunucu yeniden başlatılır.
  Senkronizasyon kuyruğu (sync_outbox) yedekle birlikte geri geldiği için
  gönderilmemiş olaylar tekrar denenir; bulut tarafı tekrarları event_id ile ayıklar.
#>
param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [string]$Root = 'C:\DUNYATEK\WeddingERP'
)
$ErrorActionPreference = 'Stop'
$db = Join-Path $Root 'data\wedding.db'
if (-not (Test-Path $BackupFile)) { throw "Yedek bulunamadı: $BackupFile" }

Stop-ScheduledTask -TaskName 'DUNYATEK WeddingERP Sunucu' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*dist\index.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($ext in '', '-wal', '-shm') {
  if (Test-Path "$db$ext") { Move-Item "$db$ext" "$db.pre-restore-$stamp$ext" }
}
Copy-Item $BackupFile $db
Start-ScheduledTask -TaskName 'DUNYATEK WeddingERP Sunucu'
Write-Output "Geri yüklendi: $BackupFile → $db (eski dosya: $db.pre-restore-$stamp)"
