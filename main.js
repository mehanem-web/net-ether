const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const https = require('https');
const { execFile, exec } = require('child_process');

// ── INPUT SANITIZATION ─────────────────────────────────────
// Main process validates all IPC inputs independently.
// The renderer already validates, but we never trust it alone.

const IP_RE     = /^(\d{1,3}\.){3}\d{1,3}$/;
// NOTE: This set is duplicated in index.html as VALID_SUBNETS_SET (renderer-side validation).
// If you add/remove entries here, update the renderer copy too.
const VALID_SUBNETS = new Set([
  '255.255.255.255','255.255.255.254','255.255.255.252','255.255.255.248',
  '255.255.255.240','255.255.255.224','255.255.255.192','255.255.255.128',
  '255.255.255.0',  '255.255.254.0',  '255.255.252.0',  '255.255.248.0',
  '255.255.240.0',  '255.255.224.0',  '255.255.192.0',  '255.255.128.0',
  '255.255.0.0',    '255.254.0.0',    '255.252.0.0',    '255.248.0.0',
  '255.240.0.0',    '255.224.0.0',    '255.192.0.0',    '255.128.0.0',
  '255.0.0.0',      '254.0.0.0',      '252.0.0.0',      '248.0.0.0',
  '240.0.0.0',      '224.0.0.0',      '192.0.0.0',      '128.0.0.0',
  '0.0.0.0',
]);

function isValidIp(ip) {
  if (!ip || !IP_RE.test(ip)) return false;
  return ip.split('.').every(n => parseInt(n, 10) <= 255);
}

function isValidSubnet(mask) {
  return VALID_SUBNETS.has(mask);
}

// Adapter names on Windows: printable ASCII, no quotes, no semicolons,
// no shell metacharacters. Max 256 chars (NDIS limit).
// Reject anything that could break out of a quoted netsh argument or PowerShell filter.
function sanitizeAdapter(name) {
  if (!name || typeof name !== 'string') return null;
  const s = name.trim();
  if (!s || s.length > 256) return null;
  // Reject anything that could break out of a quoted netsh argument or PowerShell string
  if (/["';&|`$\\]/.test(s)) return null;
  return s;
}

function clampMtu(val) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return 1500;
  return Math.min(Math.max(n, 576), 9000); // 576 min (RFC), 9000 max (jumbo)
}

// ── ELEVATED COMMAND RUNNER ────────────────────────────────
// Writes a temp VBScript that ShellExecute-runas launches cmd.exe
// to run one or more netsh commands (semicolon-separated → & chained).
// Used by apply-network-config, apply-dhcp, fix-mtu, alias-add, alias-remove.
function runElevated(cmdString, { tag = 'run', timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    // Convert semicolon-separated netsh lines into cmd-chained form: a & b & c
    const chained = cmdString.split(';').map(s => s.trim()).filter(Boolean).join(' & ');
    // Escape any double-quotes inside the command for VBS string embedding
    const escaped = chained.replace(/"/g, '""');
    const vbs =
      'Set objShell = CreateObject("Shell.Application") : ' +
      'objShell.ShellExecute "cmd.exe", ' +
      '"/c ' + escaped + '", ' +
      '"", "runas", 0';
    const vbsPath = path.join(os.tmpdir(), `netether_${tag}_${Date.now()}.vbs`);
    fs.writeFileSync(vbsPath, vbs, 'utf8');
    execFile('cscript.exe', ['//NoLogo', vbsPath], { timeout: timeoutMs }, (err) => {
      try { fs.unlinkSync(vbsPath); } catch {}
      resolve(err ? { ok: false, err: err.message } : { ok: true });
    });
  });
}

// Promisified exec — replaces repeated inline new Promise(exec(...)) wrappers
function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// ── POWERSHELL HELPERS (replace deprecated wmic) ─────────
// wmic.exe is deprecated since Win 10 21H1 and removed in Win 11 24H2+.
// All adapter queries now use PowerShell Get-CimInstance / Get-NetAdapter.

// Get adapter GUID by NetConnectionID (replaces: wmic nic where "NetConnectionID='X'" get GUID)
async function getAdapterGuid(adapterName) {
  try {
    // Escape single quotes in adapter name for PowerShell string embedding
    const safeName = adapterName.replace(/'/g, "''");
    const out = (await execAsync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_NetworkAdapter -Filter \\"NetConnectionID='${safeName}'\\" | Select-Object -ExpandProperty GUID"`,
      { timeout: 5000 }
    ).catch(() => '')).replace(/\r/g, '').trim();
    // GUID is returned as {XXXXXXXX-XXXX-...}
    const m = out.match(/\{[^}]+\}/);
    return m ? m[0] : null;
  } catch { return null; }
}

// Get adapter Name→Description map (replaces: wmic nic get Name,Description /format:csv)
async function getAdapterDescriptions() {
  try {
    const out = (await execAsync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.NetConnectionID } | Select-Object NetConnectionID, Description | ConvertTo-Csv -NoTypeInformation"',
      { timeout: 8000 }
    ).catch(() => '')).replace(/\r/g, '');
    const descMap = {};
    // CSV output: "NetConnectionID","Description"
    out.split('\n').forEach((line, i) => {
      if (i === 0 || !line.trim()) return; // skip header
      // Parse CSV — fields may be quoted
      const m = line.match(/^"?([^"]*)"?,"?([^"]*)"?$/);
      if (m) {
        const name = m[1].trim();
        const desc = m[2].trim();
        if (name && desc) descMap[name.toLowerCase()] = desc.toLowerCase();
      }
    });
    return descMap;
  } catch { return {}; }
}

// Generic JSON file loader — shared by presets-load and sites-load
async function loadJsonFile(filePath, fallback) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch { return fallback; }
}

const PRESETS_PATH = path.join(app.getPath('userData'), 'presets.json');
const IS_DEV = process.argv.includes('--dev');

// ── AUTOSTART ──────────────────────────────────────────────
function getAutostart() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutostart(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    name: 'NET-ETHER',
    args: [],
  });
}

let win;
let tray;

// ── TRAY ANIMATION ─────────────────────────────────────────
const trayState = {
  mode: 'idle',      // 'idle' | 'ping_fail' | 'dim'
  frame: 0,
  timer: null,
};

const FRAME_MS = {
  idle:      600,   // slow pulse
  ping_fail: 180,   // fast urgent flash
  dim:       500,   // medium amber pulse
};

function iconPath(mode, frame) {
  return path.join(__dirname, 'assets', `tray-${mode}-${frame}.ico`);
}

function startTrayAnimation() {
  if (trayState.timer) clearInterval(trayState.timer);
  trayState.frame = 0;

  trayState.timer = setInterval(() => {
    trayState.frame = (trayState.frame + 1) % 4;
    try {
      const img = nativeImage.createFromPath(iconPath(trayState.mode, trayState.frame));
      tray.setImage(img);
    } catch {}
  }, FRAME_MS[trayState.mode]);
}

function setTrayMode(mode) {
  if (trayState.mode === mode) return;
  trayState.mode = mode;
  startTrayAnimation();
  updateTrayTooltip();
}

function updateTrayTooltip() {
  const labels = {
    idle:      'NET//ETHER — online',
    ping_fail: 'NET//ETHER — connectivity alert!',
    dim:       'NET//ETHER — dimmed',
  };
  tray.setToolTip(labels[trayState.mode] || 'NET//ETHER');
}

// ── TRAY SETUP ─────────────────────────────────────────────
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.ico'));
  tray = new Tray(img);
  updateTrayTooltip();

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: win.isVisible() ? 'Hide HUD' : 'Show HUD',
      click: () => toggleWindow(),
    },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: (item) => {
        win.setAlwaysOnTop(item.checked);
        tray.setContextMenu(buildMenu());
      },
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: getAutostart(),
      click: (item) => {
        setAutostart(item.checked);
        tray.setContextMenu(buildMenu());
      },
    },
    { type: 'separator' },
    {
      label: 'Quit NET//ETHER',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(buildMenu());
  tray.on('click', () => toggleWindow());
  win.on('show', () => tray.setContextMenu(buildMenu()));
  win.on('hide', () => tray.setContextMenu(buildMenu()));

  startTrayAnimation();
}

function toggleWindow() {
  if (win.isVisible()) { win.hide(); } else { win.show(); win.focus(); }
}

