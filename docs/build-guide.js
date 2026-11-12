// NET//ETHER User Guide — v7.4.0 (document version 7.1, the visual guide)
// node build-guide.js → NET-ETHER-Guide.docx ; then soffice → PDF
// Screenshots in docs/img come from the tutorial film rig (shots.js + annotate.py in the pipeline zip).
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, ImageRun,
  WidthType, AlignmentType, BorderStyle, ShadingType, LevelFormat, PageBreak, VerticalAlign,
  Footer, PageNumber, TableLayoutType,
} = require('docx');

const ACCENT = '00875A', GREY = '555555', LIGHT = 'F2F2F2', PINK = 'E0207A', HELP_FILL = 'EAF3FB', HELP_LINE = '2F7BC4';
const FONT = 'Calibri';
const PAGE_W = 12240, MARGIN = 1080, TEXT_W = PAGE_W - 2 * MARGIN;   // 7 in of text
const IMG = path.join(__dirname, 'img');

// ── text ──
// LibreOffice draws ▶ ↩ ⚡ as colour emoji; keep them as text glyphs
const glyph = (s) => String(s).replace(/▶/g, '►').replace(/↩\uFE0E?/g, '↶').replace(/⚡(?!\uFE0E)/g, '⚡\uFE0E');
const T = (text, o = {}) => new TextRun({ text: glyph(text), font: FONT, size: 22, ...o });
const B = (text) => T(text, { bold: true });
const C = (text) => new TextRun({ text, font: 'Consolas', size: 20 });
const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 276 }, ...(opts.para || {}),
  children: Array.isArray(text) ? text : [T(text, opts.run || {})],
});
const rich = (...runs) => new Paragraph({ spacing: { after: 120, line: 276 }, children: runs });
const H1 = (t, brk = true) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: brk, keepNext: true, spacing: { before: brk ? 0 : 280, after: 120 }, children: [T(t, { size: 34, bold: true, color: ACCENT })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 260, after: 100 }, children: [T(t, { size: 26, bold: true, color: '222222' })] });
const PART = (n, t, sub, brk = true) => [
  new Paragraph({ pageBreakBefore: brk, keepNext: true, spacing: { before: brk ? 0 : 360, after: 40 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } },
    children: [T(`PART ${n}  `, { size: 22, bold: true, color: GREY, characterSpacing: 40 }), T(t, { size: 40, bold: true, color: ACCENT }), T(`   ${sub}`, { size: 20, color: GREY })] }),
  gap(60),
];
const bullet = (runs) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80, line: 276 }, children: Array.isArray(runs) ? runs : [T(runs)] });
const step = (runs) => new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 90, line: 276 }, children: Array.isArray(runs) ? runs : [T(runs)] });
const restartSteps = []; // docx numbering restarts per instance
let stepInst = 0;
const steps = (items) => { stepInst++; return items.map(r => new Paragraph({ numbering: { reference: 'steps', level: 0, instance: stepInst }, spacing: { after: 90, line: 276 }, children: Array.isArray(r) ? r : [T(r)] })); };
const note = (runs) => new Paragraph({
  spacing: { before: 80, after: 160, line: 276 }, indent: { left: 240, right: 120 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
  shading: { type: ShadingType.CLEAR, fill: LIGHT, color: 'auto' },
  children: Array.isArray(runs) ? runs : [T(runs)],
});
// "WHAT'S THIS?" — the newcomer box
const whats = (title, ...paras) => {
  const cellP = [new Paragraph({ spacing: { after: 60 }, children: [T('WHAT\'S THIS?  ', { bold: true, color: HELP_LINE, size: 18, characterSpacing: 20 }), T(title, { bold: true, size: 22 })] }),
    ...paras.map(x => new Paragraph({ spacing: { after: 60, line: 264 }, children: Array.isArray(x) ? x : [T(x, { size: 21 })] }))];
  return [new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [TEXT_W],
    borders: { top: none, bottom: none, right: none, insideHorizontal: none, insideVertical: none, left: { style: BorderStyle.SINGLE, size: 24, color: HELP_LINE } },
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({ width: { size: TEXT_W, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: HELP_FILL, color: 'auto' }, margins: { top: 100, bottom: 80, left: 180, right: 160 }, children: cellP })] })],
  }), gap(80)];
};
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const gap = (a = 120) => new Paragraph({ spacing: { after: a }, children: [] });

function table(rows, widths, opts = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (txt, w, head) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: 'E6F2EC', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0, line: 260 }, children: Array.isArray(txt) ? txt : [T(txt, { size: 20, bold: head })] })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({ tableHeader: i === 0 && !opts.noHead, cantSplit: true, children: r.map((c, j) => cell(c, widths[j], i === 0 && !opts.noHead)) })),
  });
}

// ── screenshots ──
function pngSize(f) { const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }
function img(name, widthIn) {
  const f = path.join(IMG, name + '.png'), s = pngSize(f);
  const w = Math.round(widthIn * 96), h = Math.round(w * s.h / s.w);
  return new ImageRun({ type: 'png', data: fs.readFileSync(f), transformation: { width: w, height: h } });
}
const num = (n) => T(` ${n} `, { bold: true, color: 'FFFFFF', size: 20, shading: { type: ShadingType.CLEAR, fill: PINK, color: 'auto' } });
const legendPara = (n, runs) => new Paragraph({ spacing: { after: 100, line: 264 }, indent: { left: 400, hanging: 400 }, children: [num(n), T('  '), ...(Array.isArray(runs) ? runs : [T(runs, { size: 21 })])] });
const caption = (t) => new Paragraph({ spacing: { before: 60, after: 160 }, alignment: AlignmentType.LEFT, children: [T(t, { size: 18, italics: true, color: GREY })] });
// narrow shot: picture left, numbered legend right
function shotSide(name, legend, cap, widthIn = 2.8) {
  const wL = Math.round(widthIn * 1440) + 160, wR = TEXT_W - wL;
  const rows = [new TableRow({ cantSplit: true, children: [
    new TableCell({ width: { size: wL, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 0, right: 160 }, children: [new Paragraph({ children: [img(name, widthIn)] })] }),
    new TableCell({ width: { size: wR, type: WidthType.DXA }, verticalAlign: VerticalAlign.TOP, margins: { top: 60, bottom: 40, left: 160, right: 0 },
      children: [...(cap ? [new Paragraph({ spacing: { after: 140 }, children: [T(cap, { size: 19, italics: true, color: GREY })] })] : []), ...legend.map((r, i) => legendPara(i + 1, r))] }),
  ] })];
  return [new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [wL, wR], layout: TableLayoutType.FIXED,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }, rows }), gap(100)];
}
// wide shot: picture across the page, legend under it
function shotWide(name, legend, cap, widthIn = 5.4) {
  return [new Paragraph({ keepNext: true, spacing: { after: 60 }, children: [img(name, widthIn)] }),
    ...(cap ? [caption(cap)] : []), ...legend.map((r, i) => legendPara(i + 1, r)), gap(80)];
}

