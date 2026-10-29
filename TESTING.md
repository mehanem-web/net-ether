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

### v7.3.0 — THE ONE PASS (also covers § 7.2.2, § 7.2.1, § 7.2.0 below)
7.2.x never got its bench round, so 7.3 carries it: do this section, then § 7.2.2 → § 7.2.1 →
§ 7.2.0 (lines marked *(7.3.0)* changed), at home. Then one real site day on the work laptop
(MANAGED LAPTOP). Anything that breaks → COPY DIAGNOSTICS → next rc. The fleet only sees 7.3.0.

**rc.2 additions (home pass 2026-10-28 found these)**
- [ ] ─ minimizes to the taskbar; Alt+Tab and the taskbar button bring it back; tray icon still there and brings it forward. Alt+F4 and taskbar "Close window" quit.
- [ ] → DHCP: one click.
- [ ] After → DHCP the status says "… IS BACK ON DHCP", not "CONFIG APPLIED SUCCESSFULLY".
- [ ] APPLY with gateway = the IP itself → stopped with "GATEWAY IS THIS LAPTOP'S OWN ADDRESS".
- [ ] MULTI-IP add on a DHCP card → a website still loads afterwards (DNS kept). DNS field shows the router's DNS.
- [ ] Card with an alias, quit, relaunch → leftover reads "left <alias> on this card (it was <your IP>)", not "static <alias>".
- [ ] Apply static, quit, relaunch → PUT BACK → apply a static again, quit, relaunch → the line shows again.
- [ ] WI-FI chip off/on → one green line each way, no red "ADAPTER NOT FOUND".
- [ ] SCAN your subnet → devices that answered DISCOVER have a ◎ after the IP; header `◎ N DISCOVERY` click → only those; click again → all. Scan an empty base (10.0.0) → "NO HOSTS ON THIS SUBNET · N ELSEWHERE".

**Leaving ETHER**
- [ ] MULTI-IP alias on a card → ─ minimizes straight away (no banner).
- [ ] Same, ✕ → quits in one click. Relaunch: the alias is still on the card; amber line under the adapter: `↺ Last session left … 10.0.30.250 … (it was …)`.
- [ ] APPLY a static on a DHCP card, ✕ → no prompt, app gone. Relaunch → leftover line "static X (it was DHCP)". **↩ PUT BACK (DHCP)** → card back on DHCP, line gone, LOG `leftover_restore` VERIFY OK.
- [ ] Leave one there, **KEEP** → line gone. Relaunch → doesn't come back.
- [ ] Leave one, ignore it, quit, relaunch twice → still shown (until dealt with).
- [ ] Leftover showing, then → DHCP on that card yourself → line disappears on its own.
- [ ] DHCP card that just got a different lease between launches → **no** leftover line.
- [ ] Make the window as short as it goes, ✕ → quits (the old prompt hid below the fold here).
- [ ] REACH on a ◇ SITTING / link-local device, ✕ → the temporary address is gone (LOG `reach_del`). DHCP tab SET LAPTOP IP… and + ALIAS → quit → both **stay** (leftover next launch).
- [ ] ↩ RESTORE LAUNCH STATE (after any APPLY) → modal lists the changes → RESTORE → card back, LOG VERIFY `restore`.

**APPLY / REVERT**
- [ ] DHCP card with a gateway → APPLY static 192.168.0.50, gateway 192.168.0.1 → REVERT → back on DHCP (gateway from DHCP).
- [ ] APPLY 10.0.0.5 gw 10.0.0.1 → APPLY 192.168.0.50 gw 192.168.0.1 → REVERT → 10.0.0.5 **with gw 10.0.0.1** (rc.2: REVERT is one step; 7.2 put the new gateway back, or refused and lost the button).
- [ ] Dismiss the UAC prompt during a REVERT (dev build) → REVERT button is still there.
- [ ] Dev build: APPLY, leave the UAC prompt up 20 s, click APPLY again → "STILL APPLYING THE LAST CHANGE". Accept → one apply in the LOG, not two.

