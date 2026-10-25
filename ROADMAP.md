# NET//ETHER — Roadmap

## Delivered in 7.2.0 (2026-10-24)
DHCP tab rework (① card / ② laptop address, plain wording, lease in plain time, one-device flow with the address typed on the row, ↗ OPEN, ✓ STATIC detection, model + firmware from the DHCP request, SERVE EVERYONE… confirm-first, QUICK START folded into SET LAPTOP IP… / + ALIAS), stale-settings guard, passive wire watch (mDNS from 5353 + announcements, SSDP NOTIFY, ARP and device LLDP via tshark) with ◇ SITTING rows and REACH to any subnet, wrong-address warning with HEAR THE WIRE on the IP tab, link-local SCAN note, ETHER tab renamed IP, spawn-latency work (launch instrumentation, `cmd /c ver` self-check in DIAGNOSTICS, persistent PowerShell worker, parallel + batched adapter reads, dev latency injector `dev-slow.bat`). Details and reasoning below.

## Still open after 7.2.0
- Bench: everything in TESTING.md § 7.2.0 on the work laptop — especially the PowerShell worker under EPM/CLM, ◇ SITTING for a camera on a fallback static, and ✓ STATIC on a real Axis/Bosch.
- Spawn latency, the rest: SCAN still launches one `ping.exe` per address (ICMP needs a raw socket Node doesn't have) and the DHCP engine pings each candidate before an offer; both are bounded and parallel, but they are the next things to measure with the injector. Async UI: a full pass over every tab for anything that waits on a launch before drawing.
- Elevated PowerShell (RECON SILENT rebind) still launches one-shot — correctness first, it's rare.

## Delivered in 7.1.0 (2026-10-03)
RECON tab (LLDP/CDP switch identity, 802.1X, STP/trunk, DHCP heard, hosts, free-address suggestion, STANDARD/SILENT), multicast discovery (WS-Discovery/ONVIF, SSDP, mDNS) with REACH for link-local devices, link-speed chip, WI-FI and DISABLE/ENABLE chips, NO ADDRESS/RENEW, `host:port` ping targets, PORT BLINK, toner pitch by latency, hidden-HUD toast, vendor probe ports, scan CSV/markdown, WSHARK per row, MEDIA type, Wake-on-LAN, serve-from-alias, batch reservations, DHCP tab dot, site-visit report, FUNCTIONS.md, Electron fuses, RECON capture filter, CI on Node 22.

## Still open after 7.1.0
- Bench verification: RESERVE SELECTED, BLINK on a lit switch, REACH on a factory-default camera, RECON on a managed port (SWITCH/STP/TRUNK/802.1X cards). Fixes → 7.1.1.
- Fleet pre-seeding of a site database from ProgramData; DHCP option 121 (classless static routes).
- Scanner beyond /24 (link-local /16 needs discovery, not a sweep — DISCOVER covers the camera case).
- Tutorial video script from FUNCTIONS.md.

## 7.2.0 — the plan as agreed (2026-10-14 → 2026-10-24), all shipped

Theme: get into a device the way AXIS IP Utility users expect, in as few steps as
possible, and stop feeling frozen on locked-down laptops.

### 1. Hear every device on the wire (the IP Utility gap)
Today DISCOVER probes and waits for a unicast reply. A device on its fallback
address (192.168.0.90, a last-site static) often can't route a reply to a laptop
on another subnet, so we miss it; link-local devices usually can reply, which is
why it works "sometimes". AXIS IP Utility listens to what devices broadcast to
the whole wire, so it always sees them.
- mDNS: query from port 5353 asking for multicast answers (not legacy unicast);
  keep a listener on 224.0.0.251:5353 for announcements.
- SSDP: listen for NOTIFY on 239.255.255.250:1900, not just M-SEARCH replies.
- ARP: passive listen via tshark (npcap fleet-wide) picks up senders on any subnet.
- Fix the stale comment in `discover.js` that says unicast replies arrive regardless of IP.
- Bench first: power-cycle the Axis device with a capture running, laptop on an
  unrelated static, and log exactly what it sends (DHCP cadence, fallback address,
  mDNS/SSDP timing). Build to that.

### 2. DHCP tab rework (mock: "ETHER DHCP Rework" canvas)
- ① NETWORK CARD (the cable) and ② LAPTOP'S ADDRESS ON THAT CABLE (chips: current
  address, + ALIAS) — makes "the laptop is the server" obvious. Cable strip:
  `LAPTOP 192.168.0.1 ── Ethernet 2 ── DEVICES GET .100–.200`.