// ── WINDOW ─────────────────────────────────────────────────
function createWindow() {
  // Electron 28 on Windows: BrowserWindow width/height/x/y all use LOGICAL pixels.
  // Do NOT multiply by scaleFactor — Electron handles DPI scaling internally.
  // workAreaSize is also logical px (excludes taskbar). Units are consistent.
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const initW = 390;  // logical CSS px
  const initH = 300;  // logical CSS px — autoResize grows this after load
  const initX = Math.round((width - initW) / 2);
  const initY = 20;   // pin near top — grows downward, never off-screen

  win = new BrowserWindow({
    width:  initW,
    height: initH,
    x: initX,
    y: initY,
    frame: false,
    transparent: false,
    backgroundColor: '#0d1a0d',
    hasShadow: false,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 320,
    minHeight: 300,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.setVisibleOnAllWorkspaces(true);

  // Show as soon as the renderer is ready — works in both dev and production
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Window is freely resizable — user can drag to any size they want.
  // autoResize() sets height on content changes, but backs off once the user
  // has manually resized (renderer sets _userResized flag via resize IPC).
  // Fire window-user-resized only for actual user drag — not our own setSize calls.
  // win._progResize is set true briefly around programmatic setSize calls.
  win._progResize = false;
  win.on('resize', () => {
    if (win._progResize) return;
    if (!win.isDestroyed() && win.webContents)
      win.webContents.send('window-user-resized');
  });

  if (IS_DEV) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

app.whenReady().then(async () => {
  // Clear Electron's disk cache on startup — prevents stale CSS/JS from a
  // previous install being served instead of the current build's files.
  try {
    const { session } = require('electron');
    await session.defaultSession.clearCache();
  } catch { /* non-fatal */ }
  createWindow();
  createTray();
  // Snapshot all connected adapters immediately at launch — this is the
  // "restore to launch state" baseline. Runs async, doesn't block UI.
  takeLaunchSnapshot();
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('before-quit', () => { app.isQuitting = true; flushVendorCache(); });

// ── IPC: window controls (main window) ────────────────────
ipcMain.on('win-close',    () => win.hide());
ipcMain.on('win-quit',     () => {
  app.isQuitting = true;
  flushVendorCache();
  try { tray.destroy(); } catch {}
  app.quit();
});
ipcMain.on('win-minimize', () => win.minimize());
// win-move removed — drag uses -webkit-app-region




// autoResize sends target height in logical CSS px. setSize also takes logical px.
// Do NOT multiply by scaleFactor — Electron handles DPI internally.
ipcMain.handle('win-set-size', (e, height) => {
  if (!win || win.isDestroyed()) return;
  const { height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const [currentW] = win.getSize();
  const h = Math.min(Math.max(Math.round(height), 300), screenH - 40);
  win._progResize = true;
  win.setSize(currentW, h, true);
  setImmediate(() => { win._progResize = false; });
});

// ── IPC: opacity ───────────────────────────────────────────
// FIX v5.22: changed from ipcMain.on → ipcMain.handle so renderer's
// await hud.setOpacity(...) actually waits for the change to apply.
ipcMain.handle('win-set-opacity', (e, val) => {
  win.setOpacity(val);
  setTrayMode(val < 0.99 ? 'dim' : 'idle');
});
ipcMain.handle('win-get-opacity', () => win.getOpacity());

// ── IPC: hide/show ─────────────────────────────────────────
ipcMain.on('win-hide', () => win.hide());


// ── IPC: tray state from renderer ─────────────────────────
ipcMain.on('tray-set-mode', (e, mode) => setTrayMode(mode));

// ── IPC: open external URL in default browser ──────────────
ipcMain.on('open-external', (e, url) => {
  if (typeof url !== 'string') return;
  if (/^(https?|rdp):\/\//i.test(url)) shell.openExternal(url);
});

// ── IPC: open user guide ───────────────────────────────────
ipcMain.handle('open-guide', async () => {
  // In packaged builds, asarUnpack puts the file in app.asar.unpacked/assets/
  // In dev, it's just __dirname/assets/
  const guideName = 'NET-ETHER-Guide.docx';
  const devPath    = path.join(__dirname, 'assets', guideName);
  const packedPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'assets', guideName);
  const guidePath  = fs.existsSync(packedPath) ? packedPath : devPath;
  const result = await shell.openPath(guidePath);
  return result ? { ok: false, err: result } : { ok: true };
});

// ── IPC: clipboard write ───────────────────────────────────
ipcMain.handle('clipboard-write', (e, text) => {
  try { clipboard.writeText(String(text)); return { ok: true }; }
  catch (err) { return { ok: false, err: err.message }; }
});

// ── IPC: fast current IP snapshot (no netsh, instant) ─────
// Accepts optional adapter name — if provided, returns ONLY that adapter's IP.
// Returns null if the adapter is not found or has no IPv4 (e.g. cable unplugged).
// Falls back to first non-internal IPv4 only when no adapter name is given.
ipcMain.handle('get-current-ip', (e, adapterName) => {
  const ifaces = os.networkInterfaces();
  if (adapterName) {
    // Specific adapter requested — return its IP or null, never fall back to another adapter
    if (!ifaces[adapterName]) return null;
    const v4 = ifaces[adapterName].find(a => a.family === 'IPv4' && !a.internal);
    return v4 ? { name: adapterName, ip: v4.address, subnet: v4.netmask } : null;
  }
  // No adapter specified — return first connected non-internal IPv4
  for (const [name, addrs] of Object.entries(ifaces)) {
    const v4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
    if (v4) return { name, ip: v4.address, subnet: v4.netmask };
  }
  return null;
});

// ── IPC: get-adapters (full, with netsh status) ────────────
ipcMain.handle('get-adapters', async () => {
  try {
    const ifaces = os.networkInterfaces();

    const netshOutput = (await execAsync('netsh interface show interface', { timeout: 4000 }).catch(() => '')).replace(/\r/g, '');

    // Build statusMap from netsh — this has ALL adapters regardless of IP
    const statusMap = {};
    netshOutput.split('\n').forEach(line => {
      const m = line.match(/^(Enabled|Disabled)\s+(Connected|Disconnected|Not Present)\s+\S+\s+(.+)$/i);
      if (m) statusMap[m[3].trim()] = { admin: m[1].trim(), state: m[2].trim() };
    });

    // Detect DHCP vs static via 'netsh interface ip show config'.
    // For DISCONNECTED adapters, netsh can lie — it sometimes reports DHCP=Yes
    // even when a static config is stored. We cross-check against the registry
    // (ground truth) for any disconnected adapter that show config claims is DHCP.
    const dhcpMap = {};
    try {
      const ipCfg = await execAsync('netsh interface ip show config', { timeout: 5000 }).catch(() => '');
      const blocks = ipCfg.split(/\r?\n(?=Configuration for interface)/i);
      blocks.forEach(block => {
        const nameMatch = block.match(/Configuration for interface "(.+?)"/i);
        if (!nameMatch) return;
        const name = nameMatch[1].trim().toLowerCase();
        const isDhcp = /DHCP enabled:\s+Yes/i.test(block);
        dhcpMap[name] = isDhcp;
      });

      // Cross-check registry for adapters that show config reports as DHCP.
      // The registry EnableDHCP value is the true stored setting:
      //   0 = static, 1 = DHCP
      // This catches disconnected static adapters that netsh misreports.
      const dhcpNames = Object.entries(dhcpMap)
        .filter(([, v]) => v === true)
        .map(([k]) => k);

      for (const name of dhcpNames) {
        try {
          // Get adapter GUID via PowerShell (wmic removed in Win 11 24H2+)
          const guid = await getAdapterGuid(name);
          if (!guid) continue;
          const regOut = (await execAsync(
            `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\${guid}" /v EnableDHCP`,
            { timeout: 3000 }
          ).catch(() => '')).replace(/\r/g, '');
          // EnableDHCP 0x0 = static, 0x1 = DHCP
          const enableMatch = regOut.match(/EnableDHCP\s+REG_DWORD\s+(0x\w+)/i);
          if (enableMatch) {
            const regIsDhcp = parseInt(enableMatch[1], 16) !== 0;
            dhcpMap[name] = regIsDhcp;
          }
        } catch { /* skip — leave show config result */ }
      }
    } catch {}

    // Build an IP lookup from os.networkInterfaces (only has adapters with IPs)
    const ipMap = {};
    Object.entries(ifaces).forEach(([name, addrs]) => {
      const v4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
      const v6 = addrs.find(a => a.family === 'IPv6' && !a.internal);
      ipMap[name] = {
        ip:     v4 ? v4.address : null,
        subnet: v4 ? v4.netmask : null,
        mac:    v4 ? v4.mac     : (v6 ? v6.mac : (addrs[0]?.mac || null)),
      };
    });

    // Lead with statusMap so we get ALL adapters, enrich with IPs where available
    let adapters = Object.entries(statusMap).map(([name, status]) => {
      const ip = ipMap[name] || { ip: null, subnet: null, mac: null };
      return {
        name,
        ip:        ip.ip,
        subnet:    ip.subnet,
        mac:       ip.mac,
        state:     status.state,
        admin:     status.admin,
        connected: status.state === 'Connected',
        isDhcp:    dhcpMap[name.toLowerCase()] ?? null,
      };
    });

    // Also add anything in ipMap that netsh didn't report (e.g. virtual/VPN adapters)
    Object.keys(ipMap).forEach(name => {
      if (!adapters.find(a => a.name === name)) {
        const ip = ipMap[name];
        const hasIp = !!ip.ip;
        adapters.push({
          name, ip: ip.ip, subnet: ip.subnet, mac: ip.mac,
          state: hasIp ? 'Connected' : 'Disconnected', admin: 'Enabled', connected: hasIp,
          isDhcp: dhcpMap[name.toLowerCase()] ?? null,
        });
      }
    });

    // Filter: wired Ethernet only -- drop wireless, loopback, VPN tunnels, and virtual/pseudo adapters
    const EXCLUDE_RE = /bluetooth|wi[-\s]?fi|wireless|802\.11|wlan|loopback|pseudo|tunnel|teredo|isatap|6to4|vpn|miniport|wan\s*miniport|virtual|vethernet|vmware|virtualbox|hyper-v|tap-|tun\d|pangp|sonicwall|globalprotect|cisco|juniper|fortinet|palo.alto|checkpoint|openvpn|nordvpn|expressvpn|wireguard/i;
    adapters = adapters.filter(a => !EXCLUDE_RE.test(a.name));

    // Build a name->description map via PowerShell so we can filter on description too.
    // Catches VPN/virtual adapters with generic names like "Ethernet 4" (e.g. SonicWall).
    try {
      const descMap = await getAdapterDescriptions();
      if (Object.keys(descMap).length > 0) {
        adapters = adapters.filter(a => {
          const desc = descMap[a.name.toLowerCase()] || '';
          return !EXCLUDE_RE.test(desc);
        });
      }
    } catch { /* PowerShell unavailable — skip description filter */ }

    // Ghost correction: netsh can report stale adapters as Connected with no IP.
    // Cross-check: a real connected adapter must have an IPv4 in os.networkInterfaces.
    // If netsh says Connected but Node sees no IPv4 for it, demote to Disconnected.
    const osHasIpv4 = new Set(
      Object.entries(ifaces)
        .filter(([, addrs]) => addrs.some(a => a.family === 'IPv4' && !a.internal))
        .map(([name]) => name.toLowerCase())
    );
    adapters = adapters.map(a => {
      if (a.connected && !a.ip && !osHasIpv4.has(a.name.toLowerCase())) {
        return { ...a, connected: false, state: 'Disconnected' };
      }
      return a;
    });

    // Sort: connected first, then disconnected, then disabled — alpha within each group
    adapters.sort((a, b) => {
      const rank = x => x.connected ? 0 : (x.admin === 'Disabled' ? 2 : 1);
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      return a.name.localeCompare(b.name);
    });

    return adapters;
  } catch (err) {
    console.error('get-adapters error:', err.message);
    // Fallback: return basic list from os.networkInterfaces only
    try {
      const ifaces = os.networkInterfaces();
      return Object.entries(ifaces).map(([name, addrs]) => {
        const v4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
        return { name, ip: v4?.address || null, subnet: v4?.netmask || null, mac: v4?.mac || null, state: v4 ? 'Connected' : 'Disconnected', admin: 'Enabled', connected: !!v4, isDhcp: null };
      });
    } catch { return []; }
  }
});
// ── IPC: subnet scanner ────────────────────────────────────

// ── OUI VENDOR TABLE ──────────────────────────────────────
// Loaded from assets/oui.csv (IEEE database, 57K+ entries, offline-capable)
// Falls back to a small built-in table if the CSV is missing.
// CSV format: "Mac Prefix,Vendor Name,Private,Block Type,Last Updated"
// e.g.        "90:9A:4A,Liteon Technology Corporation,false,MA-L,2015/11/17"

let OUI = {};

function loadOuiCsv() {
  const csvPath = path.join(__dirname, 'assets', 'oui.csv');
  try {
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split('\n');
    let loaded = 0;
    for (let i = 1; i < lines.length; i++) {   // skip header row
      const line = lines[i].trim();
      if (!line) continue;
      // CSV columns: Mac Prefix, Vendor Name, Private, Block Type, Last Updated
      // Mac Prefix may be quoted or not, and uses ":" separators e.g. 90:9A:4A
      const comma1 = line.indexOf(',');
      if (comma1 === -1) continue;
      let prefix = line.slice(0, comma1).replace(/"/g, '').trim();
      const rest  = line.slice(comma1 + 1);
      // Vendor name may be quoted
      let vendor;
      if (rest.startsWith('"')) {
        const end = rest.indexOf('"', 1);
        vendor = end !== -1 ? rest.slice(1, end) : rest.slice(1);
      } else {
        vendor = rest.slice(0, rest.indexOf(',') !== -1 ? rest.indexOf(',') : rest.length);
      }
      vendor = vendor.trim();
      // Normalise prefix: strip separators, uppercase, keep up to 8 chars (MA-S blocks)
      prefix = prefix.replace(/[:\-]/g, '').toUpperCase();
      if (prefix.length < 6 || prefix.length > 9) continue;
      // Only store if not already set (first entry wins for duplicate prefixes)
      if (!OUI[prefix]) {
        OUI[prefix] = vendor;
        loaded++;
      }
    }
    console.log(`[OUI] Loaded ${loaded} entries from oui.csv`);
  } catch (err) {
    console.warn('[OUI] oui.csv not found or unreadable — using built-in fallback table');
    OUI = BUILTIN_OUI;
  }
}

// ── BUILT-IN FALLBACK (security/networking vendors) ───────
// Used only if oui.csv is missing. Copy assets/oui.csv from the
// maclookup.app free download for full 57K-entry coverage.
const BUILTIN_OUI = {
  '000C29':'VMware','000569':'VMware','001C14':'VMware','005056':'VMware',
  '080027':'VirtualBox','0A0027':'VirtualBox',
  '00155D':'Hyper-V','001DD8':'Microsoft','0017FA':'Microsoft','0050F2':'Microsoft','001517':'Microsoft',
  '3C5AB4':'Google','94EB2C':'Google','F88FCA':'Google','7C2EBD':'Google',
  'B827EB':'Raspberry Pi','DCA632':'Raspberry Pi','E45F01':'Raspberry Pi',
  '00E04C':'Realtek','00AA00':'Intel','001B21':'Intel','001E67':'Intel','0021F7':'Intel','00236C':'Intel',
  '002354':'Intel','0024D7':'Intel','002590':'Intel','0026B9':'Intel','003048':'Intel','3C970E':'Intel',
  '8086F2':'Intel','A0369F':'Intel','A4C3F0':'Intel','84A9C4':'Intel','94659C':'Intel',
  '001018':'Broadcom','00904C':'Broadcom','001EC2':'Broadcom',
  '000A27':'Apple','0010FA':'Apple','001124':'Apple','00142A':'Apple','001451':'Apple',
  '0016CB':'Apple','001730':'Apple','001E52':'Apple','001F5B':'Apple','001FF3':'Apple',
  '002312':'Apple','002500':'Apple','00264B':'Apple','003065':'Apple','0050E4':'Apple',
  '006171':'Apple','00C610':'Apple','040CCE':'Apple','0C1539':'Apple','0C3E9F':'Apple',
  '107D1A':'Apple','14109F':'Apple','189EFC':'Apple','1C36BB':'Apple','20768F':'Apple',
  '2078F0':'Apple','24A074':'Apple','28E02C':'Apple','2C1F23':'Apple','2CF0A2':'Apple',
  '30F7C5':'Apple','340A33':'Apple','3498F3':'Apple','38484C':'Apple','381C1A':'Apple',
  '3C07F4':'Apple','40331A':'Apple','40A6D9':'Apple','44FB42':'Apple','4860BC':'Apple',
  '4C74BF':'Apple','4C8D79':'Apple','501AC5':'Apple','50EA84':'Apple','544E90':'Apple',
  '5CE936':'Apple','60334B':'Apple','609217':'Apple','64200C':'Apple','64B9E8':'Apple',
  '68967B':'Apple','6C4008':'Apple','6CAB31':'Apple','6CF049':'Apple','70480F':'Apple',
  '70ECE4':'Apple','742F68':'Apple','74E2F5':'Apple','7831C1':'Apple','7C04D0':'Apple',
  '7C6D62':'Apple','7CF05F':'Apple','80006E':'Apple','80BE05':'Apple','84788B':'Apple',
  '848506':'Apple','88642C':'Apple','8C7B9D':'Apple','90B21F':'Apple','908D6C':'Apple',
  '98FE94':'Apple','9C293F':'Apple','9CF387':'Apple','A0999B':'Apple','A45E60':'Apple',
  'A8667F':'Apple','A8BBCF':'Apple','AC3C0B':'Apple','ACBC32':'Apple','B065BD':'Apple',
  'B418D1':'Apple','B819EC':'Apple','BC3BAF':'Apple','BCF5AC':'Apple','C82A14':'Apple',
  'C86000':'Apple','C8B5B7':'Apple','CC08E0':'Apple','D03311':'Apple','D0C5F3':'Apple',
  'D49A20':'Apple','D8004D':'Apple','DC2B2A':'Apple','E0B52D':'Apple','E0F847':'Apple',
  'E4CE8F':'Apple','E89025':'Apple','E8802E':'Apple','ECA86B':'Apple','F0240F':'Apple',
  'F07BCB':'Apple','F40F24':'Apple','F81EDF':'Apple','FC253F':'Apple',
  '001A2B':'Cisco','001BC0':'Cisco','001BFC':'Cisco','001C57':'Cisco','001D45':'Cisco',
  '001D70':'Cisco','001EA6':'Cisco','001F26':'Cisco','001F6C':'Cisco','001F9E':'Cisco',
  '002155':'Cisco','00219B':'Cisco','002248':'Cisco','0022BD':'Cisco','00231C':'Cisco',
  '002390':'Cisco','0023BE':'Cisco','002368':'Cisco','002510':'Cisco','002601':'Cisco',
  '002694':'Cisco','0026CB':'Cisco','00270D':'Cisco','002790':'Cisco','006009':'Cisco',
  '00E018':'Cisco','10B3D5':'Cisco','188B45':'Cisco','1C1D86':'Cisco','1CAA07':'Cisco',
  '2477B7':'Cisco','2C3128':'Cisco','3037A6':'Cisco','34DB93':'Cisco','40F4EC':'Cisco',
  '4400CA':'Cisco','48F8B3':'Cisco','503E8A':'Cisco','507B9D':'Cisco','50870C':'Cisco',
  '5486BC':'Cisco','58AC78':'Cisco','5CA486':'Cisco','5CAAD4':'Cisco','64F694':'Cisco',
  '6C9C5D':'Cisco','70105C':'Cisco','78DA6E':'Cisco','78E7D1':'Cisco','7C95F3':'Cisco',
  '84B808':'Cisco','8CB64F':'Cisco','8CF4C8':'Cisco','9880BB':'Cisco','A021B7':'Cisco',
  'A4934C':'Cisco','A49BBD':'Cisco','ACEC80':'Cisco','B4A4E3':'Cisco',
  'B89A2A':'Cisco','C47D4F':'Cisco','C89C1D':'Cisco','CC98C0':'Cisco','D072DC':'Cisco',
  'D07ABA':'Cisco','D4AD71':'Cisco','D4E880':'Cisco','D89EF3':'Cisco','DC39E5':'Cisco',
  'E0244B':'Cisco','E4AAD2':'Cisco','E47864':'Cisco','E8B748':'Cisco','EC44F6':'Cisco',
  'F04E51':'Cisco','F41F7A':'Cisco','F44E05':'Cisco','F8B156':'Cisco','FC5FF7':'Cisco',
  '00156D':'Ubiquiti','04187F':'Ubiquiti','0418D6':'Ubiquiti','044BED':'Ubiquiti',
  '0E8E78':'Ubiquiti','24A43C':'Ubiquiti','44D9E7':'Ubiquiti','4AF5A2':'Ubiquiti',
  '68722D':'Ubiquiti','6CFDB9':'Ubiquiti','788A20':'Ubiquiti','802AA8':'Ubiquiti',
  '9C050C':'Ubiquiti','B4FBE4':'Ubiquiti','DCEF09':'Ubiquiti','E063DA':'Ubiquiti',
  'F09FC2':'Ubiquiti','FCECDA':'Ubiquiti',
  '001DB3':'Netgear','0014BF':'Netgear','001E2A':'Netgear','00223F':'Netgear',
  '0026F2':'Netgear','20E52A':'Netgear','2C3033':'Netgear','4407C6':'Netgear',
  '6013EF':'Netgear','6CB0CE':'Netgear','84189F':'Netgear','A040A0':'Netgear',
  'C03F0E':'Netgear','C4047C':'Netgear','C46000':'Netgear',
  '000AEB':'TP-Link','04D9F5':'TP-Link','08953B':'TP-Link',
  '10FEED':'TP-Link','1C3BF3':'TP-Link','283B82':'TP-Link','2CBABA':'TP-Link',
  '30DE4B':'TP-Link','34FAB2':'TP-Link','3C8CF8':'TP-Link','40169F':'TP-Link',
  '50C7BF':'TP-Link','54E6FC':'TP-Link','5C628B':'TP-Link','60A4B7':'TP-Link',
  '64697A':'TP-Link','6C5AB0':'TP-Link','70A741':'TP-Link','74DADA':'TP-Link',
  '7886D9':'TP-Link','900704':'TP-Link','98DAFF':'TP-Link','A42BB0':'TP-Link',
  'B0487A':'TP-Link','B4B024':'TP-Link','C006C3':'TP-Link','D46E5C':'TP-Link',
  'E80401':'TP-Link','EC086B':'TP-Link','F0A731':'TP-Link',
  '00259C':'Aruba','001A1E':'Aruba','001B2D':'Aruba','24DEC6':'Aruba','5C5B35':'Aruba',
  '6C8814':'Aruba','70106F':'Aruba','84D47E':'Aruba','889B39':'Aruba','94B40F':'Aruba',
  '9C1C12':'Aruba','A80CCA':'Aruba','B4750E':'Aruba','D8C7C8':'Aruba',
  '00127F':'Juniper','001BEF':'Juniper','0019E2':'Juniper','2C6BF5':'Juniper',
  '3C612C':'Juniper','50C709':'Juniper','5C5EAB':'Juniper','A0A8ED':'Juniper',
  '00D0CB':'Palo Alto','B0AA77':'Palo Alto',
  '001AE3':'Fortinet','00090F':'Fortinet','70454D':'Fortinet','8C8D28':'Fortinet',
  '90532B':'Fortinet','A4BADB':'Fortinet',
  '001422':'Dell','001E4F':'Dell','002219':'Dell','002564':'Dell',
  'B083FE':'Dell','B4968C':'Dell','F8BC12':'Dell','FCAA14':'Dell','2C768A':'Dell',
  '14FEB5':'Dell','18666E':'Dell','44A842':'Dell','4C5007':'Dell','848BCD':'Dell',
  '848D36':'Dell','9C2A83':'Dell','A41773':'Dell',
  '001F29':'HP','002655':'HP','0030C1':'HP','009027':'HP','00110A':'HP',
  '001321':'HP','001CC4':'HP','001E0B':'HP','001FE2':'HP','002128':'HP','00248C':'HP',
  '0025B3':'HP','002688':'HP','0026F1':'HP','002722':'HP','008078':'HP',
  '3C4A92':'HP','3C98DD':'HP','4CEB42':'HP','6CC217':'HP','6CF04B':'HP',
  '70108B':'HP','78AC44':'HP','7CAF49':'HP','84B135':'HP','8CBF20':'HP','9003B7':'HP',
  '98E7F4':'HP','A0484A':'HP','A0B3CC':'HP','A4388C':'HP','BC305B':'HP','C4346B':'HP',
  'D0BF9C':'HP','D4C9EF':'HP','D85D4C':'HP','EC8EB5':'HP','F0921C':'HP',
  '001AEE':'Lenovo','001CBE':'Lenovo','001E65':'Lenovo','002254':'Lenovo',
  '0024BE':'Lenovo','10659B':'Lenovo','107B44':'Lenovo','18A905':'Lenovo',
  '1C6F65':'Lenovo','20474B':'Lenovo','248A07':'Lenovo','2CAD72':'Lenovo',
  '30E171':'Lenovo','3462EF':'Lenovo','40A8F0':'Lenovo',
  '50E549':'Lenovo','54723D':'Lenovo','5CE0C5':'Lenovo','6045CB':'Lenovo',
  '6890C9':'Lenovo','70720D':'Lenovo','788CB5':'Lenovo','80FA5B':'Lenovo',
  '8C6D72':'Lenovo','906291':'Lenovo','98614C':'Lenovo','A8600A':'Lenovo',
  'A86BAD':'Lenovo','B85D0A':'Lenovo','C88EC2':'Lenovo','D4BE46':'Lenovo',
  '08D400':'Huawei','001E10':'Huawei','003087':'Huawei',
  '001882':'Huawei','0019C5':'Huawei','002568':'Huawei','00259E':'Huawei',
  '0090E8':'Huawei','041333':'Huawei','082E5F':'Huawei','0C37DC':'Huawei',
  '103091':'Huawei','10C614':'Huawei','140B81':'Huawei','18C58A':'Huawei',
  '20A680':'Huawei','20F3A3':'Huawei','24092F':'Huawei','2C7231':'Huawei',
  '30448A':'Huawei','30D172':'Huawei','346BD3':'Huawei','380102':'Huawei',
  '3C8C40':'Huawei','40CB0F':'Huawei','44A838':'Huawei','485754':'Huawei',
  '4C54CF':'Huawei','4C8BEF':'Huawei','540EEB':'Huawei','547B4B':'Huawei',
  '5C7D5E':'Huawei','5CD2E4':'Huawei','6089F5':'Huawei','6426B7':'Huawei',
  '68A0F6':'Huawei','68CC6E':'Huawei','6C8D37':'Huawei','6CB8C4':'Huawei',
  '6CD685':'Huawei','702E22':'Huawei','704A0E':'Huawei','7CA156':'Huawei',
  '8CE081':'Huawei','90671C':'Huawei','9068C3':'Huawei','944452':'Huawei',
  '9C37F4':'Huawei','A00AB9':'Huawei','A424B0':'Huawei','A4EACE':'Huawei',
  'AC4E91':'Huawei','ACE875':'Huawei','B4430D':'Huawei','B4CD27':'Huawei',
  'B8FF61':'Huawei','BC4CC4':'Huawei','C4073E':'Huawei','C47272':'Huawei',
  'C8B8B3':'Huawei','CC96A0':'Huawei','D0FF98':'Huawei',
  'D4F9A1':'Huawei','DC7340':'Huawei','E049B9':'Huawei','E0247F':'Huawei',
  'E43D1A':'Huawei','E4F3F9':'Huawei','E8088B':'Huawei','E88EB2':'Huawei',
  'EC233D':'Huawei','F47B5E':'Huawei','F8A40F':'Huawei','F89D08':'Huawei',
  '000E08':'Linksys','00127A':'Linksys','001310':'Linksys',
  '001CF0':'Linksys','001EA7':'Linksys','002225':'Linksys','00238E':'Linksys',
  '0024C4':'Linksys','00AA5A':'Linksys','20AA4B':'Linksys',
  'C8D719':'Linksys','C8BE19':'Linksys',
  '001109':'D-Link','001195':'D-Link','0015E9':'D-Link',
  '001E58':'D-Link','0021E8':'D-Link',
  '00224D':'D-Link','002401':'D-Link','002569':'D-Link',
  '00ACDE':'D-Link','1062EB':'D-Link','14D64D':'D-Link','1C7EE5':'D-Link',
  '28107B':'D-Link','2C5064':'D-Link','340804':'D-Link','3C1E04':'D-Link',
  '44158B':'D-Link','50465D':'D-Link','5CF4AB':'D-Link',
  '690EF8':'D-Link','748BBD':'D-Link','84C9B2':'D-Link','8CBEBE':'D-Link',
  '90948D':'D-Link','98AAD9':'D-Link','A0AB1B':'D-Link','ACDE48':'D-Link',
  'B4F22C':'D-Link','BCBABB':'D-Link','C0A0BB':'D-Link',
  'CCB255':'D-Link','D86CE9':'D-Link','E46F13':'D-Link','E8CC18':'D-Link',
  'F07D68':'D-Link','F8CABD':'D-Link',
  '001D7E':'Asus','083E8E':'Asus',
  '14DDA9':'Asus','1C872C':'Asus','2C56DC':'Asus','2E5DA7':'Asus','30855C':'Asus',
  '38D547':'Asus','40167E':'Asus','485073':'Asus',
  '54A050':'Asus','60A44C':'Asus','70F1A1':'Asus','74D02B':'Asus','7C2664':'Asus',
  '8C1645':'Asus','907282':'Asus','9C5C8E':'Asus','AC220B':'Asus','AC9E17':'Asus',
  'AAAAAA':'Asus','B085D6':'Asus','BC9012':'Asus','BC9906':'Asus',
  'D62292':'Asus','E0CB4E':'Asus','E4BEED':'Asus','F46D04':'Asus','F83197':'Asus',
  'FC3497':'Asus',
  '001350':'Acer','00131E':'Acer','001C26':'Acer','001D92':'Acer',
  '0015F2':'Samsung','001099':'Samsung','001247':'Samsung','001349':'Samsung',
  '0015B9':'Samsung','001632':'Samsung','001A8A':'Samsung','001B98':'Samsung',
  '001CB8':'Samsung','001D25':'Samsung','001DF6':'Samsung','001E7D':'Samsung',
  '001EE1':'Samsung','001FCC':'Samsung','002119':'Samsung','00214F':'Samsung',
  '0021D1':'Samsung','002339':'Samsung',
  '00238B':'Samsung','0023C2':'Samsung','0023D6':'Samsung','002454':'Samsung',
  '002490':'Samsung','0024E9':'Samsung','002566':'Samsung',
  '002638':'Samsung','00265F':'Samsung','0026D5':'Samsung','002703':'Samsung',
  '04180F':'Samsung','08D4C9':'Samsung','0C8910':'Samsung','0CF145':'Samsung',
  '10305A':'Samsung','107C61':'Samsung','14316E':'Samsung','148182':'Samsung',
  '14BB6E':'Samsung','14F42A':'Samsung','1816C9':'Samsung','18AF61':'Samsung',
  '18CAE7':'Samsung','1C232C':'Samsung','1C3ADE':'Samsung','1C5A3E':'Samsung',
  '200DB0':'Samsung','20A7FF':'Samsung','20D390':'Samsung','20D5BF':'Samsung',
  '24920E':'Samsung','244B03':'Samsung','248024':'Samsung','24C69B':'Samsung',
  '24DBD5':'Samsung','24F5AA':'Samsung','28B3F1':'Samsung','28BAB5':'Samsung',
  '28CC01':'Samsung','2C4401':'Samsung','2CAE2B':'Samsung','2CCC44':'Samsung',
  '30A9DE':'Samsung','30C7AE':'Samsung','30CDA7':'Samsung','3452FB':'Samsung',
  '3C5A37':'Samsung','3C8BFE':'Samsung','3CA0F4':'Samsung','3CAC2B':'Samsung',
  '3CB87A':'Samsung','40E8DB':'Samsung','44786B':'Samsung','48137E':'Samsung',
  '4844F7':'Samsung','48F026':'Samsung','4C3C16':'Samsung','4C6641':'Samsung',
  '4CACCD':'Samsung','50013B':'Samsung','50F520':'Samsung','5430F5':'Samsung',
  '54922D':'Samsung','5CD869':'Samsung','5CE8EB':'Samsung','6006E6':'Samsung',
  '60A10A':'Samsung','60AF6D':'Samsung','645103':'Samsung','6816C6':'Samsung',
  '6C0E0D':'Samsung','6C2D46':'Samsung','6C8335':'Samsung','70F927':'Samsung',
  '748FE8':'Samsung','78D6F0':'Samsung','78F7BE':'Samsung','7C1C4E':'Samsung',
  '7C7D3D':'Samsung','84389F':'Samsung','844846':'Samsung','84A466':'Samsung',
  '8C7712':'Samsung','8C8590':'Samsung','8CB29B':'Samsung','8CCDB8':'Samsung',
  '8CFC55':'Samsung','900628':'Samsung','9405F9':'Samsung','944E7C':'Samsung',
  '94D771':'Samsung','9841BB':'Samsung','9887C4':'Samsung','98F1A3':'Samsung',
  '9C28EF':'Samsung','9C3AAF':'Samsung','A4073D':'Samsung',
  'A8063B':'Samsung','A8F274':'Samsung','ACBD7B':'Samsung','ACEE9E':'Samsung',
  'B016E8':'Samsung','B0D09C':'Samsung','B4EF13':'Samsung','B862A2':'Samsung',
  'B8C75D':'Samsung','B8D9CE':'Samsung','BC20A4':'Samsung','BC5FF4':'Samsung',
  'BC72B1':'Samsung','BC851F':'Samsung','BCD17A':'Samsung','C00A95':'Samsung',
  'C4504A':'Samsung','C47807':'Samsung','C4A366':'Samsung','C4E535':'Samsung',
  'C81452':'Samsung','C8A863':'Samsung','C8E8ED':'Samsung','CC050E':'Samsung',
  'CC3A61':'Samsung','CC6677':'Samsung','D00D6E':'Samsung','D022BE':'Samsung',
  'D02544':'Samsung','D4E8B2':'Samsung','D859AB':'Samsung','D8BAE0':'Samsung',
  'DC7144':'Samsung','DC966B':'Samsung','DCF754':'Samsung','E09CAF':'Samsung',
  'E42460':'Samsung','E49B8F':'Samsung','E4B021':'Samsung','E8504B':'Samsung',
  'E8B4C8':'Samsung','EC1F72':'Samsung','ECC040':'Samsung','F015B9':'Samsung',
  'F05A09':'Samsung','F0728C':'Samsung','F0C500':'Samsung','F0E77E':'Samsung',
  'F4D9FB':'Samsung','F8042E':'Samsung','F80CB8':'Samsung',
  'F878D2':'Samsung','FCF136':'Samsung',
  '001179':'Hikvision','001E12':'Hikvision','4C61D2':'Hikvision','546C0E':'Hikvision',
  '18684D':'Hikvision','1C68EB':'Hikvision','306266':'Hikvision','44191B':'Hikvision',
  '4C77CB':'Hikvision','502C9C':'Hikvision','5CF4BF':'Hikvision','604B3A':'Hikvision',
  '6C48E6':'Hikvision','8CFE48':'Hikvision','9CFF96':'Hikvision','A0D09E':'Hikvision',
  'B40C25':'Hikvision','B46D83':'Hikvision','BC8BCC':'Hikvision','C0B9C5':'Hikvision',
  'C43B68':'Hikvision','C8F3A2':'Hikvision','D4E0A8':'Hikvision','F4E2B2':'Hikvision',
  'FC2E8F':'Hikvision','FCA6CD':'Hikvision',
  '001C30':'Dahua','3CFB96':'Dahua','4CBCCA':'Dahua','90D7EB':'Dahua','A4BF01':'Dahua',
  'B0ECFF':'Dahua','E419F9':'Dahua','EC0E6E':'Dahua','F4B531':'Dahua',
  '000D93':'Axis','ACCC8E':'Axis','B8A44F':'Axis',
  '001803':'Hanwha','00E404':'Hanwha','58E876':'Hanwha',
  '000F13':'Bosch','1CA22A':'Bosch','7CD92C':'Bosch',
  '001AC8':'Avigilon','0090A2':'Avigilon',
  '000ADE':'Mobotix',
  '00089F':'Vivotek','5C313E':'Vivotek','B0C5CA':'Vivotek',
  '005013':'Panasonic','001BFB':'Panasonic','0050F1':'Panasonic','086B59':'Panasonic',
  '0C48E8':'Panasonic','146E0A':'Panasonic','18A6F7':'Panasonic','1C8782':'Panasonic',
  '2089AB':'Panasonic','28249B':'Panasonic','50F5DA':'Panasonic','54272E':'Panasonic',
  '545BF9':'Panasonic','70B0B5':'Panasonic','7C1E52':'Panasonic','84DCFE':'Panasonic',
  '8C704F':'Panasonic','9CC171':'Panasonic','A065B4':'Panasonic','A45641':'Panasonic',
  'B8B98B':'Panasonic','C0D0E8':'Panasonic','CC68B6':'Panasonic','D8C469':'Panasonic',
  'E8C026':'Panasonic','F075A4':'Panasonic',
  '001125':'Sony','0013A9':'Sony','00137E':'Sony','001424':'Sony',
  '001634':'Sony','001ADE':'Sony','001C29':'Sony','001D0D':'Sony','001E34':'Sony',
  '00209D':'Sony','001B4F':'Sony','0025E7':'Sony','002714':'Sony',
  '002738':'Sony',
  '001065':'Motorola','00141F':'Motorola','001560':'Motorola','0017E0':'Motorola',
  '001B65':'Motorola','001C6A':'Motorola','001DEE':'Motorola',
  '00163E':'Xen','00FC99':'Amazon','40A2DB':'Amazon','848E0C':'Amazon','F0272D':'Amazon',
  '74C246':'Amazon','0427EA':'Amazon','789D2E':'Amazon','A002DC':'Amazon',
  '001F33':'Nintendo','002709':'Nintendo','00224C':'Nintendo',
  '7CBB8A':'Nintendo','98E8FA':'Nintendo','A438CC':'Nintendo','B8AE6E':'Nintendo',
  'E84ECE':'Nintendo',
  '001FA7':'Sony PlayStation','00041F':'Sony PlayStation','00D9D1':'Sony PlayStation',
  '28374B':'Sony PlayStation','70460A':'Sony PlayStation','A8E3EE':'Sony PlayStation',
  'BC607D':'Sony PlayStation','F8461C':'Sony PlayStation',
  '3C9A73':'Xbox',
  '0002CF':'Brother','000B64':'Brother','001BA9':'Brother','0080D4':'Brother',
  '30055C':'Brother','5C0E8B':'Brother',
  '0004A9':'Canon','00024F':'Canon','00037E':'Canon','000885':'Canon',
  '00206B':'Canon','002522':'Canon','003085':'Canon','048D38':'Canon',
  '081496':'Canon','1C1B0D':'Canon','20160B':'Canon','241CB5':'Canon',
  '28D244':'Canon','2C7CD7':'Canon','30C2B7':'Canon','38E088':'Canon',
  '3C2504':'Canon','44E708':'Canon','4C87EF':'Canon','54EED3':'Canon',
  '5CAFC0':'Canon','60E7AB':'Canon','68DA73':'Canon','6CA87D':'Canon',
  '70D2DC':'Canon','748798':'Canon','789C85':'Canon','7CB8B6':'Canon',
  '8006F2':'Canon','84E009':'Canon','9060F0':'Canon','90EBF0':'Canon',
  '9CB654':'Canon','A45D36':'Canon','AC5F3E':'Canon','AE5D36':'Canon',
  'B4207B':'Canon','B821D0':'Canon','BC5C4C':'Canon','C09101':'Canon',
  'C88BCA':'Canon','CCF9E8':'Canon','D4FAF9':'Canon',
  'E42160':'Canon','EC1C93':'Canon','F40B39':'Canon',
  '000413':'Epson','00268D':'Epson','08606E':'Epson','10D4C4':'Epson',
  '1C1E58':'Epson','201526':'Epson','404EE5':'Epson','483B38':'Epson',
  '50571D':'Epson','64EB8C':'Epson','6C2B25':'Epson','6CBF46':'Epson',
  '7C3C3E':'Epson','9C6C8C':'Epson','A4109C':'Epson','C8C44D':'Epson',
  'E0A878':'Epson','F431C3':'Epson',
  '001132':'QNAP','243211':'QNAP',
  '2452B3':'QNAP','244BE4':'QNAP','28D435':'QNAP','24E312':'QNAP',
  '00082F':'Synology',
  '00E0F7':'Seagate','0008A0':'Western Digital','0014EE':'Western Digital','0024EC':'Western Digital',
  '00A0B0':'WD',
  '00B0D0':'Dell EMC','001CA4':'Dell EMC',
  '00304B':'Supermicro','AC1F6B':'Supermicro',
};

// Load CSV at startup (synchronous, happens before any IPC is registered)
loadOuiCsv();

function lookupVendor(mac) {
  if (!mac) return null;
  // Normalize: strip separators, uppercase
  const clean = mac.replace(/[:\-]/g, '').toUpperCase();
  if (clean.length < 6) return null;
  // Try 6-char (MA-L), then 7-char, then 9-char (MA-S) prefix
  return OUI[clean.slice(0, 6)] || OUI[clean.slice(0, 7)] || OUI[clean.slice(0, 9)] || null;
}

let scanAbortFlag = false;
let scanRunningMain = false; // guard against concurrent scan-start calls

// Shared ARP output parser — used by scan-start and arp-sweep.
// Returns { [ip]: mac } for the given subnet base, filtered to [rangeStart, rangeEnd].
function parseArpOutput(arpOut, baseIp, rangeStart = 1, rangeEnd = 254) {
  const map = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([\w-]+)\s+(dynamic|static)/i);
    if (!m) return;
    const ip = m[1], mac = m[2];
    if (!ip.startsWith(baseIp + '.')) return;
    if (/ff-ff-ff-ff|01-00-5e|33-33/i.test(mac)) return;
    const last = parseInt(ip.split('.')[3], 10);
    if (last < rangeStart || last > rangeEnd) return;
    map[ip] = mac;
  });
  return map;
}

ipcMain.on('scan-start', async (e, { baseIp, concurrency, scanStart, scanEnd }) => {
  if (scanRunningMain) {
    if (!e.sender.isDestroyed()) e.sender.send('scan-done', { aborted: true });
    return;
  }
  // Defense-in-depth: renderer validates, but main process re-validates.
  // baseIp is a 3-octet prefix like "192.168.1" — digits and dots only.
  if (!baseIp || typeof baseIp !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(baseIp)) {
    if (!e.sender.isDestroyed()) e.sender.send('scan-done', { aborted: true });
    return;
  }
  scanRunningMain = true;
  scanAbortFlag = false;
  const start   = Math.max(1,   Math.min(254, parseInt(scanStart, 10) || 1));
  const end     = Math.max(1,   Math.min(254, parseInt(scanEnd,   10) || 254));
  const TOTAL   = end - start + 1;
  // 32 workers saturates a local /24 without overwhelming the host.
  // LAN ICMP RTT is <5ms so process-spawn overhead dominates, not network.
  const WORKERS = Math.min(Math.max(concurrency || 32, 8), 32);
  // 300ms is plenty for LAN ICMP — saves 500ms per dead host vs old 800ms.
  const PING_MS = 300;

  function icmpPing(host) {
    const pingStart = Date.now();
    return execAsync(`ping -n 1 -w ${PING_MS} ${host}`, { timeout: PING_MS + 500 })
      .then(stdout => {
        const ok = /TTL=/i.test(stdout);
        return { ok, ms: ok ? Date.now() - pingStart : 0 };
      })
      .catch(() => ({ ok: false, ms: 0 }));
  }

  // Phase 0: pre-scan ARP — report already-cached hosts immediately,
  // before a single ping fires. Warm cache from recent activity catches
  // these for free with zero wait time.
  let preScanMacMap = {};
  try {
    const arpOut = await execAsync('arp -a', { timeout: 3000 }).catch(() => '');
    preScanMacMap = parseArpOutput(arpOut, baseIp, start, end);
    if (!e.sender.isDestroyed()) {
      Object.entries(preScanMacMap).forEach(([ip, mac]) => {
        e.sender.send('scan-result', {
          host: ip, ok: true, ms: 0, done: 0, total: TOTAL,
          fromArp: true, mac, vendor: lookupVendor(mac),
        });
      });
    }
  } catch {}

  const hosts = Array.from({ length: TOTAL }, (_, i) => `${baseIp}.${start + i}`);
  let cursor = 0;
  let done   = 0;
  const pingResults = {};

  // Progress batching — dead hosts don't get individual scan-result calls.
  // Instead we emit scan-progress every 200ms so the renderer progress bar
  // stays smooth without flooding IPC with up to 254 no-op messages.
  let lastProgressDone = 0;
  const progressTimer = setInterval(() => {
    if (done !== lastProgressDone && !e.sender.isDestroyed()) {
      e.sender.send('scan-progress', { done, total: TOTAL });
      lastProgressDone = done;
    }
  }, 200);

  async function worker() {
    while (cursor < TOTAL && !scanAbortFlag) {
      const idx  = cursor++;
      const host = hosts[idx];
      let result;
      try {
        result = await icmpPing(host);
      } catch {
        result = { ok: false, ms: 0 };
      }
      done++;
      pingResults[host] = result;
      // Only push alive hosts over IPC — dead hosts are covered by scan-progress.
      if (result.ok && !e.sender.isDestroyed()) {
        e.sender.send('scan-result', {
          host, ok: true, ms: result.ms, done, total: TOTAL,
        });
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: WORKERS }, worker));
  } catch (err) {
    console.error('scan worker error:', err.message);
  }

  clearInterval(progressTimer);
  // Final progress flush so the bar reaches 100%
  if (!e.sender.isDestroyed()) e.sender.send('scan-progress', { done: TOTAL, total: TOTAL });

  if (scanAbortFlag) {
    scanRunningMain = false;
    if (!e.sender.isDestroyed()) e.sender.send('scan-done', { aborted: true });
    return;
  }

  // Phase 2: ARP sweep — cache is warm after pings; catches ICMP-silent hosts.
  // (A second, warmer pass fires after port probes via the arp-sweep IPC.)
  let macMap = {};
  try {
    const arpOut = await execAsync('arp -a', { timeout: 5000 }).catch(() => '');
    macMap = parseArpOutput(arpOut, baseIp, start, end);
  } catch (err) {
    console.error('arp sweep error:', err.message);
  }

  // Merge pre-scan entries for hosts not superseded by the post-ping sweep
  Object.entries(preScanMacMap).forEach(([ip, mac]) => {
    if (!macMap[ip]) macMap[ip] = mac;
  });

  // Single pass: report ARP-only hosts and enrich ICMP hits
  if (!e.sender.isDestroyed()) {
    Object.entries(macMap).forEach(([ip, mac]) => {
      const vendor = lookupVendor(mac);
      if (!pingResults[ip] || !pingResults[ip].ok) {
        // Host visible in ARP but missed by ICMP — and not already sent in pre-scan
        if (!preScanMacMap[ip]) {
          e.sender.send('scan-result', { host: ip, ok: true, ms: 0, done: TOTAL, total: TOTAL, fromArp: true, mac, vendor });
        }
      } else {
        // Enrich a confirmed ICMP hit with its MAC + vendor
        e.sender.send('scan-enrich', { host: ip, mac, vendor });
      }
    });
  }

  if (!e.sender.isDestroyed()) {
    e.sender.send('scan-done', { aborted: false, macMap });
  }
  scanRunningMain = false;
});

ipcMain.on('scan-stop', () => { scanAbortFlag = true; scanRunningMain = false; });

// ── IPC: duplicate IP check ────────────────────────────────
// ARP-pings a specific IP to see if anything is already using it.
// Called before applying a static IP config — non-blocking warning only.
ipcMain.handle('check-duplicate-ip', async (e, ip) => {
  if (!isValidIp(ip)) return { conflict: false };
  try {
    // Ping once to populate ARP cache
    await execAsync(`ping -n 1 -w 800 ${ip}`, { timeout: 3000 }).catch(() => {});
    // Read ARP table for that specific IP
    const arpOut = await execAsync('arp -a', { timeout: 3000 }).catch(() => '');
    for (const line of arpOut.split('\n')) {
      const m = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([\w-]+)\s+(dynamic|static)/i);
      if (!m) continue;
      if (m[1] !== ip) continue;
      if (/ff-ff-ff-ff|01-00-5e|33-33/i.test(m[2])) continue;
      const mac = m[2];
      return { conflict: true, mac, vendor: lookupVendor(mac) || null };
    }
    return { conflict: false };
  } catch { return { conflict: false }; }
});

// ── IPC: traceroute ───────────────────────────────────────
// Runs tracert -d (no DNS) -h 20 (max 20 hops) and streams each hop back.
let tracertProc = null; // global ref so tracert-stop can kill it

ipcMain.on('tracert-start', async (e, { host }) => {
  if (!host || typeof host !== 'string') return;
  const safeHost = host.trim().replace(/[^a-zA-Z0-9.\-:]/g, '');
  if (!safeHost) return;

  // Kill any previous tracert still running
  if (tracertProc) { try { tracertProc.kill(); } catch {} tracertProc = null; }

  try {
    const proc = exec(`tracert -d -h 20 -w 800 ${safeHost}`, { timeout: 60000 });
    tracertProc = proc;
    proc.stdout.on('data', chunk => {
      if (e.sender.isDestroyed()) { proc.kill(); tracertProc = null; return; }
      const lines = chunk.toString().split('\n');
      lines.forEach(line => {
        const m = line.match(/^\s*(\d+)\s+([\s\S]+?)\s*$/);
        if (!m) return;
        e.sender.send('tracert-hop', { raw: m[0].trim() });
      });
    });
    proc.on('close', () => {
      tracertProc = null;
      if (!e.sender.isDestroyed()) e.sender.send('tracert-done');
    });
    proc.on('error', () => {
      tracertProc = null;
      if (!e.sender.isDestroyed()) e.sender.send('tracert-done');
    });
  } catch {
    tracertProc = null;
    if (!e.sender.isDestroyed()) e.sender.send('tracert-done');
  }
});

ipcMain.on('tracert-stop', (e) => {
  if (tracertProc) { try { tracertProc.kill(); } catch {} tracertProc = null; }
  if (!e.sender.isDestroyed()) e.sender.send('tracert-done');
});

// ── IPC: second ARP pass — called after port probes settle ─
// By this point TCP connections have been made, cache is much warmer
ipcMain.handle('arp-sweep', async (e, { baseIp }) => {
  if (!baseIp || typeof baseIp !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(baseIp)) return {};
  try {
    const arpOut = await execAsync('arp -a', { timeout: 5000 }).catch(() => '');
    const raw = parseArpOutput(arpOut, baseIp);
    const results = {};
    Object.entries(raw).forEach(([ip, mac]) => {
      results[ip] = { mac, vendor: lookupVendor(mac) };
    });
    return results;
  } catch { return {}; }
});

// ── IPC: per-host port probe ───────────────────────────────
// Fired after a host is found — checks a fixed set of service ports
// and streams results back so the UI can update incrementally.
const PROBE_PORTS = [80, 443, 554, 8080, 8443, 3389, 22, 23, 21, 8888];
const PROBE_TIMEOUT_MS = 1200;

ipcMain.on('port-probe-start', async (e, { host, ports }) => {
  // Validate host — must be a valid IPv4 address (comes from scan results)
  if (!host || typeof host !== 'string' || !isValidIp(host)) return;
  const targets = (ports && ports.length) ? ports : PROBE_PORTS;

  async function probePort(port) {
    return new Promise(resolve => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(PROBE_TIMEOUT_MS);
      socket.connect(port, host, () => {
        socket.destroy();
        resolve({ port, open: true, ms: Date.now() - start });
      });
      socket.on('error', err => {
        socket.destroy();
        // ECONNREFUSED = port closed but host is up — port is NOT open
        resolve({ port, open: false, ms: Date.now() - start, refused: err.code === 'ECONNREFUSED' });
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve({ port, open: false, ms: 0 });
      });
    });
  }

  // Run all probes in parallel
  const results = await Promise.all(targets.map(probePort));
  if (!e.sender.isDestroyed()) {
    e.sender.send('port-probe-result', { host, ports: results });
  }
});

// ── IPC: Online MAC vendor lookup ──────────────────────────
// Hits macvendors.com when OUI CSV returns nothing.
// Results are cached to disk so we build up local knowledge over time.

const VENDOR_CACHE_PATH = path.join(app.getPath('userData'), 'vendor-cache.json');
let vendorCache = {};      // in-memory: mac prefix -> vendor string
let vendorCacheDirty = false;
let vendorCacheFlushTimer = null;
let macLookupRateLimitUntil = 0; // epoch ms — don't hit macvendors.com until after this

function loadVendorCache() {
  try {
    const raw = fs.readFileSync(VENDOR_CACHE_PATH, 'utf8');
    vendorCache = JSON.parse(raw);
    console.log(`[VendorCache] Loaded ${Object.keys(vendorCache).length} cached entries`);
  } catch { vendorCache = {}; }
}

function flushVendorCache() {
  if (!vendorCacheDirty) return;
  try {
    fs.writeFileSync(VENDOR_CACHE_PATH, JSON.stringify(vendorCache, null, 2), 'utf8');
    vendorCacheDirty = false;
  } catch (err) {
    console.warn('[VendorCache] Failed to write cache:', err.message);
  }
}

function scheduleVendorCacheFlush() {
  // Debounce writes — flush 5s after last update
  if (vendorCacheFlushTimer) clearTimeout(vendorCacheFlushTimer);
  vendorCacheFlushTimer = setTimeout(flushVendorCache, 5000);
}

// Detect locally-administered (random/spoofed) MACs
// Second nibble of first byte: bit 1 set = locally administered
function isLocallyAdministered(mac) {
  const clean = mac.replace(/[:\-]/g, '').toUpperCase();
  if (clean.length < 2) return false;
  const firstByte = parseInt(clean.slice(0, 2), 16);
  return (firstByte & 0x02) !== 0;
}

ipcMain.handle('mac-lookup-online', async (e, mac) => {
  if (!mac) return { mac, vendor: null, source: 'none' };

  const clean = mac.replace(/[:\-]/g, '').toUpperCase();
  if (clean.length < 6) return { mac, vendor: null, source: 'none' };

  // Locally-administered MAC — no lookup will find this
  if (isLocallyAdministered(clean)) {
    return { mac, vendor: null, source: 'local', note: 'Locally administered / randomised MAC' };
  }

  const prefix = clean.slice(0, 6);

  // Check in-memory + disk cache first (includes confirmed-not-found '' entries)
  if (vendorCache[prefix] !== undefined) {
    return { mac, vendor: vendorCache[prefix] || null, source: 'cache' };
  }

  // Rate-limit guard — if we hit a 429 recently, back off for 60s
  const now = Date.now();
  if (macLookupRateLimitUntil && now < macLookupRateLimitUntil) {
    return { mac, vendor: null, source: 'error', note: 'Rate limited — retry later' };
  }

  // Try macvendors.com — free, no key, plain text response
  try {
    const vendor = await new Promise((resolve, reject) => {
      const formatted = `${clean.slice(0,2)}:${clean.slice(2,4)}:${clean.slice(4,6)}`;
      const req = https.get(
        `https://api.macvendors.com/${encodeURIComponent(formatted)}`,
        { timeout: 3000 },
        (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200 && body && !body.includes('errors')) {
              resolve(body.trim());
            } else if (res.statusCode === 404) {
              resolve(''); // Not found — cache as empty to avoid re-querying
            } else if (res.statusCode === 429) {
              reject(new Error('RATE_LIMITED'));
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });

    // Cache the result (empty string = confirmed not found)
    vendorCache[prefix] = vendor || '';
    vendorCacheDirty = true;
    scheduleVendorCacheFlush();

    return { mac, vendor: vendor || null, source: 'online' };
  } catch (err) {
    if (err.message === 'RATE_LIMITED') {
      // Back off for 60s — don't hammer the API
      macLookupRateLimitUntil = Date.now() + 60000;
      return { mac, vendor: null, source: 'error', note: 'Rate limited by macvendors.com — will retry after 60s' };
    }
    // Other network error — don't cache, just return null so we can retry later
    return { mac, vendor: null, source: 'error', note: err.message };
  }
});

// Load vendor cache at startup
loadVendorCache();

// ── IPC: site database ─────────────────────────────────────
const SITES_PATH = path.join(app.getPath('userData'), 'sites.json');

ipcMain.handle('sites-load', () => loadJsonFile(SITES_PATH, {}));

ipcMain.handle('sites-save', async (e, sites) => {
  try {
    await fs.promises.writeFile(SITES_PATH, JSON.stringify(sites, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, err: err.message };
  }
});

// ── IPC: INTEL site knowledge base ────────────────────────
const INTEL_PATH = path.join(app.getPath('userData'), 'intel.json');

ipcMain.handle('intel-load', () => loadJsonFile(INTEL_PATH, {}));

ipcMain.handle('intel-save', async (e, intel) => {
  try {
    await fs.promises.writeFile(INTEL_PATH, JSON.stringify(intel, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, err: err.message };
  }
});

// ── IPC: Excel export ──────────────────────────────────────
ipcMain.handle('export-excel', async (e, { intelDB, sitesDB }) => {
  try {
    const { dialog } = require('electron');
    const ExcelJS = require('exceljs');

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Site Data',
      defaultPath: path.join(app.getPath('documents'), `netether-export-${new Date().toISOString().slice(0,10)}.xlsx`),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, err: 'CANCELLED' };

    // Merge intelDB + legacy sitesDB (intel wins)
    const allSites = {};
    Object.entries(sitesDB || {}).forEach(([subnet, site]) => {
      const sid = 'site_' + subnet.replace(/\./g, '_');
      if (!intelDB[sid]) {
        allSites[sid] = {
          id: sid, name: site.name || subnet, subnet,
          customer: '', address: '', notes: '',
          lastScan: site.updated || null,
          devices: (site.devices || []).map(d => ({
            ip: d.ip || '', mac: d.mac || '', vendor: d.vendor || '',
            type: 'unknown', hostname: '', notes: '',
            ports: [], firstSeen: d.lastSeen, lastSeen: d.lastSeen,
          })),
        };
      }
    });
    Object.entries(intelDB || {}).forEach(([k, v]) => { allSites[k] = v; });

    const sites = Object.values(allSites).sort((a, b) =>
      (a.name || '').localeCompare(b.name || ''));

    const fmtTs = ts => {
      if (!ts) return '';
      try { return new Date(ts).toISOString().slice(0, 10); } catch { return ''; }
    };

    // ── Styles ────────────────────────────────────────────
    const HDR_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2D1F' } };
    const SITE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1A0D' } };
    const ALT_FILL  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111E11' } };
    const BASE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1A0D' } };
    const HDR_FONT  = { name: 'Arial', bold: true, color: { argb: 'FF00FF90' }, size: 10 };
    const SITE_FONT = { name: 'Arial', bold: true, color: { argb: 'FFA0DCA0' }, size: 10 };
    const DATA_FONT = { name: 'Arial', color: { argb: 'FFD0F0D0' }, size: 9 };
    const TTL_FONT  = { name: 'Arial', bold: true, color: { argb: 'FF00FF90' }, size: 13 };
    const BOT_BORDER = { bottom: { style: 'thin', color: { argb: 'FF1A3A1A' } } };
    const left   = { horizontal: 'left',   vertical: 'middle' };
    const center = { horizontal: 'center', vertical: 'middle' };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'NET//ETHER — Broman Enterprises';
    wb.created = new Date();

    // ── Sheet 1: Device Roster ────────────────────────────
    const ws = wb.addWorksheet('Device Roster');
    ws.views = [{ showGridLines: false, state: 'frozen', ySplit: 2 }];

    // Title
    ws.mergeCells('A1:N1');
    const t1 = ws.getCell('A1');
    t1.value = 'NET//ETHER — SITE DEVICE EXPORT';
    t1.font = TTL_FONT; t1.fill = SITE_FILL; t1.alignment = left;
    ws.getRow(1).height = 22;

    // Headers
    const devHeaders = [
      { header: 'Device Name',      width: 28 },
      { header: 'Location / Site',  width: 22 },
      { header: 'IP Address',       width: 16 },
      { header: 'Subnet Mask',      width: 16 },
      { header: 'Default Gateway',  width: 16 },
      { header: 'MAC Address',      width: 20 },
      { header: 'Vendor',           width: 18 },
      { header: 'Device Type',      width: 16 },
      { header: 'Hostname / Notes', width: 28 },
      { header: 'Ports Open',       width: 18 },
      { header: 'Switch',           width: 16 },
      { header: 'Switch Port',      width: 12 },
      { header: 'First Seen',       width: 14 },
      { header: 'Last Seen',        width: 14 },
    ];
    devHeaders.forEach(({ header, width }, i) => {
      const col = i + 1;
      const cell = ws.getCell(2, col);
      cell.value = header;
      cell.font = HDR_FONT; cell.fill = HDR_FILL; cell.alignment = center;
      ws.getColumn(col).width = width;
    });
    ws.getRow(2).height = 18;

    let rowNum = 3;
    for (const site of sites) {
      const devs = site.devices || [];
      if (!devs.length) continue;
      const name = site.name || site.subnet || 'Unknown';

      // Site group header
      ws.mergeCells(`A${rowNum}:N${rowNum}`);
      const sg = ws.getCell(`A${rowNum}`);
      sg.value = `  ${name.toUpperCase()}   —   ${site.subnet || ''}`;
      sg.font = SITE_FONT; sg.fill = SITE_FILL; sg.alignment = left;
      ws.getRow(rowNum).height = 16;
      rowNum++;

      devs.forEach((dev, i) => {
        const fill = i % 2 ? ALT_FILL : BASE_FILL;
        const ports = (dev.ports || []).filter(p => p.open).map(p => p.port).join(', ');
        const vals = [
          dev.hostname || dev.ip || '',
          name,
          dev.ip || '',
          '', // subnet mask not stored per device
          '', // gateway not stored per device
          dev.mac || '',
          dev.vendor || '',
          dev.type || '',
          dev.notes || '',
          ports,
          '', // switch
          '', // switch port
          fmtTs(dev.firstSeen),
          fmtTs(dev.lastSeen),
        ];
        const row = ws.getRow(rowNum);
        vals.forEach((val, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value = val;
          cell.font = DATA_FONT; cell.fill = fill;
          cell.alignment = left; cell.border = BOT_BORDER;
        });
        row.height = 15;
        rowNum++;
      });
      rowNum++; // blank spacer
    }

    // ── Sheet 2: Sites Summary ────────────────────────────
    const ws2 = wb.addWorksheet('Sites Summary');
    ws2.views = [{ showGridLines: false }];

    ws2.mergeCells('A1:G1');
    const t2 = ws2.getCell('A1');
    t2.value = 'NET//ETHER — SITES SUMMARY';
    t2.font = TTL_FONT; t2.fill = SITE_FILL; t2.alignment = left;
    ws2.getRow(1).height = 22;

    const sumHeaders = [
      { header: 'Site Name',     width: 28 },
      { header: 'Subnet',        width: 18 },
      { header: 'Customer',      width: 22 },
      { header: 'Address',       width: 32 },
      { header: 'Device Count',  width: 14 },
      { header: 'Last Scan',     width: 18 },
      { header: 'Notes',         width: 36 },
    ];
    sumHeaders.forEach(({ header, width }, i) => {
      const cell = ws2.getCell(2, i + 1);
      cell.value = header;
      cell.font = HDR_FONT; cell.fill = HDR_FILL; cell.alignment = center;
      ws2.getColumn(i + 1).width = width;
    });
    ws2.getRow(2).height = 18;

    sites.forEach((site, i) => {
      const fill = i % 2 ? ALT_FILL : BASE_FILL;
      const r = ws2.getRow(i + 3);
      const vals = [
        site.name || '',
        site.subnet || '',
        site.customer || '',
        site.address || '',
        (site.devices || []).length,
        fmtTs(site.lastScan),
        site.notes || '',
      ];
      vals.forEach((val, ci) => {
        const cell = r.getCell(ci + 1);
        cell.value = val;
        cell.font = DATA_FONT; cell.fill = fill;
        cell.alignment = left; cell.border = BOT_BORDER;
      });
      r.height = 15;
    });

    await wb.xlsx.writeFile(result.filePath);
    return { ok: true, path: result.filePath };

  } catch (err) {
    return { ok: false, err: err.message };
  }
});

// ── IPC: MTU read & fix ────────────────────────────────────
ipcMain.handle('get-adapter-mtu', async (e, adapter) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter) return { ok: false, err: 'Invalid adapter name' };
  try {
    const stdout = await execAsync('netsh interface ipv4 show subinterfaces', { timeout: 4000 });
    // Output lines look like:
    //      1500  4294967295  4294967295            0  Ethernet
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+\d+\s+\d+\s+\d+\s+(.+?)\s*$/);
      if (m && m[2].trim().toLowerCase() === safeAdapter.toLowerCase()) {
        return { ok: true, mtu: parseInt(m[1], 10) };
      }
    }
    return { ok: false, err: 'Adapter not found in subinterfaces' };
  } catch (err) {
    return { ok: false, err: err.message };
  }
});