**Data safety (hardball — use a copy of `%APPDATA%\net-ether` first)**
- [ ] Quit. Truncate `intel.json` (delete the last 50 characters in Notepad). Launch → notice "A DATA FILE COULD NOT BE READ … kept as intel.corrupt-<date>.json". The corrupt copy is there, byte-identical. LOG `storage` error. Put the good copy back → sites return.
- [ ] Same with an **empty** `sites.json` and `presets.json` → notice lists them; no crash.
- [ ] Edit sites fast: rename a site, immediately edit a device, add a credential, repeat ×10 → quit → relaunch → everything there, `intel.json` opens as valid JSON, no `*.tmp` files left in the folder.
- [ ] `backups\` has an `intel-daily-…` after the first save today.
- [ ] *(optional, needs a second Windows account)* Copy `intel.json` into the other account's `%APPDATA%\net-ether`, launch there → credentials show "[UNREADABLE …]"; edit a device's notes, save, copy the file back → in your account the credentials still decrypt.

**Cards that change under ETHER**
- [ ] REACH a device (temporary alias), rename the adapter in Windows, quit → alias removed from the renamed card (LOG names the new name).
- [ ] REACH on a USB dongle, unplug the dongle, quit → LOG "kept for a retry". Plug it back, launch → alias cleaned up.
- [ ] RECON SILENT on a USB dongle, pull it mid-listen → listen ends; LOG "card not present". Plug back, relaunch → bindings restored, card gets its address.
- [ ] SCAN a /24, STOP at ~30 %, change the base, START at once → only the new subnet's rows appear; the scan finishes normally (7.2 stopped it early or mixed rows in).
- [ ] DHCP: serve a device, pull the laptop's cable → LOG "Link DOWN … nothing is answered"; device DISCOVERs get no answer (and nothing goes out the Wi-Fi). Replug → "back … answering again", device leases.
- [ ] DHCP tab open, unplug/replug the card → ◇ SITTING rows come back (wire watch restarted — LOG `wire-watch` "restarting").
- [ ] Wi-Fi chip OFF → ON on the work laptop → status says it can take a minute; result ✓ ENABLED (no FAIL even when it takes 30 s).

**Slow laptop (run these under `dev-slow.bat` — +2 s per launch — then again on the work laptop)**
- [ ] SCAN a /24 with known live devices → they're all found (7.2 at +2 s: only ARP-cached hosts).
- [ ] MULTI-IP add on a **DHCP** card → converts to static on the lease address, then adds; the lease address is never lost. LOG has no `alias_add` with a missing conversion.
- [ ] Wi-Fi OFF/ON, DISABLE/ENABLE, RENEW → no false FAIL, no "ADAPTER NOT FOUND".
- [ ] DIAGNOSTICS → STATE: PS WORKER still `ready` after an hour of use (not `disabled`).
- [ ] RECON SILENT 65 s → card rebinds and gets its address back.
- [ ] Click APPLY, then immediately ADD MULTI-IP on the same card → LOG shows them one after the other, not interleaved; both end up on the card.

**Never stuck, never hidden**
- [ ] Short window: DHCP tab, a row far down, ▶ SERVE with a mismatched laptop IP → the step-2 guard scrolls into view. IP tab: force an APPLY failure (bad adapter via dev) → COPY COMMANDS box scrolls into view.
- [ ] SCAN with changes since last scan → the chip sits above the results.
- [ ] DIAGNOSTICS after a full pass: no `unhandled` rows (any there → send them).

### Launch & diagnostics
- [ ] Version chip shows the right version. Click it: STATE lists elevated YES (High) on the portable build, NO (Medium) in dev.
- [ ] STATE: userData path is `%APPDATA%\net-ether`, data files listed, credentials line present, policy "none set".
- [ ] LOG has an APP launch entry. Quit, relaunch → previous entries still there.
- [ ] CLEAR LOG leaves one "log-cleared" entry. COPY DIAGNOSTICS pastes STATE + LOG into Notepad.

### IP tab — every write op, watch the LOG after each
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
- [ ] (7.2.0: QUICK START is gone — see § v7.2.0, SET LAPTOP IP….)
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
- [ ] TAKE → IP tab, IP/mask/gateway filled and marked changed, status "FROM RECON — CHECK IT, THEN APPLY".
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

### v7.2.2 — OPEN picks http or https
- [ ] A1210 (AXIS OS 12) → OPEN lands on `https://<ip>` (cert warning expected), not a dead http page. A device with http only still opens on http. REACH on a ◇ SITTING Axis → https too.
- [ ] An old device with http only (or a panel whose https a browser rejects) → OPEN still lands on http.