- Wording: LAPTOP PORT / LAPTOP IP / FIRST / LAST / GATEWAY (BLANK = LAPTOP). No "server".
- Example and default subnet 192.168.0.x; ARP-check .1 before taking it, offer the next free.
- Lease as a dropdown in plain time (1 min … 1 day), default 5 min.
- One device is the default flow: rows carry the bright actions. SERVE EVERYONE…
  becomes a small amber confirm-first button; QUICK START removed (its no-address
  fix and alias live in step ②).
- Asking row: editable IP pre-filled with the next free address (serve the address
  it will end up on, so going static doesn't change it). Auto-advance after each serve.
- Served row: bright ↗ OPEN (`http://<ip>`, device redirects to HTTPS itself).
- "Went static" detection: still answering at the IP, stopped renewing → ✓ STATIC,
  lease released.
- New row type from §1: ◇ SITTING AT <ip> — not asking → REACH (alias on its subnet) → OPEN.
- Status chip in words: OFF / LISTENING / SERVING N. Engine still starts on tab open,
  off by default. STOP SERVING (N) appears only while serving.

### 2b. Findings from the A1210 bench capture (2026-10-24)
- AXIS OS 12 asks for DHCP every 3 s for ~60 s, pauses ~20 s, repeats, indefinitely;
  requests its last address; falls back to link-local only (no 192.168.0.90).
  Announces via mDNS on every new address; LLDP every 30 s.
- AXIS IP Utility = plain mDNS queries from port 5353 (`_vapix-https`, `_vapix-http`,
  `_axis-video`, `_axis-nvr`, `_axis-bwsc`, `_2n-os-http(s)`). It did NOT find the
  device while it was link-local only; it found it the moment ETHER served it.
- Show model + firmware from the DISCOVER itself (option 60 vendor class
  `AXIS,Network Door Controller,A1210,12.2.63.19`, option 12 hostname) on the row,
  before the device has an address.
- **Stale settings guard (bug):** the tab served yesterday's site settings (server
  192.168.4.195, pool 192.168.4.x) while the laptop was 10.99.99.10. The device couldn't
  reach its "server" to renew and renewed only by broadcast fallback. On tab open and
  before any serve: if the server address isn't on the selected card, refill from the
  card, or show amber "settings from last job — 192.168.4.x isn't on this card" with
  REFILL / + ALIAS. Never serve a pool the card has no address on.

### 3. Wrong-address warnings (the dock / corp-lease case)
- Selected card holding an old corp lease whose gateway doesn't answer, or on
  169.254.x: amber line on the card + one-click SET STATIC.
- Subnet hint from §1's passive listen: "heard devices on 192.168.1.x — set laptop
  to 192.168.1.250?"
- SCAN from an APIPA address says it's link-local only, so empty ≠ no devices.

### 4. Rename the ETHER tab → IP
- Techs look for "IP", not "ETHER". Bar becomes `IP · PING · SCAN · SITES · DHCP · RECON`.
  App name stays NET//ETHER; internal panel id stays `net`.
- Decided 2026-10-24: plain IP (LAPTOP IP considered and dropped — plain, no ambiguity).
- Not the long form of the word: it's on the stale-ref grep list.
- Sweep the Guide, FUNCTIONS.md, quick guides and tutorial narration for "ETHER tab".

