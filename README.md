# NET//ETHER — v7.1.0
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
- ICMP first; if ping is blocked, a TCP connect to port 80 counts as alive. Add `:port` to a host (`192.168.0.50:554`) to watch that one service instead — CLOSED means the host answered but the port is shut
- **◉ CAPTURE** on a row opens a live Wireshark capture filtered to that host (only when Wireshark is installed)
- The toned host pops a Windows toast when it flips state while the HUD is hidden in the tray
- PAUSE freezes display without clearing data; STOP resets everything
- Tray icon animates on ping failure

### SCAN
Subnet scanner for /24 networks.

- ICMP ping sweep + ARP cache sweep (catches devices that block ping)
- Port probe on 14 ports per host: 80, 443, 554, 8080, 8443, 3389, 22, 23, 21, 8888, plus 8000 (Hikvision), 37777 (Dahua), 1756 (Bosch RCP+), 5500 (Genetec Directory). The vendor ports sharpen the type guess.
- **Hostnames** — after the sweep, every host is resolved by reverse DNS and, failing that, a NetBIOS name query (UDP 137, done in-process). Your own machine gets a **SELF** badge. Names carry through to SITES.
- Smart action buttons: OPEN (HTTP/HTTPS), RDP, RTSP (copies URL), SSH (copies command)
- Vendor lookup from the bundled 57K-entry IEEE OUI table. The **ONLINE VENDOR LOOKUP** toggle controls the macvendors.com fallback for misses (default on, remembered). An HKLM policy can force it off fleet-wide — see POLICY below.
- **Site Library** — save scan results as named sites; load one before scanning to compare against its known devices
- **Change chip** — scanning a known site's subnet shows an amber chip with NEW / MISSING / MOVED counts and a **VIEW →** jump. Nothing switches tabs on you.
- **COPY ▾** — the whole result list as CSV (Excel) or a markdown table (ticket). **CAPTURE** on a row hands the host off to a live Wireshark capture.

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

### v7.1.0 (2026-10-03)
The v7.1 roadmap, home-tested over ten release candidates. Headline: RECON, multicast discovery, link speed, Wi-Fi/adapter switches, port blinking, Wake-on-LAN, serve-from-alias, batch reservations, site report, Electron fuses. The rc notes below are kept as the record of what changed when.

**rc.10 — Guide**
- Full Guide rewritten for 7.1 — document version 5.0 (`docs/build-guide.js` → docx → PDF): link speed and adapter states, WI-FI / DISABLE, RENEW, `:port` targets, BLINK, DISCOVER and REACH, WSHARK, MEDIA type, WAKE, serve-from-alias, RESERVE SELECTED, the DHCP tab dot, a new RECON chapter, SITE REPORT, and the data/privacy notes for the new traffic. Both `assets/NET-ETHER-Guide.docx` and `.pdf` updated (plus the repo-root PDF copy).

**rc.9 — one fix**
- Elevated PowerShell calls (SILENT unbind/rebind, the interface bounce) now pass the script as `-EncodedCommand` instead of `-Command`. `-Command` re-joins and re-parses its arguments, so an adapter named `Johan's Port` broke it (`TerminatorExpectedAtEndOfString`). Encoded, the script is one opaque token; the readable script is logged beside the OP entry.

**rc.8 — one fix**
- Adapter GUID lookup used a WMI `-Filter` with PowerShell-style quote escaping; WMI wants `\'`, so an adapter named `Johan's Port` returned no GUID — RECON said `NO_GUID`, and the DHCP badge, Wireshark and the registry fallback were silently wrong for it. The GUID now comes from `Get-NetAdapter … .InterfaceGuid` via execFile, no WQL, no shell.

**rc.7 — last home-test round**
- A wide tab's width is a **minimum, not a target**: SCAN/SITES open at ≥640, DHCP at ≥820, and a window you dragged wider stays wider; DHCP → SCAN keeps 820. Narrow tabs still restore your narrow width.
- 8 px top margin on the grow-upward move; height capped a little lower so a tall fit lands clear of both edges.
- One SILENT restore at a time: "listen finished" and "quit" arriving together share a single rebind instead of running two.
- **DHCP engine SUSPENDED during RECON SILENT** on its adapter: socket closed, firewall rule kept, badge and tab dot amber-grey, resumes to its previous mode after the rebind. Clicking the badge while suspended explains instead of toggling.
- OFFLINE badge no longer previews green on hover.
- Adapter names may contain an apostrophe (`Johan's Port`); every write path is execFile-tokenised or PowerShell-escaped, so the old VBS-era ban was refusing legal names.

