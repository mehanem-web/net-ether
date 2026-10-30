# NET-ETHER triage - READ ONLY. Changes nothing on this machine.
# Collects why NET-ETHER won't start / won't elevate, into one text file next to the script (or Public Documents).
# Run in a normal (non-admin) PowerShell window:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\NET-ETHER-triage.ps1
# If running scripts is blocked, open the file, copy everything, paste it into PowerShell.

# Where the report goes: next to this script (the USB stick in the field) if that folder is
# writable, else Public Documents. Never the runner's Desktop: when the script is run with a
# separate admin account, that Desktop belongs to the admin account and the logged-in user
# can't open it ("Location is not available ... Access is denied").
function Pick-OutDir {
  foreach ($d in @($PSScriptRoot, (Join-Path $env:PUBLIC 'Documents'), $env:TEMP)) {
    if (-not $d -or -not (Test-Path $d)) { continue }
    try { $t = Join-Path $d ('.w' + [guid]::NewGuid().ToString('N')); [IO.File]::WriteAllText($t, 'x'); Remove-Item $t -Force; return $d } catch {}
  }
  return $env:TEMP
}
$out = Join-Path (Pick-OutDir) ("NET-ETHER-triage-{0}-{1:yyyyMMdd-HHmm}.txt" -f $env:COMPUTERNAME, (Get-Date))
$lines = New-Object System.Collections.Generic.List[string]
function Say($t) { $lines.Add([string]$t) }
function Section($t) { Say ''; Say ('=' * 70); Say $t; Say ('=' * 70) }
function Try-Block($name, [scriptblock]$b) {
  try { & $b } catch { Say "  [$name failed: $($_.Exception.Message)]" }
}

Section 'WHO / WHERE'
Try-Block 'who' {
  Say "Computer:  $env:COMPUTERNAME"
  Say "User:      $(whoami)"
  Say "Profile:   $env:USERPROFILE"
  Say "AppData:   $env:APPDATA"
  Say "Windows:   $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).Version)"
  Say "PS mode:   $($ExecutionContext.SessionState.LanguageMode)   (ConstrainedLanguage = app control policy is on)"
  $g = (whoami /groups) -join "`n"
  $il = if ($g -match 'S-1-16-12288') {'High (admin)'} elseif ($g -match 'S-1-16-8192') {'Medium (standard)'} else {'other'}
  Say "This window's integrity: $il"
}

Section 'INSTALLED COPIES (path, version, signature)'
Try-Block 'installs' {
  $cands = @(
    "$env:ProgramFiles\Broman Enterprises\NET-ETHER\NET-ETHER.exe",
    "${env:ProgramFiles(x86)}\Broman Enterprises\NET-ETHER\NET-ETHER.exe",
    "$env:LOCALAPPDATA\Programs\net-ether\NET-ETHER.exe",
    "$env:LOCALAPPDATA\Programs\NET-ETHER\NET-ETHER.exe"
  )
  $found = @()
  foreach ($c in $cands) { if (Test-Path $c) { $found += (Get-Item $c) } }
  foreach ($d in @("$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads")) {
    if (Test-Path $d) { $found += Get-ChildItem $d -Filter 'NET-ETHER*.exe' -ErrorAction SilentlyContinue }
  }
  if (-not $found) { Say '  No NET-ETHER exe found in the usual places.' }
  foreach ($f in $found | Sort-Object FullName -Unique) {
    $sig = Get-AuthenticodeSignature $f.FullName
    Say ("  {0}" -f $f.FullName)
    Say ("     version {0}   size {1:N0}   modified {2}" -f $f.VersionInfo.ProductVersion, $f.Length, $f.LastWriteTime)
    Say ("     signature {0}   signer: {1}" -f $sig.Status, ($sig.SignerCertificate.Subject -replace '^CN=([^,]+).*','$1'))
  }
  Say ''
  Say '  Uninstall entries:'
  Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'NET.?ETHER|NET//' } |
    ForEach-Object { Say ("    {0}  {1}  -> {2}" -f $_.DisplayName, $_.DisplayVersion, $_.InstallLocation) }
}

