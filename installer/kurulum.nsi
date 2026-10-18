; Dünyatek Salon Takip Yazılımı - Windows kurulum dosyası (NSIS 3, 64 bit)
; Derleme: npm run kurulum  (scripts/build-installer.mjs bu dosyayı STAGE, VERSION ve OUTFILE ile derler)

Unicode true
Target amd64-unicode
ManifestDPIAware true
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGE
  !error "STAGE tanımlı değil (npm run kurulum ile derleyin)"
!endif
!ifndef OUTFILE
  !define OUTFILE "Dunyatek-Salon-Kurulum.exe"
!endif

!define APPNAME "Dünyatek Salon Takip Yazılımı"
!define COMPANY "Dünyatek Bilişim"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DunyatekSalon"
!define SERVERTASK "DUNYATEK WeddingERP Sunucu"
!define PS '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass'

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "C:\DUNYATEK\WeddingERP"
BrandingText "© 2026 ${COMPANY}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${APPNAME} Kurulumu"
VIAddVersionKey "LegalCopyright" "© 2026 ${COMPANY}"

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define MUI_ICON "dunyatek.ico"
!define MUI_UNICON "dunyatek.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Bu sihirbaz salon sunucusunu bu bilgisayara kurar.$\r$\n$\r$\nNode.js, Git veya internet gerekmez; gereken her şey bu dosyanın içindedir. Sunucu Windows açılışında kendiliğinden başlar, her gece yedek alır ve 5 dakikada bir kendini denetler.$\r$\n$\r$\nDaha önce kurulduysa veriler ve ayarlar korunarak güncellenir."
!define MUI_FINISHPAGE_TITLE "Kurulum tamamlandı"
!define MUI_FINISHPAGE_TEXT "Sunucu çalışıyor. Masaüstündeki Dünyatek Salon kısayoluyla açabilirsiniz.$\r$\n$\r$\nKasa ve resepsiyon bilgisayarlarından açılacak adres $INSTDIR\adres.txt dosyasında yazılıdır."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Programı şimdi aç"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom SettingsPage SettingsLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Turkish"

Var Upgrade
Var hPass1
Var hPass2
Var hCloudUrl
Var hCloudToken
Var hDevice
Var AdminPass
Var CloudUrl
Var CloudToken
Var DeviceId

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Bu program 64 bit Windows 10 veya 11 gerektirir."
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $0 HKLM "${UNINSTKEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

; Yapılandırma zaten varsa güncellemedir: şifre ve bulut ayarları sorulmaz, korunur
Function SettingsPage
  StrCpy $Upgrade "0"
  ${If} ${FileExists} "$INSTDIR\config\server.env"
    StrCpy $Upgrade "1"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Kurulum ayarları" "İlk yönetici şifresi ve bulut bağlantısı"
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 12u "Yönetici (admin) şifresi, en az 6 karakter:"
  ${NSD_CreatePassword} 0 13u 48% 12u ""
  Pop $hPass1
  ${NSD_CreatePassword} 52% 13u 48% 12u ""
  Pop $hPass2
  ${NSD_CreateLabel} 0 27u 100% 10u "Soldaki kutuya şifreyi, sağdakine tekrarını yazın. Girişte kullanıcı adı: admin"
  Pop $0

  ${NSD_CreateLabel} 0 44u 100% 10u "Bulut paneli adresi (boş bırakılırsa yalnızca salon ağında çalışır):"
  ${NSD_CreateText} 0 55u 100% 12u "https://panel.truvapark.com.tr"
  Pop $hCloudUrl
  ${NSD_CreateLabel} 0 71u 100% 10u "Bulut eşitleme anahtarı (Cloudflare'deki SYNC_TOKEN):"
  ${NSD_CreatePassword} 0 82u 100% 12u ""
  Pop $hCloudToken
  ${NSD_CreateLabel} 0 98u 100% 10u "Cihaz adı:"
  ${NSD_CreateText} 0 109u 50% 12u "salon-mini-pc-1"
  Pop $hDevice
  nsDialogs::Show
FunctionEnd

Function SettingsLeave
  ${NSD_GetText} $hPass1 $AdminPass
  ${NSD_GetText} $hPass2 $0
  ${NSD_GetText} $hCloudUrl $CloudUrl
  ${NSD_GetText} $hCloudToken $CloudToken
  ${NSD_GetText} $hDevice $DeviceId
  StrLen $1 $AdminPass
  ${If} $1 < 6
    MessageBox MB_ICONEXCLAMATION "Yönetici şifresi en az 6 karakter olmalıdır."
    Abort
  ${EndIf}
  ${If} $AdminPass != $0
    MessageBox MB_ICONEXCLAMATION "Şifreler aynı değil."
    Abort
  ${EndIf}
  ${If} $CloudUrl != ""
  ${AndIf} $CloudToken == ""
    MessageBox MB_YESNO|MB_ICONQUESTION "Bulut anahtarı boş. Bulut eşitlemesi kapalı kurulsun mu? (Sonradan config\server.env dosyasından açılabilir.)" IDYES +2
    Abort
    StrCpy $CloudUrl ""
  ${EndIf}
  ${If} $DeviceId == ""
    StrCpy $DeviceId "salon-mini-pc-1"
  ${EndIf}
