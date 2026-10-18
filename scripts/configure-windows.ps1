<#
.SYNOPSIS
  Kurulu uygulamayı Windows'a tanıtır: yapılandırma, ilk yönetici, Windows görevleri, güvenlik duvarı.

.DESCRIPTION
  Hem install-windows.ps1 (depodan kurulum) hem de Kurulum.exe (hazır paket) tarafından çağrılır.
  Uygulama dosyaları $Root\app altında hazır olmalıdır. Güncellemede mevcut config\server.env
  ve veritabanı korunur; yalnızca görevler yeniden kaydedilip sunucu yeniden başlatılır.

  Şifre ve bulut anahtarı komut satırında görünmesin diye ortam değişkeniyle de verilebilir:
  DT_ADMIN_PASSWORD, DT_CLOUD_TOKEN.
#>
param(
  [Parameter(Mandatory = $true)][string]$Node,
  [string]$Root = 'C:\DUNYATEK\WeddingERP',
  [string]$AdminPassword = $env:DT_ADMIN_PASSWORD,
  [int]$Port = 8787,
  [string]$DeviceId = 'salon-mini-pc-1',
  [string]$CloudUrl = '',
  [string]$CloudToken = $env:DT_CLOUD_TOKEN,
  [string]$BackupTime = '04:00'
)

$ErrorActionPreference = 'Stop'

$app = Join-Path $Root 'app'
$data = Join-Path $Root 'data'
$backups = Join-Path $Root 'backups'
$logs = Join-Path $Root 'logs'
$config = Join-Path $Root 'config'
New-Item -ItemType Directory -Force $data, $backups, $logs, $config | Out-Null

Write-Host '1/4 Yapılandırma yazılıyor...' -ForegroundColor Cyan
$envFile = Join-Path $config 'server.env'
if (-not (Test-Path $envFile)) {
  $text = @"
PORT=$Port
HOST=0.0.0.0
DB_PATH=$data\wedding.db
WEB_DIST=$app\apps\web\dist
MIGRATIONS_DIR=$app\migrations\local
BACKUP_DIR=$backups
DEVICE_ID=$DeviceId
CLOUD_URL=$CloudUrl
CLOUD_TOKEN=$CloudToken
SYNC_INTERVAL_MS=15000
RESERVATION_BUFFER_MINUTES=60
SESSION_HOURS=12
"@
  # BOM'suz UTF-8: node --env-file ilk satırı BOM ile okursa PORT anahtarını tanımaz
  [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
  Write-Host "  $envFile oluşturuldu."
} else {
  Write-Host "  $envFile zaten var, korunuyor."
}
# Yapılandırma ve veri klasörlerine yalnızca SYSTEM ve Administrators erişsin
foreach ($dir in @($config, $data, $backups)) {
  icacls $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
}

Write-Host '2/4 Veritabanı ve yönetici kullanıcı hazırlanıyor...' -ForegroundColor Cyan
Push-Location (Join-Path $app 'apps\local-server')
try {
  if ($AdminPassword) { $env:ADMIN_PASSWORD = $AdminPassword }
  & $Node --env-file=$envFile dist\seed.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Veritabanı hazırlanamadı.' }
} finally {
  Remove-Item Env:\ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host '3/4 Windows görevleri kaydediliyor...' -ForegroundColor Cyan
$serverDir = Join-Path $app 'apps\local-server'
$runner = Join-Path $config 'run-server.cmd'
@"
@echo off
cd /d "$serverDir"
"$Node" --env-file="$envFile" dist\index.mjs >> "$logs\server.log" 2>&1
"@ | Set-Content -Encoding ASCII $runner

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`""
Register-ScheduledTask -TaskName 'DUNYATEK WeddingERP Sunucu' -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Principal $principal -Settings $settings -Force | Out-Null

$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$app\scripts\backup.ps1`" -Root `"$Root`""
Register-ScheduledTask -TaskName 'DUNYATEK WeddingERP Yedek' -Action $backupAction -Trigger (New-ScheduledTaskTrigger -Daily -At $BackupTime) `
  -Principal $principal -Force | Out-Null

$healthAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$app\scripts\health-check.ps1`" -Root `"$Root`" -Port $Port -Restart"
$healthTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'DUNYATEK WeddingERP Saglik' -Action $healthAction -Trigger $healthTrigger `
  -Principal $principal -Force | Out-Null

Write-Host '4/4 Güvenlik duvarı (yalnızca yerel ağ)...' -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName 'DUNYATEK WeddingERP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'DUNYATEK WeddingERP' -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet | Out-Null

Start-ScheduledTask -TaskName 'DUNYATEK WeddingERP Sunucu'
$ok = $false
for ($i = 0; $i -lt 15 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3 | Out-Null; $ok = $true } catch { }
}
if (-not $ok) { throw "Sunucu başlamadı. Ayrıntı: $logs\server.log" }

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.PrefixOrigin -in 'Manual', 'Dhcp' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
$addr = if ($ip) { "http://$($ip):$Port" } else { "http://<bu bilgisayarın IP adresi>:$Port" }
"Bu bilgisayarda: http://localhost:$Port`r`nKasa ve resepsiyon bilgisayarlarında: $addr" |
  Set-Content -Encoding UTF8 (Join-Path $Root 'adres.txt')
Write-Host ''
Write-Host 'Kurulum tamamlandı.' -ForegroundColor Green
Write-Host "Kasa ve resepsiyon bilgisayarlarında açın: $addr"
Write-Host 'Bu bilgisayara modem/DHCP üzerinden sabit IP verin ve ağ profilini "Özel" yapın.'
