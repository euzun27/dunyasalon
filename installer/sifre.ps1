<#
.SYNOPSIS
  Unutulan şifreyi sıfırlar. Başlat menüsündeki "Şifre sıfırla" kısayolu bunu yönetici olarak açar.
#>
param([string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
$node = Join-Path $Root 'app\node\node.exe'
$envFile = Join-Path $Root 'config\server.env'
Push-Location (Join-Path $Root 'app\apps\local-server')
try {
  & $node --env-file=$envFile dist\reset-password.mjs
  Write-Host ''
  $user = Read-Host 'Şifresi değişecek kullanıcı adı (vazgeçmek için boş bırakın)'
  if ($user) {
    $sec = Read-Host 'Yeni şifre (en az 6 karakter)' -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    & $node --env-file=$envFile dist\reset-password.mjs $user $plain
  }
} catch {
  Write-Host $_ -ForegroundColor Red
} finally {
  Pop-Location
}
Read-Host 'Kapatmak için Enter'