ipcMain.handle('fix-mtu', async (e, { adapter, mtu }) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter) return { ok: false, err: 'Invalid adapter name' };
  const targetMtu = clampMtu(mtu);
  const cmd = `netsh interface ipv4 set subinterface "${safeAdapter}" mtu=${targetMtu} store=persistent`;
  const result = await runElevated(cmd, { tag: 'mtu', timeoutMs: 15000 });
  return result.ok ? { ok: true, mtu: targetMtu } : result;
});

// ── IPC: presets ───────────────────────────────────────────
ipcMain.handle('presets-load', () => loadJsonFile(PRESETS_PATH, null));

ipcMain.handle('presets-reset', async () => {
  try { await fs.promises.unlink(PRESETS_PATH); } catch {}
  return { ok: true };
});

ipcMain.handle('presets-save', async (e, presets) => {
  try {
    await fs.promises.writeFile(PRESETS_PATH, JSON.stringify(presets, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, err: err.message };
  }
});

// ── IPC: ping ──────────────────────────────────────────────
// Uses ICMP via ping.exe — consistent with scanner behaviour.
// Falls back to TCP port 80 probe if ICMP is blocked (e.g. some VPNs / cloud VMs).
ipcMain.handle('ping-host', async (e, host) => {
  if (!host || typeof host !== 'string') return { ok: false, err: 'INVALID_HOST' };
  const safeHost = host.trim().replace(/[^a-zA-Z0-9.\-:]/g, '');
  if (!safeHost) return { ok: false, err: 'INVALID_HOST' };

  const start = Date.now();
  try {
    const stdout = await execAsync(`ping -n 1 -w 1500 ${safeHost}`, { timeout: 4000 });
    const ok = /TTL=/i.test(stdout);
    if (ok) return { ok: true, ms: Date.now() - start };
  } catch { /* ICMP failed or timed out — try TCP fallback */ }

  // TCP fallback — ECONNREFUSED means host is up but port 80 is closed
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const tcpStart = Date.now();
    socket.setTimeout(2000);
    socket.connect(80, safeHost, () => {
      socket.destroy();
      resolve({ ok: true, ms: Date.now() - tcpStart, note: 'tcp-fallback' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      if (err.code === 'ECONNREFUSED')
        resolve({ ok: true, ms: Date.now() - tcpStart, note: 'tcp-fallback-refused' });
      else
        resolve({ ok: false, err: err.code });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, err: 'TIMEOUT' });
    });
  });
});