### 5. Spawn latency (found 2026-10-14, coworker's Vostro 7590)
Every process launch on a managed laptop is expensive (Defender + MDE + EPM + 13 ASR
rules). One bad box (orphaned Deep Instinct drivers) made it extreme: `cmd /c ver`
~2 s, bare PowerShell ~4 s; ETHER felt frozen after launch. Not CPU/GPU —
`--disable-gpu` changed nothing.
1. Persistent PowerShell worker — one hidden PS at startup, commands over
   stdin/stdout with delimiters. Must stay Constrained Language Mode compliant.
2. Node-native where possible — `os.networkInterfaces()`, socket/native ping
   instead of `ping.exe` per host, bulk ARP reads.
3. Batch — adapter + IP + DHCP state in one round trip.
4. Async UI — never block a tab on a spawn; render with loading states, fill in.
5. Spawn-latency self-check — time `cmd /c ver` at startup, show it in diagnostics.
6. Dev latency injector — env var adds ~2 s per spawn, to reproduce on dev + lab VMs.
Next: audit every exec/spawn/execFile — what it runs, which tab, how often — then
sort into worker / native / batch.

---


Ideas for the next major, collected during the v7.0.0 field trial (2026-09-28).
Nothing here is committed to a version. Order is rough value-per-effort for a
technician in the field.

## Discovery

- **ONVIF / WS-Discovery.** UDP multicast probe on 3702; cameras answer from any
  IP on the wire — APIPA, last-site static, a router you can't see — with model,
  IP and hardware ID. Same pass for SSDP and mDNS (NVRs, printers, Apple). Pure
  `dgram`, no native deps. Solves the 169.254/16 problem without sweeping 65k
  hosts. Biggest single gap for a camera tech.
- **Vendor ports in the probe.** Add 8000 (Hikvision), 37777 (Dahua), 1756/1757
  (Bosch RCP+), 5500 (Genetec unit), 8443. Sharper type guessing, more "is it
  alive" answers.

## Adapter row

- **Link speed chip.** `Get-NetAdapter` `LinkSpeed`: 1 Gbps green, 100 Mbps
  amber, 10 red. A gigabit port negotiating 100 is a bad cable/crimp/port and
  it's the first thing an experienced tech checks.
- **Enable / disable adapter.** `netsh interface set interface "<name>"
  admin=disabled|enabled` through `runElevated`, verified and logged. Standard-user
  techs can't do this any other way; "kill Wi-Fi so the scan and the DHCP serve
  stay on the bench switch" is the daily case.
- **Switch + port (LLDP/CDP)** — see RECON below; this is its first slice. npcap is fleet-installed for Wireshark, so
  `tshark.exe` is available: `tshark -i "<adapter>" -a duration:35 -Y lldp -T
  fields -e lldp.tlv.system.name -e lldp.port.id -e lldp.port.desc` (and `-Y cdp`
  for Cisco). One execFile, no native module. Chip: `SW: CORE-SW-2 · Gi1/0/17`.
  Degrades gracefully when Wireshark isn't installed.

## RECON — learn the wire before touching it

Plug in, send nothing, know the network. A promiscuous capture on the adapter
(`tshark` via npcap, fleet-installed) for a minute or two, reading only what the
switch sends the port — broadcasts, multicasts, flooded unicast:

- switch name, management IP, your port, port VLAN (LLDP / CDP)
- live subnet(s) and the gateway (ARP who-has / DHCP offers seen)
- device MACs → vendors, hostnames (NetBIOS, mDNS), NVRs/printers (SSDP)
- whether DHCP exists here and who serves it

**Zero-transmit rule:** RECON never sends a packet. No address on the adapter
while it listens, DHCP engine off, no ARP, no probes. Wireshark with a summary —
and Wireshark is already on every fleet laptop. If IT's closet alarms fire, it
was the cable going in, and RECON says so up front.

