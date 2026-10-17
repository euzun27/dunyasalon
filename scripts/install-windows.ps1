<#
.SYNOPSIS
  DUNYATEK Wedding ERP yerel sunucusunu salon mini PC'sine (Windows 10/11 Pro) kurar.

.DESCRIPTION
  - C:\DUNYATEK\WeddingERP altında app, data, backups, logs, config klasörlerini oluşturur
  - Uygulamayı derler (npm ci + build)
  - İlk yönetici kullanıcıyı oluşturur
  - Sunucuyu Windows açılışında, kullanıcı oturumu açılmadan başlayan ve
    çökünce yeniden başlatılan bir zamanlanmış görev olarak kaydeder
  - Günlük yedekleme görevini ve güvenlik duvarı kuralını ekler

  Yönetici olarak açılmış PowerShell'de, depo kök klasöründen çalıştırın:
    powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -AdminPassword "GucluBirSifre"

  Gereksinim: Node.js 24 LTS (en az 22.16) ve Git kurulu olmalıdır.
#>
param(
  [Parameter(Mandatory = $true)][string]$AdminPassword,
  [string]$Root = 'C:\DUNYATEK\WeddingERP',
  [int]$Port = 8787,
  [string]$DeviceId = 'salon-mini-pc-1',
  [string]$CloudUrl = '',
  [string]$CloudToken = '',
  [string]$BackupTime = '04:00'
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Bu betik yönetici olarak çalıştırılmalıdır.'
  }
}

Assert-Admin

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js bulunamadı. Node.js 24 LTS kurun: https://nodejs.org' }
$nodeVersion = [version]((& node -v).TrimStart('v'))
if ($nodeVersion -lt [version]'22.16.0') { throw "Node.js $nodeVersion çok eski. En az 22.16 (önerilen 24 LTS) gerekir." }

Write-Host '1/6 Klasörler oluşturuluyor...' -ForegroundColor Cyan
$app = Join-Path $Root 'app'
$data = Join-Path $Root 'data'
$backups = Join-Path $Root 'backups'
$logs = Join-Path $Root 'logs'
$config = Join-Path $Root 'config'
New-Item -ItemType Directory -Force $app, $data, $backups, $logs, $config | Out-Null

Write-Host '2/6 Uygulama kopyalanıyor ve derleniyor...' -ForegroundColor Cyan
$repo = Split-Path -Parent $PSScriptRoot
robocopy $repo $app /MIR /XD node_modules .git .wrangler data backups logs /XF *.db *.db-wal *.db-shm .dev.vars /NFL /NDL /NJH /NJS | Out-Null
Push-Location $app
try {
  npm ci --no-audit --no-fund
  npm run build
} finally {
  Pop-Location
}

Write-Host '3/6 Yapılandırma yazılıyor...' -ForegroundColor Cyan
$envFile = Join-Path $config 'server.env'
if (-not (Test-Path $envFile)) {
  @"
PORT=$Port
HOST=0.0.0.0
DB_PATH=$data\wedding.db
WEB_DIST=$app\apps\web\dist
MIGRATIONS_DIR=$app\migrations\local
DEVICE_ID=$DeviceId
CLOUD_URL=$CloudUrl
CLOUD_TOKEN=$CloudToken
SYNC_INTERVAL_MS=15000
RESERVATION_BUFFER_MINUTES=60
SESSION_HOURS=12
"@ | Set-Content -Encoding UTF8 $envFile
  Write-Host "  $envFile oluşturuldu."
} else {
  Write-Host "  $envFile zaten var, korunuyor."
}
# Yapılandırma ve veri klasörlerine yalnızca SYSTEM ve Administrators erişsin
foreach ($dir in @($config, $data, $backups)) {
  icacls $dir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
}

Write-Host '4/6 Veritabanı ve yönetici kullanıcı hazırlanıyor...' -ForegroundColor Cyan
Push-Location (Join-Path $app 'apps\local-server')
try {
  $env:ADMIN_PASSWORD = $AdminPassword
  & node --env-file=$envFile dist\seed.mjs
} finally {
  Remove-Item Env:\ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host '5/6 Windows görevleri kaydediliyor...' -ForegroundColor Cyan
$serverDir = Join-Path $app 'apps\local-server'
$runner = Join-Path $config 'run-server.cmd'
@"
@echo off
cd /d "$serverDir"
"$node" --env-file="$envFile" dist\index.mjs >> "$logs\server.log" 2>&1
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

Write-Host '6/6 Güvenlik duvarı (yalnızca yerel ağ)...' -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName 'DUNYATEK WeddingERP' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'DUNYATEK WeddingERP' -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet | Out-Null

Start-ScheduledTask -TaskName 'DUNYATEK WeddingERP Sunucu'
Start-Sleep -Seconds 4
& (Join-Path $app 'scripts\health-check.ps1') -Root $Root -Port $Port

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -in 'Manual', 'Dhcp' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
Write-Host ''
Write-Host 'Kurulum tamamlandı.' -ForegroundColor Green
Write-Host "Kasa ve resepsiyon bilgisayarlarında açın: http://$($ip):$Port"
Write-Host 'Mini PC''ye modem/DHCP üzerinden sabit IP verin ve ağ profilini "Özel" yapın.'
