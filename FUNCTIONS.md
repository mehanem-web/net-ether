# NET//ETHER — FUNCTIONS (behavior spec)

*What every control does, in order, with its side effects. Not a guide — the
Guide tells you how to use the app; this says what the app does when you press
something. Current as of **v7.1.0**. Update the row when the behaviour
changes; the diagnostics `tag` column is the link to COPY DIAGNOSTICS output.*

Columns: **Elevated** = runs through `runElevated()` (direct netsh when the app
is High-integrity, UAC prompt otherwise). **On the wire** = packets the laptop
sends because of this control. **Logged as** = entry kind/tag in the diagnostics
log (OP = privileged command with full output, VERIFY = result check, APP = event).

---

## Always on (no button)

| Behaviour | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| Launch | `userData` pinned to `%APPDATA%\net-ether`; single-instance lock (a second launch focuses the first); elevation detected from `whoami /groups`; launch snapshot of every adapter's config written; policy key read; Wireshark/tshark located and version read; leftover REACH aliases and SILENT bindings from a crashed run cleaned up (elevated only) | — | nothing | APP `launch`, APP `tools`, APP `policy`, APP `reach`/VERIFY `recon-rebind` if leftovers |
| Window position | Last position restored and clamped inside that display's work area; last *narrow-tab* width restored; height always fitted to content — a fit that would cross the bottom moves the window up instead. Wide tabs (SCAN/SITES ≥640, DHCP ≥820) enforce a minimum width, never shrink a wider window, and hand the narrow width back on leaving | — | — | — |
| LIVE poll | Every 15 s while the ETHER tab is on the LIVE preset **and the window is visible**: `netsh interface show interface`, `netsh interface ip show config`, one `Get-NetAdapter -IncludeHidden` (speed, media, descriptions), registry `EnableDHCP` per adapter | no | nothing | — |
| Tray | Minimize (─) hides to tray; tray click restores; icon animates red while any PING target is failing | — | — | — |
| Version chip | Amber when the app is **not** elevated (every netsh will prompt UAC) | — | — | — |
| Always-on-top | Re-asserted on focus/show when another window stripped it | — | — | APP `window` |
| Quit (✕) | Warns if MULTI-IP aliases are still on an adapter (second ✕ within 15 s quits anyway) and if the config differs from launch; DHCP engine shut down (firewall rule removed); REACH aliases removed (+ adapter back to DHCP if REACH converted it); tshark allowed to exit, then SILENT bindings restored with retries and verified (message box if that fails); diagnostics flushed; hard-exit watchdog | yes (cleanups) | nothing | OP `dhcp-fw-del`, OP `reach_del`, OP `recon-rebind`, VERIFY `recon-rebind` |

## Title bar

| Control | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| Version chip (click) | Menu: DIAGNOSTICS, FIT WINDOW, SITE REPORT | — | — | — |
| → DIAGNOSTICS | Overlay: STATE (version, elevation, user/host, paths, tools, policy, DHCP engine, file sizes) + LOG (last 200 entries). COPY puts both on the clipboard; CLEAR LOG empties the ring | — | — | APP `log-cleared` |
| → FIT WINDOW | Re-enables auto-fit and sizes the window to content | — | — | — |
| → SITE REPORT | Markdown to clipboard: adapter + switch, scans this session with site changes and the last result table, RECON verdicts, DHCP leases, PING stats, every OP/VERIFY/ERROR since launch | — | — | — |
| ◐ theme | Cycles the 6 presets; custom palette via the picker; stored in `localStorage` | — | — | — |
| ▣ opacity | Steps window opacity | — | — | — |
| ? | Help overlay for the current tab | — | — | — |
| ─ | Hide to tray (not a real minimize — `skipTaskbar` would make that unrecoverable) | — | — | — |
| ✕ | Safe quit (see Always on) | — | — | — |

---

## ETHER