Section 'RUNNING RIGHT NOW (a hidden copy swallows every new launch)'
Try-Block 'procs' {
  $p = Get-CimInstance Win32_Process -Filter "Name like 'NET-ETHER%'" -ErrorAction SilentlyContinue
  if (-not $p) { Say '  None running.' }
  foreach ($x in $p) { Say ("  PID {0}  started {1}  {2}" -f $x.ProcessId, $x.CreationDate, $x.ExecutablePath) }
}

Section 'APP DATA FOLDERS (names and sizes only - no contents)'
Try-Block 'appdata' {
  $dirs = @("$env:APPDATA\net-ether") + (Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -notin 'Public','Default','Default User','All Users' } | ForEach-Object { Join-Path $_.FullName 'AppData\Roaming\net-ether' })
  foreach ($d in $dirs | Select-Object -Unique) {
    if (Test-Path $d) {
      Say "  $d"
      Get-ChildItem $d -File -ErrorAction SilentlyContinue | ForEach-Object { Say ("     {0,-32} {1,10:N0}  {2}" -f $_.Name, $_.Length, $_.LastWriteTime) }
    } else { Say "  $d  (not there)" }
  }
}

Section 'NET-ETHER DIAGNOSTICS LOG - last 40 entries (if the app ever ran)'
Try-Block 'diag' {
  $dl = Get-ChildItem 'C:\Users\*\AppData\Roaming\net-ether\diag-log.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $dl) { Say '  No diag-log.json found.' }
  else {
    Say "  from $($dl.FullName)"
    $raw = Get-Content $dl.FullName -Raw -Encoding UTF8
    # Windows PowerShell's ConvertFrom-Json fails quietly on some logs; the .NET parser doesn't
    $entries = $null
    try {
      Add-Type -AssemblyName System.Web.Extensions
      $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
      $ser.MaxJsonLength = 67108864
      $entries = @($ser.DeserializeObject($raw))
    } catch { $entries = @($raw | ConvertFrom-Json -ErrorAction Stop) }
    if (-not $entries.Count) { Say '  (log is empty)' }
    $entries | Select-Object -Last 40 | ForEach-Object {
      $e = $_
      $get = { param($k) if ($e -is [System.Collections.IDictionary]) { $e[$k] } else { $e.$k } }
      $ts = & $get 'ts'
      $when = try { [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$ts).LocalDateTime.ToString('MM-dd HH:mm:ss') } catch { "$ts" }
      $note = ("$(& $get 'note')" -replace '\s+',' ').Trim()
      if ($note.Length -gt 160) { $note = $note.Substring(0, 160) }
      Say ("  {0} {1,-6} {2,-14} ok={3} {4}" -f $when, (& $get 'kind'), (& $get 'tag'), (& $get 'ok'), $note)
    }
  }
}

Section 'POLICY KEYS'
Try-Block 'policy' {
  $k = 'HKLM:\SOFTWARE\Policies\Broman Enterprises\NET-ETHER'
  if (Test-Path $k) { (Get-ItemProperty $k | Out-String).Trim() -split "`n" | ForEach-Object { Say "  $_" } } else { Say '  none' }
}

Section 'BLOCKS IN THE LAST 3 DAYS (AppLocker, WDAC/Code Integrity, Defender, app crashes)'
$since = (Get-Date).AddDays(-3)
$logs = @(
  'Microsoft-Windows-AppLocker/EXE and DLL',
  'Microsoft-Windows-AppLocker/MSI and Script',
  'Microsoft-Windows-CodeIntegrity/Operational',
  'Microsoft-Windows-Windows Defender/Operational',
  'Application'
)
foreach ($l in $logs) {
  Try-Block $l {
    $ev = Get-WinEvent -FilterHashtable @{ LogName = $l; StartTime = $since } -ErrorAction Stop |
          Where-Object { $_.Message -match 'NET-ETHER|net-ether|electron' } | Select-Object -First 15
    Say "  [$l] $(@($ev).Count) matching"
    foreach ($e in $ev) { Say ("    {0:yyyy-MM-dd HH:mm} id {1} {2}" -f $e.TimeCreated, $e.Id, (($e.Message -replace '\s+',' ').Substring(0, [Math]::Min(220, $e.Message.Length)))) }
  }
}