// ── IPC: apply network config (elevated) ──────────────────
ipcMain.handle('apply-network-config', async (e, { adapter, ip, subnet, gateway, dns }) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter)           return { ok: false, err: 'Invalid adapter name' };
  if (!isValidIp(ip))         return { ok: false, err: 'Invalid IP address' };
  if (!isValidSubnet(subnet)) return { ok: false, err: 'Invalid subnet mask' };
  if (gateway && gateway.trim() && !isValidIp(gateway)) return { ok: false, err: 'Invalid gateway' };
  if (dns && dns.trim() && !isValidIp(dns.trim())) return { ok: false, err: 'Invalid DNS address' };

  const addrCmd = gateway && gateway.trim()
    ? `netsh interface ip set address "${safeAdapter}" static ${ip} ${subnet} ${gateway}`
    : `netsh interface ip set address "${safeAdapter}" static ${ip} ${subnet}`;

  const cmdLines = [
    addrCmd,
    dns && dns.trim() ? `netsh interface ip set dns "${safeAdapter}" static ${dns.trim()}` : null,
  ].filter(Boolean).join('; ');

  const result = await runElevated(cmdLines, { tag: 'run', timeoutMs: 30000 });
  if (!result.ok) return result;

  // Verify the change took — poll netsh up to 3x, but also check registry
  // as netsh drops the IP line for disconnected adapters even after a successful apply.
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      // Primary: netsh (works for connected adapters)
      const cfg = await execAsync('netsh interface ip show config', { timeout: 5000 });
      const blocks = cfg.split(/\r?\n(?=Configuration for interface)/i);
      const block = blocks.find(b => b.toLowerCase().includes(safeAdapter.toLowerCase()));
      if (block && block.includes(ip)) return { ok: true };
      // Fallback: registry (works for disconnected static adapters)
      const guid = await getAdapterGuid(safeAdapter);
      if (guid) {
        const regOut = (await execAsync(
          `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\${guid}" /v IPAddress`,
          { timeout: 3000 }
        ).catch(() => '')).replace(/\r/g, '');
        if (regOut.includes(ip)) return { ok: true };
      }
    } catch {}
  }
  return { ok: false, err: 'Command ran but IP did not change — check adapter name or admin rights' };
});

