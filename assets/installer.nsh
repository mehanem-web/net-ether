; NET//ETHER custom NSIS installer script
; Included by electron-builder (package.json → build.nsis.include).
; Install mode is per-machine (perMachine: true) so Intune can deploy it in
; system context. The exe itself is manifested requireAdministrator.

; ── Default install directory ────────────────────────────────
; electron-builder reads InstallLocation from the app's install registry key
; to seed the directory page. Writing it here (before the page is shown) makes
; the suite-standard path the default while still letting the user change it.
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Broman Enterprises\NET-ETHER"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Broman Enterprises\NET-ETHER"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Broman Enterprises\NET-ETHER"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\Broman Enterprises\NET-ETHER"
!macroend

!macro customInstall
  ; ── Kill any running instance before installing ──────────
  DetailPrint "Checking for running NET//ETHER instance..."
  nsExec::ExecToLog 'taskkill /F /IM "NET-ETHER.exe" /T'
  Sleep 1000

  ; (The old "uninstall previous version" ReadRegStr blocks were removed: they
  ;  read a key that never existed — the real uninstall key is a GUID derived
  ;  from the appId — and electron-builder's own NSIS logic already removes a
  ;  previous per-machine install on upgrade. Leftover PER-USER installs from
  ;  v6.1 and earlier live in each user's profile and must be uninstalled
  ;  separately; see TESTING.md.)

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