### v7.2.1 — DHCP replies out the right card
Bench: the A1210 (or any DHCP device) on a USB/dock card, **Wi-Fi connected** (or a second wired network with the default gateway).
- [ ] Wi-Fi ON, serve the device from its row → OFFERED → LEASED within a few seconds (7.2.0 sat on OFFERED). Log shows `offering … (via <card subnet>.255)`.
- [ ] Same with the lease at 1 min: the renewal ACKs (row stays LEASED past 2 minutes, expiry keeps moving).
- [ ] SCAN WIRE with Wi-Fi on → `relay DISCOVER sent (… to <card subnet>.255)`; the home/office router on the Wi-Fi is NOT reported as a server on this cable.
- [ ] Wi-Fi OFF → still leases (single-card case unchanged).
- [ ] DIAGNOSTICS → LAUNCHES never shows `program ×…`.

### v7.2.0 — DHCP rework, wire watch, IP tab, spawn latency
Bench: a dumb switch, the Axis A1210 (or any Axis on AXIS OS 10+), a Bosch or other DHCP camera, the laptop's dock NIC. Run the DHCP part from the portable build (elevated) and once from `dev-slow.bat`.

**Spawn latency**
- [ ] DIAGNOSTICS → STATE: PROCESS LAUNCH shows `cmd /c ver N ms — <verdict>` within ~2 s of launch; LAUNCHES counts climb as you use the app; PS WORKER reaches `ready · start-up N ms` and its job count climbs on every adapter refresh. LOG has APP `spawn-check`.
- [ ] `dev-slow.bat`: STATE shows LATENCY INJECTOR ON; the app is slow but never frozen; adapter refresh completes in roughly one delay (the four reads run together), not four or more.
- [ ] Work laptop (EPM, CLM if enforced): PS WORKER `ready`, not `disabled`. If it says disabled or fallbacks climb, COPY DIAGNOSTICS — everything still works one-shot, but send it.
- [ ] Adapter list, DHCP/STATIC badges and link speeds identical to 7.1.0 on the same machine (registry now read in one call).

**IP tab (renamed from ETHER)**
- [ ] Tab bar reads `IP · PING · SCAN · SITES · DHCP · RECON`, labels not squeezed at the 430 minimum width. ? guide strip says IP.
- [ ] Unplug from DHCP, plug into the dumb switch with no server → after the address falls to 169.254: amber warning "self-assigned". HEAR THE WIRE with a camera on a fallback static (e.g. 192.168.0.90) → "Heard 192.168.0.x (1) USE 192.168.0.250" → USE fills IP/mask, marked changed, nothing applied.
- [ ] Office jack → lease → move the cable to the dumb switch quickly (lease still held): warning "gateway … doesn't answer" with RENEW. RENEW → falls to 169.254 → warning changes.
- [ ] SCAN from a 169.254 base with nothing in that /24 → "LINK-LOCAL: ONLY ONE /24 … TRY DISCOVER".

**DHCP tab**
- [ ] Open the tab: ① card line shows description · link speed · DHCP/static; ② chips list the card's addresses; cable strip reads LAPTOP ── card ── DEVICES GET first – .last.
- [ ] Card with no address: SET LAPTOP IP… → 192.168.0.1 → LOG OP apply + VERIFY; chip `✓ 192.168.0.1` (no TEMP tag since 7.3.0). With a device already sitting on 192.168.0.1 (set one static there) → it moves to .2 and says so. *(7.3.0)* Quit → the card **stays** on 192.168.0.1; next launch shows the leftover line on the IP tab.
- [ ] + ALIAS 10.0.30.250 → chip appears (ALIAS, no TEMP since 7.3.0), handing out from it. *(7.3.0)* Quit → alias **stays**; next launch shows it in the leftover line.
- [ ] **Stale settings:** serve on 192.168.0.x, quit, change the card to another subnet (or use a profile saved on another subnet), relaunch → open the tab: status "LAST JOB'S SETTINGS … REFILLED FROM THE CARD". Load the mismatched profile → amber guard with REFILL FROM CARD / + ADD AS ALIAS; SERVE refused with "NOT SERVED — LAPTOP IP IS NOT ON THIS CARD".
- [ ] Power-cycle the A1210 with the tab open → ASKING within seconds, DEVICE "AXIS A1210 12.2.63", hostname axis-…. Type 192.168.0.150 → ▶ SERVE → SERVED .150 → ↗ OPEN opens its page.
- [ ] Set it static on 192.168.0.150 in its own UI → within ~3 min (5-min lease) the row turns ✓ STATIC, status "WENT STATIC", log line. Second camera asking → box pre-filled .151.
- [ ] Lease dropdown: 1 min → device renews about every 30 s (log ACKs).
- [ ] A camera left on a fallback static / link-local and not asking → ◇ SITTING row with model and mdns/arp sources within ~10 s. On the laptop's subnet: ↗ OPEN. Off it: ⇢ REACH → temporary address, page opens; SCAN tab shows the LINK-LOCAL / alias chip; quit removes it.
- [ ] Same with AXIS IP Utility running alongside — both see the device; ETHER also sees it while it's still link-local.
- [ ] SERVE EVERYONE… → confirm modal → (home LAN) another-server modal → CANCEL. On the bench → serves everyone; button reads ■ STOP SERVING EVERYONE.
- [ ] Wire watch stops when the engine is OFF (status chip): netstat shows nothing on :5353/:1900 from the app after a few seconds.

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
- [ ] If IT sets `DisableDhcpServer=1`: tab shows the red policy notice, badge POLICY OFF, SERVE EVERYONE greyed, no ▶ SERVE on rows, netstat shows nothing on :67.
- [ ] Two launches in a row during the EPM delay → one window.