// ── IPC: apply DHCP (elevated) ────────────────────────────
ipcMain.handle('apply-dhcp', async (e, { adapter }) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter) return { ok: false, err: 'Invalid adapter name' };
  const psLines = [
    `netsh interface ip set address "${safeAdapter}" dhcp`,
    `netsh interface ip set dns "${safeAdapter}" dhcp`,
  ].join('; ');
  const result = await runElevated(psLines, { tag: 'dhcp', timeoutMs: 30000 });
  if (!result.ok) return result;

  // Verify the change actually took by polling netsh up to 3 times with a short delay
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const cfg = await execAsync('netsh interface ip show config', { timeout: 5000 });
      const blocks = cfg.split(/\r?\n(?=Configuration for interface)/i);
      const block = blocks.find(b => b.toLowerCase().includes(safeAdapter.toLowerCase()));
      if (block && /DHCP enabled:\s+Yes/i.test(block)) {
        return { ok: true };
      }
    } catch {}
  }
  // netsh verify failed — try registry as ground truth (catches disconnected adapters
  // where netsh show config never updates until a lease is obtained)
  try {
    const guid = await getAdapterGuid(safeAdapter);
    if (guid) {
      const regOut = (await execAsync(
        `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\${guid}" /v EnableDHCP`,
        { timeout: 3000 }
      ).catch(() => '')).replace(/\r/g, '');
      const enableMatch = regOut.match(/EnableDHCP\s+REG_DWORD\s+(0x\w+)/i);
      if (enableMatch && parseInt(enableMatch[1], 16) !== 0) return { ok: true };
    }
  } catch {}
  // runElevated succeeded but DHCP didn't take — likely UAC was auto-approved
  // but netsh failed silently (e.g. adapter name mismatch or policy block)
  return { ok: false, err: 'DHCP command ran but adapter is still static — check adapter name and run as admin' };
});

