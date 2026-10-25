// NET//ETHER User Guide — v7.2.2 (document version 5.3)
// node build-guide.js → NET-ETHER-Guide.docx ; then soffice → PDF
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType, LevelFormat, PageBreak,
} = require('docx');

const ACCENT = '00875A', GREY = '555555', LIGHT = 'F2F2F2';
const FONT = 'Calibri';
const PAGE_W = 12240, MARGIN = 1080, TEXT_W = PAGE_W - 2 * MARGIN;

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 276 }, ...(opts.para || {}),
  children: Array.isArray(text) ? text : [new TextRun({ text, font: FONT, size: 22, ...(opts.run || {}) })],
});
const B = (text) => new TextRun({ text, font: FONT, size: 22, bold: true });
const T = (text) => new TextRun({ text, font: FONT, size: 22 });
const C = (text) => new TextRun({ text, font: 'Consolas', size: 20 });
const rich = (...runs) => new Paragraph({ spacing: { after: 120, line: 276 }, children: runs });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [new TextRun({ text: t, font: FONT, size: 32, bold: true, color: ACCENT })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, font: FONT, size: 26, bold: true, color: '222222' })] });
const bullet = (runs) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80, line: 276 }, children: Array.isArray(runs) ? runs : [T(runs)] });
const note = (runs) => new Paragraph({
  spacing: { before: 80, after: 160, line: 276 }, indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
  shading: { type: ShadingType.CLEAR, fill: LIGHT, color: 'auto' },
  children: Array.isArray(runs) ? runs : [T(runs)],
});
function table(rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (txt, w, head) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: 'E6F2EC', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0, line: 260 }, children: [new TextRun({ text: txt, font: head ? FONT : FONT, size: 20, bold: head })] })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({ tableHeader: i === 0, children: r.map((c, j) => cell(c, widths[j], i === 0)) })),
  });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    children: [
      // ── Cover ──
      new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: 'NET//ETHER', font: FONT, size: 72, bold: true, color: ACCENT })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Field Network Management Tool', font: FONT, size: 32, color: GREY })] }),
      new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: 'User Guide', font: FONT, size: 28, color: GREY })] }),
      P('Application version 7.2.2 · Document version 5.3', { run: { color: GREY } }),
      P('Broman Enterprises, SSP Division', { run: { color: GREY } }),
      P('© 2026 Broman Enterprises. All rights reserved.', { run: { color: GREY, size: 18 } }),
      new Paragraph({ children: [new PageBreak()] }),

      // ── 1 ──
      H1('1. What it is'),
      P('NET//ETHER is a compact, always-on-top Windows tool for low-voltage field technicians. It does six things fast: switches the laptop\'s wired adapter between IP configurations, serves DHCP to devices that need an address, monitors connectivity, scans a subnet to see what\'s there, listens to a port to learn what it is before you say anything, and remembers what was found at each site so the next visit starts with knowledge instead of guesswork.'),
      P('Version 7 absorbed NET//DHCP; 7.1 adds RECON, multicast discovery, link speed, a Wi-Fi switch, port blinking, Wake-on-LAN and a site report. One application, one installer, signed.'),
      P('It runs elevated because adapter changes go through Windows\' own netsh. On a company-managed laptop that elevation is granted silently by policy; on an unmanaged PC Windows asks once at launch. There are no prompts per operation.'),
      note([T('Everything the app knows lives on your laptop under '), C('%APPDATA%\\net-ether'), T('. Nothing is sent anywhere, except an optional vendor lookup for unknown MAC addresses that you can turn off.')]),

      // ── 2 ──
      H1('2. The window'),
      table([
        ['Control', 'What it does'],
        ['NET//ETHER logo', 'Drag the window from anywhere on the title bar.'],
        ['Version chip (e.g. v7.1.0)', 'Opens a small menu: DIAGNOSTICS, FIT WINDOW to snap the HUD to its content, and SITE REPORT, which copies a markdown summary of everything this session did (adapter, scans, RECON, DHCP, ping, every privileged command) for the ticket. Turns amber if the app is not running elevated.'],
        ['◑', 'Toggle 50% transparency so you can read what\'s behind the HUD.'],
        ['▣', 'Colour theme. Tab icons and accents follow it.'],
        ['?', 'Quick guide for the tab you\'re on, plus a CIDR reference. FULL MANUAL → opens this document.'],
        ['─', 'Hide to the system tray. Click the tray icon to bring it back; double-click always shows it.'],
        ['✕', 'Quit. If a Multi-IP is still on an adapter you\'re warned first (press ✕ again to quit anyway); if you changed any adapter this session you\'re offered a one-click restore. DHCP serving, temporary link-local aliases and RECON\'s adapter bindings are all put back before the app exits.'],
      ], [2600, TEXT_W - 2600]),
      gap(),
      H2('Size and position'),
      bullet('The window fits itself to the active tab. Drag it taller and that size holds until you switch tabs; lists stretch to fill the extra room. FIT WINDOW in the version-chip menu snaps it back. If a tab needs more height than there is room below, the window moves up rather than hanging off the bottom.'),
      bullet('Some tabs are wide: SCAN and SITES open at 640 px or wider, DHCP at 820 or wider, so a host fits on one line. A window you dragged wider stays wider. IP, PING and RECON return to the width you keep for them. The minimum width is 430 — visible beats small.'),
      bullet('Position, size and which display you left it on are remembered. If that display is gone next time, it comes back top-centre of the primary.'),
      bullet('Only one copy runs. Launching it again just brings the running window to the front — useful when a managed laptop takes a few seconds to elevate.'),
      bullet('Windows occasionally strips "always on top" from a window (the Win+Shift+S capture overlay does). The app re-asserts it the moment you click it or recall it from the tray.'),
      P('The tray icon pulses green normally, amber when the HUD is dimmed, and flashes red while any PING host is failing — even with the HUD hidden. The tooltip shows the DHCP serving state.'),

      // ── 3 ──
      H1('3. IP — adapter configuration'),
      P('Everything on this tab acts on the adapter chosen in the ADAPTER dropdown. Wireless, VPN and virtual adapters are filtered out; only wired Ethernet is listed. A connected adapter shows its negotiated link speed where it used to say CONNECTED — green for gigabit, amber for 100 Mb, red for 10 — because a gigabit port talking at 100 is a bad crimp, cable or switch port, and that is the first thing to know. Beside it, a DHCP or STATIC badge from the registry, shown whether or not the cable is in.'),
      table([
        ['State', 'Meaning'],
        ['1 GBPS / 100 MBPS / 10 MBPS', 'Link up with an address. The speed is what the switch and the NIC agreed on.'],
        ['NO ADDRESS', 'Link up, but Windows has no IPv4 address on it. On a DHCP adapter a RENEW button appears beside the badge; on a static one, APPLY.'],
        ['DISCONNECTED', 'No link. Cable, port or far end.'],
        ['DISABLED', 'Switched off in Windows. ENABLE in the ADAPTER line brings it back.'],
      ], [3000, TEXT_W - 3000]),
      gap(),
      P('The ADAPTER line carries two chips. WI-FI switches every wireless adapter off (or back on) so SCAN, DHCP and PING go out the wire and nothing else; it stays amber — WI-FI OFF — until you switch it back, and it stays off through a reboot, so don\'t leave the site without it. DISABLE / ENABLE does the same for the selected wired adapter: the link drops, the configuration is kept, ENABLE brings it back.'),
      note('Docks present their own network adapter. If you see two ("Ethernet" and "Ethernet 2"), pick the one with a link speed.'),
      H2('Wrong-address warning'),
      P('Move the cable from the office jack to a camera switch and Windows either keeps the last network\'s DHCP lease or falls back to 169.254.x.x. Either way the cameras\' subnet isn\'t reachable. An amber line under the ADAPTER says which it is — a self-assigned 169.254 address, a lease whose gateway no longer answers, or no address at all — with three ways out:'),
      bullet([B('HEAR THE WIRE'), T(' listens for ten seconds (ARP, mDNS, device LLDP) and lists the subnets devices are actually using, each with a free address and a USE button that fills in the form. APPLY still runs the duplicate check.')]),
      bullet([B('SET STATIC…'), T(' puts the cursor in the IP field. '), B('RENEW'), T(' asks DHCP again.')]),
      bullet('A SCAN from a 169.254 address says it only swept one /24 of the /16 — use DISCOVER or the DHCP tab\'s ◇ SITTING list for link-local devices.'),
      H2('Presets'),
      bullet([B('LIVE'), T(' always mirrors the adapter\'s current settings — address, mask, gateway and DNS, whether they came from DHCP or were set by hand — and is never saved.')]),
      bullet('Three named slots are yours. Pick one, fill in the fields and press SAVE TO PRESET (the button only appears on a saved slot). Double-click a slot name to rename it.'),
      H2('Factory defaults'),
      P('The FACTORY DEFAULTS button beside SAVE TO PRESET opens tiles for common device brands. A tile fills in that device\'s out-of-box subnet and puts your laptop one address above it. One exception:'),
      note('AXIS — current Axis cameras ship DHCP-only with no factory address. Without a DHCP server they fall back to a random 169.254.x.x address. The AXIS tile puts your laptop on 169.254.1.1 / 255.255.0.0, which reaches any of them; read the camera\'s actual address from its label or the Axis discovery tool, then open it in the browser. Or use the DHCP tab and give it a real address.'),
      H2('Applying'),
      table([
        ['Control', 'Action'],
        ['APPLY CONFIG', 'Writes IP, mask, gateway and DNS to the adapter, then re-reads it to confirm the change took. The button shows a moving sweep while netsh runs. A verified change lights the status bar green, tags the IP field ✓ ACTIVE and flashes the new address in the top bar. A failure turns the field red and shows netsh\'s own message.'],
        ['→ DHCP', 'Beside the STATIC badge in the adapter row. Click twice to hand the adapter back to DHCP. Switching to DHCP drops every Multi-IP on that adapter.'],
        ['RENEW', 'Beside the DHCP badge when the adapter has link but no address. Asks the DHCP server again.'],
        ['REVERT', 'Restores the configuration from before your last APPLY — straight back to DHCP if that is where you came from.'],
        ['COPY COMMANDS', 'Shows the exact netsh commands without running them, with a COPY button for an admin prompt.'],
        ['MTU → 1500', 'In DIAGNOSTICS → TOOLS. Resets MTU if it isn\'t 1500. Fixes "can ping, can\'t load web pages".'],
      ], [2600, TEXT_W - 2600]),
      gap(),
      P('A gateway is optional — leave it blank for direct device connections. 169.254 addresses are allowed; a note reminds you that 255.255.0.0 is usually the mask you want there. If netsh reports the address is already on the adapter (a DHCP lease or an alias), switch to DHCP first or pick a different address.'),
      H2('Multi-IP'),
      P('Adds a second IP to the adapter so you can reach a device on another subnet without losing your primary address.'),
      bullet('Enter the IP and mask, press ADD MULTI-IP. The mask defaults to 255.255.255.0 (255.255.0.0 for 169.254 addresses). The app confirms the address is really present before reporting success. The list marks your real address PRIMARY and only offers REMOVE on the others; it re-reads itself after every change, so what it shows is what Windows has.'),
      bullet('If the adapter is on DHCP, adding a multi-IP converts it to static (keeping its current lease values). The button asks for a second click before doing that.'),
      bullet([B('Remove multi-IPs before you leave.'), T(' Windows keeps them across reboots, and the app warns you if any are still active when you hide or quit.')]),

      // ── 4 ──
      H1('4. DHCP — serve addresses'),
      P('A DHCP server for the bench and the dead segment: a box of new cameras on a switch with no router, a site whose DHCP has died, a device that will not take a static address until it has had a lease. The laptop is the server. It hears everything and answers nothing until you say so.'),
      H2('Two steps at the top'),
      bullet([B('① NETWORK CARD'), T(' — the cable you\'re plugged into. The line under it says what the card is, its link speed, and whether it has an address. It follows the IP tab\'s adapter unless you pick another.')]),
      bullet([B('② LAPTOP\'S ADDRESS ON THAT CABLE'), T(' — the address the laptop answers DHCP from. Devices get addresses next to it, and it is how you reach them afterwards. Each address on the card is a chip; the selected one is filled in. No address? SET LAPTOP IP… gives the card one (192.168.0.1 by default — the factory subnet most of our gear expects — duplicate-checked on the wire, moved to the next if taken, reverted when you quit). + ALIAS adds a second, temporary address to hand out on another subnet while the laptop keeps its own.')]),
      bullet('A strip under the chips reads it back: LAPTOP 192.168.0.1 ── Ethernet 2 ── DEVICES GET 192.168.0.100 – .200.'),
      bullet([B('Settings from another job.'), T(' The tab remembers its last settings. If the saved laptop IP is not an address on the card any more (yesterday\'s site), it refills from the card when you open it and says so. A loaded profile that doesn\'t match gets REFILL FROM CARD / + ADD AS ALIAS, and nothing is ever served from an address the card doesn\'t have.')]),
      H2('The everyday flow — one device'),
      P('Plug the device in. It appears ASKING, with what it says it is under DEVICE — Axis puts the model and firmware in its DHCP request, so an A1210 reads "AXIS A1210 12.2.63" before it has an address. The IP box on its row is the address it will get: type the one it should end up on, press ▶ SERVE, then ↗ OPEN on the row. Set it static on the device on that same address and stop — when it stops renewing (or releases its lease) but still answers there, the row turns ✓ STATIC and the lease is freed. The next device that asks starts one address higher, so a run of cameras off one PoE injector is SERVE, OPEN, next row. Only the devices you serve are answered; on a customer network their DHCP is untouched.'),
      H2('◇ SITTING — heard, not asking'),
      P('While the tab listens it also hears what devices announce to the whole wire — mDNS, SSDP, and (with Wireshark installed) ARP and device LLDP — whatever subnet they are on. That is how AXIS IP Utility finds things. A device that isn\'t asking for DHCP shows as ◇ SITTING with its address, name and model. ↗ OPEN if it\'s on the laptop\'s subnet; otherwise ⇢ REACH gives the laptop a temporary address next to it (on its /24, or 169.254/16) and opens it.'),
      H2('How it behaves'),
      bullet([B('Off at launch.'), T(' Nothing listens on the DHCP port until you open the tab. Opening it starts LISTEN: every device asking for an address appears in the table as ASKING, with the address it would be given.')]),
      bullet([B('Serving is opt-in, per device.'), T(' SERVE on a row answers only that device. Tick several rows and press SERVE TICKED to answer just those. This is the right choice on a customer network that has DHCP of its own.')]),
      bullet([B('SERVE EVERYONE…'), T(' (the small amber button) answers everyone. It asks first, then scans the wire for other DHCP servers and stops to ask if it finds one — or if one was heard in the last two minutes, even if it didn\'t answer this time. It also warns when the laptop is connected to another network at the same time (Wi-Fi, usually): requests from that side show up in the list too. The answers themselves always go out the card you picked in step ①, Wi-Fi or not.')]),
      bullet('Before offering an address the server pings it; anything that answers is skipped. A device reporting a conflict has that address quarantined.'),
      bullet('The server never interferes with another server\'s clients. A device reconfirming a lease it got from the site\'s router gets silence, not a refusal.'),
      bullet('A device that comes back gets the address it had before, for up to an hour. ★ on a row pins a device to a fixed address permanently.'),
      bullet('Serving stops on its own after 30 minutes with nothing to do (ADVANCED OPTIONS changes or disables this). The status chip — OFF / LISTENING / SERVING N / SERVING EVERYONE — is also the on-off switch; OFF releases the port and removes the firewall rule. The same red / green / amber dot sits on the DHCP tab itself, so the engine\'s state is visible from every tab. While RECON\'s SILENT listen has the adapter the engine shows SUSPENDED and resumes by itself.'),
      H2('Controls'),
      table([
        ['Control', 'What it does'],
        ['① CARD · ② LAPTOP IP', 'Which cable, and the laptop\'s address on it (chips). SET LAPTOP IP… and + ALIAS add an address — both temporary, reverted when you quit and recovered on the next launch after a force-close.'],
        ['ADDRESSES TO HAND OUT', 'First, last, mask, gateway (blank = laptop) and lease (1 min … 1 day, default 5 min). Filled in from the laptop address you pick. ADVANCED adds DNS, domain, NTP, TFTP, boot file, vendor option 43 and the idle timer.'],
        ['Profiles', 'Save the settings under a name and load them on the next job — checked against the card when loaded.'],
        ['SERVE EVERYONE…', 'Answer every device on the cable. Asks first, scans the wire, warns about another live server or a second network.'],
        ['SCAN WIRE', 'Active check for other DHCP servers, about six seconds. No serving, no changes.'],
        ['SELF-TEST', 'Adapter, port, firewall rule, other servers, policy — in plain language.'],
        ['Device rows', 'Status (ASKING · SERVED · ✓ STATIC · ◇ SITTING), address, MAC, device (model / vendor), hostname, activity. ▶ SERVE with the typed address, ↗ OPEN (web UI — http or https, whichever the device answers; a certificate warning on a brand-new device is normal), ⇢ REACH, ★ pin, ✕ take the address back. Tick several rows and ★ RESERVE TICKED gives them consecutive fixed addresses from a start you type — twenty cameras in one go; the server, gateway and existing reservations are skipped.'],
        ['CSV · LOG', 'Lease table or activity log to the clipboard. The bar between the table and the log drags to resize.'],
      ], [2600, TEXT_W - 2600]),
      gap(),
      note([T('Every serve, firewall change and static-address step is written to DIAGNOSTICS. IT can switch the server off with the '), C('DisableDhcpServer'), T(' policy value; the tab then shows a notice and stays read-only.')]),

      // ── 5 ──
      H1('5. PING — connectivity monitor'),
      bullet('Up to 8 hosts. + GATEWAY and + MY IP add the two most useful ones. PING on a SCAN row adds that device and starts the monitor.'),
      bullet('A plain target is pinged; if ping is blocked, a TCP connection to port 80 counts as alive, so it works through switches and appliances that drop ICMP. Add :port to a target (192.168.0.50:554) to watch one service instead: CLOSED means the host answered but that port is shut, FAIL means the host is gone. The status line counts the two separately.'),
      bullet('Dot colour: green under 150 ms, amber at 150 ms and above, red for no response. The sparkline is the last 60 samples.'),
      bullet([B('♪ TONER'), T(' — hear one host. Every reply is a sonar ping; when the host stops answering you get a downward sweep and then the alarm, repeating; when it\'s back, an upward sweep and the sonar again. Pull cables at the switch with the laptop across the room and listen. One host at a time; STOP silences it.')]),
      bullet([B('⚡ BLINK'), T(' — with a host toned, 20 seconds of tiny packets to it so that port\'s activity LED strobes on the switch. Find the port without pulling anything. Same subnet only.')]),
      bullet('The sonar pitch drops as latency climbs, so a struggling link is audible before it fails. If the HUD is in the tray when the toned host flips state, a Windows toast tells you; clicking it brings the HUD back.'),
      bullet('TRCRT runs a live traceroute to that host. ◉ opens a Wireshark capture filtered to that host (when Wireshark is installed). COPY puts the whole summary on the clipboard for the service report.'),
      bullet('PAUSE freezes the display and keeps the data; STOP clears everything.'),

      // ── 6 ──
      H1('6. SCAN — subnet discovery'),
      P('Two buttons, two ways to find things. SCAN SUBNET sweeps a /24 with ICMP and ARP, probes fourteen service ports on every responder (web, RTSP, RDP, SSH and the Hikvision, Dahua, Bosch and Genetec ports), then resolves names. DISCOVER asks the wire instead: one WS-Discovery/ONVIF probe, one SSDP, one mDNS, three seconds. Discovery runs alongside every sweep and on its own, and it finds what a sweep cannot — a camera on a different subnet, a factory-default box on 169.254.x.x — because the probe is multicast and the reply comes back over the same cable regardless of IP.'),
      bullet('BASE IP is filled from the adapter. Narrow the range (for example 1-60) to finish faster.'),
      bullet('Site picker loads a saved site\'s subnet. Scanning a known subnet compares the results against that site\'s device list.'),
      bullet('Each row shows IP, MAC, response time, hostname, vendor, open ports and — when the device answered discovery — a badge (ONVIF, SSDP, mDNS) with its name, model and URLs in the tooltip. Your own laptop is marked SELF. IP, MAC, PING and WSHARK copy, hand the device to the monitor, or open a Wireshark capture filtered to it. A row found by discovery alone shows the source where the response time would be.'),
      bullet([B('REACH'), T(' appears on 169.254 rows. It adds a temporary link-local address to your adapter (converting a DHCP adapter to static first, with a warning), opens the device\'s web page, and shows an amber LINK-LOCAL chip with REMOVE. The alias is removed when you quit, and cleaned up on the next launch if the app was force-closed.')]),
      bullet('Hostnames come from reverse DNS or, failing that, a NetBIOS name query — which is what most Windows PCs, NAS units, printers and NVRs answer.'),
      bullet('Vendor names come from a bundled offline database of 57,000 manufacturer prefixes, with short names for the brands you meet on site. ONLINE VENDOR LOOKUP controls whether misses are looked up on macvendors.com; your IT department can force it off.'),
      bullet('OPEN launches the device\'s web interface. RDP and SSH do what they say. RTSP cameras without a web UI get their stream URL copied instead.'),
      bullet('COPY ▾ puts the whole list on the clipboard as CSV (for Excel) or a markdown table (for the ticket). SAVE SITE stores the results for next time.'),
      note('After scanning a known site\'s subnet an amber chip appears under the results: "SITE — +2 NEW · 1 MISSING". Press VIEW → to jump to the site with those changes listed. The chip stays until you dismiss it or start another scan; the app never switches tabs on its own.'),

      // ── 7 ──
      H1('7. SITES — site knowledge base'),
      P('One record per site, one record per device, devices anchored by MAC address so an IP change is tracked instead of creating a duplicate.'),
      bullet('Site card: name, tag, last scan, device count, and change badges since the previous scan.'),
      bullet('Device drawer: click a device for MAC, hostname, first and last seen, open ports, notes, and credentials.'),
      bullet('Type chip: click to cycle CAMERA · NVR/DVR · NETWORK · SERVER · WORKSTATION · ACCESS CTL · PRINTER · MEDIA · OTHER. Types are guessed from what the device announces (ONVIF, printer or media services) first and its MAC vendor second; a type you set by hand is kept.'),
      bullet('WAKE in the device drawer sends a Wake-on-LAN magic packet to that MAC on every connected subnet. Give it thirty seconds, then scan.'),
      bullet('DELETE on a site writes a backup of the whole database first.'),
      bullet('SCAN NOW loads the site\'s subnet into SCAN; the results come back as a change chip.'),
      H2('Credentials'),
      P('Each device can store any number of label/value pairs (web UI login, ONVIF user, and so on). Values are masked; the eye icon reveals one at a time.'),
      P('On disk, credential values are encrypted with Windows Data Protection (DPAPI). They can only be read by your Windows account on this machine.'),
      H2('Export and import'),
      table([
        ['Button', 'What you get'],
        ['EXCEL', 'A formatted workbook of every site and device — the right thing to send to a customer or another tech.'],
        ['JSON', 'A portable file for moving your data to another machine. Credentials are left out unless you choose WITH CREDS, which writes them as readable text — only do that for a file you\'ll move and then delete.'],
        ['IMPORT', 'Reads a JSON export. Your current data is backed up first (the last five backups are kept). MERGE keeps everything you have and adds what\'s new, matching devices by MAC; REPLACE discards everything and loads the file. Imported files are checked and cleaned before anything is shown.'],
      ], [2000, TEXT_W - 2000]),
      gap(),

      // ── 8 ──
      H1('8. RECON — listen before you talk'),
      P('Plug into a port, say nothing, and let the port tell you what it is. RECON runs a passive capture through the Wireshark that is already on the laptop for up to 65 seconds and turns what it hears into verdicts, in the order they arrive. Nothing is transmitted.'),
      table([
        ['Card', 'What it tells you'],
        ['SWITCH', 'Switch name, port and VLAN from LLDP (every 30 s) or CDP (every 60 s). "No announcement" means LLDP/CDP is off on that port or it is not a managed switch — an answer, not an error.'],
        ['802.1X', 'Whether the switch asked for authentication. A camera without a certificate on such a port gets MAB or the guest VLAN, if anything.'],
        ['STP / TRUNK', 'Spanning-tree running (don\'t hang an unmanaged switch off it); tagged frames or per-VLAN BPDUs for several VLANs mean a trunk, where an untagged device lands on the native VLAN.'],
        ['DHCP', 'Which server answered, with the gateway, mask and DNS it handed out. "Clients asking, nobody answering" is the dead-server signature.'],
        ['HOSTS', 'How many addresses were heard and on which subnet. More than one subnet on an access port is worth a question.'],
        ['ADDRESS', 'A free-looking address on the busiest subnet, with the mask and gateway heard. TAKE puts it into the IP tab form; APPLY still runs the duplicate check.'],
        ['NAMES / NTP', 'NetBIOS and mDNS names hosts announced; time servers clients are asking.'],
      ], [2000, TEXT_W - 2000]),
      gap(),
      bullet('STANDARD leaves the adapter as it is; Windows itself still chatters (DHCP, NetBIOS, LLMNR), which is why a STANDARD listen finds the DHCP server — it asked.'),
      bullet('SILENT unbinds IPv4 and IPv6 from the adapter for the listen so nothing leaves the port, not even a DHCP request, then restores them: when the listen ends, when you stop it, when you quit, and on the next launch if the app was force-closed. The app checks that Windows really recreated the IPv4 interface and asks for a DHCP lease again if one doesn\'t come back on its own. The DHCP server, if running, pauses while SILENT has the adapter.'),
      bullet('WIRESHARK opens the whole adapter live, unfiltered. COPY puts the verdicts on the clipboard; they also go into the SITE REPORT.'),
      note('RECON needs Wireshark 4.6 or newer with npcap. Many Windows NIC drivers strip 802.1Q tags before the capture sees them, so a trunk is recognised from per-VLAN BPDUs and CDP/LLDP as much as from tags.'),

      // ── 9 ──
      H1('9. DIAGNOSTICS'),
      P('Version chip → DIAGNOSTICS.'),
      bullet('TOOLS — MTU → 1500 for the adapter selected on the IP tab.'),
      bullet('STATE — version, whether the app is elevated, your user and machine, where the data lives, Wireshark and tshark, credential storage status, the DHCP engine\'s state, and any policy in effect.'),
      bullet([B('PROCESS LAUNCH'), T(' — how long one bare process launch (cmd /c ver) takes on this laptop, timed at start-up, with a verdict, plus how many launches the app has made and the slowest. Endpoint security inspects every launch; on a healthy box it is tens of milliseconds, on a managed laptop a few hundred, and over a second means every action that runs a command will lag — the first number to read on an "it\'s slow" report. PS WORKER shows the one PowerShell the app keeps open for its read-only queries.')]),
      bullet('LOG — every adapter change the app made, with the exact commands run, their output, and whether the change was confirmed. Also launches, backups, imports, DHCP engine and firewall changes, rogue-server scans, discovery and RECON summaries, Wake-on-LAN, port blinks and name-resolution timings. Survives restarts.'),
      bullet('COPY DIAGNOSTICS — puts a plain-text report on the clipboard.'),
      note('If something doesn\'t work, that report is what to send. It says exactly what Windows was asked to do and what Windows said back.'),

      // ── 10 ──
      H1('10. Common workflows'),
      H2('Arriving at a new site'),
      P('Plug in. The IP tab shows the adapter, its link speed and its current state in LIVE. Not sure what the port is? RECON → LISTEN: in a minute you know the switch and port you are on, whether it wants 802.1X, which VLAN, who hands out addresses, and a free address you could take. Then pick a preset or a Factory Default, APPLY, and the status line, the IP field and the top bar all confirm the change. If the device you need is on a second subnet, add a Multi-IP instead of changing your primary.'),
      H2('A box of new cameras on a bench switch'),
      P('DHCP tab. ① pick the card; ② SET LAPTOP IP… if it has no address (192.168.0.1). Cameras appear as they ask: type the address each should end up on, ▶ SERVE, ↗ OPEN, set it static, next row. SERVE EVERYONE… if you just want them all to have an address. Quit when done — the laptop\'s adapter goes back the way it was.'),
      H2('One device on a live customer network'),
      P('DHCP tab. Watch the table; the device shows up ASKING with the address it would get. SERVE on that row — only that device is answered, the customer\'s DHCP is untouched.'),
      H2('A factory-default camera'),
      P('DHCP tab: a camera on its fallback address shows as ◇ SITTING with its model, even though your laptop is on another subnet. ⇢ REACH gives the laptop a temporary address next to it and opens its web page. (SCAN → DISCOVER and REACH do the same from the SCAN tab.) Give it its real address, then REMOVE on the chip (or just quit).'),
      H2('Finding which cable is which'),
      P('PING the device, press ♪ on its row, walk to the switch. Pull cables until the sonar turns into the alarm; that\'s the one. Or press ⚡ BLINK and watch for the port LED that strobes — no pulling needed.'),
      H2('Finding a camera that\'s stopped answering'),
      P('SITES → the site → SCAN NOW. When the sweep finishes, the change chip tells you if it\'s MISSING (not on the wire), MOVED (new IP — usually DHCP), or present with a different open-port pattern (rebooted into a bad state). VIEW → shows which.'),
      H2('"It pings but the web page won\'t load"'),
      P('Version chip → DIAGNOSTICS → MTU → 1500. If the adapter was left at a jumbo or PPPoE-sized MTU by something else, one click fixes it.'),
      H2('Handing a site to another technician'),
      P('SITES → EXCEL for a document they can read anywhere, or JSON if they also run NET//ETHER and should import the records.'),
      H2('Writing the ticket'),
      P('Version chip → SITE REPORT. One click copies what this session did — adapter and switch port, scans and site changes, RECON verdicts, DHCP leases, ping results, every privileged command with its time — as markdown. Paste it in.'),

      // ── 11 ──
      H1('11. Data and privacy'),
      bullet([T('All data is stored under '), C('%APPDATA%\\net-ether'), T(' on the technician\'s laptop.')]),
      bullet('No software is installed on customer systems and no customer network data leaves the laptop.'),
      bullet('Stored credentials are encrypted per user and per machine.'),
      bullet('The only outbound internet request is the optional vendor lookup, and it sends only the first half of a MAC address.'),
      bullet('The DHCP server listens only while the DHCP tab has been opened, adds one inbound firewall rule for that port while it runs, and removes it when it stops or the app quits.'),
      bullet('Discovery sends three multicast probes per scan; BLINK and Wake-on-LAN send small UDP packets only when you press them; RECON transmits nothing. Everything the app sends is listed, with the command and its output, in the diagnostics log and in FUNCTIONS.md in the source repository.'),
      bullet('Releases are code-signed. The application cannot be used as a general Node.js runtime by other software on the laptop (Electron fuses).'),
      bullet([T('IT policy values: '), C('DisableOnlineVendorLookup'), T(' and '), C('DisableDhcpServer'), T(' under '), C('HKLM\\SOFTWARE\\Policies\\Broman Enterprises\\NET-ETHER'), T('.')]),
      bullet('Uninstalling the application leaves the data folder in place.'),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => { fs.writeFileSync('NET-ETHER-Guide.docx', buf); console.log('docx written'); });
