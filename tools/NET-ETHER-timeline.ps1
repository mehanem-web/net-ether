# NET-ETHER timeline - READ ONLY. Changes nothing on this machine.
# One time-sorted list of everything Windows, EPM, Intune and NET-ETHER logged about launching
# NET-ETHER, plus when the PC woke up and went online / offline. Saved next to the script (or Public Documents).
#
# Run in an ADMIN PowerShell window (Prefetch, Intune and Security logs need it):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\NET-ETHER-timeline.ps1            # today
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\NET-ETHER-timeline.ps1 -Days 2    # yesterday + today
param([int]$Days = 1)

$From = (Get-Date).Date.AddDays(-([Math]::Max(1, $Days) - 1))
$To   = Get-Date
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
$out  = Join-Path (Pick-OutDir) ("NET-ETHER-timeline-{0}-{1:yyyyMMdd-HHmm}.txt" -f $env:COMPUTERNAME, $To)
$inv  = [Globalization.CultureInfo]::InvariantCulture
$rows = New-Object System.Collections.Generic.List[object]
$notes = New-Object System.Collections.Generic.List[string]
function Add-Row($when, $src, $text) {
  if ($when -ge $From -and $when -le $To) {
    $t = ("$text" -replace '\s+', ' ').Trim()
    if ($t.Length -gt 300) { $t = $t.Substring(0, 300) }
    $rows.Add([pscustomobject]@{ When = $when; Src = $src; Text = $t })
  }
}
function Note($t) { $notes.Add([string]$t) }
function Try-Block($name, [scriptblock]$b) { try { & $b } catch { Note "[$name] failed: $($_.Exception.Message)" } }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Note 'NOT running as admin - Prefetch, Intune and Security sections may be empty.' }

# 1. NET-ETHER's own log - every entry in the window (only exists once the app actually started).
#    Every profile on the machine: run with a separate admin account, $env:APPDATA is that
#    account's, not the tech's who actually used ETHER.
Try-Block 'ether' {
  $logs = @(Get-ChildItem 'C:\Users\*\AppData\Roaming\net-ether\diag-log.json' -ErrorAction SilentlyContinue)
  if (-not $logs.Count) { Note 'ETHER: no diag-log.json in any profile'; return }
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $ser.MaxJsonLength = 67108864
  foreach ($dl in $logs) {
    $who = $dl.FullName.Split('\')[2]
    $n = 0
    foreach ($e in @($ser.DeserializeObject((Get-Content $dl.FullName -Raw -Encoding UTF8)))) {
      try { $w = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$e['ts']).LocalDateTime } catch { continue }
      if ($w -lt $From) { continue }
      Add-Row $w ('ETHER ' + $who) ("{0} {1} ok={2} {3}" -f $e['kind'], $e['tag'], $e['ok'], $e['note']); $n++
    }
    Note "ETHER ($who): $n entries in window"
  }
}

# 2. Microsoft EPM agent text logs - every file touched in the window, NET-ETHER and refusal lines
Try-Block 'epm' {
  $d = 'C:\Program Files\Microsoft EPM Agent\Logs'
  if (-not (Test-Path $d)) { Note 'EPM: no agent log folder'; return }
  $files = Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $From }
  $n = 0
  foreach ($h in ($files | Select-String -Pattern 'NET-ETHER|net-ether|Broman|Den(y|ied)|Block|Revoc|Certif|Untrusted|Signat|Timeout|Timed out' -ErrorAction SilentlyContinue)) {
    if ($h.Line -match 'Failed to query process with process id') { continue }   # harmless EPM noise
    if ($h.Line -match '(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} [AP]M)') {
      try { $w = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd h:mm:ss tt', $inv) } catch { continue }
      $t = $h.Line -replace '^Log \w+: \d+ : ', '' -replace '\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} [AP]M', '' -replace '\| thread\[\d+\] \|', '' -replace '\| Status : \| EventMessage :', ''
      Add-Row $w 'EPM' $t; $n++
    }
  }
  Note "EPM: $(@($files).Count) log file(s) touched in window, $n line(s)"
}

# 3. Intune Management Extension - did Intune (re)install or remove NET-ETHER in the window?
Try-Block 'intune' {
  $d = 'C:\ProgramData\Microsoft\IntuneManagementExtension\Logs'
  if (-not (Test-Path $d)) { Note 'INTUNE: no IME log folder'; return }
  $files = Get-ChildItem $d -Filter '*.log' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $From }
  $n = 0
  foreach ($h in ($files | Select-String -Pattern 'NET-ETHER|net-ether|Broman' -ErrorAction SilentlyContinue)) {
    if ($h.Line -match '<!\[LOG\[(.*?)\]LOG\]!><time="(\d{1,2}:\d{2}:\d{2})[^"]*" date="(\d{1,2}-\d{1,2}-\d{4})"') {
      try { $w = [datetime]::ParseExact("$($Matches[3]) $($Matches[2])", 'M-d-yyyy H:mm:ss', $inv) } catch { continue }
      Add-Row $w 'INTUNE' ("[{0}] {1}" -f $h.Filename, $Matches[1]); $n++
    }
  }
  Note "INTUNE: $(@($files).Count) log file(s) touched in window, $n line(s)"
}