// ── IPC: IP alias management ───────────────────────────────

// Get all IPs assigned to an adapter
ipcMain.handle('get-aliases', async (e, adapter) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter) return { ok: false, err: 'Invalid adapter name', aliases: [] };
  try {
    const stdout = await execAsync(`netsh interface ip show addresses "${safeAdapter}"`, { timeout: 4000 });
    // Parse lines like:
    //    IP Address:               192.168.1.100
    //    Subnet Prefix:            192.168.1.0/24 (mask 255.255.255.0)
    const results = [];
    const ipMatches = [...stdout.matchAll(/IP Address:\s+([\d.]+)/gi)];
    const maskMatches = [...stdout.matchAll(/mask\s+([\d.]+)/gi)];
    ipMatches.forEach((m, i) => {
      results.push({
        ip:     m[1],
        subnet: maskMatches[i] ? maskMatches[i][1] : '255.255.255.0',
      });
    });
    return { ok: true, aliases: results };
  } catch (err) {
    return { ok: false, err: err.message, aliases: [] };
  }
});

ipcMain.handle('alias-add', async (e, { adapter, ip, subnet }) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter)           return { ok: false, err: 'Invalid adapter name' };
  if (!isValidIp(ip))         return { ok: false, err: 'Invalid IP address' };
  if (!isValidSubnet(subnet)) return { ok: false, err: 'Invalid subnet mask' };

  // If the adapter is on DHCP, netsh "add address" silently replaces the DHCP
  // lease instead of adding a second IP. Fix: switch to static first (preserving
  // the current IP/subnet/gateway), then add the alias — all in one elevated chain.
  try {
    const cfg = await execAsync('netsh interface ip show config', { timeout: 5000 }).catch(() => '');
    const blocks = cfg.split(/\r?\n(?=Configuration for interface)/i);
    const block  = blocks.find(b => b.toLowerCase().includes(safeAdapter.toLowerCase()));
    if (block && /DHCP enabled:\s+Yes/i.test(block)) {
      const currentIp  = (block.match(/IP Address:\s+([\d.]+)/i)         || [])[1];
      const currentSn  = (block.match(/Subnet Prefix[^(]+\(mask\s+([\d.]+)\)/i) || [])[1] || '255.255.255.0';
      const currentGw  = (block.match(/Default Gateway:\s+([\d.]+)/i)    || [])[1];
      if (!currentIp) return { ok: false, err: 'DHCP adapter has no current IP — apply a static IP first before adding multi-IP' };
      const setStatic = currentGw
        ? `netsh interface ip set address "${safeAdapter}" static ${currentIp} ${currentSn} ${currentGw}`
        : `netsh interface ip set address "${safeAdapter}" static ${currentIp} ${currentSn}`;
      const addAlias  = `netsh interface ip add address "${safeAdapter}" ${ip} ${subnet}`;
      return runElevated(`${setStatic}; ${addAlias}`, { tag: 'alias_add', timeoutMs: 25000 });
    }
  } catch { /* fall through to normal path */ }

  const cmd = `netsh interface ip add address "${safeAdapter}" ${ip} ${subnet}`;
  return runElevated(cmd, { tag: 'alias_add', timeoutMs: 20000 });
});