Section 'ELEVATION MANAGER LOGS (whatever product IT uses)'
Try-Block 'epm' {
  $epmLogs = Get-WinEvent -ListLog * -ErrorAction SilentlyContinue |
             Where-Object { $_.LogName -match 'EPM|Privilege|Elevat|Avecto|BeyondTrust|CyberArk|AutoElevate|Admin By Request' -and $_.RecordCount -gt 0 }
  if (-not $epmLogs) { Say '  No elevation-manager event log found.' }
  foreach ($l in $epmLogs) {
    $ev = Get-WinEvent -FilterHashtable @{ LogName = $l.LogName; StartTime = $since } -ErrorAction SilentlyContinue |
          Where-Object { $_.Message -match 'NET-ETHER|net-ether' } | Select-Object -First 15
    Say "  [$($l.LogName)] $(@($ev).Count) matching"
    foreach ($e in $ev) { Say ("    {0:yyyy-MM-dd HH:mm} id {1} {2}" -f $e.TimeCreated, $e.Id, (($e.Message -replace '\s+',' ').Substring(0, [Math]::Min(220, $e.Message.Length)))) }
  }
  foreach ($d in 'C:\Program Files\Microsoft EPM Agent', 'C:\Program Files\Avecto', 'C:\Program Files\BeyondTrust', 'C:\Program Files\CyberArk') {
    if (Test-Path $d) { Say "  Installed: $d" }
  }
  # Microsoft EPM (Intune) writes text logs, not event-log entries - newest lines naming NET-ETHER
  $epmLogDirs = 'C:\Program Files\Microsoft EPM Agent\Logs', 'C:\ProgramData\Microsoft\IntuneManagementExtension\Logs'
  foreach ($ld in $epmLogDirs) {
    if (-not (Test-Path $ld)) { continue }
    $files = Get-ChildItem $ld -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'EPM|Epm|epm|Elevation' -or $ld -like '*EPM Agent*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 6
    # NET-ETHER lines plus anything that refused, failed or was unmanaged - newest 60, full width
    $hits = $files | Select-String -Pattern 'NET-ETHER|net-ether|Broman|Denied|Deny|Block|Fail|Error|Unmanaged|Revoc|Certificate' -ErrorAction SilentlyContinue |
            Sort-Object { $_.Line } -Unique | Sort-Object Filename, LineNumber | Select-Object -Last 60
    Say "  [$ld] $(@($files).Count) log file(s), $(@($hits).Count) line(s) (NET-ETHER / denied / failed / unmanaged / certificate)"
    foreach ($h in $hits) {
      $t = ($h.Line -replace '\s+',' ').Trim()
      $t = $t -replace '^Log Information: \d+ : ', '' -replace '\| thread\[\d+\] \| Looking for keywords: \d+, keyword received: \d+ \| ', ''
      if ($t.Length -gt 420) { $t = $t.Substring(0, 420) }
      Say ("    {0}" -f $t)
    }
  }
}

Section 'HOW SLOW IS A PROCESS LAUNCH HERE (3 x cmd /c ver)'
Try-Block 'spawn' {
  1..3 | ForEach-Object { $t = Measure-Command { cmd /c ver | Out-Null }; Say ("  {0:N0} ms" -f $t.TotalMilliseconds) }
}

$lines | Out-File -FilePath $out -Encoding utf8
Write-Host ''
Write-Host "  REPORT SAVED TO:" -ForegroundColor Green
Write-Host "  $out" -ForegroundColor Green
Write-Host ''
# open Explorer with the file selected
try { Start-Process explorer.exe "/select,`"$out`"" } catch {}