**rc.6 — hardening, the SILENT race, visible beats small (round two)**
- **Electron fuses** (package.json `build.electronFuses`, applied by electron-builder before signing, verified in CI): `ELECTRON_RUN_AS_NODE` off, `NODE_OPTIONS` off, inspect args off, asar integrity on, app only from asar. The signed, whitelisted, auto-elevated exe can no longer be used as a Node runtime by anything already on the laptop.
- **RECON capture filter**: only LLDP, CDP, EAPOL, STP, ARP, 802.1Q, IGMP and the UDP ports we read (67/68/137/5353/5355/1900/123) reach tshark's dissectors.
- CI: `checkout@v5`, `setup-node@v5`, Node 22.
- **SILENT rebind made robust.** Quit waits for tshark to exit before touching NetCfg; the rebind retries three times with backoff (error 6800 is the NetCfg lock, and it clears); "restored" now means `Get-NetIPInterface` shows an IPv4 interface, not just that the binding flag flipped — if the flag flipped and the interface didn't come back, the binding is toggled once more and the adapter bounced; a DHCP adapter with no address 3 s later gets `ipconfig /renew`; a failed restore at quit shows a Windows message box with the fix. Launch recovery uses the same path.
- **NO ADDRESS** is its own adapter state (link up, nothing bound), with a **RENEW** action; DISCONNECTED now means no link. The DHCP/STATIC badge and → DHCP action show without link; `isDhcp` is read from the registry for adapters that have no IPv4 interface yet.
- **WI-FI chip read `AdminStatus`, which PowerShell emits as a number** — so it said OFF since rc.1 regardless of the radio. It reads `Status` now, and "Not Present" ghosts of a reinstalled card are ignored.
- **RECON NAMES** only lists what hosts say about themselves (NetBIOS registrations/responses, mDNS answers) — no more `wpad`, `*<00>…` or `_dosvc._tcp` instances. DHCP card in SILENT explains why nothing was heard; acks-only reads "N leases renewed".
- **Window grows upward** when a content fit would push the bottom past the work area (REVERT and the status bar stay on screen; no more taskbar overlap).
- **✕ checks for MULTI-IP aliases** like ─ already did (second ✕ within 15 s quits anyway). MULTI-IP panel re-reads after every APPLY / → DHCP / REVERT / alias op and with the LIVE poll; REMOVE on an address Windows already dropped says so instead of "Element not found".
- APPLY's `set dns` uses `validate=no` (the "DNS server is incorrect" warning on every apply is gone). REVERT is logged as `revert`. BLINK uses a hostname target's resolved IP. SITES → DELETE writes a backup first.
- **DHCP tab dot is always present**: red OFFLINE, green LISTENING, amber SERVING — engine state from any tab.
- **SCAN and SITES are 640-wide tabs** (DHCP stays 820): one line per host, MAC beside the IP, vendor and name chips up to 220 px. **DISCOVER is a second big button** beside SCAN SUBNET with one-line hints under both.

**rc.5 — RECON unblocked**
- Fix: the tools lookup handed the UI `version`/`versionOk` while the UI read `tsharkVersion`/`tsharkOk`, so RECON's LISTEN was always dimmed with "? FOUND — 4.6 or newer needed" even with 4.6.9 installed. Diagnostics STATE was right the whole time; the UI wasn't.
- BLINK refuses this machine's own address (loopback never reaches the switch) with a clear message.

The v7.1 roadmap, staged: rc.1 is everything you'd notice on the first plug-in at a site; rc.2 is discovery and the switch port; rc.3 is DHCP, toner and the report; rc.4 is RECON and the layout rule "visible beats small".

