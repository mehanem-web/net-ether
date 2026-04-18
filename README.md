# NET//ETHER — v6.0.0
**Broman Enterprises**

An always-on-top desktop network utility for Windows. Built for field technicians who need to switch IP configurations, scan subnets, and track site device inventory on the job.

**Requires Windows 10 / 11**

---

## TABS

### ETHER
Manage static IP configuration for any network adapter.

- **Presets** — 4 slots (LIVE, +3 saved). LIVE auto-populates from the active adapter and never persists to disk
- **Adapter dropdown** — lists all adapters with live status, IP, and connection state
- **APPLY CONFIG** — applies static IP/subnet/gateway/DNS via UAC elevation
- **DHCP** — switches the adapter back to DHCP in one click
- **MTU** — reads current MTU and resets to 1500 if needed (fixes the classic "can ping but can't browse" symptom)
- **CMD** — shows raw netsh commands without running them; copy/paste into Admin CMD if UAC is unavailable
- **REVERT** — snapshots your config before applying; one click to restore if something breaks
- **Multi-IP** — expandable section to add/remove secondary IP aliases on any adapter, useful for reaching devices on a different subnet without changing your primary address

---

### PING
Continuous connectivity monitor.

- Up to 8 hosts, configurable interval (1s / 2s / 5s / 10s)
- Tracks latency, packet loss %, and a per-host sparkline history
- Uses TCP port 80 connect rather than ICMP — works through firewalls that block ping
- PAUSE freezes display without clearing data; STOP resets everything
- Tray icon animates on ping failure
- **TRCRT** — per-host traceroute, runs inline below the host row

---

### SCAN
Subnet scanner.

- ICMP ping sweep + ARP cache sweep (catches devices that block ping)
- Configurable host range (default 1–254)
- Port probe on 10 common ports: 80, 443, 554, 8080, 8443, 3389, 22, 23, 21, 8888
- Smart action buttons per host: OPEN (HTTP/HTTPS), RDP, RTSP (copies stream URL), SSH (copies command)
- Vendor lookup from offline 57K-entry IEEE OUI CSV — falls back to macvendors.com, caches locally
- **SAVE SITE** — saves scan results to the Sites library

---

### SITES
Persistent site knowledge base.

- **Site list** — named sites with customer, address, contact, and subnet
- **Device roster** — tracks devices by MAC address, not just IP
- **Change detection** — after every scan, automatically flags NEW / MISSING / MOVED devices
- **Device notes** — freeform text per device, persists forever
- **Credentials** — per-device key/value pairs stored locally (e.g. `web UI: admin/admin123`)
- **Device type tags** — CAMERA, NVR/DVR, NETWORK, SERVER, WORKSTATION, ACCESS CTL, PRINTER, OTHER
- **▶ SCAN NOW** — jumps to SCAN tab with the site's subnet pre-loaded
- **EXCEL** — exports all site and device data to `.xlsx`
- **IMPORT** — import sites from a JSON backup

Data stored in `%APPDATA%\net-ether\intel.json` — local only, never transmitted.

---

## DATA FILES

All data stored per-user in `%APPDATA%\net-ether\`

| File | Contents |
|------|----------|
| `presets.json` | Saved preset slots 1–3 (LIVE is never persisted) |
| `sites.json` | SCAN tab site library |
| `intel.json` | SITES knowledge base |
| `vendor-cache.json` | Cached macvendors.com lookups |
| `last-snapshot.json` | Last applied config snapshot (for REVERT) |

---

## CHANGELOG

### v6.0.0
- **BREAKING** — Migrated all `wmic` calls to PowerShell `Get-CimInstance`. `wmic` was removed in Windows 11 24H2; this update is required for compatibility on modern systems. Affects DHCP/static detection, adapter description filtering, GUID lookups, and snapshot/restore.
- **FIX** — Port probe ECONNREFUSED no longer reported as open. Closed ports now correctly show as closed.
- **FIX** — `snapshotAdapterConfig()` now uses sanitized PowerShell instead of raw `exec()` with unsanitized adapter names.
- **FIX** — Scan result IPs, MACs, and known-defaults chips now escaped via `escHtml()` to prevent XSS.
- **FIX** — `wmic` references removed from code comments.

---

© 2026 Broman Enterprises