# 4. Windows event logs
function Events($log, $ids, $label, [scriptblock]$keep, [scriptblock]$fmt) {
  Try-Block $label {
    $f = @{ LogName = $log; StartTime = $From; EndTime = $To }
    if ($ids) { $f.Id = $ids }
    $ev = Get-WinEvent -FilterHashtable $f -MaxEvents 4000 -ErrorAction Stop
    $n = 0
    foreach ($e in $ev) { if (& $keep $e) { Add-Row $e.TimeCreated $label (& $fmt $e); $n++ } }
    Note "${label}: $n event(s)"
  }
}
$isEther = { param($e) $e.Message -match 'NET-ETHER|net-ether' }
$msg     = { param($e) "id $($e.Id) $($e.Message)" }

# power: boot, shutdown, sleep, wake
Events 'System' @(1, 12, 13, 42, 107) 'POWER' {
  param($e) $e.ProviderName -match 'Power-Troubleshooter|Kernel-General|Kernel-Power'
} {
  param($e)
  switch ("$($e.ProviderName)/$($e.Id)") {
    'Microsoft-Windows-Kernel-General/12'        { 'BOOT' }
    'Microsoft-Windows-Kernel-General/13'        { 'SHUTDOWN' }
    'Microsoft-Windows-Kernel-Power/42'          { 'GOING TO SLEEP' }
    'Microsoft-Windows-Kernel-Power/107'         { 'RESUMED FROM SLEEP' }
    'Microsoft-Windows-Power-Troubleshooter/1'   { 'WOKE UP' }
    default { "id $($e.Id) $($e.ProviderName)" }
  }
}
# network: when this PC got / lost a network (the "online" moment)
Events 'Microsoft-Windows-NetworkProfile/Operational' @(10000, 10001) 'NETWORK' { param($e) $true } {
  param($e)
  $name = if ($e.Message -match 'Name:\s*(.+)') { $Matches[1].Trim() } else { '?' }
  if ($e.Id -eq 10000) { "CONNECTED to '$name'" } else { "DISCONNECTED from '$name'" }
}
Events 'Microsoft-Windows-WLAN-AutoConfig/Operational' @(8001, 8003) 'WIFI' { param($e) $true } {
  param($e)
  $ssid = if ($e.Message -match 'SSID:\s*(.+)') { $Matches[1].Trim() } else { '?' }
  if ($e.Id -eq 8001) { "Wi-Fi connected: $ssid" } else { "Wi-Fi disconnected: $ssid" }
}
# crashes / hangs / blocks naming NET-ETHER
Events 'Application' @(1000, 1001, 1002, 1026) 'APP-ERROR' $isEther $msg
Events 'Microsoft-Windows-CodeIntegrity/Operational' $null 'CODE-INTEGRITY' $isEther $msg
Events 'Microsoft-Windows-Windows Defender/Operational' $null 'DEFENDER' { param($e) $e.Message -match 'NET-ETHER|net-ether' -or $e.Id -in 1121, 1122 } $msg
# process starts (only if IT turned on process-creation auditing)
Events 'Security' @(4688, 4689) 'PROCESS' $isEther {
  param($e)
  $verb = if ($e.Id -eq 4688) { 'STARTED' } else { 'EXITED' }
  $p = if ($e.Message -match '(New )?Process Name:\s*(.+)') { $Matches[2].Trim() } else { '' }
  "$verb $p"
}

# 5. Prefetch - Windows' own record of when NET-ETHER ran (first + last run per exe path)
Try-Block 'prefetch' {
  $pf = Get-ChildItem 'C:\Windows\Prefetch' -Filter 'NET-ETHER*.pf' -ErrorAction Stop
  foreach ($p in $pf) {
    Add-Row $p.LastWriteTime 'PREFETCH' "last run recorded: $($p.Name)"
    Note ("PREFETCH: {0}  first seen {1}  last run {2}" -f $p.Name, $p.CreationTime, $p.LastWriteTime)
  }
  if (-not $pf) { Note 'PREFETCH: no NET-ETHER entries (Prefetch may be off)' }
}

# ---- write it out
$L = New-Object System.Collections.Generic.List[string]
$L.Add("NET-ETHER TIMELINE  $env:COMPUTERNAME  $(whoami)")
$L.Add("Window: $($From.ToString('yyyy-MM-dd HH:mm')) -> $($To.ToString('yyyy-MM-dd HH:mm'))")
$L.Add('')
$L.Add('How to read it: a launch attempt shows as EPM "Parsing file: NET-ETHER.exe".')
$L.Add('  Worked  -> EPM "triggered process elevation ... result: 0", then ETHER "launch".')
$L.Add('  Failed  -> "Parsing file" with nothing after it, or a Deny/Block/Certificate line.')
$L.Add('')
$L.Add('SOURCES')
foreach ($n in $notes) { $L.Add("  $n") }
$L.Add('')
$L.Add('TIMELINE')
foreach ($r in ($rows | Sort-Object When)) { $L.Add(("  {0:MM-dd HH:mm:ss}  {1,-22} {2}" -f $r.When, $r.Src, $r.Text)) }
if (-not $rows.Count) { $L.Add('  (nothing in this window)') }
$L | Out-File -FilePath $out -Encoding utf8
Write-Host ''
Write-Host '  TIMELINE SAVED TO:' -ForegroundColor Green
Write-Host "  $out" -ForegroundColor Green
Write-Host ''
try { Start-Process explorer.exe "/select,`"$out`"" } catch {}