**rc.4 — RECON, window, primary address**
- **RECON tab** (sixth tab). One LISTEN, up to 65 s, nothing transmitted: tshark on the ETHER adapter, evidence streamed every ~1.5 s, verdicts as cards — SWITCH (LLDP/CDP name · port · VLAN), 802.1X (EAPOL), STP / TRUNK (BPDUs, PVST VLANs, tagged frames), DHCP (server, gateway, mask, DNS heard; "clients asking, nobody answering"), HOSTS per subnet, NAMES (NetBIOS/mDNS), NTP, and ADDRESS — a free-looking IP with TAKE → ETHER form (APPLY still runs the duplicate check). STANDARD leaves the adapter alone; SILENT unbinds IPv4/IPv6 for the listen (elevated PowerShell) and restores them on finish, stop, quit, and on the next elevated launch after a crash (`recon-silent.json`). WIRESHARK (whole adapter) and COPY live here; the SWITCH? chip and the result line under the ETHER selector are gone. RECON verdicts go into the SITE REPORT. The engine is `reconListen` / `reconVerdicts` in `discover.js` — pure, tested against a generated LLDP/CDP/EAPOL/STP/ARP/DHCP/NBNS/NTP/802.1Q capture.
- **Window: visible beats small.** Minimum width 430 (every adapter chip fits); the chip group wraps as a unit instead of clipping; height is never restored (the content fit sets it); the saved position is clamped inside the work area so it can't open onto the taskbar; only a narrow-tab width is ever saved — DHCP's 820 no longer leaks into the next launch.
- **Primary address = the one holding the gateway**, not whichever Windows lists first: ETHER's adapter list, MULTI-IP's PRIMARY tag (REMOVE never appears on it) and the DHCP select all agree. DHCP refills its settings when the selected adapter gains or loses an address, and ⟳ re-runs the pick-and-fill, so the serve-from-alias choice is reachable with a single adapter.
- **MULTI-IP subnet** defaults to 255.255.255.0; an alias inside the primary's own network inherits the primary's mask; 169.254 gets /16. The classful /8 for 10.x is gone from both forms.
- **MEDIA** device type. What a device announces (mDNS `_googlecast`/`_airplay`/`_roku`, "TV" in its name) beats what its MAC vendor usually makes; printer announcements override too. SITES: the SELF row is never filed as a site device, a stale MAC-less twin of a known device is dropped, and a type you set by hand is never overwritten by a scan.
- **PING** status counts DOWN and CLOSED separately (`ALERT — 1 DOWN · 67% LOSS · 1 CLOSED`); BLINK and capture warnings hold the status line 4 s. Report says "0 sent" instead of "not run".
- **DISCOVER** pulses the rows that answered and lists them in the status when there are six or fewer; a row found by DISCOVER alone shows the source (SSDP / mDNS / ONVIF) where the ms would be.
- **MAC beside the IP** on rows 600 px and wider (container query); below it on narrower rows.

**rc.3 — DHCP, toner, report**
- **SERVE FROM ALIAS** (DHCP): an adapter with a MULTI-IP alias asks which address to serve from; the pool is built on the one you pick. The engine's rogue probe now sees every address, not just the primary.
- **★ RESERVE SELECTED** (DHCP): tick devices, enter a start address, consecutive reservations in list order. Server, gateway and existing reservations are skipped.
- **⚡ BLINK** (PING): with a host toned, 20 s of tiny UDP packets to its discard port so the switch-port LED strobes. Same subnet only; nothing elevated; logged.
- **Toner pitch follows latency**: 1250 Hz at ≤5 ms down to ~650 Hz at 300 ms+.
- **SITE REPORT** (version chip menu): markdown summary of the session — adapter and switch port, scans with site changes and the last result table, DHCP leases, ping stats, every privileged operation from the diagnostics log.
- **WSHARK** replaces CAPTURE and moves into the IP / MAC / PING group, which now wraps as one unit instead of shedding buttons one at a time. Library-drawn rows get it too.
- Fixes from the bug scan: standalone DISCOVER now receives its port-probe results (the listener only existed during a sweep); REACH on a DHCP adapter hands the adapter back to DHCP when the alias is removed (it used to leave it static); a dead `:port` PING target no longer stretches the whole cycle to 6 s; LLDP packet parsing ignores braces inside strings; adapter GUIDs must be real GUIDs; the LIVE refresh spawns one PowerShell instead of two (descriptions ride along with link speed); `ONVIF+WSD` collapses to `ONVIF`; the model chip is skipped when it repeats the name; DISCOVER stays quiet about a missing adapter while a sweep is running; the Wi-Fi chip ignores Wi-Fi Direct virtual adapters.

