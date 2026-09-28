// NET//ETHER User Guide — v7.0.0 (document version 4.0)
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
      P('Application version 7.0.0 · Document version 4.0', { run: { color: GREY } }),
      P('Broman Enterprises, SSP Division', { run: { color: GREY } }),
      P('© 2026 Broman Enterprises. All rights reserved.', { run: { color: GREY, size: 18 } }),
      new Paragraph({ children: [new PageBreak()] }),

      // ── 1 ──
      H1('1. What it is'),
      P('NET//ETHER is a compact, always-on-top Windows tool for low-voltage field technicians. It does five things fast: switches the laptop\'s wired adapter between IP configurations, serves DHCP to devices that need an address, monitors connectivity, scans a subnet to see what\'s there, and remembers what was found at each site so the next visit starts with knowledge instead of guesswork.'),
      P('Version 7 absorbs NET//DHCP. The standalone DHCP tool is now the DHCP tab — one application, one installer, one thing for IT to approve.'),
      P('It runs elevated because adapter changes go through Windows\' own netsh. On a company-managed laptop that elevation is granted silently by policy; on an unmanaged PC Windows asks once at launch. There are no prompts per operation.'),
      note([T('Everything the app knows lives on your laptop under '), C('%APPDATA%\\net-ether'), T('. Nothing is sent anywhere, except an optional vendor lookup for unknown MAC addresses that you can turn off.')]),

      // ── 2 ──
      H1('2. The window'),
      table([
        ['Control', 'What it does'],
        ['NET//ETHER logo', 'Drag the window from anywhere on the title bar.'],
        ['Version chip (e.g. v7.0.0)', 'Opens a small menu: DIAGNOSTICS, and FIT WINDOW to snap the HUD to its content. Turns amber if the app is not running elevated.'],
        ['◑', 'Toggle 50% transparency so you can read what\'s behind the HUD.'],
        ['▣', 'Colour theme. Tab icons and accents follow it.'],
        ['?', 'Quick guide for the tab you\'re on, plus a CIDR reference. FULL MANUAL → opens this document.'],
        ['─', 'Hide to the system tray. Click the tray icon to bring it back; double-click always shows it.'],
        ['✕', 'Quit. If you changed any adapter this session you\'re offered a one-click restore first. Any DHCP serving is shut down cleanly.'],
      ], [2600, TEXT_W - 2600]),
      gap(),
      H2('Size and position'),
      bullet('The window fits itself to the active tab. Drag it taller and that size holds until you switch tabs; lists stretch to fill the extra room. FIT WINDOW in the version-chip menu snaps it back.'),
      bullet('DHCP is the wide tab: the window grows to about 820 px while it\'s open and returns to your normal width when you leave.'),
      bullet('Position, size and which display you left it on are remembered. If that display is gone next time, it comes back top-centre of the primary.'),
      bullet('Only one copy runs. Launching it again just brings the running window to the front — useful when a managed laptop takes a few seconds to elevate.'),
      bullet('Windows occasionally strips "always on top" from a window (the Win+Shift+S capture overlay does). The app re-asserts it the moment you click it or recall it from the tray.'),
      P('The tray icon pulses green normally, amber when the HUD is dimmed, and flashes red while any PING host is failing — even with the HUD hidden. The tooltip shows the DHCP serving state.'),

      // ── 3 ──
      H1('3. ETHER — adapter configuration'),
      P('Everything on this tab acts on the adapter chosen in the ADAPTER dropdown. Wireless, VPN and virtual adapters are filtered out; only wired Ethernet is listed, each with its connection state and a DHCP or STATIC badge.'),
      note('Docks present their own network adapter. If you see two ("Ethernet" and "Ethernet 2"), pick the one that says CONNECTED.'),
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
        ['→ DHCP', 'Beside the STATIC badge in the adapter row. Click twice to hand the adapter back to DHCP.'],
        ['REVERT', 'Restores the configuration from before your last APPLY.'],
        ['COPY COMMANDS', 'Shows the exact netsh commands without running them, with a COPY button for an admin prompt.'],
        ['MTU → 1500', 'In DIAGNOSTICS → TOOLS. Resets MTU if it isn\'t 1500. Fixes "can ping, can\'t load web pages".'],
      ], [2600, TEXT_W - 2600]),
      gap(),
      P('A gateway is optional — leave it blank for direct device connections. 169.254 addresses are allowed; a note reminds you that 255.255.0.0 is usually the mask you want there. If netsh reports the address is already on the adapter (a DHCP lease or an alias), switch to DHCP first or pick a different address.'),
      H2('Multi-IP'),
      P('Adds a second IP to the adapter so you can reach a device on another subnet without losing your primary address.'),
      bullet('Enter the IP and mask, press ADD MULTI-IP. The app confirms the address is really present before reporting success.'),
      bullet('If the adapter is on DHCP, adding a multi-IP converts it to static (keeping its current lease values). The button asks for a second click before doing that.'),
      bullet([B('Remove multi-IPs before you leave.'), T(' Windows keeps them across reboots, and the app warns you if any are still active when you hide or quit.')]),

      // ── 4 ──
      H1('4. DHCP — serve addresses'),
      P('A DHCP server for the bench and the dead segment: a box of new cameras on a switch with no router, a site whose DHCP has died, a device that will not take a static address until it has had a lease. It hears everything and answers nothing until you say so.'),
      H2('How it behaves'),
      bullet([B('Off at launch.'), T(' Nothing listens on the DHCP port until you open the tab. Opening it starts LISTEN: every device asking for an address appears in the table as ASKING, with the address it would be given.')]),
      bullet([B('Serving is opt-in, per device.'), T(' SERVE on a row answers only that device. Tick several rows and press SERVE SELECTED to answer just those. This is the right choice on a customer network that has DHCP of its own.')]),
      bullet([B('SERVE ALL DEVICES'), T(' answers everyone. It first scans the wire for other DHCP servers and stops to ask if it finds one — or if one was heard in the last two minutes, even if it didn\'t answer this time. It also warns when the laptop is connected to another network at the same time (Wi-Fi, usually), because serving everyone would answer that side too.')]),
      bullet('Before offering an address the server pings it; anything that answers is skipped. A device reporting a conflict has that address quarantined.'),
      bullet('The server never interferes with another server\'s clients. A device reconfirming a lease it got from the site\'s router gets silence, not a refusal.'),
      bullet('A device that comes back gets the address it had before, for up to an hour. ★ on a row pins a device to a fixed address permanently.'),
      bullet('Serving stops on its own after 30 minutes with nothing to do (ADVANCED OPTIONS changes or disables this). The mode badge — OFFLINE / LISTENING / SERVING — is also the on-off switch; OFFLINE releases the port and removes the firewall rule.'),
      H2('Controls'),
      table([
        ['Control', 'What it does'],
        ['SERVE ON', 'Which adapter to serve on. Follows the ETHER tab\'s adapter unless you pick another. LINK UP / NO LINK beside it is live.'],
        ['DHCP SETTINGS', 'Server IP (this PC), mask, pool start and end, gateway (blank = this PC), lease length. Filled in from the adapter when you pick it. ADVANCED adds DNS, domain, NTP, TFTP, boot file, vendor option 43 and the idle timer.'],
        ['Profiles', 'Save the settings under a name and load them on the next job.'],
        ['QUICK START', 'Picks the wired adapter, fills the pool from its subnet, scans the wire, serves. If the adapter has no usable address it offers to set a temporary static one through the ETHER apply path — reverted when you quit, and recovered on the next launch if the app was force-closed.'],
        ['SCAN WIRE', 'Active check for other DHCP servers, about six seconds. No serving, no changes.'],
        ['SELF-TEST', 'Adapter, port, firewall rule, other servers, policy — in plain language.'],
        ['Device rows', 'Status, address, MAC, vendor, hostname, activity. SERVE, OPEN (web UI), ★ pin, ✕ take the address back. Randomised MACs (phones with privacy on) are labelled as such.'],
        ['CSV · LOG', 'Lease table or activity log to the clipboard. The bar between the table and the log drags to resize.'],
      ], [2600, TEXT_W - 2600]),
      gap(),
      note([T('Every serve, firewall change and static-address step is written to DIAGNOSTICS. IT can switch the server off with the '), C('DisableDhcpServer'), T(' policy value; the tab then shows a notice and stays read-only.')]),

      // ── 5 ──
      H1('5. PING — connectivity monitor'),
      bullet('Up to 8 hosts. + GATEWAY and + MY IP add the two most useful ones. PING on a SCAN row adds that device and starts the monitor.'),
      bullet('Checks use a TCP connection to port 80, not ICMP, so they work through switches and appliances that drop ping.'),
      bullet('Dot colour: green under 150 ms, amber at 150 ms and above, red for no response. The sparkline is the last 60 samples.'),
      bullet([B('♪ TONER'), T(' — hear one host. Every reply is a sonar ping; when the host stops answering you get a downward sweep and then the alarm, repeating; when it\'s back, an upward sweep and the sonar again. Pull cables at the switch with the laptop across the room and listen. One host at a time; STOP silences it.')]),
      bullet('TRCRT runs a live traceroute to that host. COPY puts the whole summary on the clipboard for the service report.'),
      bullet('PAUSE freezes the display and keeps the data; STOP clears everything.'),

      // ── 6 ──
      H1('6. SCAN — subnet discovery'),
      P('Sweeps a /24 with ICMP and ARP, probes ten common service ports on every responder, then resolves names. Rows are kept in address order as they arrive.'),
      bullet('BASE IP is filled from the adapter. Narrow the range (for example 1-60) to finish faster.'),
      bullet('Site picker loads a saved site\'s subnet. Scanning a known subnet compares the results against that site\'s device list.'),
      bullet('Each row shows IP, response time, MAC, hostname, vendor, and open ports. Your own laptop is marked SELF. IP, MAC and PING buttons copy or hand the device to the monitor.'),
      bullet('Hostnames come from reverse DNS or, failing that, a NetBIOS name query — which is what most Windows PCs, NAS units, printers and NVRs answer.'),
      bullet('Vendor names come from a bundled offline database of 57,000 manufacturer prefixes, with short names for the brands you meet on site. ONLINE VENDOR LOOKUP controls whether misses are looked up on macvendors.com; your IT department can force it off.'),
      bullet('OPEN launches the device\'s web interface. RDP and SSH do what they say. RTSP cameras without a web UI get their stream URL copied instead.'),
      bullet('SAVE SITE stores the results for next time.'),
      note('After scanning a known site\'s subnet an amber chip appears under the results: "SITE — +2 NEW · 1 MISSING". Press VIEW → to jump to the site with those changes listed. The chip stays until you dismiss it or start another scan; the app never switches tabs on its own.'),

      // ── 7 ──
      H1('7. SITES — site knowledge base'),
      P('One record per site, one record per device, devices anchored by MAC address so an IP change is tracked instead of creating a duplicate.'),
      bullet('Site card: name, tag, last scan, device count, and change badges since the previous scan.'),
      bullet('Device drawer: click a device for MAC, hostname, first and last seen, open ports, notes, and credentials.'),
      bullet('Type chip: click to cycle CAMERA · NVR/DVR · NETWORK · SERVER · WORKSTATION · ACCESS CTL · PRINTER · OTHER. Types are guessed from the vendor and can be corrected.'),
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
      H1('8. DIAGNOSTICS'),
      P('Version chip → DIAGNOSTICS.'),
      bullet('TOOLS — MTU → 1500 for the adapter selected in ETHER.'),
      bullet('STATE — version, whether the app is elevated, your user and machine, where the data lives, credential storage status, the DHCP engine\'s state, and any policy in effect.'),
      bullet('LOG — every adapter change the app made, with the exact commands run, their output, and whether the change was confirmed. Also launches, backups, imports, DHCP engine and firewall changes, rogue-server scans, and name-resolution timings. Survives restarts.'),
      bullet('COPY DIAGNOSTICS — puts a plain-text report on the clipboard.'),
      note('If something doesn\'t work, that report is what to send. It says exactly what Windows was asked to do and what Windows said back.'),

      // ── 9 ──
      H1('9. Common workflows'),
      H2('Arriving at a new site'),
      P('Plug in. ETHER shows the adapter and its current state in LIVE. Pick a preset or a Factory Default, APPLY, and the status line, the IP field and the top bar all confirm the change. If the device you need is on a second subnet, add a Multi-IP instead of changing your primary.'),
      H2('A box of new cameras on a bench switch'),
      P('DHCP tab. QUICK START picks the adapter, sets the pool, checks the wire and starts serving; if the laptop has no address it offers to set one. Cameras appear as they ask, get addresses, and OPEN takes you to each web UI. Quit when done — the laptop\'s adapter goes back the way it was.'),
      H2('One device on a live customer network'),
      P('DHCP tab. Watch the table; the device shows up ASKING with the address it would get. SERVE on that row — only that device is answered, the customer\'s DHCP is untouched.'),
      H2('Finding which cable is which'),
      P('PING the device, press ♪ on its row, walk to the switch. Pull cables until the sonar turns into the alarm; that\'s the one.'),
      H2('Finding a camera that\'s stopped answering'),
      P('SITES → the site → SCAN NOW. When the sweep finishes, the change chip tells you if it\'s MISSING (not on the wire), MOVED (new IP — usually DHCP), or present with a different open-port pattern (rebooted into a bad state). VIEW → shows which.'),
      H2('"It pings but the web page won\'t load"'),
      P('Version chip → DIAGNOSTICS → MTU → 1500. If the adapter was left at a jumbo or PPPoE-sized MTU by something else, one click fixes it.'),
      H2('Handing a site to another technician'),
      P('SITES → EXCEL for a document they can read anywhere, or JSON if they also run NET//ETHER and should import the records.'),

      // ── 10 ──
      H1('10. Data and privacy'),
      bullet([T('All data is stored under '), C('%APPDATA%\\net-ether'), T(' on the technician\'s laptop.')]),
      bullet('No software is installed on customer systems and no customer network data leaves the laptop.'),
      bullet('Stored credentials are encrypted per user and per machine.'),
      bullet('The only outbound internet request is the optional vendor lookup, and it sends only the first half of a MAC address.'),
      bullet('The DHCP server listens only while the DHCP tab has been opened, adds one inbound firewall rule for that port while it runs, and removes it when it stops or the app quits.'),
      bullet([T('IT policy values: '), C('DisableOnlineVendorLookup'), T(' and '), C('DisableDhcpServer'), T(' under '), C('HKLM\\SOFTWARE\\Policies\\Broman Enterprises\\NET-ETHER'), T('.')]),
      bullet('Uninstalling the application leaves the data folder in place.'),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => { fs.writeFileSync('NET-ETHER-Guide.docx', buf); console.log('docx written'); });
