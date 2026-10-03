# NET//ETHER — Test checklist

Two lists. **HOME** is everything that can be proven on an unmanaged PC (UAC
elevation at launch); it covers the code. **MANAGED LAPTOP** is the short list
that only the fleet build can prove (EPM hook, Intune install, policy keys).
Do HOME completely before tagging — every release is a new exe hash for IT to
whitelist, so a v7.0.1 costs a second request.

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
- [ ] Set MTU to 1400 in an admin prompt, then version chip → DIAGNOSTICS → TOOLS → MTU → 1500 → OP mtu + VERIFY "MTU now 1500".
- [ ] APPLY: while netsh runs the button shows a moving sweep. On VERIFY OK: status bar green stripe + "✓ APPLIED — x.x.x.x IS ACTIVE", the IP field shows ✓ ACTIVE with a border pulse, the live bar IP flashes. Edit the IP → tag disappears.
- [ ] Make one fail on purpose (apply to a disabled adapter, or an IP already on it) → red ERROR status with netsh's own message; IP field red with ✕ FAILED; OP row red; COPY COMMANDS box shows the command.
- [ ] DHCP: on a STATIC adapter the `→ DHCP` action shows beside the badge; first click arms it (CLICK AGAIN), second fires. Not shown on a DHCP adapter.
- [ ] `dev.bat` only: APPLY → UAC → **No** → status "CANCELLED — UAC PROMPT DISMISSED", OP row mode `uac`. Then APPLY → **Yes** → OP row mode `uac`, exit 0, VERIFY OK.
- [ ] FACTORY DEFAULTS (beside SAVE TO PRESET) opens a 3-column grid with the explainer line. AXIS tile fills 169.254.1.1 / 255.255.0.0, no gateway. APPLY succeeds (mask hint only, no error).
- [ ] `?` → CIDR tab → click /16 → subnet field reads 255.255.0.0.
- [ ] LIVE on a DHCP adapter shows gateway and DNS, not blanks.
- [ ] PING: ♪ on a row → sonar on each reply. Unplug that device → downward sweep, then EEK-EEK-EEK every ~1.4 s. Plug it back → upward sweep, sonar resumes. STOP silences it. Only one row can be toned at a time.
- [ ] Two adapters named "Ethernet" and "Ethernet 2": apply / alias / verify on "Ethernet" never reports the other one's address.
- [ ] SITES → IMPORT a JSON where you've hand-edited a site id to `x');alert(1);//` → import succeeds, LOG has "Import sanitised: 1 site id(s) regenerated", nothing pops.
- [ ] Type 169.254.5.5 with 255.255.255.0 → amber note about /16, still applies.

### MULTI-IP
- [ ] On a STATIC adapter: add 192.168.250.10 → OP alias_add + VERIFY OK, row appears. REMOVE → OP alias_del + VERIFY OK.
- [ ] On a DHCP adapter: first ADD click → amber "CLICK ADD AGAIN TO CONFIRM". Second click → OP alias_add with **two** commands in the expanded row, adapter badge flips to STATIC, alias present. **This is the case that failed at work in v6.1.0 — whatever the LOG shows here is the answer.**
- [ ] Add an alias that's already present → ERROR with netsh text, CMD box shown.
- [ ] Hide-to-tray with an alias active → warning banner, HUD stays.