// Remove a secondary IP from an adapter (elevated)
ipcMain.handle('alias-remove', async (e, { adapter, ip }) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter)   return { ok: false, err: 'Invalid adapter name' };
  if (!isValidIp(ip)) return { ok: false, err: 'Invalid IP address' };
  const cmd = `netsh interface ip delete address "${safeAdapter}" ${ip}`;
  return runElevated(cmd, { tag: 'alias_del', timeoutMs: 20000 });
});

// Build netsh commands for aliases without elevating (CMD fallback)
ipcMain.handle('alias-build-cmd', async (e, { action, adapter, ip, subnet, currentIp, currentSn, currentGw }) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter || !isValidIp(ip)) return '';
  if (action === 'add' && isValidSubnet(subnet)) {
    // If caller passed current DHCP state, prepend the static conversion step
    if (currentIp && isValidIp(currentIp)) {
      const setStatic = currentGw && isValidIp(currentGw)
        ? `netsh interface ip set address "${safeAdapter}" static ${currentIp} ${currentSn || '255.255.255.0'} ${currentGw}`
        : `netsh interface ip set address "${safeAdapter}" static ${currentIp} ${currentSn || '255.255.255.0'}`;
      return `${setStatic} & netsh interface ip add address "${safeAdapter}" ${ip} ${subnet}`;
    }
    return `netsh interface ip add address "${safeAdapter}" ${ip} ${subnet}`;
  }
  if (action === 'remove') return `netsh interface ip delete address "${safeAdapter}" ${ip}`;
  return '';
});

