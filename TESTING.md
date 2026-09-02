# NET//ETHER — Test checklist

Two lists. **HOME** is everything that can be proven on an unmanaged PC (UAC
elevation at launch); it covers the code. **MANAGED LAPTOP** is the short list
that only the fleet build can prove (EPM hook, Intune install, policy keys).
Do HOME completely before tagging — every release is a new exe hash for IT to
whitelist, so a v6.2.1 costs a second request.

When anything looks wrong: open the version chip → COPY DIAGNOSTICS → paste it
into the bug report. That is the only observable on a managed laptop.

---

## HOME (unmanaged PC, before tagging)

Run twice: once from `dev.bat` (unelevated — chip AMBER, UAC per operation) and
once from the portable build (UAC once at launch — chip normal, no prompts).

### Launch & diagnostics
- [ ] Version chip shows the right version. Click it: STATE lists elevated YES (High) on the portable build, NO (Medium) in dev.
- [ ] STATE: userData path is `%APPDATA%\net-ether`, data files listed, credentials line present, policy "none set".
- [ ] LOG has an APP launch entry. Quit, relaunch → previous entries still there.
- [ ] CLEAR LOG leaves one "log-cleared" entry. COPY DIAGNOSTICS pastes STATE + LOG into Notepad.

### ETHER — every write op, watch the LOG after each
- [ ] APPLY a static config → OP apply (direct) exit 0, VERIFY apply OK. Adapter shows STATIC. (The VERIFY note usually says "registry" — the registry updates before netsh's own view does; either source is a confirmed apply.)
- [ ] REVERT → OP apply + VERIFY OK, config back to previous.
- [ ] DHCP → OP dhcp + VERIFY OK.
- [ ] Set MTU to 1400 in an admin prompt, then MTU button → OP mtu + VERIFY "MTU now 1500".
- [ ] Make one fail on purpose (apply to a disabled adapter, or an IP already on it) → red ERROR status with netsh's own message; OP row red; CMD box shows the command.
- [ ] `dev.bat` only: APPLY → UAC → **No** → status "CANCELLED — UAC PROMPT DISMISSED", OP row mode `uac`. Then APPLY → **Yes** → OP row mode `uac`, exit 0, VERIFY OK.
- [ ] Known defaults → AXIS tile fills 169.254.1.1 / 255.255.0.0, no gateway. APPLY succeeds (mask hint only, no error).
- [ ] Type 169.254.5.5 with 255.255.255.0 → amber note about /16, still applies.

### MULTI-IP
- [ ] On a STATIC adapter: add 192.168.250.10 → OP alias_add + VERIFY OK, row appears. REMOVE → OP alias_del + VERIFY OK.
- [ ] On a DHCP adapter: first ADD click → amber "CLICK ADD AGAIN TO CONFIRM". Second click → OP alias_add with **two** commands in the expanded row, adapter badge flips to STATIC, alias present. **This is the case that failed at work in v6.1.0 — whatever the LOG shows here is the answer.**
- [ ] Add an alias that's already present → ERROR with netsh text, CMD box shown.
- [ ] Hide-to-tray with an alias active → warning banner, HUD stays.

### Window
- [ ] The `─` button hides to tray (no minimize). Tray click brings it back.
- [ ] Win+D, then tray click → HUD restores (not hidden).
- [ ] Titlebar `?` → quick guide for the current tab; tab strip switches; FULL MANUAL → opens the PDF in the default viewer (no Word needed). Esc closes.

### SCAN
- [ ] Scan your /24. Hostnames appear on rows within a few seconds of "SCAN COMPLETE"; your own IP has a SELF badge. Status "N HOSTNAMES RESOLVED". LOG has an APP resolve entry with DNS/NetBIOS counts.
- [ ] Row for a Windows PC shows its NetBIOS name if DNS has no PTR for it.
- [ ] ONLINE VENDOR LOOKUP toggle: OFF → an unknown-vendor host stays UNKNOWN. ON → macvendors.com fills it. Setting survives restart.
- [ ] Save the scan as a site. Scan again → chip "SITE — NO CHANGES" (green). Unplug a device, scan → amber chip with "1 MISSING", VIEW → opens the site in SITES with the change listed. Start another scan → chip disappears.
- [ ] SITES → SCAN NOW → scan runs → you stay on SCAN; chip appears; no tab jump.

### SITES / credentials / import-export
- [ ] Open a device drawer, add a credential. Value is masked; eye toggle reveals. Close and reopen the app → still there, masked.
- [ ] Open `%APPDATA%\net-ether\intel.json` in Notepad: top level is `{ "format": 2, "creds": "safeStorage", "sites": {...} }` and the value is `{ "$enc": "..." }`, not plaintext.
- [ ] Migration: copy a v6.1 `intel.json` (bare sites object, plaintext creds) over the file, relaunch, open SITES → creds readable in the UI, file now format 2, LOG has "Migrated intel.json to format 2".
- [ ] Diagnostics STATE "credentials" line reads "N encrypted (safeStorage, format 2)".
- [ ] JSON export with credentials present → strip asks WITHOUT / WITH CREDS. WITHOUT → file has `"val": ""`. WITH → plaintext in file.
- [ ] IMPORT that file → strip shows counts + "Current intel.json backed up first"; `backups\` has a new file. MERGE → status shows +sites/+devices; nothing you had is lost. IMPORT again → REPLACE → YES → only the file's sites remain.
- [ ] IMPORT a random .json (not an export) → "IMPORT FAILED — NOT A SITE EXPORT". IMPORT → cancel picker → "IMPORT CANCELLED".
- [ ] EXCEL export still works.

### Installer (home PC, run as admin)
- [ ] Uninstall any per-user v6.1 copy first (Settings → Apps).
- [ ] Run `NET-ETHER-Installer-6.2.0.exe` → directory page defaults to `C:\Program Files\Broman Enterprises\NET-ETHER\`. Install completes, shortcut works, app launches elevated.
- [ ] Silent: `NET-ETHER-Installer-6.2.0.exe /S` from an admin prompt → same result, no UI.
- [ ] Data from before the install (presets, sites) is still there — `%APPDATA%` is unaffected by install mode.
- [ ] Uninstall from Programs & Features → exe gone, `%APPDATA%\net-ether` kept.

---

## MANAGED LAPTOP (after IT whitelists the new hash)

Everything above is already proven; this is only what the fleet changes.

- [ ] Launch → no UAC prompt (EPM). Chip **normal** (not amber). STATE: elevated YES (High), user = your standard account, userData under your profile.
- [ ] MTU reset, static APPLY, DHCP, **alias add on the DHCP adapter** → all VERIFY OK. If alias still fails: COPY DIAGNOSTICS, the OP row contains netsh's message.
- [ ] SCAN a site subnet → hostnames resolve, no Defender alert on UDP 137 (IT pre-cleared the scanner; this is new traffic — tell them it's coming).
- [ ] Intune install lands in `C:\Program Files\Broman Enterprises\NET-ETHER\`, Start menu entry present, per-user v6.1 copy removed by IT's uninstall step.
- [ ] If IT sets `HKLM\SOFTWARE\Policies\Broman Enterprises\NET-ETHER\DisableOnlineVendorLookup=1`: toggle greyed "OFF · POLICY", STATE policy line shows it, LOG has a policy entry, no macvendors traffic.

---

## Deployment notes for IT (v6.1 → v6.2 migration)

1. v6.2.0 installs **per-machine** (`C:\Program Files\Broman Enterprises\NET-ETHER\`). Earlier versions installed **per-user** (`%LOCALAPPDATA%\Programs\NET-ETHER`). A system-context install cannot remove copies living in user profiles, so push an uninstall of the old package alongside the new deployment (or let users remove it via Settings → Apps). Both can coexist; the old one just goes stale.
2. User data is untouched by either step — it lives in `%APPDATA%\net-ether`, not the install directory.
3. New network behaviour to clear: after a subnet scan the app sends a NetBIOS node-status query (UDP 137) to each host it found. Same scope as the existing ICMP/ARP sweep, one packet per host.
4. Optional policy value: `HKLM\SOFTWARE\Policies\Broman Enterprises\NET-ETHER\DisableOnlineVendorLookup` (DWORD 1) disables the only outbound internet call the app makes.
5. Every release changes the exe hash. EPM and Defender whitelists need re-pointing per version until builds are signed.