---

## Deployment notes for IT (v7.3.0 — the fleet update after 7.1.0)
One install replaces 7.1.x; the v7.2.0 notes below also apply (new mDNS/SSDP sockets and their
program-scoped firewall rule, one long-lived read-only PowerShell, the launch self-check).
Same publisher, same install path, same signing — the publisher rule covers it.

- **Addresses the tech sets now stay set on quit.** 7.1 asked on quit and could revert; 7.3 doesn't. A static, a MULTI-IP alias, or the DHCP tab's SET LAPTOP IP… / + ALIAS remain on the card exactly like a manual change in Windows, and the next launch shows them with one-click PUT BACK. Temporary REACH addresses and RECON SILENT unbinds are still undone automatically (on quit, or next launch if the card was unplugged).
- **No new network behaviour.** No new ports, processes, rules or registry keys beyond 7.2.0's.
- **Data files** in `%APPDATA%\net-ether` may now include `leftovers.json` and, only if a file was damaged, `<name>.corrupt-<date>.json` (kept on purpose — don't clean them up blindly; they may hold a tech's site credentials, still DPAPI-encrypted).
- **Crash logging.** Unhandled errors go to the app's own diagnostics log (COPY DIAGNOSTICS); nothing is sent anywhere.

## Deployment notes for IT (v7.2.0)

- **New listening sockets while the DHCP tab is open.** UDP 5353 (mDNS) and UDP 1900 (SSDP) are joined on the selected adapter's addresses to hear devices announce themselves; every 8 s one multicast mDNS query (224.0.0.251) for camera/intercom service names goes out. Closed when the engine is turned off, the tab's card changes, or the app quits. Multicast answers aren't covered by Windows Firewall's response exception, so the app adds one program-scoped inbound rule, `NET-ETHER-DISCOVERY-UDP` (UDP 5353,1900, program = the NET-ETHER exe), the first time it listens, and removes it on quit — logged as OP `disc-fw-add` / `disc-fw-del`. IT may prefer to deploy that rule by policy instead. With Wireshark installed, one more `tshark` process captures only ARP and LLDP on that adapter for the same period. Nothing is sent to devices beyond the mDNS query.
- **One long-lived PowerShell.** The app now keeps a single hidden `powershell.exe -NoProfile -NonInteractive -NoLogo -Command -` for its read-only queries (Get-NetAdapter, Get-NetIPAddress, Get-NetIPInterface, Get-CimInstance Win32_NetworkAdapter). It is a child of NET-ETHER.exe, reads its commands from stdin, and exits with the app. If policy kills or blocks it, the app falls back to its 7.1 behaviour (one PowerShell per query).
- **Temporary addresses.** SET LAPTOP IP… (DHCP tab) sets a static address on the chosen card and reverts it on quit; + ALIAS and REACH add aliases that are removed on quit. All three are recovered on the next launch after a crash, and logged.
- **Process-launch self-check.** One `cmd.exe /c ver` 1.5 s after launch, timed for the diagnostics overlay.

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