### Window (v7 sizing model)
- [ ] Fresh launch: HUD fits its content on every tab, status bar fully visible at the bottom, no scrollbar on ETHER. Switch tabs → height follows.
- [ ] Set Windows scaling to 125 % and 150 % (sign out/in if needed): same — no clipped footer, no stray gap under the status bar.
- [ ] Drag the window taller → it stays that size across tab switches. Quit, relaunch → still that size and at the same position. Version chip → FIT WINDOW → snaps to content. Chip → AUTO-FIT shows OFF after a manual drag, ON after FIT.
- [ ] Two monitors: put the HUD on the second one, quit, relaunch → comes back on the second one. Unplug it, relaunch → top-centre of the primary. Open SITES (tallest tab) on the smaller monitor → capped at that monitor's work area, not the primary's.
- [ ] Launch the exe twice quickly → one HUD; the second click just brings it to front. LOG has a "Second launch attempt" entry.
- [ ] The `─` button hides to tray (no minimize). Tray click brings it back.
- [ ] Win+D, then tray click → HUD restores (not hidden).
- [ ] Titlebar `?` → quick guide for the current tab; tab strip switches; FULL MANUAL → opens the PDF in the default viewer (no Word needed). Esc closes.

### DHCP (new in v7 — do this on a bench switch, not the home LAN, for the SERVE steps)
- [ ] Before opening the DHCP tab: `netstat -ano -p UDP | findstr :67` in a prompt → nothing from NET-ETHER. Open the tab → status "LISTENING", badge LISTENING, netstat now shows :67 held by the NET-ETHER PID. LOG has "DHCP engine listen" and an OP `dhcp-fw-add` (or "already allowed" in the activity log).
- [ ] `netsh advfirewall firewall show rule name=NET-ETHER-DHCP-UDP67` → present. If you still have NET//DHCP's `NET-DHCP-Server-UDP67` rule, it is gone (OP `dhcp-fw-legacy`).
- [ ] Adapter dropdown lists the same wired adapters as ETHER. Pick one with an address → settings fill from its subnet (.100–.200 pool).
- [ ] Plug a camera / any DHCP client into the bench switch → row appears ASKING with "→ x.x.x.x" preview. Nothing is served (device stays without address).
- [ ] SERVE on that row → badge "SERVING 1 TARGET", DHCP tab shows the amber dot, live bar shows "DHCP: 1 TARGET", tray tooltip mentions DHCP. Device gets the previewed address; row goes LEASED with countdown; status "✓ LEASE → …". LOG has "DHCP engine serve-targeted".
- [ ] ★ on the leased row → reservation input → enter another pool address → Enter → star lit. ✕ revoke → device re-asks and gets the reserved address.
- [ ] SCAN WIRE on the bench (no other server) → "✓ No other DHCP server answered". SCAN WIRE on the home LAN → the router is listed, status red.
- [ ] SERVE ALL on the home LAN → scan runs first → modal "ANOTHER DHCP SERVER IS LIVE" → CANCEL. (Don't serve-all on the home LAN.)
- [ ] SELF-TEST → five rows, all green on the bench; port 67 "Bound by NET//ETHER".
- [ ] Profiles: ⊕ SAVE "BENCH" → appears in the dropdown → change a field → pick BENCH → field restored. ✕ deletes after confirm.
- [ ] ADVANCED → AUTO-STOP 1 → serve a device → wait a minute with nothing renewing → status "AUTO-STOPPED", badge back to LISTENING.
- [ ] QUICK START on an adapter with no address (bench switch, no server) → modal offers a static IP → SET STATIC IP → LOG has OP apply + VERIFY (static assist), ETHER tab shows the adapter STATIC at 192.168.100.1 → serving starts. Quit → LOG shows the revert apply/dhcp; adapter back to DHCP.
- [ ] Kill the app from Task Manager while a static assist is active → relaunch, open DHCP → "LEFTOVER STATIC IP" modal → REVERT ADAPTER works.
- [ ] Tick two ASKING rows → SERVE SELECTED (2) appears beside CSV → click → both go LEASED, badge says 2 TARGETS, live bar "DHCP: 2 TARGETS".
- [ ] Let a lease expire → device re-asks → preview shows its OLD address (1 h memory), not the next pool slot.
- [ ] With the home router live, plug a laptop already leased from the router into the same switch while ETHER is in SERVE ALL → activity log shows "not ours, staying silent" for its REQUEST; the laptop keeps its router lease.
- [ ] Drag the bar between the device table and the log → ratio changes and survives relaunch.
- [ ] Click the LISTENING badge → OFFLINE, netstat shows :67 released, firewall rule gone. Click again → back to LISTENING.
- [ ] Quit while serving → app exits within a few seconds; :67 released; firewall rule gone; LOG (next launch) shows "DHCP engine off".
- [ ] Diagnostics STATE shows a "dhcp engine" line and `dhcp-config.json` in the file list.
- [ ] If you had NET//DHCP installed: first open of the tab imports its profiles/reservations (LOG "Imported NET//DHCP settings").

### SCAN
- [ ] Scan your /24. Hostnames appear on rows within a few seconds of "SCAN COMPLETE"; your own IP has a SELF badge. Status "N HOSTNAMES RESOLVED". LOG has an APP resolve entry with DNS/NetBIOS counts.
- [ ] Row for a Windows PC shows its NetBIOS name if DNS has no PTR for it.
- [ ] ONLINE VENDOR LOOKUP toggle: OFF → an unknown-vendor host stays UNKNOWN. ON → macvendors.com fills it. Setting survives restart.
- [ ] Save the scan as a site. Scan again → chip "SITE — NO CHANGES" (green). Unplug a device, scan → amber chip with "1 MISSING", VIEW → opens the site in SITES with the change listed. Start another scan → chip disappears.
- [ ] SITES → SCAN NOW → scan runs → you stay on SCAN; chip appears; no tab jump.

### v7.1.0 — adapter tools, PING port, SCAN export, WAKE
- [ ] Connected adapter shows its speed (e.g. `1 GBPS` green) where CONNECTED used to be. Plug into a 100 Mb port or a bad cable → `100 MBPS` amber.
- [ ] ADAPTER line: DISABLE → modal → link drops, selector shows DISABLED, chip reads ENABLE; LOG has OP adapter-disable + VERIFY. ENABLE brings it back with the same static config.
- [ ] WI-FI chip visible (laptop) → click → modal → Wi-Fi off, chip amber "WI-FI OFF". Reboot: still off, chip still amber. Click again → back on.
- [ ] With the DHCP tab serving on the wired adapter, DISABLE is refused with the "stop serving first" message.
- [ ] WIRESHARK chip present (Wireshark installed) → opens a live capture on the selected adapter. STATE shows the Wireshark path and tshark version. Uninstall / rename Wireshark → chip gone, STATE "not found".
- [ ] PING: target `x.x.x.x:554` on a camera → green while RTSP answers. `x.x.x.x:5555` → CLOSED (amber), not FAIL. Plain IP still ICMP.
- [ ] PING ◉ on a row → Wireshark opens with filter `host x.x.x.x`.
- [ ] Toner on a host, hide the HUD to the tray, pull the cable → toast "host down"; click it → HUD returns. Leave it hidden 10 minutes → sparkline still advances once a second (no throttling).
- [ ] SCAN a subnet with a Hikvision / Dahua / Bosch / Genetec box → vendor badge on the row. A no-vendor host with 554 open gets the CAMERA colour bar.
- [ ] SCAN → COPY ▾ → CSV pastes into Excel as columns; MARKDOWN renders as a table. Ports column lists 80 and 554 even though they show as OPEN buttons.
- [ ] SCAN → CAPTURE on a row → Wireshark with the host filter.
- [ ] SITES → device drawer → WAKE → "MAGIC PACKET SENT", LOG has OP wol with the broadcast targets. A WoL-capable PC that's asleep wakes.

### v7.1.0 rc.2 — discovery, REACH, SWITCH?
- [ ] SCAN a subnet: rows gain ONVIF / SSDP / mDNS badges within ~3 s (router shows SSDP, Reolinks ONVIF, printer mDNS). Hover a badge → name, model, URLs.
- [ ] ◎ DISCOVER alone (no sweep): same badges, status "N DEVICES ANSWERED DISCOVERY". LOG has an APP discover entry with the counts.
- [ ] Factory-reset a camera (or any box on 169.254) on the bench: ◎ DISCOVER shows it as an amber-ms row with an ONVIF/WSD badge and a REACH button, even though the laptop is on 192.168.x.
- [ ] REACH → modal → LOG has OP reach_add + VERIFY, amber LINK-LOCAL chip appears, browser opens the camera. REMOVE → OP reach_del, chip gone. REACH again, then quit the app → `netsh interface ip show address` shows no 169.254 alias.
- [ ] REACH on a DHCP adapter: modal warns about the static conversion; afterwards the ETHER badge reads STATIC; → DHCP restores it.
- [ ] SWITCH? chip present (Wireshark 4.6+). Click on a managed-switch port → "LISTENING 65s" countdown, result line under the selector within ~30 s (LLDP) or ~60 s (CDP). Click again to stop early. On an unmanaged switch → "didn't announce". LOG has an APP lldp entry.
- [ ] If tshark is older than 4.6 the chip is amber and the tooltip says so; no listen starts.
- [ ] DHCP tab: engine dot red OFFLINE / green LISTENING on every theme preset, including the red and amber ones.
- [ ] PING `x.x.x.x:5555` on a live host that drops → CLOSED (amber), tooltip "no answer on port, host is up". On a dead host → FAIL.
- [ ] SCAN: your own PC with 554 open is not typed CAMERA; a Windows box with a NetBIOS name and 554 is WORKSTATION.
- [ ] Every scan row has CAPTURE, including ARP-only rows with no open ports.

### v7.1.0 rc.3 — DHCP, toner, report, fixes
- [ ] DHCP: add a MULTI-IP alias on the wired adapter, then pick the adapter on the DHCP tab → modal asks which address; pick the alias → SERVER IP and pool are on the alias subnet; the select reads "[ip +1 alias]".
- [ ] DHCP: tick 3 asking devices → ★ RESERVE SELECTED (3) → start 192.168.x.150 → stars on all three at .150/.151/.152; a start that collides with the server IP skips it.
- [ ] PING: tone a host → ⚡ BLINK appears → click → "BLINKING" for 20 s, the switch LED for that port flickers hard; LOG has APP blink with the packet count. Toning an off-subnet host → BLINK says it needs your own subnet.
- [ ] PING: tone a LAN host (~1 ms) then a WAN host (~30–80 ms) — the sonar is audibly lower on the slow one.
- [ ] Version chip → SITE REPORT → paste into Notepad: adapter line, scans, DHCP, ping, operations all present and in this session's time window only.
- [ ] SCAN: every row shows IP / MAC / PING / WSHARK together; narrow the window until they can't fit — the four drop to their own line together.
- [ ] SCAN: CLEAR, ◎ DISCOVER with no sweep → on-subnet rows get real port badges, not "…".
- [ ] REACH on a DHCP adapter, then REMOVE → ETHER badge is back to DHCP, LOG reach_del note says "back to DHCP".
- [ ] PING `:5555` on a dead host → cycle still ticks about once a second for the other hosts.
- [ ] Epson row: one "EPSON ET-8550 Series", not two. A real ONVIF camera shows ONVIF, not ONVIF+WSD.

### v7.1.0 rc.4 — RECON, window, primary address
- [ ] Six tabs; RECON opens with the ETHER adapter named and "NOTHING HEARD YET". With Wireshark missing the LISTEN button is dimmed with a reason in its tooltip.
- [ ] RECON → LISTEN at home: progress counts to 65 s; cards: SWITCH "No LLDP/CDP announcement", 802.1X "No challenge", DHCP server 192.168.0.1 with gateway/mask/DNS, HOSTS on 192.168.0.x, NAMES, ADDRESS with TAKE. LOG has APP recon with the summary.
- [ ] TAKE → ETHER tab, IP/mask/gateway filled and marked changed, status "FROM RECON — CHECK IT, THEN APPLY".
- [ ] SILENT → modal → during the listen the ETHER badge shows no IP; after it ends the adapter is back (DHCP lease renewed). LOG: OP recon-unbind, OP recon-rebind, VERIFY recon-rebind. Kill the app mid-listen (Task Manager) → relaunch → VERIFY recon-rebind "leftover from previous run", adapter has its IP again.
- [ ] Managed switch (bench): SWITCH card within ~30 s (LLDP) or ~60 s (CDP); STP card on a port running spanning tree; TRUNK card on a trunk port.
- [ ] Window can't be narrowed below 430; at 430 WI-FI OFF / DISABLE fit the ADAPTER line. Quit from the DHCP tab → relaunch → ETHER opens at your narrow width, not 820, and fully on screen.
- [ ] Add a MULTI-IP alias → ETHER still shows 192.168.x as the IP; MULTI-IP marks it PRIMARY (no REMOVE) and the alias as removable; the DHCP select reads `[192.168.x +1 alias]`; the DHCP settings refill with the modal (same adapter, no dropdown change); ⟳ offers the modal again.
- [ ] MULTI-IP: typing 10.10.10.1 suggests 255.255.255.0, not 255.0.0.0.
- [ ] SCAN after CLEAR: the Roku/TV row is MEDIA (purple bar), not CAMERA. UPDATE SITE → SITES shows MEDIA, no second 192.168.0.146 entry, and a type you cycled by hand survives the next UPDATE.
- [ ] PING with `.139:5555` + `.250:5555` + router: status reads `ALERT — 1 DOWN · … · 1 CLOSED`. BLINK on a WAN host → the warning stays ~4 s.
- [ ] ◎ DISCOVER after a sweep: the rows that answered pulse, status lists their last octets.
- [ ] SCAN at 760 wide: MAC right of the IP, meta line is hostname/vendor/badges only. Narrow to 430: MAC drops back to the meta line.

### v7.1.0 rc.6 — hardening, SILENT, layout
- [ ] `build.bat` at home: the fused build runs. Then in PowerShell `$env:ELECTRON_RUN_AS_NODE="1"; & "dist\win-unpacked\NET-ETHER.exe" -e "console.log(1)"` must NOT print 1 (it should just launch the app or do nothing). Remove the variable after.
- [ ] RECON STANDARD at home: cards as before; NAMES shows real host names only (no wpad, no `*<00>`, no `_tcp`).
- [ ] RECON SILENT, let it finish: LOG has recon-unbind, recon-rebind OK with "IPv4 interface present", the header shows the IP again within ~8 s. DHCP card reads "No DHCP heard — SILENT".
- [ ] RECON SILENT, quit mid-listen: either a clean rebind in the log, or the message box — never a dead adapter without a word. Relaunch: adapter has its address; `Get-NetIPInterface -InterfaceAlias Ethernet -AddressFamily IPv4` returns a row.
- [ ] Unplug the cable → adapter reads DISCONNECTED. Plug in; if it comes up with no address it reads NO ADDRESS with a RENEW action; RENEW gets the lease (LOG: OP renew, VERIFY renew).
- [ ] WI-FI chip: green "WI-FI" while the radio is enabled, amber "WI-FI OFF" only after you switch it off from the chip. Matches Settings.
- [ ] ETHER: MULTI-IP open, add an alias, → DHCP from the badge → the panel updates by itself, alias gone, no REMOVE left behind.
- [ ] ETHER: alias present, ✕ → warning banner; ✕ again → quits.
- [ ] ETHER: open MULTI-IP with the window near the bottom of the screen → the window moves up, REVERT and the status bar stay visible.
- [ ] APPLY a static with a DNS: no "DNS server is incorrect" line in the OP apply output. REVERT → OP revert in the log.
- [ ] DHCP tab dot: red on launch, green once the tab has been opened (engine listening), amber while serving; visible from ETHER.
- [ ] SCAN tab opens at 640 wide, SITES too; ETHER comes back at your narrow width. DISCOVER sits beside SCAN SUBNET with the hint line under both.
- [ ] SITES → DELETE a throwaway site → LOG: APP backup "pre-delete" before the delete.

### v7.1.0 rc.7 — final home round
- [ ] Drag ETHER to 700 wide → SCAN opens at 700 (not 640), DHCP at 820, back to SCAN stays 820, ETHER returns to 700.
- [ ] Open MULTI-IP with the window parked at the bottom of the screen → it moves up and sits clear of the taskbar and the top edge.
- [ ] DHCP tab open (LISTENING) → RECON SILENT → badge and tab dot read SUSPENDED (amber-grey) → listen ends → LISTENING again by itself. Engine log: "Suspended …" then "Resumed — listen".
- [ ] Quit mid-SILENT → exactly one recon-rebind in the log, not two.
- [ ] Hover the OFFLINE badge → dot stays red.
- [ ] Rename the adapter to `Johan's Port` → relaunch → APPLY a static, → DHCP, MULTI-IP add/remove, DISABLE/ENABLE, RECON SILENT all work; rename back to `Ethernet`.

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
- [ ] Run `NET-ETHER-Installer-7.0.1.exe` → directory page defaults to `C:\Program Files\Broman Enterprises\NET-ETHER\`. Install completes, shortcut works, app launches elevated.
- [ ] Silent: `NET-ETHER-Installer-7.0.1.exe /S` from an admin prompt → same result, no UI.
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
- [ ] DHCP tab on the managed laptop: opening it adds the firewall rule silently (EPM elevation, no prompt) — OP `dhcp-fw-add` exit 0. If Defender flags the UDP 67 bind or the rule add, COPY DIAGNOSTICS and send it to IT with the notes below.
- [ ] If IT sets `DisableDhcpServer=1`: tab shows the red policy notice, badge POLICY OFF, SERVE/QUICK START greyed, netstat shows nothing on :67.
- [ ] Two launches in a row during the EPM delay → one window.

---

## Deployment notes for IT (v7.1.0)

- **Wireshark hand-off.** When Wireshark is installed, the app can launch it on an
  adapter or with a `host <ip>` capture filter. Because NET//ETHER runs elevated,
  the Wireshark it launches is elevated too — same binary IT already deploys,
  just started from our process. Nothing captures unless the technician clicks.
- **New probe ports.** The subnet scanner now also tries TCP 8000, 37777, 1756
  and 5500 on hosts it finds (Hikvision, Dahua, Bosch, Genetec service ports).
- **Wake-on-LAN.** UDP 9 magic packets to 255.255.255.255 and each subnet's
  directed broadcast, on demand only.
- **Adapter enable/disable** goes through `netsh interface set interface`, under
  the same EPM elevation as every other netsh call; each one is in the
  diagnostics log.
- **Toasts** use the tray balloon API — no notification registration, no
  Start-menu dependency, works on the portable build.
- **Multicast discovery.** With every scan (and on demand) the app sends one
  WS-Discovery probe (UDP 3702), one SSDP M-SEARCH (UDP 1900) and one mDNS
  query (UDP 5353) to the standard multicast groups and listens 3 s for
  unicast replies. Windows Firewall allows those replies by default
  ("unicast response to multicast"); if a GPO disables that, discovery
  simply finds nothing.
- **Link-local alias (REACH).** On request the app adds a temporary
  169.254.x.x/16 secondary address to the active adapter so a factory-default
  camera can be configured, and removes it on quit. Logged like every netsh call.
- **Passive LLDP/CDP listen.** Through the installed Wireshark's `tshark.exe`,
  capture filter limited to LLDP and CDP frames, up to 65 s, nothing sent.
  Needs Wireshark 4.6+ and npcap; both are already on the image.
- **PORT BLINK.** On request, ~25 small UDP datagrams a second to one host's
  discard port (UDP 9) for 20 s, on the technician's own subnet only. The host
  ignores them; it exists to strobe a switch-port LED.
- **RECON.** Passive capture through tshark for up to 65 s (LLDP, CDP, EAPOL,
  STP, ARP, DHCP, NBNS, mDNS, SSDP, NTP, 802.1Q). Nothing is sent. SILENT mode
  temporarily disables the IPv4/IPv6 bindings on the adapter
  (`Disable-NetAdapterBinding`) and re-enables them afterwards; both are logged
  and the re-enable is retried on the next launch if the app was killed.

## Deployment notes for IT (v7.0.1 — signed binaries)

From v7.0.1 every release is Authenticode-signed, publisher **Johan Broman**
(Azure Artifact Signing, Microsoft-issued Public Trust certificate). EPM and
Defender/Intune can now trust the **publisher** rather than a per-version file
hash: whitelist the certificate once and subsequent NET// releases are trusted
on arrival. Right-click the exe → Properties → Digital Signatures to inspect.

## Deployment notes for IT (v7.0.0 — DHCP server absorbed)

Everything in the v6.2 list below still applies. New in v7.0.0:

1. **NET//DHCP is retired.** Its function is now the DHCP tab in NET//ETHER; the standalone package can be removed from the fleet. There is no separate exe to whitelist any more.
2. **UDP 67 listener, on demand only.** The app binds UDP 67 (DHCP server port) only when a technician opens the DHCP tab, never at launch. It opens in a listen-only state and never hands out an address until the technician explicitly starts serving. A serve-all is preceded by an active check for other DHCP servers and a confirmation if one answers.
3. **Firewall rule.** When the listener starts the app adds an inbound rule `NET-ETHER-DHCP-UDP67` (UDP 67, allow) via `netsh advfirewall`, using the elevation it already has. The rule is removed when the engine is turned off and when the app quits. If a NET//DHCP rule `NET-DHCP-Server-UDP67` is still present from the old app, it is deleted the first time the new engine starts.
4. **Rogue-server scan traffic.** SCAN WIRE / SERVE ALL send a DHCPDISCOVER (relay-style with the laptop's IP as giaddr, plus a client-style broadcast from UDP 68) and listen ~6 s for offers. Nothing is accepted or applied to the laptop from those replies.
5. **Off switch:** `HKLM\SOFTWARE\Policies\Broman Enterprises\NET-ETHER\DisableDhcpServer` (DWORD 1). With it set the engine never binds and the tab is read-only.
6. **Single instance.** A second launch exits immediately and focuses the running window — relevant with the EPM launch delay.
7. Everything the engine does (start/stop, firewall rule add/remove, static-IP assist and its revert, serve mode changes, rogue scans) is written to the app's diagnostics log; COPY DIAGNOSTICS gives IT the exact commands and outputs.

## Deployment notes for IT (v6.1 → v6.2 migration)

1. v6.2.0 installs **per-machine** (`C:\Program Files\Broman Enterprises\NET-ETHER\`). Earlier versions installed **per-user** (`%LOCALAPPDATA%\Programs\NET-ETHER`). A system-context install cannot remove copies living in user profiles, so push an uninstall of the old package alongside the new deployment (or let users remove it via Settings → Apps). Both can coexist; the old one just goes stale.
2. User data is untouched by either step — it lives in `%APPDATA%\net-ether`, not the install directory.
3. New network behaviour to clear: after a subnet scan the app sends a NetBIOS node-status query (UDP 137) to each host it found. Same scope as the existing ICMP/ARP sweep, one packet per host.
4. Optional policy value: `HKLM\SOFTWARE\Policies\Broman Enterprises\NET-ETHER\DisableOnlineVendorLookup` (DWORD 1) disables the only outbound internet call the app makes.
5. Every release changes the exe hash. EPM and Defender whitelists need re-pointing per version until builds are signed.