**Output is verdicts, not protocols.** The tech never sees "EAPOL" or "BPDU":

- "Port needs IT sign-off before you plug in a device (802.1X)." — EAPOL
  Request-Identity seen; the port will shut or quarantine an unknown device.
- "Safe for a device — VLAN 20, 10.0.30.x, DHCP present, gateway 10.0.30.254."
- "This is a trunk / has BPDU guard — don't hang a switch off it." — 802.1Q tags
  on the port / STP guard evidence.
- "Time server at 10.0.60.5." — NTP seen; wrong-time cameras are a top-five call.
- "Two devices claim 10.0.30.40." — passive ARP conflict.
- "Unusual: IPv6 router on this VLAN." / "Heavy multicast — an NVR pulling
  streams here?" — one line, one colour, no graphs.
- "Expected 14 devices from SITES, hearing 11, plus 2 never seen."
- "Your MAC is now visible on CORE-SW-2 port 17." — the honest line.

Result: a one-screen "this is what you plugged into" and a button to take a
sensible address on that subnet. Windows still chatters on a bound adapter; the
tester trick is a NIC with no IPv4 bound — receives everything, originates
nothing. Worth offering as the RECON entry mode. Grows out of the LLDP item and
replaces it.

## Wireshark hand-off

- **OPEN IN WIRESHARK** from the adapter row (whole adapter) and from SCAN /
  PING rows (`-f "host <ip>"`): `Wireshark.exe -i <adapter> -k -f "<filter>"`.
  Not a capture engine of our own — just one click from "camera's acting weird"
  to a live filtered capture in the tool the fleet already has.

## DHCP

- **Serve from an alias.** Let the SERVE ON picker choose a Multi-IP alias as
  the server address, and offer to add one when the pool is off the primary
  subnet. Pre-stage cameras on their production subnet while the laptop keeps its
  own address; renewals, probes and browsing all work because the server is on
  the client subnet. (Serving off-subnet without an alias technically works but
  renewals unicast fail until rebind and probes are blind — the alias is the
  right shape.)
- **Batch reservations.** Tick N asking devices, type a start address, they are
  pinned sequentially in the order they asked. Install sheets want sequential
  addressing; today it's N ★ clicks.

## Reporting

- **Site-visit report.** One button turns today's session — adapters changed,
  scans, leases handed out, devices new/missing — into a paragraph and a table
  for the ticket. The diagnostics log and SITES already have every fact.

## PING / SCAN

- **Per-host TCP port in PING** — `192.168.0.50:554`; default 80. Cameras with no
  web server and HTTPS-only devices currently read FAIL while alive.
- **PORT BLINK on the toner** — one-second bursts of ~30 tiny UDP packets to the
  device, one second off, repeat. The device's switch port (and its own link
  LED) strobes in a pattern that stands out on a 48-port face. One `dgram`
  socket in main, no privileges. The "blink my own port" cousin is adapter
  enable/disable, cycled.
- **Toner pitch by latency** — sonar slides lower as RTT climbs; hear a link
  degrading before it drops.
- **SCAN → CSV / markdown to clipboard** — the raw scan for tickets; SITES has
  the Excel, the scan tab has nothing.

## Fleet (later)

- Read `default-presets.json` / `default-sites.json` from
  `C:\ProgramData\Broman Enterprises\NET-ETHER\` if present — IT pre-seeds the
  fleet. Worth it at 20 laptops, not at 5.
- DHCP option 121 (classless static routes) — legit, rarely needed for cameras;
  cheap if asked for.

## Small

- Wake-on-LAN from a SITES / SCAN row (magic packet).
- Toast when a toned PING host flips state while the HUD is hidden.
- Toner volume / pitch tuned on real laptop speakers.

## Not doing

- Rebuilding Wireshark. It's comprehensive, it's installed, hand off to it.
- Anything that sends device credentials over the wire on the technician's behalf.
