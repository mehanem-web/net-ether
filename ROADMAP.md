# NET//ETHER — Roadmap

## Delivered in 7.1.0 (2026-10-03)
RECON tab (LLDP/CDP switch identity, 802.1X, STP/trunk, DHCP heard, hosts, free-address suggestion, STANDARD/SILENT), multicast discovery (WS-Discovery/ONVIF, SSDP, mDNS) with REACH for link-local devices, link-speed chip, WI-FI and DISABLE/ENABLE chips, NO ADDRESS/RENEW, `host:port` ping targets, PORT BLINK, toner pitch by latency, hidden-HUD toast, vendor probe ports, scan CSV/markdown, WSHARK per row, MEDIA type, Wake-on-LAN, serve-from-alias, batch reservations, DHCP tab dot, site-visit report, FUNCTIONS.md, Electron fuses, RECON capture filter, CI on Node 22.

## Still open after 7.1.0
- Bench verification: RESERVE SELECTED, BLINK on a lit switch, REACH on a factory-default camera, RECON on a managed port (SWITCH/STP/TRUNK/802.1X cards). Fixes → 7.1.1.
- Fleet pre-seeding of a site database from ProgramData; DHCP option 121 (classless static routes).
- Scanner beyond /24 (link-local /16 needs discovery, not a sweep — DISCOVER covers the camera case).
- Tutorial video script from FUNCTIONS.md.

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