**rc.2 — discovery, REACH, SWITCH?**
- **◎ DISCOVER** (SCAN): WS-Discovery/ONVIF (UDP 3702), SSDP (1900) and mDNS (5353) probes, 3 s, from every IPv4 on the adapter. Runs alongside each sweep and standalone. Answers merge into the rows: an ONVIF / SSDP / mDNS badge with name, model, URLs and services in the tooltip; the ONVIF name fills the hostname slot; ONVIF → CAMERA, printer services → PRINTER. Hosts outside the scanned /24 get their own amber-ms row — this is how a 169.254 camera out of the box shows up.
- **REACH** on a link-local row: adds a temporary 169.254.x.x alias (the MULTI-IP path, DHCP→static conversion included), opens http://<ip>, and records the alias in `temp-aliases.json`. An amber LINK-LOCAL chip shows it with REMOVE; it's also removed on quit, and a leftover from a crash is cleaned up on the next elevated launch.
- **SWITCH?** chip on the ADAPTER line (Wireshark 4.6+): tshark listens for LLDP and CDP on the adapter, up to 65 s, nothing transmitted. Switch name · port · VLAN appear under the selector as they arrive; stops early once both protocols have been heard. "Didn't announce" is a result, not an error.
- New module `discover.js` (pure dgram + execFile, no shell strings) — listed in `package.json` files.
- DHCP engine dot is a theme-independent traffic light (red OFFLINE, green LISTENING, amber SERVING, slashed POLICY) with a dark ring.
- CAPTURE now on every scan row from the moment it appears, open ports or not.
- PING `:port` targets: a silent drop now runs the normal alive check — host up → CLOSED, host down → FAIL. The LAST cell's tooltip says why.
- Type guess: SELF never gets a port-based type; a host with a NetBIOS name and 554 open is a WORKSTATION (WMP sharing), not a camera.
- The ◉ capture button no longer pulses under the cursor (row rebuild replayed its hover transition).
- SITES: devices with no FIRST SEEN (old library imports) get it on the next scan.

**rc.1 — adapter row, PING port, SCAN export, WAKE**

**Adapter row**
- **Link speed** replaces CONNECTED on a connected adapter: green 1 Gbps+, amber 100 Mbps, red 10 Mbps. From `Get-NetAdapter`, read alongside the existing netsh calls.
- **DISABLE / ENABLE** the selected adapter (`netsh interface set interface`, elevated, verified, logged). Refused while the DHCP server is serving on it.
- **WI-FI** chip: switches every wireless adapter off (or back on) so SCAN, DHCP and PING stay on the wire. Amber while off.
- **WIRESHARK**: live capture on the adapter. Wireshark is located via App Paths / `%ProgramFiles%\Wireshark`; tshark's version is read once and shown in DIAGNOSTICS STATE (4.6+ is the floor for the LLDP / RECON work in later rcs).

**PING**
- `host:port` targets do a TCP check against that port instead of ICMP. CLOSED = host answered, port shut.
- **◉ CAPTURE** column (only when Wireshark is installed).
- Toast via the tray when the toned host flips state while the HUD is hidden. `backgroundThrottling` is now off so the monitor keeps time from the tray — it used to slow to once a minute after ~5 min hidden, which also weakened the tray flash.

**SCAN**
- Vendor ports 8000 / 37777 / 1756 / 5500 in the probe, with badges. Dahua / Bosch RCP+ hits classify as CAMERA, Genetec Directory as SERVER.
- **COPY ▾** exports the result list as CSV or markdown.
- **CAPTURE** action per row.
- Fix: port-based type guessing never ran for hosts with no vendor (an early return skipped it). Fix: SITES change detection now sees every open port, not just the badge-only ones — ports with an action button (OPEN / RDP / SSH) were being dropped from the site record.

**SITES**
- **WAKE** (Wake-on-LAN) in the device drawer. Magic packet to the limited broadcast and every interface's directed broadcast, logged.

**Housekeeping**
- tracert now refuses a host starting with `-` (ping already did) and strips a `:port`.
- PING help text said "TCP 80, not ICMP"; the code does ICMP first. Help now matches, and every new control has a help row.

### v7.0.1
- Release binaries are code-signed in CI (Azure Artifact Signing, publisher Johan Broman). No functional change. IT can now whitelist by publisher instead of per-version hash — see RELEASING.md.

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
- PING: **♪ toner** on each row — hear one host: sonar on every reply, submarine alarm when it drops, a sweep on each change. Web Audio only, no files. For pulling cables at a switch with the laptop across the room.
- SCAN: rows stay sorted by IP as they arrive. Randomised (private) MACs are labelled as such instead of Unknown.
- Titlebar yields on the left (chip, then logo) so ─ ✕ never clip; minimum width 340. Vector tab icons — crisp at any DPI and theme-coloured.
- DHCP: the laptop's own DHCP client no longer appears in the device table (its REQUESTs still feed rogue-server detection).
- Security: imported site JSON is sanitised at import (site IDs, MACs, IPs forced to shape; strings bounded) — imported identifiers reach inline handlers where HTML escaping isn't protection. CSP meta tag (`connect-src 'none'`). Adapter lookups match the exact netsh interface name ("Ethernet" no longer matches "Ethernet 2"). Ping host can't start with `-`. Electron lock bumped to 41.10.x.

**Docs**
- README, quick guide, TESTING.md (new DHCP checklist and IT notes for UDP 67 + the firewall rule). Full Guide (docx + PDF) rewritten for v7 — document version 4.0; its generator now lives in `docs/build-guide.js`.

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
