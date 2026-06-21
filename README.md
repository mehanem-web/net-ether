# NET//ETHER — v6.1.0
**Broman Enterprises**

A cyberpunk-styled always-on-top desktop HUD for Windows network configuration management. Built for field technicians switching between network setups on job sites.

---

## REQUIREMENTS

- [Node.js](https://nodejs.org/) v18 or later
- Windows 10 / 11

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

DevTools open detached automatically in dev mode.

---

## BUILD

```bash
# MSI installer (recommended for deployment)
npm run build-msi

# NSIS installer (user picks install directory)
npm run build-nsis

# Portable single .exe (no install)
npm run build-portable

# All three
npm run build-all
```

Output lands in `dist/`.

| File | Description |
|------|-------------|
| `NET-ETHER-Setup-{version}.msi` | MSI — installs via Programs & Features, clean uninstall |
| `NET-ETHER-Installer-{version}.exe` | NSIS installer |
| `NET-ETHER-portable-{version}.exe` | Run from anywhere, no install needed |

---

## SOURCE ZIP WORKFLOW (Claude sessions)

When zipping the source for handoff or upload, the output folder inside the zip must match the version. Never zip as a stale version or generic name. Folder and zip must be `NET-ETHER-vX.XX.X`.

Correct process every time:
1. Work in the current working directory
2. Bump version in `package.json` and `README.md`
3. Copy to a versioned folder: `cp -r . ../NET-ETHER-vX.XX.X`
4. Zip that folder: `zip -qr NET-ETHER-vX.XX.X.zip NET-ETHER-vX.XX.X/`
5. Move to outputs: `/mnt/user-data/outputs/`
6. Clean up the temp folder

---

## TABS

### ETHER
Manage static IP configuration for any network adapter.

- **Presets** — 4 slots (LIVE, +3 saved). LIVE auto-populates from the active adapter and never persists to disk.
- **Adapter dropdown** — lists all adapters with live status, IP, and connection state
- **APPLY CONFIG** — runs netsh commands elevated via UAC to apply static IP/subnet/gateway/DNS
- **DHCP** — switches the adapter back to DHCP in one click
- **MTU** — reads current MTU and resets to 1500 if needed (fixes the classic "can ping but can't browse" symptom)
- **CMD** — shows raw netsh commands without running them; copy/paste into Admin CMD if UAC is unavailable
- **REVERT** — snapshots your current IP before applying; one click to restore if something breaks
- **Connection History** — last 10 applied configs, click any to reload

### MULTI-IP
Manage secondary IP aliases on an adapter — useful for reaching devices on a different subnet without changing your primary address.

- Add/remove aliases with UAC elevation
- Peek at all current IPs on the selected adapter (+ button under the IP field)
- Falls back to CMD copy if elevation fails
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
- Smart action buttons: OPEN (HTTP/HTTPS), RDP, RTSP (copies URL), SSH (copies command)
- Vendor lookup from offline 57K-entry IEEE OUI CSV — falls back to macvendors.com, caches locally
- **Site Library** — save scan results as named sites, load before a scan to see known devices pre-populated

### INTEL
Persistent site knowledge base. Survives across visits.

- **Site profiles** — name, customer, address, contact, subnet
- **Device roster** — every device anchored by MAC address, not just IP
- **Change detection** — after every scan, automatically flags NEW / MISSING / MOVED devices
- **Device notes** — freeform text per device, persists forever
- **Credentials** — per-device key/value pairs stored locally (e.g. web UI: admin/admin123)
- **Device type tags** — CAMERA, NVR/DVR, NETWORK, SERVER, WORKSTATION, ACCESS CTL, PRINTER, OTHER
- **SCAN NOW** — jumps to SCAN tab with site subnet pre-loaded
- **Auto-import** — first open migrates existing SCAN library sites automatically

Data stored in %APPDATA%\net-ether\intel.json — local only, never transmitted.

---

## DATA FILES

All data stored per-user in %APPDATA%\net-ether\

| File | Contents |
|------|----------|
| presets.json | Saved preset slots 1-3 (LIVE is never persisted) |
| sites.json | SCAN tab site library |
| intel.json | INTEL site knowledge base |
| vendor-cache.json | Cached macvendors.com lookups |

---

## PROJECT STRUCTURE

```
NET-ETHER/
├── main.js          — Electron main process: window, IPC, netsh, scanning
├── preload.js       — Secure IPC bridge (contextBridge)
├── package.json     — Electron-builder config
├── dev.bat          — One-click dev launch
├── build.bat        — One-click production build
├── assets/
│   ├── icon.ico
│   ├── oui.csv      — IEEE OUI vendor database (57K+ entries)
│   ├── tray*.ico    — Animated tray icon frames
│   └── installer.*  — NSIS installer assets
└── src/
    └── index.html   — Entire HUD UI (HTML + CSS + JS)
```

---

## CHANGELOG

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
