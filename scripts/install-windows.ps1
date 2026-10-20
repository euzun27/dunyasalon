<#
.SYNOPSIS
  DUNYATEK Wedding ERP yerel sunucusunu salon mini PC'sine (Windows 10/11 Pro) kurar.

.DESCRIPTION
  - C:\DUNYATEK\WeddingERP altında app, data, backups, logs, config klasörlerini oluşturur
  - Uygulamayı derler (npm ci + build)
  - configure-windows.ps1 ile ilk yöneticiyi, Windows görevlerini ve güvenlik duvarını kurar

  Node.js ve Git kurmadan tek dosyayla kurulum için Kurulum.exe kullanın (npm run kurulum).

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

Write-Host '1/2 Klasörler oluşturuluyor...' -ForegroundColor Cyan
$app = Join-Path $Root 'app'
$data = Join-Path $Root 'data'
$backups = Join-Path $Root 'backups'
$logs = Join-Path $Root 'logs'
$config = Join-Path $Root 'config'
New-Item -ItemType Directory -Force $app, $data, $backups, $logs, $config | Out-Null

Write-Host '2/2 Uygulama kopyalanıyor ve derleniyor...' -ForegroundColor Cyan
$repo = Split-Path -Parent $PSScriptRoot
robocopy $repo $app /MIR /XD node_modules .git .wrangler data backups logs /XF *.db *.db-wal *.db-shm .dev.vars /NFL /NDL /NJH /NJS | Out-Null
Push-Location $app
try {
  npm ci --no-audit --no-fund
  npm run build
} finally {
  Pop-Location
}

& (Join-Path $PSScriptRoot 'configure-windows.ps1') -Node $node -Root $Root -AdminPassword $AdminPassword -Port $Port `
  -DeviceId $DeviceId -CloudUrl $CloudUrl -CloudToken $CloudToken -BackupTime $BackupTime