// ════════════════════════════════════════════════════════════════════
const children = [
  // ── Cover ──
  new Paragraph({ spacing: { before: 600, after: 160 }, children: [T('NET//ETHER', { size: 80, bold: true, color: ACCENT })] }),
  new Paragraph({ spacing: { after: 80 }, children: [T('Field Network Management Tool', { size: 32, color: GREY })] }),
  new Paragraph({ spacing: { after: 400 }, children: [T('The visual guide', { size: 28, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [img('cover', 3.0)] }),
  P('Application version 7.4.0 · Document version 7.1', { run: { color: GREY } }),
  P('Broman Enterprises, SSP Division', { run: { color: GREY } }),
  P('© 2026 Broman Enterprises. All rights reserved.', { run: { color: GREY, size: 18 } }),

  // ── How to use this guide ──
  H1('How to use this guide'),
  P('Every page is written for two readers at once. The steps and pictures are for the tech who just needs to know where the button is. The blue WHAT\'S THIS? boxes are for anyone meeting a word for the first time — skip them if you already know.'),
  ...whats('the pink numbers', 'Every screenshot is the real app. A pink number on the picture matches the numbered line next to it or under it.'),
  table([
    ['Part', 'What\'s in it', 'Read it when'],
    ['1 · Start here', 'What the app does, the window, what the colours mean', 'First time you open it'],
    ['2 · Jobs', 'Nine common jobs, step by step, with pictures', 'You\'re on site and need to get something done'],
    ['3 · Tab reference', 'Every button on every tab', 'You want the detail'],
    ['4 · Helpers', 'Glossary · what each message means · a one-page quick card · data and privacy', 'A word or a message makes no sense'],
  ], [2000, 5000, TEXT_W - 7000]),
  gap(),
  H2('The jobs in Part 2'),
  table([
    ['Job', 'Tab'],
    ['A · Talk to a camera on its factory address', 'IP'],
    ['B · Reach two networks at once', 'IP'],
    ['C · Give a box of new cameras their addresses', 'DHCP'],
    ['D · Find a camera on an address you don\'t know', 'DHCP · SCAN'],
    ['E · Find which cable or switch port it is', 'PING'],
    ['F · See what\'s on a network, and save it', 'SCAN'],
    ['G · Come back next month: what changed?', 'SITES'],
    ['H · A port you know nothing about', 'RECON'],
    ['I · Something\'s not working, or writing the ticket', 'Diagnostics · Site report'],
  ], [7400, TEXT_W - 7400]),

  // ══ PART 1 ══
  ...PART(1, 'Start here', 'What it does, the window, and what the colours mean.'),

  H1('1. What NET//ETHER does', false),
  P('A small, always-on-top window for low-voltage field technicians. Six tabs, one for each thing you keep doing on a laptop at a site:'),
  table([
    ['Tab', 'In one line'],
    ['IP', 'Change the laptop\'s wired address — to reach a camera, a panel, or a customer network.'],
    ['PING', 'Watch up to eight devices live. Hear one. Find its switch port.'],
    ['SCAN', 'See everything on a network: address, maker, name, open ports.'],
    ['SITES', 'Your notebook for every job — devices, notes and logins, and what changed since last time.'],
    ['DHCP', 'Hand out addresses yourself, to a bench of new cameras or a network with no router.'],
    ['RECON', 'Plug into an unknown port, say nothing, and let it tell you what it is.'],
  ], [1400, TEXT_W - 1400]),
  gap(),
  P('It runs as administrator, because changing a network card goes through Windows\' own netsh. On a company laptop that happens silently; on your own PC Windows asks once when it starts. There are no pop-ups per change.'),
  note([T('Everything the app knows stays on your laptop, under '), C('%APPDATA%\\net-ether'), T('. Nothing is sent anywhere, except an optional lookup of unknown MAC address makers that you can switch off.')]),

  H1('2. The window', false),
  ...shotSide('window', [
    [B('NET//ETHER'), T(' — drag the window from here.', { size: 21 })],
    [B('Version chip'), T(' — DIAGNOSTICS, FIT WINDOW and SITE REPORT. Amber if the app isn\'t running as administrator.', { size: 21 })],
    [B('◑'), T(' — see-through, to read what\'s behind it.', { size: 21 })],
    [B('▣'), T(' — colour themes (see below).', { size: 21 })],
    [B('?'), T(' — a quick guide for the tab you\'re on. FULL MANUAL opens this document.', { size: 21 })],
    [B('─'), T(' — minimise. The taskbar, Alt+Tab or the tray icon bring it back.', { size: 21 })],
    [B('✕'), T(' — quit. No questions. What you set stays set; what the app did on its own is cleaned up.', { size: 21 })],
    [B('The six tabs.'), T(' A dot on DHCP shows its server: red off, green listening, amber serving.', { size: 21 })],
  ], 'The IP tab, as it opens.', 3.0),
  bullet('The window fits itself to each tab. Drag it bigger and it stays that way until you switch tabs; FIT WINDOW snaps it back.'),
  bullet('Position, size and screen are remembered. Launching it twice just brings the running one to the front.'),
  bullet('The tray icon pulses green; it turns red while a PING target is down.'),
  bullet('Closing the laptop lid pauses the DHCP server, the wire listener and PING; they start again when it wakes.'),
  H2('Colour themes'),
  P('▣ in the title bar picks a colour theme: ONLINE is the standard green, RGB runs the whole rainbow, CUSTOM lets you pick three colours. DEPTH (faint scan lines) switches off from the same menu.'),

  H1('3. What the colours mean', false),
  P('The app uses the same three colours everywhere, so once you know them every tab reads the same.'),
  table([
    ['Colour', 'Means', 'Examples'],
    [[T('GREEN', { bold: true, color: '00A86B', size: 20 })], 'Done, healthy, working', '✓ APPLIED on the status bar · a PING target answering quickly · 1 GBPS link'],
    [[T('AMBER', { bold: true, color: 'C98A00', size: 20 })], 'Look at this — it works, but', 'A slow PING reply · 100 Mb link (bad crimp?) · Wi-Fi switched off · a 2nd address left on a card · SERVE EVERYONE'],
    [[T('RED', { bold: true, color: 'D0312D', size: 20 })], 'Stopped, failed, gone', 'Address already taken · a PING target not answering · 10 Mb link · a failed change'],
  ], [1300, 2600, TEXT_W - 3900]),
  gap(),
  H2('Badges you\'ll see'),
  table([
    ['Badge', 'Where', 'Means'],
    ['DHCP  /  STATIC', 'Top bar, IP tab', 'How the card gets its address: from the network, or typed in.'],
    ['✓ ACTIVE', 'IP field', 'The address is on the card, checked.'],
    ['✓ SAVED · NO CABLE', 'IP field', 'Set, and used as soon as a cable goes in.'],
    ['ASKING', 'DHCP rows', 'A device is asking for an address. Nothing has been given yet.'],
    ['SERVED', 'DHCP rows', 'You gave it an address.'],
    ['✓ STATIC', 'DHCP rows', 'It now keeps that address itself. Done.'],
    ['◇ SITTING', 'DHCP rows', 'Heard on the cable, already has an address, isn\'t asking.'],
    ['● YOU\'RE HERE', 'SITES', 'The site your laptop is on right now.'],
    ['NEW DEVICE / NOT RESPONDING / MOVED', 'SITES', 'What changed since the last scan of that site.'],
    ['LISTENING / SERVING 1 / SERVING EVERYONE', 'DHCP', 'The DHCP server: hearing only, answering one device, answering all.'],
  ], [3000, 1700, TEXT_W - 4700]),
  gap(),
  P('Every action ends with one line on the status bar at the bottom of the tab. Part 4 has a table of what each message means and what to do about it.'),

  // ══ PART 2 ══
  ...PART(2, 'Jobs', 'Nine jobs you do on site, step by step.'),

  // A
  H1('A · Talk to a camera on its factory address', false),
  P('A new camera comes out of the box on a fixed address — Bosch on 192.168.0.1, Hanwha on 192.168.1.100, and so on. Your laptop has to be on the same network to open it.'),
  ...whats('a factory address, and why my laptop needs to match',
    'Devices only talk directly to addresses in the same network. 192.168.0.1 and 192.168.0.2 are neighbours (same first three numbers, with the usual 255.255.255.0 mask). 10.20.30.57 is on another street entirely.',
    'So to reach a camera on 192.168.0.1, the laptop takes an address next to it: 192.168.0.2. The FACTORY DEFAULTS tiles do that sum for you.'),
  ...shotSide('defaults', [
    [B('FACTORY DEFAULTS'), T(' opens a tile per brand.', { size: 21 })],
    [B('The tile.'), T(' DEV is the device\'s address out of the box; YOU is the one you\'ll take, right next to it.', { size: 21 })],
    [B('USE'), T(' fills the form with YOUR address. Nothing changes yet.', { size: 21 })],
  ], 'IP tab → FACTORY DEFAULTS.'),
  P([B('USE'), T(' fills the form, and the button now says exactly what it will do: '), B('APPLY 192.168.0.2'), T('. Press it.')]),
  ...shotSide('applied', [
    [B('Green on the status bar'), T(' means it\'s done and checked: the app read the address back from Windows.', { size: 21 })],
    [B('✓ ACTIVE'), T(' — the address is really on the card.', { size: 21 })],
    [B('REVERT'), T(' puts the card back exactly as it was before — DHCP, in this case.', { size: 21 })],
  ], 'About two seconds later.'),
  H2('If the address is already taken'),
  ...shotSide('taken', [
    [B('Red, with who has it'), T(' — the MAC address and the maker. Pick another address, or press APPLY again within 15 seconds if you really mean it.', { size: 21 })],
  ], 'ETHER checks the address is free before and after it applies it.', 3.0),
  ...whats('a MAC address', 'A device\'s permanent hardware name, like 00:07:5F:B2:41:0C. The IP address can change; the MAC can\'t. The first half says who made it — 00:07:5F is Bosch — which is how ETHER can say "taken by a Bosch".'),
  note('AXIS cameras have no fixed factory address — they pick a random 169.254.x.x when nobody gives them one. The AXIS tile puts you on 169.254.1.1 / 255.255.0.0, which reaches all of them. Better still: Job C or D.'),

  // B
  H1('B · Reach two networks at once', false),
  P('You need the cameras on 192.168.1.x and the customer\'s server on 10.20.30.x at the same time. Instead of switching back and forth, give the card a second address.'),
  ...shotSide('second-add', [
    [B('+ ADD A 2ND NETWORK ADDRESS'), T(' (under the IP field) opens this row. Type the address — the mask fills itself.', { size: 21 })],
    [B('ADD.'), T(' Your main address stays as it is.', { size: 21 })],
  ], 'IP tab.'),
  ...shotSide('second-done', [
    [B('2ND NETWORK ADDRESS'), T(' — now its own field. The card is on both networks.', { size: 21 })],
    [B('REMOVE'), T(' takes it off again.', { size: 21 })],
    [B('ADD A 3RD…'), T(' if you need more.', { size: 21 })],
  ], 'Done in about a second.'),
  bullet('APPLY a new main address later and the 2nd one stays put.'),
  bullet('On a DHCP card, adding one first fixes the card on its current address (and says so). SWITCH TO DHCP removes every extra address.'),
  bullet('Windows keeps extra addresses after a reboot until you remove them. ETHER mentions any it finds when it next starts.'),
  bullet('Shortcut: the + ADD button on a FACTORY DEFAULTS tile does all of this in one step.'),

  // C
  H1('C · Give a box of new cameras their addresses', false),
  P('A bench switch, a box of cameras, no router. The cameras want an address and nobody is handing one out. The laptop becomes the DHCP server.'),
  ...whats('DHCP', 'The service that hands out addresses on a network — normally the router does it. A new camera set to DHCP shouts "anyone got an address for me?" and waits. On a bench with no router, nothing answers, so the camera sits there with no address (or a random 169.254 one).',
    'ETHER can answer instead — but only for the devices you choose, so it never fights the customer\'s own DHCP.'),
  H2('1. Give the laptop an address on that cable'),
  ...shotSide('dhcp-noaddr', [
    [B('① The card'), T(' your cable is in. Here it has no address — "was DHCP, nothing answered".', { size: 21 })],
    [B('SET LAPTOP IP…'), T(' gives it one (192.168.0.1 by default), checked free first.', { size: 21 })],
    [B('LISTENING'), T(' — the server hears requests but answers nobody yet.', { size: 21 })],
  ], 'DHCP tab, as it opens on a bench switch.', 3.4),
  H2('2. Serve them one at a time'),
  ...shotWide('dhcp-asking', [
    [B('The laptop and the pool.'), T(' Laptop 192.168.0.1; devices get .100 to .200.', { size: 21 })],
    [B('The IP box'), T(' is the address the camera will get. Type the one it should end up on.', { size: 21 })],
    [B('What it is.'), T(' Model and firmware, read from its request — before it even has an address.', { size: 21 })],
    [B('▶ SERVE'), T(' answers that camera only.', { size: 21 })],
    [B('SERVE EVERYONE…'), T(' answers every device (see below).', { size: 21 })],
  ], 'Four cameras powered up, all ASKING.'),
  ...shotSide('dhcp-served', [
    [B('SERVED'), T(' — it took the address.', { size: 21 })],
    [B('↗ OPEN'), T(' opens its web page. Set it static there, on that same address.', { size: 21 })],
    [B('The log'), T(' shows the request and the answer.', { size: 21 })],
  ], null, 3.4),
  ...shotSide('dhcp-static-sitting', [
    [B('✓ STATIC'), T(' — the camera stopped asking and still answers on its address: ETHER marks it done and frees the lease. Next row.', { size: 21 })],
    [B('◇ SITTING'), T(' — a camera that never asked. It already has an address (here on another network) and announces itself.', { size: 21 })],
    [B('⇢ REACH'), T(' borrows a temporary address next to it and opens it. See Job D.', { size: 21 })],
  ], null, 3.4),
  H2('A whole bench at once'),
  P([B('A whole bench at once: '), T('SERVE EVERYONE… asks first, checks the cable for another DHCP server, and stops to ask if it finds one.')]),
  P('SCAN → DISCOVER does the same from the SCAN tab: it asks every camera on the cable to answer, whatever its address, and lists the ones on other networks as ELSEWHERE.'),
  ...whats('169.254.x.x', 'The address a device gives itself when nobody hands it one. If you see your own laptop on 169.254, it didn\'t get an address from the network — the amber line on the IP tab will say so and offer HEAR THE WIRE, which listens for ten seconds and suggests a free address on the network that\'s really there.'),

  // E
  H1('E · Find which cable or switch port it is', false),
  P('Thirty patch cables, one camera. Make the laptop beep while it answers and walk to the switch.'),
  ...shotSide('ping-setup', [
    [B('+ GATEWAY / + MY IP'), T(' add the two useful ones in a click.', { size: 21 })],
    [B('+ ADD TARGET'), T(' — type the camera\'s address. Add :port (10.20.30.10:3389) to watch one service.', { size: 21 })],
    [B('▶ START.', { size: 21 })],
  ], 'PING tab.'),
  ...shotSide('ping-running', [
    [B('Amber'), T(' — answering, but slowly (150 ms or more).', { size: 21 })],
    [B('CLOSED'), T(' — the device answered, but that port is shut.', { size: 21 })],
    [B('♪ TONER'), T(' — every reply is a sonar blip. Slower reply, lower pitch.', { size: 21 })],
    [B('⚡ BLINK'), T(' — strobes that device\'s port light on the switch for 20 seconds. Find the port without pulling anything.', { size: 21 })],
  ], 'Running, with the camera toned.'),
  ...shotSide('ping-alarm', [
    [B('Pull the wrong cable'), T(' and the sonar drops into an alarm, and the row goes red. Plug it back: it sweeps back up.', { size: 21 })],
  ], 'The camera\'s cable just got pulled.', 3.1),
  bullet('No reply to ping? ETHER tries port 80, so devices that ignore ping still show as alive. If the window is in the tray when the toned device drops, Windows pops a notification.'),

  // F
  H1('F · See what\'s on a network, and save it', false),
  ...shotSide('scan-results', [
    [B('BASE IP'), T(' — filled from your card. Narrow the range (1-60) to finish faster.', { size: 21 })],
    [B('▶ SCAN SUBNET'), T(' sweeps all 254 addresses: who answers, their MAC, name and open ports.', { size: 21 })],
    [B('◎ DISCOVER'), T(' asks cameras to announce themselves — finds the ones on other networks too.', { size: 21 })],
    [B('The maker'), T(', from a list built into the app. No internet needed.', { size: 21 })],
    [B('SAVE SITE'), T(' keeps the result for next time (Job G).', { size: 21 })],
  ], 'SCAN tab after a sweep.'),
  bullet('Each row: IP · MAC · name · maker · open ports, with OPEN, RDP or SSH buttons where they apply. Your own laptop is marked SELF.'),
  bullet('COPY ▾ puts the list on the clipboard as a spreadsheet or a table for the ticket.'),
  ...whats('a subnet, and "/24"', 'A network\'s block of addresses. "10.20.30.x /24" means the 254 addresses 10.20.30.1 to 10.20.30.254 — everything that shares the first three numbers. The mask 255.255.255.0 says the same thing the long way.'),

  // G
  H1('G · Come back next month: what changed?', false),
  ...shotSide('sites-list', [
    [B('The site card'), T(' — name, network, last scan, device count.', { size: 21 })],
    [B('● YOU\'RE HERE'), T(' — your laptop is on this site\'s network right now.', { size: 21 })],
    [B('▶ SCAN'), T(' sweeps it again in one click.', { size: 21 })],
    [B('EXPORT'), T(' to Excel or JSON. SHOW FILES opens the folder.', { size: 21 })],
  ], 'SITES tab.'),
  ...shotSide('sites-changes', [
    [B('What changed, and when'), T(' — the date of this scan and the one it was compared with.', { size: 21 })],
    [B('NOT RESPONDING'), T(' — was here last time, silent now. Dead, unplugged, or moved.', { size: 21 })],
    [B('NEW DEVICE'), T(' — wasn\'t here before.', { size: 21 })],
  ], 'Inside the site.'),
  ...shotSide('sites-device', [
    [B('← BACK TO ALL SITES.', { size: 21 })],
    [B('A device'), T(' — click a row to open it.', { size: 21 })],
    [B('Notes'), T(' — save themselves when you click away.', { size: 21 })],
    [B('Logins'), T(' — as many as you like, stored encrypted.', { size: 21 })],
    [B('WAKE'), T(' (Wake-on-LAN), ↗ OPEN its web page, PING it.', { size: 21 })],
  ], 'One device, opened.'),
  P('Devices are tracked by MAC address, so a camera that changed IP shows as MOVED instead of as a new device.'),

  // H
  H1('H · A port you know nothing about', false),
  P('A wall jack, a mystery cable. Before you set any address, find out what it is — without the laptop saying a word on the network.'),
  P([T('Pick the card, choose '), B('STANDARD'), T(' or '), B('SILENT'), T(' (the laptop transmits nothing at all), press '), B('▶ LISTEN'), T('. Up to 65 seconds. Needs Wireshark 4.6+ with npcap.')]),
  ...shotSide('recon-cards', [
    [B('SWITCH'), T(' — the switch name, port and VLAN, if the switch announces them.', { size: 21 })],
    [B('802.1X'), T(' — whether the port wants a login before it lets a device on.', { size: 21 })],
    [B('DHCP'), T(' — who hands out addresses, with the gateway and mask.', { size: 21 })],
    [B('ADDRESS'), T(' — a free-looking address you could take.', { size: 21 })],
    [B('TAKE'), T(' fills the IP tab with it. Nothing changes until you press APPLY there.', { size: 21 })],
  ], 'Cards fill in as the network talks.'),
  ...whats('VLAN and 802.1X', 'A VLAN is a separate network running over the same switch — cameras on one, offices on another. The port decides which one you land on.',
    '802.1X is a lock on the port: the switch asks for credentials before letting a device on. A camera without a certificate on such a port gets nowhere, which is worth knowing before you spend an hour on it.'),

  // I
  H1('I · Something\'s not working, or writing the ticket', false),
  P([B('? on any tab'), T(' explains that tab in one screen; FULL MANUAL opens this guide. '), B('The version number'), T(' opens DIAGNOSTICS, FIT WINDOW and SITE REPORT.')]),
  ...shotSide('diagnostics', [
    [B('COPY DIAGNOSTICS'), T(' — puts the whole report on the clipboard.', { size: 21 })],
    [B('The log'), T(' — every change, with the exact command and its result.', { size: 21 })],
  ], 'DIAGNOSTICS.'),
  H2('When something misbehaves'),
  ...steps(['Click the version number → DIAGNOSTICS → COPY DIAGNOSTICS.', 'Paste it into a message to whoever looks after NET//ETHER for your team. It says exactly what Windows was asked to do and what it said back — usually enough to sort it in one reply.']),
  H2('Writing the ticket'),
  P('Version number → SITE REPORT. One click copies what this visit did — card and switch port, scans and what changed, RECON results, DHCP leases, ping results, every change with its time — ready to paste.'),
  note('"It pings but the web page won\'t load"? DIAGNOSTICS → MTU → 1500. Something else may have left the card at an odd packet size.'),

  // ══ PART 3 ══
  ...PART(3, 'Tab reference', 'Every button on every tab.'),

  // IP
  H1('IP — the network card', false),
  ...shotSide('ip-tour', [
    [B('NETWORK CARD'), T(' — the wired card, its link speed and DHCP/STATIC badge.', { size: 21 })],
    [B('WI-FI'), T(' switches wireless off, so everything goes out the cable.', { size: 21 })],
    [B('STATIC | DHCP'), T(' — the dot shows what the card is on now.', { size: 21 })],
    [B('Address, mask, gateway, DNS.'), T(' Greyed out on DHCP; click one to type.', { size: 21 })],
    [B('+ ADD A 2ND NETWORK ADDRESS.', { size: 21 })],
    [B('The button'), T(' — APPLY <address>, SWITCH TO DHCP, or ✓ ON DHCP.', { size: 21 })],
    [B('SHORTCUTS'), T(' — CURRENT plus three setups of your own.', { size: 21 })],
    [B('FACTORY DEFAULTS'), T(' — a tile per brand.', { size: 21 })],
  ], 'IP tab on a DHCP card.', 3.0),
  H2('Card states'),
  table([
    ['State', 'Meaning'],
    ['1 GBPS / 100 MBPS / 10 MBPS', 'Link up with an address — the speed the switch and card agreed. Green 1 Gb, amber 100 Mb, red 10 Mb: a gigabit port at 100 is a bad crimp, cable or port.'],
    ['NO ADDRESS', 'Link, but no address. A DHCP card shows RENEW; a static one, APPLY.'],
    ['DISCONNECTED', 'No link. Cable, port or far end.'],
    ['NO CABLE · 192.168.0.1 SAVED', 'No link, and a static address set. Windows uses it the moment a cable goes in.'],
    ['DISABLED', 'Switched off in Windows. ENABLE CARD brings it back.'],
  ], [3000, TEXT_W - 3000]),
  gap(),
  note('Docks have their own network card. If you see "Ethernet" and "Ethernet 2", pick the one with a link speed.'),
  H2('Buttons'),
  table([
    ['Button', 'What happens'],
    ['APPLY 192.168.1.50', 'Writes address, mask, gateway and DNS, then reads them back. Green status, ✓ ACTIVE and the new address in the top bar mean it\'s done. No cable: ✓ SAVED · NO CABLE. Failure: red, with Windows\' own message.'],
    ['SWITCH TO DHCP', 'Hands the card back to the network, cable or not.'],
    ['RENEW', 'Asks DHCP again, when the card has link but no address.'],
    ['REVERT', 'Undoes your last APPLY exactly. Press again to step back once more.'],
    ['↩ RESTORE LAUNCH STATE', 'Every card back to how it was when the app started.'],
    ['COPY COMMANDS', 'Shows the netsh commands without running them, for an admin prompt.'],
  ], [2600, TEXT_W - 2600]),
  gap(),
  H2('Good to know'),
  bullet([B('Wrong-network warning. '), T('Moved the cable and kept an old address, or got 169.254? An amber line says which, with HEAR THE WIRE (listens ten seconds and suggests a free address on the network that\'s really there), SET STATIC… and RENEW.')]),
  bullet([B('Duplicate check. '), T('On your current network ETHER asks before APPLY; on a new one, Windows checks the moment the address is on the card. Either way you\'re told who has it.')]),
  bullet([B('Gateway. '), T('Optional — leave it blank on a camera or panel network. Typing one while Wi-Fi has internet gets a warning: the laptop\'s internet may go down this cable instead.')]),
  bullet([B('Shortcuts. '), T('CURRENT always mirrors the card. The three others are yours: fill the form, SAVE TO PRESET; double-click a name to rename. A shortcut only fills the form.')]),
  bullet([B('Leftovers. '), T('If the last session left a card static or with extra addresses, one amber line says so on the next start: ↩ PUT BACK or KEEP.')]),

  // DHCP
  H1('DHCP — hand out addresses', false),
  P('Off until you open the tab. Opening it starts LISTEN: every device asking for an address appears, and nothing is answered until you say so. Job C walks through it with pictures.'),
  table([
    ['Control', 'What it does'],
    ['① NETWORK CARD', 'The cable you\'re on. Follows the IP tab unless you pick another.'],
    ['② LAPTOP\'S ADDRESS', 'The address the laptop serves from; devices get addresses next to it. SET LAPTOP IP… gives the card one; + ALIAS adds another network to serve on. Both stay until you change them.'],
    ['ADDRESSES TO HAND OUT', 'First, last, mask, gateway (blank = laptop) and lease time (default 5 min). ADVANCED adds DNS, NTP, TFTP, option 43 and the idle timer. Save as a profile for the next job.'],
    ['Device rows', 'ASKING · SERVED · ✓ STATIC · ◇ SITTING. ▶ SERVE with the typed address, ↗ OPEN, ⇢ REACH, ★ pin to a fixed address, ✕ take it back. Tick rows for SERVE TICKED or ★ RESERVE TICKED (consecutive fixed addresses).'],
    ['SERVE EVERYONE…', 'Answers every device. Asks first, checks for another DHCP server, warns if the laptop is also on another network.'],
    ['SCAN WIRE · SELF-TEST', 'Look for other DHCP servers (6 s). Check card, port, firewall and policy in plain words.'],
    ['Status chip', 'OFF / LISTENING / SERVING N / SERVING EVERYONE — also the on/off switch. OFF releases the port and removes the firewall rule.'],
    ['CSV · LOG', 'Copy the lease table. The two-line log strip opens with ▸ LOG and turns amber if a warning lands while it\'s closed.'],
  ], [2600, TEXT_W - 2600]),
  gap(),
  bullet('Before giving an address the server pings it; anything that answers is skipped.'),
  bullet('It never interferes with another server\'s devices. A device that comes back gets the same address for up to an hour.'),
  bullet('Serving stops by itself after 30 idle minutes (changeable in ADVANCED).'),
  note([T('Every serve, firewall change and address step goes into DIAGNOSTICS. IT can switch the server off with the '), C('DisableDhcpServer'), T(' policy.')]),

  // PING
  H1('PING — watch devices', false),
  bullet('Up to 8 targets. + GATEWAY and + MY IP add the two most useful. PING on a SCAN or SITES row sends that device here.'),
  bullet('Blocked ping? A connection to port 80 counts as alive. Add :port to watch one service: CLOSED = device up, port shut; FAIL = device gone.'),
  bullet('Dots: green under 150 ms, amber 150 ms and over, red no reply. The little graph is the last 60 replies.'),
  bullet([B('♪ TONER'), T(' — one target as sound: sonar while it answers, a falling sweep then an alarm when it stops, a rising sweep when it\'s back. Pitch drops as replies slow.')]),
  bullet([B('⚡ BLINK'), T(' — 20 seconds of tiny packets so the switch port LED strobes. Same network only.')]),
  bullet('TRCRT traces the route. ◉ opens Wireshark on that device. COPY copies the summary. PAUSE keeps the data; STOP clears it.'),

  // SCAN
  H1('SCAN — what\'s on the network', false),
  bullet([B('SCAN SUBNET'), T(' sweeps a /24, checks fourteen common ports on everything that answers (web, RTSP, RDP, SSH, and the Hikvision, Dahua, Bosch and Genetec ports), then finds names.')]),
  bullet([B('DISCOVER'), T(' asks the cable instead (ONVIF, SSDP, mDNS — three seconds). It finds cameras on other networks and on 169.254, because the question goes out to everyone and the answer comes back on the same cable.')]),
  bullet('Rows found by discovery have a violet frame; ◎ N DISCOVERY shows only those. REACH appears on 169.254 rows.'),
  bullet('Makers come from a built-in list of 57,000 manufacturer codes. ONLINE VENDOR LOOKUP asks macvendors.com about misses (IT can force it off).'),
  bullet('Loading a saved site and scanning compares against it; the amber chip lists what\'s new, missing or moved.'),

  // SITES
  H1('SITES — the notebook', false),
  bullet('Sites are made from a scan (SAVE SITE). One record per device, by MAC address, so a changed IP is tracked, not duplicated.'),
  bullet('A site card: name (click to rename), network, customer and address, last scan, device count, change badges. ● YOU\'RE HERE sits first.'),
  bullet('Inside: ▶ SCAN NOW, what changed (dated), every device. DELETE SITE is at the bottom and backs up the database first.'),
  bullet('A device: MAC, name, first and last seen, ports, notes, logins. Type chip — click to cycle CAMERA · NVR · NETWORK · SERVER · WORKSTATION · ACCESS CTL · PRINTER · MEDIA · OTHER.'),
  bullet('Logins are encrypted with Windows\' own protection (DPAPI): only your Windows account on this laptop can read them.'),
  table([
    ['Export / import', 'What you get'],
    ['EXCEL', 'A tidy workbook of every site and device — send it to a customer or another tech.'],
    ['JSON', 'For moving your data to another laptop. Logins are left out unless you pick WITH CREDS (readable text — move it and delete it).'],
    ['IMPORT', 'Reads a JSON export. Backs up your data first. MERGE adds what\'s new; REPLACE swaps it all.'],
  ], [2000, TEXT_W - 2000]),
  gap(),

  // RECON
  H1('RECON — listen first', false),
  P('A passive capture through Wireshark, up to 65 seconds, turned into plain-language cards. Nothing is sent.'),
  table([
    ['Card', 'What it tells you'],
    ['SWITCH', 'Switch name, port and VLAN (LLDP every 30 s, CDP every 60 s). "No announcement" is an answer, not an error: not a managed switch, or it\'s turned off.'],
    ['802.1X', 'Whether the switch asked for a login.'],
    ['STP / TRUNK', 'Spanning tree running (don\'t hang an unmanaged switch off it); several VLANs means a trunk port.'],
    ['DHCP', 'Who answered, with gateway, mask and DNS. "DHCP in use — server not heard" = devices are renewing leases, so there is a server, it just did not speak while you listened. "Clients asking — no answer heard" = dead DHCP server.'],
    ['HOSTS', 'How many addresses were heard, on which network.'],
    ['ADDRESS', 'A free-looking address. TAKE fills the IP tab; APPLY still checks it.'],
    ['NAMES / NTP', 'Names devices announced; time servers they asked for.'],
  ], [2000, TEXT_W - 2000]),
  gap(),
  bullet('STANDARD leaves the card alone (Windows still chatters a little — which is how it finds the DHCP server). SILENT unbinds the card for the listen and restores it afterwards, even if the app is closed mid-listen.'),
  bullet('WIRESHARK opens the full capture. COPY copies the cards; they also go in the SITE REPORT.'),

  // DIAGNOSTICS
  H1('DIAGNOSTICS', false),
  bullet('TOOLS — MTU → 1500 for the card on the IP tab.'),
  bullet('STATE — version, administrator or not, user, data folder, Wireshark, login storage, DHCP engine, IT policy.'),
  bullet('PROCESS LAUNCH — how long one command takes to start on this laptop. Tens of ms is healthy, a few hundred is a managed laptop, over a second means every action will lag. The first number to read on an "it\'s slow" report.'),
  bullet('LOG — every change with the exact command, its output and whether it was confirmed. Survives restarts.'),
  bullet('COPY DIAGNOSTICS — the whole thing as text. That\'s what to send.'),

  // ══ PART 4 ══
  ...PART(4, 'Helpers', 'Words, messages, a quick card, and where your data goes.', false),

  H1('Glossary', false),
  table([
    ['Word', 'In plain words'],
    ['IP address', 'A device\'s address on the network, like 192.168.0.1. Four numbers, 0–255.'],
    ['Subnet mask', 'Says how much of the address is the street and how much the house number. 255.255.255.0 (/24): the first three numbers are the street — devices that share them talk directly.'],
    ['Subnet, /24, /16', 'A network\'s block of addresses. /24 = 254 addresses (x.x.x.1–254); /16 = 65,534 (used for 169.254).'],
    ['Gateway', 'The door out of the network — usually the router. Not needed to talk to a camera on your own bench.'],
    ['DHCP', 'Hands out addresses automatically. The router usually does it; on a bench, ETHER can.'],
    ['Static address', 'An address typed into the device (or laptop) that it keeps by itself.'],
    ['169.254.x.x', 'The address a device gives itself when nobody hands it one. A sign DHCP didn\'t answer.'],
    ['MAC address', 'A device\'s permanent hardware name (00:07:5F:B2:41:0C). The first half says who made it.'],
    ['2nd network address (alias)', 'An extra address on the same card, so the laptop is on two networks at once.'],
    ['Link speed', '1 Gbps / 100 Mbps / 10 Mbps — what the card and switch agreed. Lower than expected = suspect the cable.'],
    ['Port (network)', 'A numbered service on a device: 80 web, 443 secure web, 554 video stream (RTSP), 3389 remote desktop, 22 SSH.'],
    ['Port (switch)', 'The physical socket on the switch. BLINK finds it.'],
    ['VLAN', 'A separate network sharing the same switch. The switch port decides which one you\'re on.'],
    ['802.1X', 'A login on the switch port. No credentials, no network.'],
  ], [2400, TEXT_W - 2400]),

  H1('What\'s this message mean?', false),
  P('The status line at the bottom of each tab says what just happened. The ones you\'ll meet most:'),
  table([
    ['Message', 'Means', 'Do this'],
    ['✓ APPLIED — 192.168.0.2 IS ACTIVE ON ETHERNET', 'Done, and checked with Windows.', 'Nothing. Carry on.'],
    ['✓ SAVED · NO CABLE', 'The address is set; there\'s no link yet.', 'Plug the cable in.'],
    ['✕ 192.168.0.2 IS ALREADY TAKEN BY … (BOSCH)', 'Something else has that address.', 'Pick another, or press APPLY again within 15 s to use it anyway.'],
    ['STATIC — TYPE THE ADDRESS, THEN APPLY', 'You picked STATIC with an empty form.', 'Type the address.'],
    ['ERROR: INVALID SUBNET MASK', 'The mask isn\'t valid.', 'Usually 255.255.255.0.'],
    ['WARNING: GATEWAY … IS OUTSIDE SUBNET', 'The gateway isn\'t on the same network as the address.', 'Clear it (CLEAR IT) or fix it.'],
    ['CANCELLED — UAC PROMPT DISMISSED', 'Windows asked for administrator rights and it was declined.', 'Try again and accept.'],
    ['LISTENING — NOTHING IS SERVED UNTIL YOU SAY SO', 'DHCP tab is hearing requests only.', 'SERVE a row.'],
    ['THIS CARD HAS NO ADDRESS — SET A LAPTOP IP IN STEP 2', 'The laptop can\'t serve from nothing.', 'SET LAPTOP IP…'],
    ['✓ 192.168.0.101 WENT STATIC — … IS DONE', 'The camera keeps its address itself now.', 'Next camera.'],
    ['⏻ AUTO-STOPPED AFTER 30 MIN IDLE', 'Serving stopped by itself.', 'SERVE again if you need it.'],
    ['NOTHING HEARD ON A REAL SUBNET IN 10 S', 'HEAR THE WIRE found no devices talking.', 'Check the cable; try DISCOVER, or the DHCP tab.'],
    ['MTU RESET TO 1500 — ADAPTER MAY BRIEFLY RECONNECT', 'Fixed. The link may blink.', 'Try the web page again.'],
    ['ERROR: … — COPY DIAGNOSTICS', 'Something unexpected.', 'Version number → DIAGNOSTICS → COPY, and send it.'],
  ], [3400, 3000, TEXT_W - 6400]),

  H1('Quick card'),
  P('The whole app on one page.', { run: { color: GREY } }),
  table([
    ['I need to…', 'Do this'],
    ['open a camera on its factory address', 'IP → FACTORY DEFAULTS → brand → USE → APPLY'],
    ['be on two networks at once', 'IP → + ADD A 2ND NETWORK ADDRESS → type → ADD'],
    ['undo what I just did', 'IP → REVERT'],
    ['give new cameras addresses', 'DHCP → SET LAPTOP IP… → type the address on a row → ▶ SERVE → ↗ OPEN'],
    ['find a camera on an unknown address', 'DHCP → ◇ SITTING row → ⇢ REACH   (or SCAN → DISCOVER)'],
    ['find a cable', 'PING → add it → START → ♪ → pull cables until the alarm'],
    ['find a switch port', 'PING → ♪ on the row → ⚡ BLINK → watch the LEDs'],
    ['see what\'s on the network', 'SCAN → SCAN SUBNET → SAVE SITE'],
    ['see what changed since last visit', 'SITES → ▶ SCAN on the card → VIEW →'],
    ['identify a mystery port', 'RECON → LISTEN → wait a minute → TAKE'],
    ['write the ticket', 'Version number → SITE REPORT → paste'],
    ['report a problem', 'Version number → DIAGNOSTICS → COPY DIAGNOSTICS → send'],
    ['make it less green', '▣ → pick a theme'],
  ], [3600, TEXT_W - 3600]),
  gap(),
  P([B('Colours: '), T('green done · amber look at this · red stopped.  '), B('Before you leave: '), T('Wi-Fi back on (IP tab), and REVERT or ↩ RESTORE LAUNCH STATE if the laptop should go back to normal.')]),

  H1('Data and privacy', false),
  bullet([T('All data is on the technician\'s laptop under '), C('%APPDATA%\\net-ether'), T('. Uninstalling leaves it in place.')]),
  bullet('Nothing is installed on customer systems and no customer network data leaves the laptop.'),
  bullet('Stored logins are encrypted per user and per machine.'),
  bullet('The only internet request is the optional maker lookup, which sends only the first half of a MAC address.'),
  bullet('The DHCP server only listens after its tab is opened, adds one firewall rule while it runs and removes it when it stops.'),
  bullet('DISCOVER sends three multicast questions; BLINK and Wake-on-LAN send small packets only when pressed; RECON sends nothing. Every command is in the diagnostics log.'),
  bullet('Releases are code-signed. The app can\'t be used as a general Node.js runtime by other software (Electron fuses).'),
  bullet([T('IT policy: '), C('DisableOnlineVendorLookup'), T(' and '), C('DisableDhcpServer'), T(' under '), C('HKLM\\SOFTWARE\\Policies\\Broman Enterprises\\NET-ETHER'), T('.')]),
];

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } }, run: { bold: true, color: ACCENT } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [T('NET//ETHER visual guide · ', { size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GREY })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => { fs.writeFileSync(path.join(__dirname, 'NET-ETHER-Guide.docx'), buf); console.log('docx written'); });