| Control | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| Presets LIVE / 1–3 | LIVE mirrors the selected adapter's current config (never saved). Slots 1–3 load into the form; SAVE writes the form to the slot (`presets.json`) | — | — | — |
| FACTORY DEFAULTS ▾ | Panel of known vendor defaults (incl. link-local Axis). Click a tile → IP/mask fill with "YOU" address beside the device's | — | — | — |
| Adapter selector | Lists wired adapters (Wi-Fi/VPN filtered). State: **link speed** when connected (green ≥1 G, amber 100 M, red 10 M), **NO ADDRESS** (link but nothing bound), DISCONNECTED (no link), DISABLED. DHCP/STATIC badge from the registry, shown with or without link; → DHCP action when static, **RENEW** (`ipconfig /renew`) when DHCP with no address | yes (RENEW) | DHCP request (RENEW) | OP `renew`, VERIFY `renew` |
| ⟳ | Re-reads adapters (same calls as the LIVE poll) | no | nothing | — |
| WI-FI chip | Shown when a real wireless adapter exists (ghost "Not Present" entries ignored; state from `Status`). Click → modal → `netsh interface set interface "<wifi>" admin=disabled` (or enabled) for every Wi-Fi adapter → admin state polled ≤6 s. Chip is amber **WI-FI OFF** while any is disabled; it survives reboots | yes | nothing | OP `adapter-disable`/`adapter-enable`, VERIFY |
| DISABLE / ENABLE chip | Modal (louder if it's the adapter in use) → `netsh interface set interface "<n>" admin=…` → poll ≤6 s → list refresh. Refused while the DHCP engine is serving on that adapter | yes | nothing | OP `adapter-disable`/`adapter-enable`, VERIFY |
| IP / SUBNET / GATEWAY / DNS fields | Validated live (renderer) and again in main before any netsh. 169.254.x.x allowed (mask note). Changes mark the form dirty | — | — | — |
| APPLY CONFIG | Snapshot current config (for REVERT) → duplicate-IP check (ARP for the target) → `netsh interface ip set address "<n>" static <ip> <mask> [gw]` (+ `set dns … validate=no`) → verify via netsh, registry fallback → history entry | yes | 1 ARP probe for the duplicate check | OP `apply`, VERIFY `apply` |
| → DHCP (badge or button) | `netsh interface ip set address "<n>" dhcp` + `set dns dhcp` → verify | yes | DHCP DISCOVER by Windows | OP `dhcp`, VERIFY `dhcp` |
| REVERT | Re-applies the pre-APPLY snapshot (static fields or back to DHCP) | yes | as APPLY | OP `revert`, VERIFY `revert` |
| MTU → 1500 | `netsh interface ipv4 set subinterface "<n>" mtu=1500 store=persistent` → MTU re-read | yes | nothing | OP `mtu`, VERIFY `mtu` |
| CMD / COPY COMMANDS | Shows/copies the exact netsh lines APPLY would run; nothing executes | — | — | — |
| RESTORE LAUNCH STATE | Diffs every adapter against the launch snapshot; lists the deltas; on confirm re-applies the launch config per adapter (incl. MTU) | yes | as APPLY | OP `restore`/`restore_mtu`, VERIFY |
| MULTI-IP ▾ | Peek: `netsh interface ip show addresses` for the adapter, re-read after every APPLY / → DHCP / REVERT / alias op and with the LIVE poll while open; PRIMARY = the address holding the gateway (never offered for REMOVE); others get COPY / REMOVE | no | nothing | — |
| ADD MULTI-IP | Mask auto-suggested /24 (primary's mask if inside its network, /16 for 169.254). If the adapter is DHCP: two-click arm, then `set address static <current>` first. Then `netsh interface ip add address "<n>" <ip> <mask>` → alias polled 5 s | yes | nothing | OP `alias_add`, VERIFY `alias_add` |
| REMOVE (alias) | `netsh interface ip delete address "<n>" <ip>` → polled 5 s. An address Windows already dropped (e.g. after → DHCP) reports "already gone" and refreshes the list | yes | nothing | OP `alias_del`, VERIFY `alias_del` |
| CMD (alias) | Shows the add command for copy/paste when elevation isn't available | — | — | — |

---

## PING

| Control | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| Target fields (≤8) | `IP`, `hostname`, or `IP:port`. Leading `-` refused in main (would become a ping flag) | — | — | — |
| + GATEWAY / + MY IP | Fill the next free target from the selected adapter | — | — | — |
| EVERY 1S/2S/5S/10S | Cycle interval. Each cycle pings every target in parallel and waits for the slowest | — | — | — |
| ▶ START | Per plain target: `ping -n 1 -w 1000` → if no reply, TCP connect to port 80 (refused counts as alive). Per `host:port` target: TCP connect to that port (1.5 s) → refused or timed-out → alive check (ping 0.6 s, TCP 80 0.8 s) → **CLOSED** if the host is up, **FAIL** if not. Tooltip on LAST says why | no | ICMP echo + TCP SYNs per cycle | — |
| ⏸ PAUSE / ■ STOP | PAUSE freezes the display, keeps data. STOP clears everything (data, toner, blink) | — | — | — |
| Status line | `ALL TARGETS ONLINE`, or `ALERT — n DOWN · x% LOSS · m CLOSED` (CLOSED is not counted as loss). Held messages (BLINK/capture warnings) keep it 4 s | — | — | — |
| TRCRT | `tracert` on that host (port stripped), output in a panel under the row; one tracert at a time | no | ICMP with rising TTL | — |
| ♪ TONER | One host: sonar blip per reply (pitch sags with latency, 1250 Hz → ~650 Hz at 300 ms+), alarm when it stops, sweep on each change. Toast via the tray when it flips while the HUD is hidden | — | — | — |
| ⚡ BLINK | Shown while a host is toned. 20 s of ~25 UDP/s to that host's port 9 so its switch-port LED strobes; click again stops. Own subnet only; refuses this machine's own address | no | UDP 9 burst | APP `blink` |
| ◉ (per row) | Wireshark on the adapter carrying that host, `-f "host <ip>"`. Only when Wireshark is installed | no | nothing | APP `wireshark` |
| COPY | Results summary to clipboard | — | — | — |

---

## SCAN

| Control | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| Site chip / BASE IP / range | Base = the first three octets; range default 1–254; last site auto-detected from the adapter's subnet | — | — | — |
| ▶ SCAN SUBNET | Opening the tab widens the window to 640 (SITES too; back to your width on leaving). Library rows for a known site drawn first (CACHED). Then: 32-wide `ping -n 1 -w 300` sweep + `arp -a` enrichment (catches ping-blocking hosts) + MAC vendor (57K offline OUI; macvendors.com if ONLINE VENDOR LOOKUP is on and policy allows). Discovery (below) fires alongside. After the sweep: 14-port TCP probe per host (80 443 554 8080 8443 3389 22 23 21 8888 8000 37777 1756 5500), hostnames (reverse DNS 1.5 s ‖ NetBIOS UDP 137 1.2 s), SELF badge, change detection against the site (NEW/MISSING/MOVED chip) | no | ICMP ×254, TCP SYN ×14/host, UDP 137 /host, HTTPS to macvendors.com (optional), multicast discovery | APP `resolve`, APP `discover` |
| ■ STOP | Kills the sweep, keeps rows found so far | — | — | — |
| ◎ DISCOVER (beside SCAN SUBNET) | Standalone discovery: WS-Discovery/ONVIF probe (UDP 3702), SSDP M-SEARCH (UDP 1900), mDNS query (UDP 5353), sent from every IPv4 on the adapter, 3 s listen. Answers merge into rows (badge, name, model, URLs, services); off-subnet answerers get their own row with the source where the ms would be; rows that answered pulse; ≤6 are listed in the status. On-subnet rows found this way get a port probe | no | 3 multicast datagrams per adapter address | APP `discover` |
| ONLINE VENDOR LOOKUP | Toggle for macvendors.com fallback; greyed when policy `DisableOnlineVendorLookup` is set | — | — | — |
| Row: IP / MAC / PING / WSHARK | Copy IP; copy MAC; add to PING and start; Wireshark with `host <ip>`. The four wrap as one unit. On rows ≥600 px wide the MAC shows beside the IP | no | — | APP `wireshark` |
| Row: smart actions | OPEN (http/https in the browser), RDP (`mstsc`), RTSP (URL copied), SSH (`ssh <ip>` copied), FTP (URL copied) — from the probe; vendor ports show as badges | no | — | — |
| Row: REACH | 169.254 rows only. Modal (warns about DHCP→static) → `reach-add`: picks a free 169.254.x.y, adds it as a MULTI-IP alias /16, records it in `temp-aliases.json`, opens `http://<ip>`. Amber LINK-LOCAL chip with REMOVE; removed on quit or next launch, adapter returned to DHCP if REACH converted it | yes | nothing (then the browser's HTTP) | OP `reach_add`, VERIFY, APP `reach` |
| LINK-LOCAL chip → REMOVE | `reach-clear`: delete the alias (+ `set address dhcp` if converted) | yes | nothing | OP `reach_del`, APP `reach` |
| COPY ▾ | CSV or markdown of every row (IP, hostname, MAC, vendor, type, open ports, response) to clipboard | — | — | — |
| SAVE SITE / UPDATE SITE | Writes rows into the site library (`sites.json`) and the SITES knowledge base (`intel.json`): devices anchored by MAC, first/last seen, ports, announced type; SELF row skipped; MAC-less twins dropped | — | — | APP `sitekb-save` |
| CLEAR | Empties results, port map, discovery map | — | — | — |
| Changes chip → VIEW / ✕ | Jumps to that site in SITES / dismisses | — | — | — |

---

## SITES

| Control | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| Site list / open | Sites from `intel.json` (format 2, credentials DPAPI-encrypted). Auto-imported from the SCAN library on first open | — | — | — |
| SCAN NOW | SCAN tab with the site's subnet pre-loaded | — | as SCAN | — |
| DELETE (site) | Confirm → backup of `intel.json` → site and its device records removed | — | — | APP `backup` |
| Device row → drawer | MAC, hostname, first/last seen, open ports, notes, credentials (masked, reveal per field), type badge (click cycles; a hand-set type is never overwritten by a scan) | — | — | — |
| SAVE | Writes the device | — | — | — |
| WAKE | Magic packet (6×FF + MAC×16) to UDP 9 at 255.255.255.255 and every interface's directed broadcast | no | 2+ UDP broadcasts | OP `wol` |
| REMOVE DEVICE | Removes the device from the site | — | — | — |
| + ADD CREDENTIAL / ✕ | Key/value pairs, encrypted at rest with Windows DPAPI (user-bound) | — | — | — |
| EXCEL | `.xlsx` export of sites/devices (no credentials) | — | — | APP `export` |
| JSON | Export; WITH CREDS option writes **plaintext** credentials | — | — | APP `export` |
| IMPORT | File dialog → validated and sanitised (site ids, MACs, IPs forced to shape) → backup → MERGE (MAC-anchored, existing wins, blanks filled) or REPLACE | — | — | APP `import`, APP `backup` |

---

## DHCP

| Control | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| Tab opened | Engine starts in LISTEN: firewall rule `NET-ETHER-DHCP-UDP67` added if missing, UDP 67 bound. Nothing is answered. The DHCP tab's dot shows the engine from every tab: red OFFLINE, green LISTENING, amber SERVING | yes (firewall) | nothing | OP `dhcp-fw-add`, APP `dhcp` |
| Mode badge (engine switch) | OFFLINE ↔ LISTENING; SERVING when serving; **SUSPENDED** while RECON SILENT has the adapter (socket closed, rule kept, resumes to the previous mode by itself). Dot is a theme-independent traffic light. Off → rule removed, socket closed | yes (firewall) | nothing | OP `dhcp-fw-del`, APP `dhcp` |
| SERVE ON adapter + ⟳ | Adapter list with every IPv4 (primary first). Choosing an adapter (or ⟳, or the adapter's addresses changing while not serving) fills the settings; with a MULTI-IP alias present a modal asks which address to serve from | — | — | — |
| Settings / profiles | Server IP, mask, lease, pool start/end, gateway, advanced (DNS, options). Validated in main. Profiles saved in `dhcp-config.json` | — | — | — |
| ⚡ QUICK START | Picks the best adapter, sets a static address if needed via ETHER's apply path (with crash recovery), fills a pool, starts serving | yes | as APPLY + DHCP | OP `apply`, APP `dhcp` |
| ▶ SERVE ALL DEVICES | Rogue-server scan first (DISCOVER probe, 2-minute memory of foreign servers) → gate modal if another server answered → serve-all | no | 1 DHCP DISCOVER, then OFFER/ACK per client | APP `dhcp-scan`, APP `dhcp` |
| SERVE (row) / ▶ SERVE SELECTED | Serve only that MAC / the ticked MACs (targeted mode). Ping-before-offer; DECLINEs quarantine the address; NAK only for leases that are ours; own MAC ignored | no | ICMP before each offer, OFFER/ACK | APP `dhcp` |
| ★ PIN / ✕ | Reservation for a MAC / release it (`dhcp-config.json`) | — | — | — |
| ★ RESERVE SELECTED | Start address prompt → consecutive reservations for the ticked devices in list order; server IP, gateway and existing reservations skipped | — | — | — |
| ◎ SCAN WIRE | The rogue-server probe on its own | no | 1 DHCP DISCOVER | APP `dhcp-scan` |
| ⚕ SELF-TEST | Checks: elevation, socket bound, firewall rule, adapter address, pool sanity | no | nothing | — |
| ✕ RELEASE ALL | Clears every lease from memory | — | — | — |
| ⎘ CSV / ⎘ LOG | Device table / engine log to clipboard | — | — | — |

---

## RECON

| Control | What happens | Elevated | On the wire | Logged as |
|---|---|---|---|---|
| STANDARD / SILENT | STANDARD: adapter untouched (Windows still sends DHCP/NetBIOS/LLMNR). SILENT: the DHCP engine is suspended first if it's running, then `Disable-NetAdapterBinding -ComponentID ms_tcpip,ms_tcpip6` on the ETHER adapter for the listen, state in `recon-silent.json`. Restore (after the listen, on stop, on quit after tshark exits, on the next elevated launch): `Enable-NetAdapterBinding` with 3 retries → `Get-NetIPInterface` must show IPv4 → else toggle `ms_tcpip` again + `Restart-NetAdapter` → if DHCP and still no address after 3 s, `ipconfig /renew`. Failure at quit = Windows message box | yes (SILENT) | DHCP request (renew) | OP `recon-unbind`, OP `recon-rebind`, VERIFY `recon-rebind`, APP `recon-renew` |
| ▶ LISTEN / ■ STOP | tshark on `\Device\NPF_{guid}` for up to 65 s, capture filter limited to LLDP/CDP/EAPOL/STP/ARP/802.1Q/IGMP and UDP 67/68/137/5353/5355/1900/123 (nothing else reaches a dissector), display filter on the same, JSON streamed; evidence pushed to the UI every ~1.5 s; stops early on click. Needs Wireshark 4.6+ (button dimmed with the reason otherwise) | no | nothing | APP `recon` (summary) / ERROR `recon` |
| Cards | SWITCH (LLDP/CDP name · port · VLAN, or "no announcement"), 802.1X (EAPOL seen), STP / TRUNK (BPDUs, PVST VLANs, tagged frames), VLAN, DHCP (servers, gateway, mask, DNS heard; "clients asking, nobody answering"), HOSTS per /24, ADDRESS (free-looking IP), NAMES (NetBIOS/mDNS), NTP | — | — | — |
| TAKE | Fills ETHER's IP/mask/gateway from the ADDRESS card and switches tab; nothing applied | — | — | — |
| WIRESHARK | Wireshark on the whole adapter, no filter | no | nothing | APP `wireshark` |
| COPY | Verdicts as text | — | — | — |

---

## Files (`%APPDATA%\net-ether\`)

| File | Written by |
|---|---|
| `presets.json` | ETHER preset SAVE |
| `sites.json` | SCAN → SAVE SITE |
| `intel.json` (+ `backups/`) | SITES; backup before delete/import |
| `dhcp-config.json` | DHCP profiles, reservations, settings |
| `vendor-cache.json` | macvendors.com answers |
| `launch-snapshot.json` / `last-snapshot.json` | launch config / pre-APPLY snapshot |
| `temp-aliases.json` | REACH aliases pending removal |
| `recon-silent.json` | SILENT bindings pending restore |
| `diag-log.json` | diagnostics ring (200 entries) |
| `window-state.json` | position, display, narrow width |