FunctionEnd

Function OpenApp
  ExecShell "open" "http://localhost:8787"
FunctionEnd

Section "Kurulum"
  SetRegView 64
  SetShellVarContext all
  DetailPrint "Çalışan sunucu durduruluyor..."
  InitPluginsDir
  File "/oname=$PLUGINSDIR\durdur.ps1" "durdur.ps1"
  nsExec::ExecToLog '${PS} -File "$PLUGINSDIR\durdur.ps1" -Root "$INSTDIR"'
  Pop $0

  ; Eski sürüm dosyaları temizlenir (veri, yedek ve ayarlar app klasörünün dışındadır)
  RMDir /r "$INSTDIR\app"
  SetOutPath "$INSTDIR\app"
  File /r "${STAGE}\*.*"
  File "dunyatek.ico"

  WriteUninstaller "$INSTDIR\app\Kaldir.exe"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\app\dunyatek.ico"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\app\Kaldir.exe"'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1

  DetailPrint "Sunucu ayarlanıyor ve başlatılıyor..."
  ; Şifre ve anahtar komut satırında görünmesin diye ortam değişkeniyle aktarılır
  StrCpy $0 $AdminPass
  System::Call 'Kernel32::SetEnvironmentVariable(t "DT_ADMIN_PASSWORD", t r0)'
  StrCpy $0 $CloudToken
  System::Call 'Kernel32::SetEnvironmentVariable(t "DT_CLOUD_TOKEN", t r0)'
  ; Boş değer -File ile verilirse PowerShell 5.1 parametreyi eksik sayar; yalnızca dolu olanlar eklenir
  StrCpy $1 ""
  ${If} $Upgrade != "1"
    ${If} $CloudUrl != ""
      StrCpy $1 '-CloudUrl "$CloudUrl"'
    ${EndIf}
    StrCpy $1 '$1 -DeviceId "$DeviceId"'
  ${EndIf}
  nsExec::ExecToLog '${PS} -File "$INSTDIR\app\scripts\configure-windows.ps1" -Root "$INSTDIR" -Node "$INSTDIR\app\node\node.exe" $1'
  Pop $0
  System::Call 'Kernel32::SetEnvironmentVariable(t "DT_ADMIN_PASSWORD", p 0)'
  System::Call 'Kernel32::SetEnvironmentVariable(t "DT_CLOUD_TOKEN", p 0)'
  StrCpy $AdminPass ""
  StrCpy $CloudToken ""
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Sunucu ayarlanırken hata oluştu (kod $0).$\r$\nAyrıntılar bu penceredeki kayıtlarda ve $INSTDIR\logs\server.log dosyasındadır."
    Abort
  ${EndIf}

  WriteINIStr "$INSTDIR\app\Dunyatek Salon.url" "InternetShortcut" "URL" "http://localhost:8787"
  WriteINIStr "$INSTDIR\app\Dunyatek Salon.url" "InternetShortcut" "IconFile" "$INSTDIR\app\dunyatek.ico"
  WriteINIStr "$INSTDIR\app\Dunyatek Salon.url" "InternetShortcut" "IconIndex" "0"
  CopyFiles /SILENT "$INSTDIR\app\Dunyatek Salon.url" "$DESKTOP\Dünyatek Salon.url"
  CreateDirectory "$SMPROGRAMS\Dünyatek Salon"
  CopyFiles /SILENT "$INSTDIR\app\Dunyatek Salon.url" "$SMPROGRAMS\Dünyatek Salon\Dünyatek Salon.url"
  CreateShortcut "$SMPROGRAMS\Dünyatek Salon\Şifre sıfırla.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" \
    "-NoProfile -Command Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\app\scripts\sifre.ps1$\"'" \
    "$INSTDIR\app\dunyatek.ico"
  CreateShortcut "$SMPROGRAMS\Dünyatek Salon\Yedekler klasörü.lnk" "$INSTDIR\backups"
  CreateShortcut "$SMPROGRAMS\Dünyatek Salon\Kaldır.lnk" "$INSTDIR\app\Kaldir.exe"
SectionEnd

Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  ; Kaldir.exe app klasörünün içinde: kök klasör registry'den okunur
  ReadRegStr $R0 HKLM "${UNINSTKEY}" "InstallLocation"
  ${If} $R0 == ""
    StrCpy $R0 "C:\DUNYATEK\WeddingERP"
  ${EndIf}
  nsExec::ExecToLog '${PS} -File "$R0\app\scripts\durdur.ps1" -Root "$R0" -Remove'
  Pop $0
  Delete "$DESKTOP\Dünyatek Salon.url"
  RMDir /r "$SMPROGRAMS\Dünyatek Salon"
  RMDir /r /REBOOTOK "$R0\app"
  DeleteRegKey HKLM "${UNINSTKEY}"
  MessageBox MB_ICONINFORMATION "Program kaldırıldı.$\r$\nVeritabanı, yedekler ve ayarlar silinmedi: $R0\data, $R0\backups, $R0\config"
SectionEnd
