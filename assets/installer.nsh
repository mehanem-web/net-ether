; NET//ETHER Custom NSIS installer script

!macro customInstall
  ; ── Kill any running instance before installing ──────────
  DetailPrint "Checking for running NET//ETHER instance..."
  nsExec::ExecToLog 'taskkill /F /IM "NET-ETHER.exe" /T'
  Sleep 1000

  ; ── Silently uninstall previous version if found ─────────
  ; Check both HKCU and HKLM uninstall registry keys
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.bromanenterprises.net-ether" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Found previous install, removing..."
    ExecWait '"$0" /S _?=$INSTDIR'
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.bromanenterprises.net-ether" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Found previous install (machine-wide), removing..."
    ExecWait '"$0" /S _?=$INSTDIR'
  ${EndIf}

  ; ── Clean up old autostart entry ─────────────────────────
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NET-ETHER"
!macroend

!macro customUnInstall
  ; Kill running instance before uninstalling
  nsExec::ExecToLog 'taskkill /F /IM "NET-ETHER.exe" /T'
  Sleep 500
  ; Remove autostart registry entry on uninstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NET-ETHER"
!macroend