// Session log feature removed — handlers deleted.

// ── FULL ADAPTER SNAPSHOT ─────────────────────────────────
// Reads complete config (IP mode, IP, subnet, gateway, DNS, MTU) for an adapter.
// Used to build a before-state record before any changes are applied.
const SNAPSHOT_PATH = path.join(app.getPath('userData'), 'last-snapshot.json');

// ── LAUNCH STATE SNAPSHOT ─────────────────────────────────
// Taken once at startup — captures ALL connected adapters so we can offer
// a full session restore on quit. Stored separately from last-snapshot.json
// so the per-apply revert flow is unaffected.
const LAUNCH_SNAPSHOT_PATH = path.join(app.getPath('userData'), 'launch-snapshot.json');

async function snapshotAdapterConfig(name) {
  // Shared helper — reads one adapter's full config from netsh + registry + subinterfaces
  const cfg = await execAsync('netsh interface ip show config', { timeout: 5000 }).catch(() => '');
  const blocks = cfg.split(/\r?\n(?=Configuration for interface)/i);
  const block = blocks.find(b => b.toLowerCase().includes(name.toLowerCase()));
  if (!block) return null;

  const isDhcp  = /DHCP enabled:\s+Yes/i.test(block);
  const ipMatch = block.match(/IP Address:\s+([\d.]+)/i);
  const snMatch = block.match(/Subnet Prefix[^(]+\(mask\s+([\d.]+)\)/i);
  const gwMatch = block.match(/Default Gateway:\s+([\d.]+)/i);
  const dnsMatch = block.match(/Statically Configured DNS Servers:\s+([\d.]+)/i) ||
                   block.match(/DNS servers configured through DHCP:\s+([\d.]+)/i);

  let ip     = ipMatch ? ipMatch[1] : null;
  let subnet = snMatch ? snMatch[1] : null;
  let gateway= gwMatch ? gwMatch[1] : null;

  // Registry fallback for disconnected static adapters
  if (!ip) {
    try {
      const guid = await getAdapterGuid(name);
      if (guid) {
        const base = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\${guid}`;
        const ipReg = (await execAsync(`reg query "${base}" /v IPAddress`, { timeout: 2000 }).catch(() => '')).replace(/\r/g, '');
        const snReg = (await execAsync(`reg query "${base}" /v SubnetMask`, { timeout: 2000 }).catch(() => '')).replace(/\r/g, '');
        const gwReg = (await execAsync(`reg query "${base}" /v DefaultGateway`, { timeout: 2000 }).catch(() => '')).replace(/\r/g, '');
        const ipR = ipReg.match(/IPAddress\s+REG_MULTI_SZ\s+([\d.]+)/i);
        const snR = snReg.match(/SubnetMask\s+REG_MULTI_SZ\s+([\d.]+)/i);
        const gwR = gwReg.match(/DefaultGateway\s+REG_MULTI_SZ\s+([\d.]+)/i);
        if (ipR) ip     = ipR[1];
        if (snR) subnet = snR[1];
        if (gwR) gateway= gwR[1];
      }
    } catch {}
  }

  // MTU
  let mtu = null;
  try {
    const mtuOut = await execAsync('netsh interface ipv4 show subinterfaces', { timeout: 4000 });
    for (const line of mtuOut.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+\d+\s+\d+\s+\d+\s+(.+?)\s*$/);
      if (m && m[2].trim().toLowerCase() === name.toLowerCase()) {
        mtu = parseInt(m[1], 10);
        break;
      }
    }
  } catch {}

  return {
    adapter: name,
    isDhcp,
    ip:      ip      || null,
    subnet:  subnet  || null,
    gateway: gateway || null,
    dns:     dnsMatch ? dnsMatch[1] : null,
    mtu,
  };
}

async function takeLaunchSnapshot() {
  try {
    const ifaces = os.networkInterfaces();
    const adapterNames = Object.keys(ifaces).filter(name => {
      const addrs = ifaces[name];
      return addrs.some(a => a.family === 'IPv4' && !a.internal);
    });

    const snapshots = {};
    await Promise.all(adapterNames.map(async name => {
      try {
        const snap = await snapshotAdapterConfig(name);
        if (snap) snapshots[name] = snap;
      } catch {}
    }));

    if (Object.keys(snapshots).length > 0) {
      const payload = { ts: Date.now(), adapters: snapshots };
      await fs.promises.writeFile(LAUNCH_SNAPSHOT_PATH, JSON.stringify(payload, null, 2), 'utf8');
      console.log(`[LaunchSnapshot] Captured ${Object.keys(snapshots).length} adapter(s)`);
    }
  } catch (err) {
    console.warn('[LaunchSnapshot] Failed:', err.message);
  }
}

ipcMain.handle('get-full-snapshot', async (e, adapter) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter) return { ok: false, err: 'Invalid adapter name' };
  try {
    const snap = await snapshotAdapterConfig(safeAdapter);
    if (!snap) return { ok: false, err: 'Adapter not found in config output' };

    const snapshot = { ...snap, adapter, ts: Date.now() };

    // Persist to disk so it survives app restarts
    try { await fs.promises.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8'); } catch {}
    return { ok: true, snapshot };
  } catch (err) {
    return { ok: false, err: err.message };
  }
});

ipcMain.handle('get-saved-snapshot', async () => {
  try {
    const raw = await fs.promises.readFile(SNAPSHOT_PATH, 'utf8');
    return { ok: true, snapshot: JSON.parse(raw) };
  } catch { return { ok: false }; }
});

// ── ADAPTER LIVE CONFIG (autofill, no disk write) ─────────
// Lightweight version of get-full-snapshot — reads live IP/subnet/gateway/DNS
// for autofilling fields on adapter select without touching the revert snapshot.
// Uses shared snapshotAdapterConfig helper — same logic, no duplication.
ipcMain.handle('get-adapter-config', async (e, adapter) => {
  const safeAdapter = sanitizeAdapter(adapter);
  if (!safeAdapter) return { ok: false };
  try {
    const snap = await snapshotAdapterConfig(safeAdapter);
    if (!snap) return { ok: false };
    return { ok: true, ip: snap.ip, subnet: snap.subnet, gateway: snap.gateway, dns: snap.dns };
  } catch { return { ok: false }; }
});

// ── ACTIVE ALIAS CHECK ────────────────────────────────────
// Returns all adapters that have more than one IP assigned (i.e. active aliases).
// Called on hide/quit to warn user before they leave.
ipcMain.handle('check-active-aliases', async () => {
  try {
    const ifaces = os.networkInterfaces();
    const warnings = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
      const v4addrs = addrs.filter(a => a.family === 'IPv4' && !a.internal);
      if (v4addrs.length > 1) {
        warnings.push({ adapter: name, count: v4addrs.length, ips: v4addrs.map(a => a.address) });
      }
    }
    return { ok: true, warnings };
  } catch (err) {
    return { ok: false, err: err.message, warnings: [] };
  }
});

// ── LAUNCH SNAPSHOT IPC ───────────────────────────────────

// Return the full launch snapshot payload to the renderer
ipcMain.handle('get-launch-snapshot', async () => {
  try {
    const raw = await fs.promises.readFile(LAUNCH_SNAPSHOT_PATH, 'utf8');
    return { ok: true, ...JSON.parse(raw) };
  } catch { return { ok: false }; }
});

// Compare current live adapter state against launch snapshot.
// Returns only adapters that actually changed — empty array means nothing to restore.
ipcMain.handle('get-launch-deltas', async () => {
  try {
    const raw = await fs.promises.readFile(LAUNCH_SNAPSHOT_PATH, 'utf8');
    const { ts, adapters } = JSON.parse(raw);

    const deltas = [];
    for (const [name, snap] of Object.entries(adapters)) {
      const current = await snapshotAdapterConfig(name).catch(() => null);
      if (!current) continue;

      const changed =
        current.isDhcp  !== snap.isDhcp  ||
        current.ip      !== snap.ip      ||
        current.subnet  !== snap.subnet  ||
        current.gateway !== snap.gateway ||
        current.dns     !== snap.dns     ||
        (snap.mtu && current.mtu && current.mtu !== snap.mtu);

      if (changed) {
        deltas.push({ adapter: name, from: current, to: snap });
      }
    }
    return { ok: true, ts, deltas };
  } catch { return { ok: false, deltas: [] }; }
});

// Restore all adapters in the launch snapshot to their saved state (elevated).
ipcMain.handle('restore-launch-state', async (e, adapterNames) => {
  try {
    const raw = await fs.promises.readFile(LAUNCH_SNAPSHOT_PATH, 'utf8');
    const { adapters } = JSON.parse(raw);

    // Filter to only requested adapters (renderer passes the confirmed list)
    const targets = adapterNames
      ? Object.entries(adapters).filter(([name]) => adapterNames.includes(name))
      : Object.entries(adapters);

    const results = [];
    for (const [name, snap] of targets) {
      const safeAdapter = sanitizeAdapter(name);
      if (!safeAdapter) { results.push({ adapter: name, ok: false, err: 'Invalid adapter name' }); continue; }

      try {
        let cmdLines;
        if (snap.isDhcp) {
          cmdLines = [
            `netsh interface ip set address "${safeAdapter}" dhcp`,
            `netsh interface ip set dns "${safeAdapter}" dhcp`,
          ].join('; ');
        } else {
          const addrCmd = snap.gateway && isValidIp(snap.gateway)
            ? `netsh interface ip set address "${safeAdapter}" static ${snap.ip} ${snap.subnet || '255.255.255.0'} ${snap.gateway}`
            : `netsh interface ip set address "${safeAdapter}" static ${snap.ip} ${snap.subnet || '255.255.255.0'}`;
          const dnsCmd = snap.dns && isValidIp(snap.dns)
            ? `netsh interface ip set dns "${safeAdapter}" static ${snap.dns}`
            : `netsh interface ip set dns "${safeAdapter}" dhcp`;
          cmdLines = `${addrCmd}; ${dnsCmd}`;
        }
        const r = await runElevated(cmdLines, { tag: 'restore', timeoutMs: 30000 });

        // Restore MTU if it was captured and differs
        if (r.ok && snap.mtu && snap.mtu !== 1500) {
          const mtuCmd = `netsh interface ipv4 set subinterface "${safeAdapter}" mtu=${snap.mtu} store=persistent`;
          await runElevated(mtuCmd, { tag: 'restore_mtu', timeoutMs: 15000 }).catch(() => {});
        }

        results.push({ adapter: name, ok: r.ok, err: r.err || null });
      } catch (err) {
        results.push({ adapter: name, ok: false, err: err.message });
      }
    }

    const allOk = results.every(r => r.ok);
    return { ok: allOk, results };
  } catch (err) {
    return { ok: false, err: err.message, results: [] };
  }
});

// ══════════════════════════════════════════════════════════════
