<#
.SYNOPSIS
  Çalışan SQLite veritabanının tutarlı yedeğini alır (SQLite çevrimiçi yedekleme API'si).
  Aktif .db dosyası doğrudan kopyalanmaz. Son 30 yedek saklanır.
  İsteğe bağlı -CopyTo ile yedeğin bir kopyası USB diske / NAS'a da bırakılır.
#>
param(
  [string]$Root = 'C:\DUNYATEK\WeddingERP',
  [int]$Keep = 30,
  [string]$CopyTo = ''
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $Root 'config\server.env'
$serverDir = Join-Path $Root 'app\apps\local-server'
$env:BACKUP_DIR = Join-Path $Root 'backups'
$env:BACKUP_KEEP = "$Keep"
$log = Join-Path $Root 'logs\backup.log'

Push-Location $serverDir
try {
  $out = & node --env-file=$envFile dist\backup.mjs 2>&1
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
"$(Get-Date -Format s) [$code] $out" | Add-Content -Encoding UTF8 $log
if ($code -ne 0) { throw "Yedekleme başarısız: $out" }

if ($CopyTo -and (Test-Path $CopyTo)) {
  $latest = Get-ChildItem $env:BACKUP_DIR -Filter 'wedding-*.db' | Sort-Object Name -Descending | Select-Object -First 1
  Copy-Item $latest.FullName -Destination $CopyTo -Force
  "$(Get-Date -Format s) kopya: $CopyTo\$($latest.Name)" | Add-Content -Encoding UTF8 $log
}
Write-Output $out
