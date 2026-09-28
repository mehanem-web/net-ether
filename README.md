# NET//ETHER — v7.0.0
**Broman Enterprises**

A cyberpunk-styled always-on-top desktop HUD for Windows network configuration management — static IP, DHCP server, ping, subnet scan and a per-site device knowledge base in one window. Built for field technicians switching between network setups on job sites.

v7.0.0 absorbs **NET//DHCP**: the standalone DHCP tool is now the DHCP tab.

---

## REQUIREMENTS

- Windows 10 / 11
- To build: [Node.js](https://nodejs.org/) v18 or later

The packaged app is manifested `requireAdministrator`. On an unmanaged PC that means a UAC prompt at launch; on a managed fleet it means EPM (or an equivalent policy) elevates it silently. Either way the process starts elevated and `netsh` runs directly — there are no per-operation prompts.

---

## DEV MODE

```bash
dev.bat
```

Or manually:
```bash
npm install
npx electron . --dev
```

DevTools open detached automatically in dev mode. Dev mode runs **unelevated** (the Electron binary carries no manifest): the titlebar version chip turns amber, and each adapter change goes through a UAC prompt instead of running directly. That path exists for development only.

---

## BUILD

```bash
build.bat
```

`build.bat` is the source of truth: `npm install`, then `npx electron-builder --win nsis portable` with `CSC_IDENTITY_AUTO_DISCOVERY=false`. CI (`.github/workflows/release.yml`) runs the same command. There is no MSI target.

Output lands in `dist/`:

| File | Description |
|------|-------------|
| `NET-ETHER-Installer-{version}.exe` | NSIS installer, **per-machine**, defaults to `C:\Program Files\Broman Enterprises\NET-ETHER\`. Supports `/S` for silent (Intune system-context) deployment. |
| `NET-ETHER-portable-{version}.exe` | Run from anywhere, no install needed |

Builds are unsigned — SmartScreen warnings are expected.

Releasing (tag → CI builds → binaries attached to the GitHub release) is documented in `RELEASING.md`. Test procedure for a new version is in `TESTING.md`.

---

## SOURCE ZIP WORKFLOW (Claude sessions)

GitHub `main` is the source of truth; Claude pulls it directly at session start. When a source zip is produced for hand-back, the folder inside the zip must match the version — never a stale version or a generic name. Folder and zip are `NET-ETHER-vX.X.X`, excluding `dist/`, `node_modules/`, `.git/`, and any `.exe` / `.msi` / `.7z`.

---

## TABS

### ETHER
Manage static IP configuration for any wired adapter.

- **Presets** — 4 slots (LIVE, +3 saved). LIVE auto-populates from the active adapter and never persists to disk.
- **Factory defaults** — manufacturer out-of-box addresses, beside SAVE TO PRESET. A tile fills the device's subnet and puts you one address above it. The **AXIS** tile is link-local (`169.254.1.1 / 255.255.0.0`): current Axis cameras ship DHCP-only and fall back to a random `169.254` address, so joining that /16 is how you reach one without a DHCP server or the Axis tool.
- **Adapter dropdown** — every wired adapter with live status, IP, DHCP/STATIC badge, and connection state. On a static adapter a **→ DHCP** action sits beside the badge: click twice to hand the adapter back to DHCP.
- **APPLY CONFIG** — writes IP / subnet / gateway / DNS via `netsh`, then re-reads the adapter to confirm it took. A verified change shows three ways: green stripe on the status bar, **✓ ACTIVE** on the IP field, and a flash of the new address in the top bar. A failed one turns the field red.
- **COPY COMMANDS** — shows the exact `netsh` lines without running them
- **MTU** — in DIAGNOSTICS (version chip) → TOOLS: reads current MTU and resets to 1500 (fixes the classic "can ping but can't browse" symptom)
- **CIDR** — in the **?** quick guide: prefix ↔ mask ↔ hosts; click a row to fill the subnet field
- **REVERT** — snapshots the previous config before applying; one click to restore
- **Connection History** — last 10 applied configs, click any to reload
- `169.254.x.x` is allowed (with a mask hint). `0.x.x.x` and an APIPA DNS server are still rejected.

### DHCP
A DHCP server for the bench and the dead segment — NET//DHCP v3, absorbed into ETHER in v7.0.0 with its engine moved onto ETHER's elevated path and diagnostics log.

- **The wide tab.** The window grows to ~820 px while DHCP is open (NET//DHCP's own layout: 3-column settings, device table, log strip) and returns to your normal width when you leave.
- **Off at launch.** Nothing binds UDP 67 until the DHCP tab is opened. Opening it starts **LISTEN**: every DHCP request on the wire shows in the table as ASKING with the address it *would* be given, and nothing is answered.
- **SERVE** (per row) — answers only that MAC. The safe option on a network that already has DHCP.
- **SERVE ALL DEVICES** — answers everyone, after an active scan for other DHCP servers; asks for confirmation if one is live.
- **QUICK START** — picks the wired adapter, derives the pool, scans, serves. If the adapter has no usable address it offers a temporary static IP (via ETHER's own apply/verify path) that reverts on quit, with crash recovery on next launch.
- **SCAN WIRE** — active rogue-DHCP check (relay-style DISCOVER, ~6 s). Scans are serialised, a result is reused for 20 s, and the serve-all gate also counts any server heard on the wire in the last two minutes — routers often ignore a second DISCOVER sent seconds after the first. **SELF-TEST** — adapter, port 67, firewall rule, other servers, policy.
- Ping-before-offer conflict probe, DHCPDECLINE quarantine, MAC → IP reservations (★), named profiles, idle auto-stop (default 30 min), lease CSV and activity-log export.
- Advanced options: DNS (6), domain (15), NTP (42), vendor 43, TFTP (66), boot file (67).
- The buttons bring the engine up themselves; the mode badge (OFFLINE / LISTENING / SERVING) is the on-off switch. OFFLINE releases UDP 67 and removes the firewall rule. The engine is also torn down on quit.
- Every serve/firewall/static-assist step is written to DIAGNOSTICS. IT can disable the server with the `DisableDhcpServer` policy value.
- Settings live in `%APPDATA%\net-ether\dhcp-config.json`; on first run they are imported from a standalone NET//DHCP install if one exists.

### MULTI-IP
Secondary IP aliases on an adapter — reach a device on another subnet without changing your primary address.

- Add/remove aliases; the result is verified by re-reading the adapter
- On a **DHCP** adapter, adding an alias converts it to static (keeping the current lease values). The button asks for a second click to confirm before doing that.
- CMD fallback if the command fails — the real `netsh` error is shown, with the full output in DIAGNOSTICS
- Always remove aliases when done — Windows keeps them across reboots

### PING
Continuous connectivity monitor.

- Up to 8 hosts, configurable interval (1s / 2s / 5s / 10s)
- Tracks latency, packet loss %, and a per-host sparkline history
- Uses TCP port 80 connect (not ICMP) — works through firewalls that block ping
- PAUSE freezes display without clearing data; STOP resets everything
- Tray icon animates on ping failure

### SCAN
Subnet scanner for /24 networks.

- ICMP ping sweep + ARP cache sweep (catches devices that block ping)
- Port probe on 10 common ports per host: 80, 443, 554, 8080, 8443, 3389, 22, 23, 21, 8888
- **Hostnames** — after the sweep, every host is resolved by reverse DNS and, failing that, a NetBIOS name query (UDP 137, done in-process). Your own machine gets a **SELF** badge. Names carry through to SITES.
- Smart action buttons: OPEN (HTTP/HTTPS), RDP, RTSP (copies URL), SSH (copies command)
- Vendor lookup from the bundled 57K-entry IEEE OUI table. The **ONLINE VENDOR LOOKUP** toggle controls the macvendors.com fallback for misses (default on, remembered). An HKLM policy can force it off fleet-wide — see POLICY below.
- **Site Library** — save scan results as named sites; load one before scanning to compare against its known devices
- **Change chip** — scanning a known site's subnet shows an amber chip with NEW / MISSING / MOVED counts and a **VIEW →** jump. Nothing switches tabs on you.

### SITES
Persistent site knowledge base. Survives across visits.

- **Site profiles** — name, customer, address, contact, subnet
- **Device roster** — every device anchored by MAC address, not just IP
- **Change detection** — after every scan of a known subnet, flags NEW / MISSING / MOVED devices
- **Device notes** — freeform text per device
- **Credentials** — per-device key/value pairs. Masked in the UI with a reveal toggle. **Encrypted at rest** with Windows DPAPI via Electron `safeStorage` — readable only by your account on this machine. Pre-v6.2 plaintext files migrate automatically on first load.
- **Device type tags** — CAMERA, NVR/DVR, NETWORK, SERVER, WORKSTATION, ACCESS CTL, PRINTER, OTHER
- **SCAN NOW** — loads the site's subnet into SCAN; results come back as a change chip
- **EXCEL** — formatted workbook of every site and device
- **JSON** — portable export. Credentials are **excluded** unless you choose WITH CREDS, which writes them as plaintext.
- **IMPORT** — backs up your current data first (`backups/`, last 5 kept), then **MERGE** (devices matched by MAC, your values win, blanks filled) or **REPLACE**.

---

## DIAGNOSTICS

Click the **version chip** in the titlebar → **DIAGNOSTICS**. The same menu has **FIT WINDOW** (snap the HUD to its content) and **AUTO-FIT** (on: the window follows the active tab's content; off: your manual size sticks — dragging the window edge turns it off).

- **TOOLS** — MTU → 1500 for the adapter selected in ETHER
- **STATE** — version, elevation (with integrity level), user/host, exe and data paths, credential storage status, policy, data file sizes
- **LOG** — every privileged operation with the exact `netsh` commands run, exit codes, captured output, and a VERIFY entry recording whether the change actually took. Also app launch, backups, imports/exports, hostname resolution timings. Persistent across restarts (`diag-log.json`, last 200 entries).
- **COPY DIAGNOSTICS** — plain-text report to the clipboard. Paste it into a bug report.

The chip turns **amber** if the process is not elevated.

The titlebar **?** opens a per-tab quick guide; **FULL MANUAL →** opens `NET-ETHER-Guide.pdf`.

---

## POLICY

Optional HKLM values for managed fleets (Intune / GPO). Read once at launch.

| Key | Value | Effect |
|-----|-------|--------|
| `HKLM\SOFTWARE\Policies\Broman Enterprises\NET-ETHER` | `DisableOnlineVendorLookup` (REG_DWORD) = 1 | macvendors.com is never contacted; the SCAN toggle shows OFF · POLICY and is greyed out |
| `HKLM\SOFTWARE\Policies\Broman Enterprises\NET-ETHER` | `DisableDhcpServer` (REG_DWORD) = 1 | The DHCP engine never binds UDP 67; the DHCP tab is read-only with a policy notice |

---

## DATA FILES

All data is per-user in `%APPDATA%\net-ether\`, pinned explicitly regardless of how the exe was launched. Nothing is transmitted anywhere except the optional macvendors.com OUI lookup.

| File | Contents |
|------|----------|
| `presets.json` | Saved preset slots 1–3 (LIVE is never persisted) |
| `sites.json` | SCAN tab site library |
| `intel.json` | SITES knowledge base (format 2: `{ format, creds, sites }` — credential values are DPAPI blobs). The filename is historical. |
| `backups/intel-*.json` | Automatic pre-import backups, newest 5 |
| `vendor-cache.json` | Cached macvendors.com lookups |
| `last-snapshot.json`, `launch-snapshot.json` | Adapter state for REVERT and restore-on-quit |
| `diag-log.json` | Diagnostics log |
| `dhcp-config.json` | DHCP tab: last settings, profiles, reservations, idle timer, pending static-assist revert |
| `window-state.json` | Last window position, size and display |

All JSON writes are atomic (temp file + rename).

---

## PROJECT STRUCTURE

```
NET-ETHER/
├── main.js          — Electron main process: window, IPC, netsh, scanning, crypto, diagnostics
├── dhcp.js          — DHCP server engine (RFC 2131, listen-first) on ETHER's elevated path
├── preload.js       — Secure IPC bridge (contextBridge, fixed API surface)
├── package.json     — electron-builder config (nsis + portable, per-machine)
├── dev.bat          — One-click dev launch
├── build.bat        — One-click production build
├── RELEASING.md     — Tag → CI → release procedure
├── TESTING.md       — Pre-release test checklist (home vs managed laptop)
├── assets/
│   ├── icon.ico
│   ├── oui.csv              — IEEE OUI vendor database (57K+ entries)
│   ├── tray*.ico            — Animated tray icon frames
│   ├── installer.nsh        — NSIS customisation (default path, taskkill, cleanup)
│   ├── NET-ETHER-Guide.pdf  — User guide (opened by FULL MANUAL →)
│   └── fonts/               — Orbitron + Share Tech Mono, bundled
└── src/
    └── index.html   — Entire HUD UI (HTML + CSS + JS)
```

---

## CHANGELOG

### v7.0.0
Two apps become one. NET//DHCP is absorbed as the DHCP tab, the window sizing model is rebuilt, and the ETHER tab gets a visual pass. One release, one whitelist request.

**DHCP server (from NET//DHCP v3.0.4)**
- New `dhcp.js` module and DHCP tab. Listen-first engine, targeted serve, serve-all behind a rogue-server scan, ping-before-offer, reservations, profiles, idle auto-stop, self-test, CSV/log export — all of v3, re-plumbed.
- **Off until the tab is opened.** Launching ETHER never binds UDP 67.
- All shell calls moved onto `runElevated()` / `execFile` — no `exec` strings, no shell. Firewall rule (`NET-ETHER-DHCP-UDP67`) is added only when missing and removed on ENGINE OFF / quit; a leftover `NET-DHCP-Server-UDP67` rule from the old app is cleaned up.
- Static-IP assist now goes through ETHER's apply + verify path and is recorded in the diagnostics log; revert on quit uses the same path.
- Adapter list and vendor lookup come from ETHER. NET//DHCP's curated short names (Axis, Hikvision, Dahua, Hanwha, Bosch, …) now win over the IEEE legal-entity string everywhere, including SCAN and SITES.
- Quit goes through one path that tears the engine down (revert static assist → socket off → firewall rule removed) before the process exits; also on Windows shutdown.
- Tray tooltip and the live bar show the serving state; the DHCP tab gets a live dot while serving.
- New policy value `DisableDhcpServer`.
- One-time import of profiles/reservations from a standalone NET//DHCP install.

**Window**
- Sizing rebuilt: the panel is `[scroll body][pinned footer]`, so the status bar can never be clipped by the window edge. Height follows the active tab's real content via a ResizeObserver instead of summing child heights (the source of the off-by-a-few-px overshoot/undershoot at non-100 % DPI).
- Height is clamped against the display the window is actually on, not the primary. Position, size and display are remembered; if that display is gone at launch the HUD falls back to top-centre of the primary.
- A manual resize now sticks across tab switches and launches. Version chip → **FIT WINDOW** snaps back; **AUTO-FIT** toggles the behaviour.
- Single instance: a second launch (the EPM double-click) exits and brings the running HUD to the front.
- Always-on-top is re-asserted if Windows strips it (the Win+Shift+S overlay does). Tray click brings the HUD forward unless it's already in front; double-click always shows it.
- Quit has a watchdog: the process is gone within 8 s regardless of what the DHCP teardown is doing.
- Programmatic resizes no longer register as manual drags (auto-fit stayed off), are coalesced, and re-assert keyboard focus (typing stopped working after a scan).

**ETHER tab**
- APPLY shows a progress sweep while netsh runs. A verified apply lights the status bar green, tags the IP field **✓ ACTIVE** and flashes the new address in the live bar; a failed one turns the field red.
- Status bars have a coloured accent stripe (green / amber / red / animated while busy) and a blinking cursor when idle.
- KNOWN DEFAULTS → **FACTORY DEFAULTS** button beside SAVE TO PRESET, with a one-line explainer and a three-column grid.
- Button row simplified: **DHCP** → `→ DHCP` in the adapter row (two clicks, only on a static adapter); **MTU** → DIAGNOSTICS → TOOLS; **CIDR** → `?` guide (CIDR tab, rows still fill the subnet field); **CMD** → **COPY COMMANDS**.
- Section labels carry the `//` mark; primary buttons carry the icon family's corner brackets.

**From the bench (rc2)**
- DHCP: tick several devices → **SERVE SELECTED**; header checkbox grabs every asker. Devices/log divider is draggable and remembered. Returning devices get their previous address back (1 h memory). Target count on the badge/live bar updates on every add/remove. The serve gate logs its reasoning and flags a server that's off the serve subnet (reachable via another adapter — Wi-Fi, usually).
- DHCP engine only NAKs a client it offered/leased itself or a request for an address off its subnet; anything else gets silence (RFC 2131 §4.3.2) — it can no longer knock a customer device off a lease from the real router. Replies padded to 300 bytes for old BOOTP-era clients.
- ETHER: LIVE mirrors the adapter's gateway and DNS (DHCP-served or static). A netsh "object already exists" apply failure now says the address is already on the adapter. Command box wraps.
- SCAN: rows stay sorted by IP as they arrive. Randomised (private) MACs are labelled as such instead of Unknown.
- Titlebar yields on the left (chip, then logo) so ─ ✕ never clip; minimum width 340. Vector tab icons — crisp at any DPI and theme-coloured.
- Security: imported site JSON is sanitised at import (site IDs, MACs, IPs forced to shape; strings bounded) — imported identifiers reach inline handlers where HTML escaping isn't protection. CSP meta tag (`connect-src 'none'`). Adapter lookups match the exact netsh interface name ("Ethernet" no longer matches "Ethernet 2"). Ping host can't start with `-`. Electron lock bumped to 41.10.x.

**Docs**
- README, quick guide, TESTING.md (new DHCP checklist and IT notes for UDP 67 + the firewall rule).

### v6.2.0
Consolidated release: elevation rework, diagnostics, data security, and UX fixes in one build so the fleet needs a single whitelist update.

**Elevation & diagnostics**
- **CHANGE** Privileged commands no longer go through the VBScript → cscript → cmd.exe trampoline. The process is already elevated (UAC or EPM), so `netsh` runs directly via `execFile` with stdout/stderr and exit code captured, stopping at the first failing command. Unelevated (dev) launches use a self-logging temp `.cmd` via PowerShell `Start-Process -Verb RunAs -Wait`, so output and a dismissed prompt (`CANCELLED`) are both reported.
- **NEW** Post-op verification on every write (static apply, DHCP, MTU, multi-IP add/remove, launch-state restore) — the adapter is re-read and the outcome logged. MTU and multi-IP return `verified` instead of assuming exit 0 meant success.
- **NEW** Diagnostics overlay behind the titlebar version chip: STATE + persistent LOG with captured command output, COPY DIAGNOSTICS. Chip turns amber when not elevated.
- **NEW** Multi-IP pre-flight: adding to a DHCP adapter requires a second click to confirm.
- **FIX** `userData` pinned explicitly to `%APPDATA%\net-ether`.
- **CHANGE** Elevated-op status messages no longer claim to request admin rights; real `netsh` error text is shown on failure.

**Data**
- **NEW** Credentials encrypted at rest with `safeStorage` (DPAPI). `intel.json` moves to a format-2 envelope; legacy files migrate once, only after an in-memory round-trip verifies, written atomically.
- **NEW** Credential inputs masked with a reveal toggle.
- **NEW** JSON export (credentials excluded unless opted in) and IMPORT with automatic pre-import backup, MAC-anchored MERGE, or REPLACE. Replaces the old raw-JSON merge.
- **FIX** All JSON saves are atomic (temp + rename).

**UX**
- **CHANGE** Minimize button now hides to tray (`skipTaskbar` made minimize a dead end). `win-minimize` IPC removed. Tray click restores an OS-minimized window instead of hiding it.
- **CHANGE** SCAN no longer auto-switches to SITES after a scan; a persistent change chip with VIEW → replaces it (and the stale-arming bug that could fire on a later scan is gone with it).
- **NEW** `169.254.x.x` static addresses allowed. AXIS default tile is now link-local `169.254.1.1 / 255.255.0.0`.
- **NEW** Titlebar **?** opens a per-tab quick guide with FULL MANUAL →. The guide is a PDF (`shell.openPath` on the .docx failed without Word).
- **NEW** Hostname resolution after every scan: reverse DNS + NetBIOS (in-process UDP 137), SELF badge, names stored in SITES.

**Policy & packaging**
- **NEW** ONLINE VENDOR LOOKUP toggle on SCAN; `HKLM\SOFTWARE\Policies\Broman Enterprises\NET-ETHER\DisableOnlineVendorLookup=1` force-disables it.
- **CHANGE** Installer is per-machine NSIS defaulting to `C:\Program Files\Broman Enterprises\NET-ETHER\` (suite convention). `msi` target removed. `installer.nsh` no longer reads a nonexistent uninstall key (Fix A). **Existing per-user installs must be uninstalled separately** — see `TESTING.md`.
- **CLEANUP** Remaining `INTEL` identifiers renamed (`SITE_TYPES`, `sitekb-*` IPC channels, path constants). `intel.json` filename kept.

---

### v6.0.1
- **HARDEN** `escHtml()` now also escapes the single quote (`'` → `&#39;`). Closes a latent XSS-into-elevated-IPC vector: values dropped into single-quoted inline handler args (`onclick="fn('${escHtml(x)}')"`) could previously break out of the JS string. Not exploitable in practice (all such args are app-generated IDs/MAC/IP) but removes the whole class.
- **HARDEN** `sanitizeAdapter()` now also rejects `%` and `^` (cmd.exe env-expansion / escape) that would otherwise survive into the elevated `cmd /c` chain.
- **HARDEN** `alias-build-cmd` now validates `currentSn` with `isValidSubnet()` instead of trusting the renderer value, matching the sibling `alias-add` handler.
- **FIX** Window IPC handlers (`win-close`, `win-minimize`, `win-hide`, `win-set-opacity`, `win-get-opacity`) now guard against a torn-down window ref via `winAlive()` — prevents a throw if a late IPC fires during quit.

---

### v6.0.0
- **BREAKING** Migrated all `wmic` calls to PowerShell `Get-CimInstance` — wmic is removed in Win 11 24H2+. Affects DHCP/static detection, adapter description filtering, GUID lookups for registry cross-check, and snapshot/restore. All 13 call sites replaced with shared `getAdapterGuid()` and `getAdapterDescriptions()` helpers.
- **FIX** Port probe ECONNREFUSED no longer reported as `open: true` — closed ports now correctly show as closed. Added `refused` flag for host-reachability detection.
- **FIX** `snapshotAdapterConfig()` now uses `getAdapterGuid()` (sanitized PowerShell) instead of raw `exec()` with unsanitized adapter names from disk/OS.
- **FIX** `wmic nic get Name,Description /format:csv` column order assumption replaced — PowerShell `ConvertTo-Csv` has deterministic column order.
- **FIX** Scan result IPs and MACs now escaped via `escHtml()` in innerHTML templates.
- **FIX** Known-defaults chip innerHTML now escaped (future-proofing for user-editable presets).
- **FIX** `build.bat` — removed all `pause` calls, added `exit /b 0` on success.
- **FIX** `dev.bat` — removed `pause` on npm install failure.
- **FIX** `CLAUDE.md` appId corrected to `com.bromanenterprises.net-ether` (was `net-ether`).
- **FIX** Stale `wmic` references removed from code comments.

---

© 2026 Broman Enterprises
