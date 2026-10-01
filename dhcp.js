'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// NET//ETHER — DHCP server engine (absorbed from NET//DHCP v3.0.4 in v7.0.0)
//
// Listen-first RFC 2131 server on one persistent UDP 67 socket, four modes:
//   off            socket closed — the default. Nothing binds until the DHCP
//                  tab asks for it, so launching ETHER never opens a listener.
//   listen         decode every DHCP packet on the wire, answer nothing
//   serve-all      answer every client (after an active rogue-server scan)
//   serve-targeted answer only MACs in the target set
// Stopping serve drops back to listen, never to blindness.
//
// Everything that touches the OS goes through ETHER's plumbing, injected via
// init(deps): validators, runElevated() (netsh firewall rules, with captured
// output and a diagnostics-log entry), execFile for read-only probes (ping,
// netstat, tasklist — never a shell string), ETHER's adapter list, ETHER's OUI
// table, and ETHER's own apply/verify path for static-IP assist. Nothing in
// this file spawns a shell.
// ══════════════════════════════════════════════════════════════════════════════

const path   = require('path');
const dgram  = require('dgram');
const os     = require('os');
const fs     = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

const OFFER_HOLD_MS   = 30000;      // tentative offer lifetime
const QUIET_AFTER_MS  = 60000;      // asking → quiet when silent this long
const PURGE_QUIET_MS  = 300000;     // quiet rows age out of the table
const PROBE_CACHE_MS  = 30000;
const SWEEP_MS        = 5000;
const SCAN_WINDOW_MS  = 6000;       // active rogue-scan window — must outlast slow routers (~3.3s seen in the field)
const ADAPTER_POLL_MS = 3000;       // light link poll while the engine is on
const LOG_MAX         = 200;

const FW_RULE_NAME    = 'NET-ETHER-DHCP-UDP67';
const FW_RULE_LEGACY  = 'NET-DHCP-Server-UDP67';   // NET//DHCP's rule — cleaned up once if found

const ASSIST_BASES = ['192.168.100', '192.168.150', '192.168.200', '10.10.10'];

module.exports = function initDhcp(deps) {
  const {
    app, ipcMain, getWin, diagAdd, runElevated,
    isValidIp, isValidSubnet, sanitizeAdapter, lookupVendor,
    getAdapters, applyStatic, applyDhcp, readAdapterConfig, getPolicy,
    onStateChange,
  } = deps;

  // ── Engine state ───────────────────────────────────────────────────────────
  let mode       = 'off';
  let sock       = null;
  let serveCfg   = null;
  let previewCfg = null;
  let targets    = new Set();
  let devices    = {};
  let quarantinedIps = new Set();
  let probeCache     = {};
  let probing        = {};
  let probeXids      = new Set();
  let relayCollector = null;
  let scanDebug      = null;
  let foreignServers = {};
  let lastServeAction = 0;
  const lastIp = {};              // mac → { ip, ts } — a returning device gets its old address back if free
  const LAST_IP_TTL_MS = 3600000;
  const rememberIp = (mac, ip) => { if (mac && ip) lastIp[mac] = { ip, ts: Date.now() }; };
  const recallIp = mac => { const r = lastIp[mac]; return (r && Date.now() - r.ts < LAST_IP_TTL_MS) ? r.ip : null; };
  let scanInFlight    = null;     // Promise of the running active scan — callers share it instead of stacking
  let lastScan        = null;     // { ts, result } — reused for SERVE within SCAN_REUSE_MS
  const SCAN_REUSE_MS  = 20000;
  const FOREIGN_FRESH_MS = 120000;   // a server heard this recently still blocks a serve-all
  let sweepTimer  = null;
  let emitTimer   = null;
  let pollTimer   = null;
  let lastAdapterState = {};
  let knownAdapters    = [];      // last full list from ETHER's get-adapters
  let lastSquatter     = null;
  let shuttingDown     = false;

  // ── Config persistence (%APPDATA%\net-ether\dhcp-config.json) ─────────────
  const CONFIG_FILE = path.join(app.getPath('userData'), 'dhcp-config.json');
  // One-time import from the standalone NET//DHCP install, if this is the first
  // run and the old file exists: profiles, reservations, idle setting, last form.
  const LEGACY_FILE = path.join(app.getPath('appData'), 'net-dhcp', 'dhcp-config.json');

  function loadStore() {
    let s = null, imported = false;
    try { if (fs.existsSync(CONFIG_FILE)) s = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
    if (!s) {
      try {
        if (fs.existsSync(LEGACY_FILE)) {
          const old = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
          s = { current: old.current || null, profiles: old.profiles || {}, reservations: old.reservations || {}, idleMinutes: old.idleMinutes };
          imported = true;
        }
      } catch {}
    }
    if (!s) s = {};
    if (!s.profiles)     s.profiles = {};
    if (!s.reservations) s.reservations = {};
    if (s.idleMinutes === undefined || s.idleMinutes === null) s.idleMinutes = 30;
    if (s.staticAssist === undefined) s.staticAssist = null;
    if (imported) {
      saveStore(s);
      diagAdd({ kind: 'app', tag: 'dhcp', ok: true, note: `Imported NET//DHCP settings from ${LEGACY_FILE} (${Object.keys(s.profiles).length} profiles, ${Object.keys(s.reservations).length} reservations)` });
    }
    return s;
  }
  function saveStore(s) {
    try {
      const tmp = CONFIG_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(s || store, null, 2), 'utf8');
      fs.renameSync(tmp, CONFIG_FILE);
    } catch {}
  }
  const store = loadStore();
  function persist() { saveStore(store); }

  // ── Log (activity log — packet-level, separate from the diagnostics log) ──
  const LOG_HISTORY = [];
  function log(msg, cls) {
    const ts = new Date().toLocaleTimeString();
    LOG_HISTORY.push(`[${ts}] ${msg}`);
    if (LOG_HISTORY.length > LOG_MAX) LOG_HISTORY.shift();
    send('dhcp-log', { msg, time: ts, cls: cls || '' });
  }
  function send(channel, payload) {
    try {
      const w = getWin();
      if (w && !w.isDestroyed() && w.webContents) w.webContents.send(channel, payload);
    } catch {}
  }

  // ── IP helpers ─────────────────────────────────────────────────────────────
  const ipToBytes = ip => Buffer.from(ip.split('.').map(Number));
  const uint32Bytes = n => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const ipToNum = ip => ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
  const numToIp = n => [(n >>> 24), (n >>> 16 & 255), (n >>> 8 & 255), n & 255].join('.');
  const isApipa = ip => /^169\.254\./.test(ip || '');
  function buildIpPool(start, end) {
    const pool = [];
    for (let n = ipToNum(start), e = ipToNum(end); n <= e; n++) pool.push(numToIp(n));
    return pool;
  }
  // Neutralise spreadsheet formula injection in device-supplied strings.
  function csvSafe(val) {
    const s = String(val == null ? '' : val);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  const csvEscape = s => String(s).replace(/"/g, '""');
  const cleanMac = m => (typeof m === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(m)) ? m.toLowerCase() : null;

  // ── Adapters — ETHER's list is the truth; a light os.networkInterfaces poll
  //    keeps link state live between full refreshes ─────────────────────────
  function lightAdapters() {
    const ifaces = os.networkInterfaces();
    const names = knownAdapters.length ? knownAdapters.map(a => a.name) : Object.keys(ifaces);
    return names.map(name => {
      const addrs = ifaces[name] || [];
      const v4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
      const known = knownAdapters.find(a => a.name === name);
      return {
        name,
        ip:        v4 ? v4.address : null,
        netmask:   v4 ? v4.netmask : null,
        connected: !!v4,
        apipa:     v4 ? isApipa(v4.address) : false,
        isDhcp:    known ? known.isDhcp : null,
      };
    });
  }
  async function refreshAdapters() {
    try {
      const full = await getAdapters();
      if (Array.isArray(full)) knownAdapters = full;
    } catch {}
    const list = lightAdapters();
    send('dhcp-adapters', { adapters: list, event: 'refresh' });
    return list;
  }
  function pollAdapters() {
    const adapters = lightAdapters();
    const current = {};
    for (const a of adapters) current[a.name] = a.connected;
    for (const name of Object.keys(current)) {
      const was = lastAdapterState[name], is = current[name];
      if (was === false && is === true)      { send('dhcp-adapters', { name, event: 'link-up' });   log(`Link UP: ${name}`, 'warn'); }
      else if (was === true && is === false) { send('dhcp-adapters', { name, event: 'link-down' }); log(`Link DOWN: ${name}`, 'err'); }
    }
    lastAdapterState = current;
    send('dhcp-adapters', { adapters, event: 'poll' });
  }
  function startPoller() { if (!pollTimer) { pollAdapters(); pollTimer = setInterval(pollAdapters, ADAPTER_POLL_MS); } }
  function stopPoller()  { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function localAdapterIps() { return new Set(lightAdapters().filter(a => a.ip).map(a => a.ip)); }
  function localAdapterMacs() {
    const out = new Set();
    for (const a of knownAdapters) if (a.mac) out.add(String(a.mac).toLowerCase().replace(/-/g, ':'));
    for (const addrs of Object.values(os.networkInterfaces())) for (const x of addrs) if (x.mac && x.mac !== '00:00:00:00:00:00') out.add(x.mac.toLowerCase());
    return out;
  }
  function otherSubnetAdapters(serverIp, mask) {
    if (!isValidIp(serverIp) || !isValidIp(mask)) return [];
    const m = ipToNum(mask), myNet = ipToNum(serverIp) & m;
    return lightAdapters()
      .filter(a => a.connected && a.ip && !a.apipa && a.ip !== serverIp && ((ipToNum(a.ip) & m) !== myNet))
      .map(a => `${a.name} (${a.ip})`);
  }
  function deriveCfgFromAdapter(a) {
    const ipParts = a.ip.split('.').map(Number), nmParts = a.netmask.split('.').map(Number);
    const netParts = ipParts.map((b, i) => b & nmParts[i]);
    const poolBase = netParts.slice(0, 3).join('.');
    return { adapterName: a.name, serverIp: a.ip, subnet: a.netmask, rangeStart: poolBase + '.100', rangeEnd: poolBase + '.200', gateway: a.ip, dns: '' };
  }

  // ── Firewall (UDP 67 inbound) — via runElevated, checked first so a rule
  //    that already exists never produces a failed op in the diagnostics log ──
  function fwRuleExists(name) {
    return new Promise(resolve => {
      execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], { timeout: 8000, windowsHide: true },
        (err, stdout) => resolve(!err && /Enabled/i.test(stdout || '')));
    });
  }
  async function addFirewallRule() {
    try {
      if (await fwRuleExists(FW_RULE_LEGACY)) {
        await runElevated(`netsh advfirewall firewall delete rule name=${FW_RULE_LEGACY}`, { tag: 'dhcp-fw-legacy', timeoutMs: 15000 });
        log('Removed the old NET//DHCP firewall rule', 'info');
      }
      if (await fwRuleExists(FW_RULE_NAME)) { log('Firewall: inbound UDP 67 already allowed'); return true; }
      const r = await runElevated(`netsh advfirewall firewall add rule name=${FW_RULE_NAME} dir=in action=allow protocol=UDP localport=67`, { tag: 'dhcp-fw-add', timeoutMs: 15000 });
      if (r.ok) log('Firewall: inbound UDP 67 allowed');
      else      log('Warning: could not add firewall rule — packets may be blocked (' + (r.err || 'unknown') + ')', 'warn');
      return r.ok;
    } catch (e) { log('Firewall rule error: ' + e.message, 'warn'); return false; }
  }
  async function removeFirewallRule() {
    try {
      if (!(await fwRuleExists(FW_RULE_NAME))) return;
      await runElevated(`netsh advfirewall firewall delete rule name=${FW_RULE_NAME}`, { tag: 'dhcp-fw-del', timeoutMs: 15000 });
    } catch {}
  }

  // ── Port-67 squatter check — netstat / tasklist via execFile ──────────────
  function checkPort67() {
    return new Promise(resolve => {
      execFile('netstat', ['-ano', '-p', 'UDP'], { timeout: 10000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) { resolve(null); return; }
        const line = stdout.split('\n').find(l => /UDP\s+(0\.0\.0\.0|[\d.]+):67\s/.test(l));
        if (!line) { resolve(null); return; }
        const pid = (line.trim().split(/\s+/).pop() || '').trim();
        if (!/^\d{1,7}$/.test(pid) || pid === String(process.pid)) { resolve(null); return; }
        execFile('tasklist', ['/svc', '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeout: 10000, windowsHide: true }, (err2, out2) => {
          if (err2 || !out2) { resolve(`PID ${pid}`); return; }
          const cols = out2.trim().split('","').map(s => s.replace(/^"|"$/g, ''));
          const proc = cols[0] || `PID ${pid}`;
          const svcs = (cols[2] || '').trim();
          if (/svchost/i.test(proc) && /SharedAccess/i.test(svcs)) resolve('Windows Internet Connection Sharing (ICS)');
          else if (/svchost/i.test(proc) && svcs && svcs !== 'N/A') resolve(`${proc} (services: ${svcs})`);
          else resolve(proc);
        });
      });
    });
  }

  // ── Ping-probe a candidate before offering — execFile, IP validated ────────
  function probeIp(ip) {
    return new Promise(resolve => {
      if (!isValidIp(ip)) { resolve(true); return; }     // never offer something we can't even validate
      execFile('ping', ['-n', '1', '-w', '250', ip], { timeout: 2500, windowsHide: true }, (err, stdout) => {
        const alive = !err && /ttl=/i.test(stdout || '');
        probeCache[ip] = { free: !alive, ts: Date.now() };
        resolve(alive);
      });
    });
  }

  // ── Config validation ──────────────────────────────────────────────────────
  function validateCfg(cfg) {
    if (!cfg || typeof cfg !== 'object') return { ok: false, msg: 'No configuration' };
    const { adapterIp, subnet, rangeStart, rangeEnd, gateway, dns } = cfg;
    for (const [label, val] of [['Server IP', adapterIp], ['Subnet', subnet], ['Pool Start', rangeStart], ['Pool End', rangeEnd]]) {
      if (!isValidIp(val)) return { ok: false, msg: `${label}: invalid IP address` };
    }
    if (gateway && gateway.trim() && !isValidIp(gateway.trim())) return { ok: false, msg: 'Gateway: invalid IP address' };
    if (dns && dns.trim() && !isValidIp(dns.trim()))             return { ok: false, msg: 'DNS: invalid IP address' };
    if (!isValidSubnet(subnet)) return { ok: false, msg: 'Subnet: not a valid contiguous mask' };

    const maskNum = ipToNum(subnet);
    if (ipToNum(rangeStart) > ipToNum(rangeEnd)) return { ok: false, msg: 'Pool Start must be less than Pool End' };
    const serverNet = ipToNum(adapterIp) & maskNum;
    if (serverNet !== (ipToNum(rangeStart) & maskNum) || serverNet !== (ipToNum(rangeEnd) & maskNum))
      return { ok: false, msg: 'Pool appears to be on a different subnet than the server IP' };
    if (gateway && gateway.trim() && ((ipToNum(gateway.trim()) & maskNum) !== serverNet))
      return { ok: false, msg: 'Gateway is not on the server subnet' };
    if (ipToNum(rangeEnd) - ipToNum(rangeStart) + 1 > 253) return { ok: false, msg: 'Pool too large (max 253 addresses)' };

    if (cfg.ntp && cfg.ntp.trim() && !isValidIp(cfg.ntp.trim())) return { ok: false, msg: 'NTP server: invalid IP address' };
    if (cfg.opt43 && cfg.opt43.trim()) {
      const hex = cfg.opt43.replace(/[\s:.-]/g, '');
      if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0 || hex.length / 2 > 255)
        return { ok: false, msg: 'Option 43: must be hex bytes (e.g. 01 04 C0 A8 01 0A), max 255 bytes' };
    }
    for (const [label, val] of [['Domain name', cfg.domainName], ['TFTP server', cfg.tftpServer], ['Boot file', cfg.bootFile]]) {
      if (val && String(val).length > 255) return { ok: false, msg: `${label}: too long (max 255)` };
    }
    return { ok: true };
  }

  function buildEngineCfg(opts) {
    const adapterIp = opts.adapterIp;
    const gateway   = (opts.gateway && opts.gateway.trim()) || adapterIp;
    const dns       = (opts.dns && opts.dns.trim()) || null;
    const leaseSeconds = Math.max(30, Math.min(86400, parseInt(opts.lease, 10) || 300));
    const str = (v, max) => String(v || '').trim().replace(/[^\x20-\x7E]/g, '').substring(0, max) || null;
    return {
      adapterName: sanitizeAdapter(opts.adapterName) || '',
      adapterIp, subnet: opts.subnet, rangeStart: opts.rangeStart, rangeEnd: opts.rangeEnd,
      gateway, dns, leaseSeconds,
      extras: {
        domainName: str(opts.domainName, 255),
        ntp:        (opts.ntp || '').trim() || null,
        tftpServer: str(opts.tftpServer, 255),
        bootFile:   str(opts.bootFile, 128),
        opt43:      (opts.opt43 || '').replace(/[\s:.-]/g, '') || null,
      },
      pool: buildIpPool(opts.rangeStart, opts.rangeEnd),
    };
  }
  // Only the form fields go to disk — never the derived pool.
  function storableCfg(opts) {
    const keys = ['adapterName','adapterIp','subnet','rangeStart','rangeEnd','gateway','dns','lease','domainName','ntp','tftpServer','bootFile','opt43'];
    const out = {};
    for (const k of keys) if (opts[k] !== undefined) out[k] = typeof opts[k] === 'string' ? opts[k].substring(0, 255) : opts[k];
    return out;
  }

  // ── Socket & modes ─────────────────────────────────────────────────────────
  const isServing = () => mode === 'serve-all' || mode === 'serve-targeted';
  const allowedToServe = mac => mode === 'serve-all' || (mode === 'serve-targeted' && targets.has(mac));

  function setMode(newMode) {
    return new Promise((resolve, reject) => {
      if (newMode === mode) { resolve(); return; }
      if (newMode === 'off') {
        stopSweeper(); stopPoller();
        if (sock) { try { sock.close(); } catch {} sock = null; }
        const old = mode;
        mode = 'off';
        if (old !== 'off') log('Engine offline — UDP 67 released');
        diagAdd({ kind: 'app', tag: 'dhcp', ok: true, note: 'DHCP engine off' });
        announceMode();
        resolve();
        return;
      }
      const activate = () => {
        const old = mode;
        mode = newMode;
        if (old === 'off') log('Listening — every DHCP request on the wire shows below');
        if (newMode === 'serve-all')      log(`SERVING ALL on ${serveCfg.adapterIp} — pool ${serveCfg.rangeStart}–${serveCfg.rangeEnd}`, 'ok');
        if (newMode === 'serve-targeted') log(`SERVING TARGETS on ${serveCfg.adapterIp} — pool ${serveCfg.rangeStart}–${serveCfg.rangeEnd}`, 'ok');
        if (newMode === 'listen' && (old === 'serve-all' || old === 'serve-targeted')) log('Serving stopped — still listening');
        if (old !== newMode) diagAdd({ kind: 'app', tag: 'dhcp', ok: true, note: `DHCP engine ${newMode}${serveCfg && newMode !== 'listen' ? ` on ${serveCfg.adapterName || serveCfg.adapterIp} pool ${serveCfg.rangeStart}–${serveCfg.rangeEnd}` : ''}` });
        lastServeAction = Date.now();
        startSweeper(); startPoller();
        announceMode();
        resolve();
      };
      if (sock) { activate(); return; }

      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      let bound = false;
      s.on('error', err => {
        log('DHCP socket error: ' + err.message, 'err');
        if (!bound) { try { s.close(); } catch {} reject(err); }
      });
      s.on('message', (msg, rinfo) => { handleDhcpMessage(msg, rinfo).catch(e => log('DHCP parse error: ' + e.message, 'err')); });
      addFirewallRule().then(() => {
        s.bind(67, '0.0.0.0', () => {
          bound = true;
          try { s.setBroadcast(true); } catch {}
          sock = s;
          activate();
        });
      });
    });
  }

  function announceMode() {
    const state = modeState();
    send('dhcp-mode', state);
    try { onStateChange && onStateChange(state); } catch {}
    emitDevices();
  }
  function modeState() {
    const leases = Object.values(devices).filter(d => d.state === 'leased').length;
    return {
      mode, targets: [...targets], leases,
      serveCfg: serveCfg ? { adapterName: serveCfg.adapterName, adapterIp: serveCfg.adapterIp, rangeStart: serveCfg.rangeStart, rangeEnd: serveCfg.rangeEnd } : null,
    };
  }

  // ── Message handler ────────────────────────────────────────────────────────
  async function handleDhcpMessage(msg, rinfo) {
    if (msg.length < 240) return;
    if (!(msg[236] === 99 && msg[237] === 130 && msg[238] === 83 && msg[239] === 99)) return;
    const xidHex = msg.slice(4, 8).toString('hex');

    if (scanDebug) {
      scanDebug.rx67++;
      if (probeXids.has(xidHex)) scanDebug.matched67++;
      else if (msg[0] === 1) scanDebug.clients.add(Array.from(msg.slice(28, 34)).map(b => b.toString(16).padStart(2, '0')).join(':'));
      if (scanDebug.logged < scanDebug.cap) {
        scanDebug.logged++;
        log(`SCAN · rx :67 from ${rinfo ? rinfo.address + ':' + rinfo.port : '?'} op=${msg[0]} xid=${xidHex}${probeXids.has(xidHex) ? ' [our probe]' : ''}`, 'info');
      }
    }
    if (probeXids.has(xidHex)) {
      if (msg[0] === 2 && relayCollector && msg.slice(4, 8).equals(relayCollector.xid)) {
        const ip = parseReplyServerIp(msg) || (rinfo && rinfo.address) || null;
        if (ip) relayCollector.found[ip] = true;
      }
      return;
    }
    if (msg[0] !== 1) return;                                  // BOOTREQUEST only

    const xid    = Buffer.from(msg.slice(4, 8));
    const ciaddr = `${msg[12]}.${msg[13]}.${msg[14]}.${msg[15]}`;
    const chaddr = Buffer.from(msg.slice(28, 34));
    const mac    = Array.from(chaddr).map(b => b.toString(16).padStart(2, '0')).join(':');

    let msgType = 0, hostname = '', requestedIp = null, serverIdent = null;
    let i = 240;
    while (i < msg.length - 1) {
      const opt = msg[i++];
      if (opt === 255) break;
      if (opt === 0) continue;
      const len = msg[i++];
      if (i + len > msg.length) break;
      if (opt === 53 && len === 1) msgType = msg[i];
      if (opt === 12 && len > 0)   hostname = msg.slice(i, i + len).toString('utf8').replace(/[^\x20-\x7E]/g, '').trim().substring(0, 64);
      if (opt === 50 && len === 4) requestedIp = `${msg[i]}.${msg[i+1]}.${msg[i+2]}.${msg[i+3]}`;
      if (opt === 54 && len === 4) serverIdent = `${msg[i]}.${msg[i+1]}.${msg[i+2]}.${msg[i+3]}`;
      i += len;
    }
    if (!msgType) return;
    if (!requestedIp && ciaddr !== '0.0.0.0') requestedIp = ciaddr;

    // The laptop's own DHCP client broadcasts land here too. Keep the rogue-server
    // signal from its REQUESTs (that's real information) but never list ourselves.
    if (localAdapterMacs().has(mac)) {
      if (serverIdent && !localAdapterIps().has(serverIdent) && !foreignServers[serverIdent]) {
        foreignServers[serverIdent] = Date.now();
        log(`OTHER DHCP SERVER on the wire — this laptop is leasing from ${serverIdent}`, 'warn');
        send('dhcp-rogue', { server: serverIdent, how: 'passive' });
      } else if (serverIdent && !localAdapterIps().has(serverIdent)) foreignServers[serverIdent] = Date.now();
      return;
    }

    const now = Date.now();
    let d = devices[mac];
    if (!d) {
      d = devices[mac] = { state: 'asking', ip: null, vendor: lookupVendor(mac) || 'Unknown', hostname: '',
                           firstSeen: now, lastSeen: now, attempts: 0, expires: null, offerExpires: null, foreignServer: null, lastXid: null };
    }
    d.lastSeen = now; d.lastXid = xid;
    if (hostname) d.hostname = hostname;
    if (d.state === 'quiet' || d.state === 'declined') { d.state = 'asking'; d.firstSeen = now; d.attempts = 0; }
    if (msgType === 1 || msgType === 3) d.attempts++;

    // Passive rogue detection — a REQUEST naming a server that isn't us
    if (serverIdent && !localAdapterIps().has(serverIdent)) {
      d.foreignServer = serverIdent;
      if (!foreignServers[serverIdent]) {
        foreignServers[serverIdent] = now;
        log(`OTHER DHCP SERVER on the wire — clients are requesting from ${serverIdent}`, 'warn');
        send('dhcp-rogue', { server: serverIdent, how: 'passive' });
      } else foreignServers[serverIdent] = now;
    }

    if (msgType === 1) {                                       // DISCOVER
      if (d.state === 'leased') d.state = 'asking';
      if (isServing() && allowedToServe(mac)) await offerWithProbe(mac, requestedIp);
      emitDevices();
    } else if (msgType === 3) {                                // REQUEST
      if (serverIdent && serveCfg && serverIdent !== serveCfg.adapterIp) {
        if (d.state === 'offered') { d.state = 'asking'; d.ip = null; d.offerExpires = null; }
        emitDevices(); return;
      }
      if (isServing() && allowedToServe(mac)) await ackRequest(mac, chaddr, requestedIp);
      emitDevices();
    } else if (msgType === 4) {                                // DECLINE
      if (isServing() && (!serverIdent || (serveCfg && serverIdent === serveCfg.adapterIp))) {
        const badIp = requestedIp || d.ip;
        if (badIp && isValidIp(badIp)) { quarantinedIps.add(badIp); delete probeCache[badIp]; log(`DECLINE from ${mac}  ${badIp} — IP conflict, quarantining address`, 'warn'); }
        d.state = 'declined'; d.ip = null; d.offerExpires = null; d.expires = null;
        emitDevices(); announceTray();
      }
    } else if (msgType === 7) {                                // RELEASE
      if (d.state === 'leased' || d.state === 'offered') { log(`RELEASE from ${mac}  ${d.ip || ''}`); delete devices[mac]; emitDevices(); announceTray(); }
    } else if (msgType === 8) {                                // INFORM
      emitDevices();
    }
  }

  async function offerWithProbe(mac, requestedIp) {
    if (probing[mac]) { probing[mac].xid = devices[mac].lastXid; return; }
    probing[mac] = { xid: devices[mac].lastXid };
    try {
      const candidates = candidateList(mac, requestedIp);
      let chosen = null, tried = 0;
      for (const ip of candidates) {
        if (tried >= 6) break;
        const cached = probeCache[ip];
        if (cached && (Date.now() - cached.ts) < PROBE_CACHE_MS) { if (cached.free) { chosen = ip; break; } continue; }
        tried++;
        if (await probeIp(ip)) { quarantinedIps.add(ip); log(`Probe: ${ip} is already in use — quarantined, trying next`, 'warn'); continue; }
        chosen = ip; break;
      }
      const d = devices[mac];
      if (!d) return;
      if (!chosen) { log('Pool exhausted — cannot offer', 'err'); return; }
      d.state = 'offered'; d.ip = chosen; d.offerExpires = Date.now() + OFFER_HOLD_MS;
      log(`DISCOVER from ${mac} → offering ${chosen}`);
      const offer = buildDhcpPacket(2, probing[mac].xid, macToChaddr(mac), chosen, serveCfg);
      sock && sock.send(offer, 0, offer.length, 68, '255.255.255.255');
      lastServeAction = Date.now();
    } finally { delete probing[mac]; }
  }

  async function ackRequest(mac, chaddr, requestedIp) {
    const d = devices[mac];
    if (!d) return;
    let ip = null;
    const renewal = (d.state === 'leased' || d.state === 'offered') && d.ip && (!requestedIp || requestedIp === d.ip);
    if (renewal) ip = d.ip;
    else {
      const candidates = candidateList(mac, requestedIp);
      if (requestedIp && candidates[0] === requestedIp) {
        const cached = probeCache[requestedIp];
        const alive = (cached && (Date.now() - cached.ts) < PROBE_CACHE_MS) ? !cached.free : await probeIp(requestedIp);
        if (!alive) ip = requestedIp;
        else { quarantinedIps.add(requestedIp); log(`Probe: ${requestedIp} is in use — NAK to ${mac}`, 'warn'); }
      }
    }
    if (!ip) {
      // RFC 2131 §4.3.2: a server with no record of this client stays SILENT on a REQUEST
      // it can't satisfy — the client may be reconfirming a lease from the site's real
      // router (INIT-REBOOT carries no server identifier). We NAK only when we're
      // entitled to: it's a client WE offered/leased asking for the wrong address, or
      // the address it wants isn't on our subnet at all (RFC allows a wrong-network NAK).
      const ours = d.state === 'offered' || d.state === 'leased' || d.ip;
      const maskNum = ipToNum(serveCfg.subnet);
      const wrongNet = requestedIp && isValidIp(requestedIp) && ((ipToNum(requestedIp) & maskNum) !== (ipToNum(serveCfg.adapterIp) & maskNum));
      if (ours || wrongNet) {
        const nak = buildNakPacket(d.lastXid, chaddr, serveCfg.adapterIp);
        sock && sock.send(nak, 0, nak.length, 68, '255.255.255.255');
        log(`REQUEST from ${mac} → NAK${requestedIp ? ' (' + requestedIp + (wrongNet ? ' is not on our subnet' : ' unavailable') + ')' : ''}`, 'warn');
      } else {
        log(`REQUEST from ${mac} for ${requestedIp || '?'} — not ours, staying silent`, 'info');
      }
      if (d.state === 'offered') { d.state = 'asking'; d.ip = null; d.offerExpires = null; }
      lastServeAction = Date.now();
      return;
    }
    d.state = 'leased'; d.ip = ip; d.offerExpires = null; d.expires = Date.now() + serveCfg.leaseSeconds * 1000;
    rememberIp(mac, ip);
    log(`REQUEST from ${mac} → ACK ${ip}  [${d.vendor}]${d.hostname ? '  ' + d.hostname : ''}`, 'ok');
    const ack = buildDhcpPacket(5, d.lastXid, chaddr, ip, serveCfg);
    sock && sock.send(ack, 0, ack.length, 68, '255.255.255.255');
    lastServeAction = Date.now();
    send('dhcp-lease', { mac, ip, vendor: d.vendor, hostname: d.hostname, expires: d.expires, time: new Date().toLocaleTimeString() });
    announceTray();
  }

  function candidateList(mac, requestedIp) {
    const cfg = serveCfg;
    if (!cfg) return [];
    const maskNum = ipToNum(cfg.subnet);
    const netAddr = numToIp((ipToNum(cfg.adapterIp) & maskNum) >>> 0);
    const bcast   = numToIp(((ipToNum(cfg.adapterIp) & maskNum) | (~maskNum >>> 0)) >>> 0);
    const used = new Set([cfg.adapterIp, netAddr, bcast]);
    if (cfg.gateway) used.add(cfg.gateway);
    if (cfg.dns)     used.add(cfg.dns);
    for (const q of quarantinedIps) used.add(q);
    for (const [m2, d2] of Object.entries(devices)) if (m2 !== mac && d2.ip && (d2.state === 'offered' || d2.state === 'leased')) used.add(d2.ip);
    for (const [m2, ip2] of Object.entries(store.reservations)) if (m2 !== mac) used.add(ip2);
    // Keep another device's remembered address out of this one's pool walk while that device is still around
    for (const m2 of Object.keys(devices)) if (m2 !== mac) { const r = recallIp(m2); if (r) used.add(r); }
    const onSubnet = ip => isValidIp(ip) && ((ipToNum(ip) & maskNum) === (ipToNum(cfg.adapterIp) & maskNum));
    const out = [];
    const push = ip => { if (ip && onSubnet(ip) && !used.has(ip) && !out.includes(ip)) out.push(ip); };
    push(store.reservations[mac]);
    const d = devices[mac];
    if (d && d.ip) push(d.ip);
    push(recallIp(mac));
    if (requestedIp && cfg.pool.includes(requestedIp)) push(requestedIp);
    for (const ip of cfg.pool) push(ip);
    return out;
  }
  const macToChaddr = mac => Buffer.from(mac.split(':').map(h => parseInt(h, 16)));

  // ── Sweeper (expiry, quiet, idle auto-stop) ────────────────────────────────
  function startSweeper() { if (!sweepTimer) sweepTimer = setInterval(sweep, SWEEP_MS); }
  function stopSweeper()  { if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; } }
  function sweep() {
    const now = Date.now();
    let changed = false;
    for (const mac of Object.keys(devices)) {
      const d = devices[mac];
      if (d.state === 'leased' && d.expires && d.expires < now)                 { log(`Lease expired: ${d.ip}  ${mac}`); rememberIp(mac, d.ip); delete devices[mac]; changed = true; }
      else if (d.state === 'offered' && d.offerExpires && d.offerExpires < now) { d.state = 'asking'; d.offerExpires = null; changed = true; }
      else if (d.state === 'asking' && (now - d.lastSeen) > QUIET_AFTER_MS)     { d.state = 'quiet'; changed = true; }
      else if (d.state === 'quiet' && (now - d.lastSeen) > PURGE_QUIET_MS)      { delete devices[mac]; changed = true; }
    }
    if (isServing() && store.idleMinutes > 0 && (now - lastServeAction) > store.idleMinutes * 60000) {
      log(`AUTO-STOP — nothing served for ${store.idleMinutes} min, back to listening`, 'warn');
      targets.clear();
      setMode('listen').catch(() => {});
      send('dhcp-auto-stopped', { idleMinutes: store.idleMinutes });
    }
    if (changed) { emitDevices(); announceTray(); }
  }
  function announceTray() { try { onStateChange && onStateChange(modeState()); } catch {} }

  // ── Device list (throttled) ────────────────────────────────────────────────
  function emitDevices() {
    if (emitTimer) return;
    emitTimer = setTimeout(() => { emitTimer = null; send('dhcp-devices', buildDeviceList()); }, 150);
  }
  function buildDeviceList() {
    const preview = previewAssignments();
    return Object.entries(devices).map(([mac, d]) => ({
      mac, state: d.state,
      ip: (d.state === 'offered' || d.state === 'leased') ? d.ip : null,
      wouldOffer: d.state === 'asking' ? (preview[mac] || null) : null,
      vendor: d.vendor, hostname: d.hostname || '', firstSeen: d.firstSeen, lastSeen: d.lastSeen, attempts: d.attempts,
      expires: d.state === 'leased' ? d.expires : null,
      targeted: targets.has(mac), reserved: store.reservations[mac] || null, foreignServer: d.foreignServer,
    }));
  }
  function previewAssignments() {
    const cfg = serveCfg || previewCfg;
    if (!cfg) return {};
    const maskNum = ipToNum(cfg.subnet);
    const netAddr = numToIp((ipToNum(cfg.adapterIp) & maskNum) >>> 0);
    const bcast   = numToIp(((ipToNum(cfg.adapterIp) & maskNum) | (~maskNum >>> 0)) >>> 0);
    const used = new Set([cfg.adapterIp, netAddr, bcast]);
    if (cfg.gateway) used.add(cfg.gateway);
    if (cfg.dns)     used.add(cfg.dns);
    for (const q of quarantinedIps) used.add(q);
    for (const d of Object.values(devices)) if (d.ip && (d.state === 'offered' || d.state === 'leased')) used.add(d.ip);
    const onSubnet = ip => isValidIp(ip) && ((ipToNum(ip) & maskNum) === (ipToNum(cfg.adapterIp) & maskNum));
    const askers = Object.entries(devices).filter(([, d]) => d.state === 'asking').sort((a, b) => a[1].firstSeen - b[1].firstSeen);
    // Hold every asker's remembered address before dealing, so an earlier asker can't be dealt someone else's old IP
    for (const [mac] of askers) { const r = recallIp(mac); if (r && onSubnet(r) && !used.has(r)) used.add('hold:' + r); }
    const isHeldForOther = (ip, mac) => used.has('hold:' + ip) && recallIp(mac) !== ip;
    const result = {};
    for (const [mac, d] of askers) {
      let pick = null;
      const reserved = store.reservations[mac], remembered = recallIp(mac);
      if (reserved && onSubnet(reserved) && !used.has(reserved)) pick = reserved;
      else if (d.ip && onSubnet(d.ip) && !used.has(d.ip)) pick = d.ip;
      else if (remembered && onSubnet(remembered) && !used.has(remembered) && !Object.values(store.reservations).includes(remembered)) pick = remembered;
      else {
        const otherRes = new Set(Object.entries(store.reservations).filter(([m]) => m !== mac).map(([, ip]) => ip));
        for (const ip of cfg.pool) if (!used.has(ip) && !otherRes.has(ip) && !isHeldForOther(ip, mac)) { pick = ip; break; }
      }
      if (pick) { result[mac] = pick; used.add(pick); }
    }
    return result;
  }

  // ── Packet builders ────────────────────────────────────────────────────────
  function buildDhcpPacket(msgType, xid, chaddr, offeredIp, cfg) {
    const pkt = Buffer.alloc(576, 0);
    pkt[0] = 2; pkt[1] = 1; pkt[2] = 6; pkt[3] = 0;
    xid.copy(pkt, 4);
    ipToBytes(offeredIp).copy(pkt, 16);
    ipToBytes(cfg.adapterIp).copy(pkt, 20);
    chaddr.copy(pkt, 28);
    if (cfg.extras && cfg.extras.bootFile) Buffer.from(cfg.extras.bootFile.substring(0, 127), 'ascii').copy(pkt, 108);
    pkt[236] = 99; pkt[237] = 130; pkt[238] = 83; pkt[239] = 99;
    let o = 240;
    const opt = (code, ...vals) => { if (vals.length > 255 || o + vals.length + 3 > pkt.length) return; pkt[o++] = code; pkt[o++] = vals.length; vals.forEach(v => pkt[o++] = v & 0xff); };
    const optStr = (code, s) => opt(code, ...Buffer.from(String(s).substring(0, 255), 'ascii'));
    opt(53, msgType);
    opt(54, ...ipToBytes(cfg.adapterIp));
    opt(51, ...uint32Bytes(cfg.leaseSeconds));
    opt(58, ...uint32Bytes(Math.floor(cfg.leaseSeconds * 0.5)));
    opt(59, ...uint32Bytes(Math.floor(cfg.leaseSeconds * 0.875)));
    opt(1,  ...ipToBytes(cfg.subnet));
    opt(3,  ...ipToBytes(cfg.gateway));
    if (cfg.dns) opt(6, ...ipToBytes(cfg.dns));
    const x = cfg.extras || {};
    if (x.domainName) optStr(15, x.domainName);
    if (x.ntp && isValidIp(x.ntp)) opt(42, ...ipToBytes(x.ntp));
    if (x.tftpServer) optStr(66, x.tftpServer);
    if (x.bootFile)   optStr(67, x.bootFile);
    if (x.opt43 && /^[0-9a-fA-F]+$/.test(x.opt43) && x.opt43.length % 2 === 0) opt(43, ...Buffer.from(x.opt43, 'hex'));
    pkt[o++] = 255;
    return pkt.slice(0, Math.max(o, 300));   // some older BOOTP-era clients drop replies under 300 bytes
  }
  function buildNakPacket(xid, chaddr, serverIp) {
    const pkt = Buffer.alloc(300, 0);
    pkt[0] = 2; pkt[1] = 1; pkt[2] = 6; pkt[3] = 0;
    xid.copy(pkt, 4); chaddr.copy(pkt, 28);
    pkt[236] = 99; pkt[237] = 130; pkt[238] = 83; pkt[239] = 99;
    let o = 240;
    pkt[o++] = 53; pkt[o++] = 1; pkt[o++] = 6;
    pkt[o++] = 54; pkt[o++] = 4; ipToBytes(serverIp).copy(pkt, o); o += 4;
    pkt[o++] = 255;
    return pkt.slice(0, 300);
  }
  function parseReplyServerIp(msg) {
    let serverIp = null, i = 240;
    while (i < msg.length - 1) {
      const opt = msg[i++];
      if (opt === 255) break;
      if (opt === 0) continue;
      const len = msg[i++];
      if (i + len > msg.length) break;
      if (opt === 54 && len === 4) serverIp = `${msg[i]}.${msg[i+1]}.${msg[i+2]}.${msg[i+3]}`;
      i += len;
    }
    if (!serverIp) { const siaddr = `${msg[20]}.${msg[21]}.${msg[22]}.${msg[23]}`; if (siaddr !== '0.0.0.0') serverIp = siaddr; }
    return serverIp;
  }
  function buildProbeDiscover(xid, giaddrIp, useBroadcastFlag) {
    const pkt = Buffer.alloc(300, 0);
    pkt[0] = 1; pkt[1] = 1; pkt[2] = 6; pkt[3] = giaddrIp ? 1 : 0;
    xid.copy(pkt, 4);
    pkt[9] = 4;
    if (useBroadcastFlag) pkt[10] = 0x80;
    if (giaddrIp) ipToBytes(giaddrIp).copy(pkt, 24);
    Buffer.concat([Buffer.from([0x02]), crypto.randomBytes(5)]).copy(pkt, 28);
    pkt[236] = 99; pkt[237] = 130; pkt[238] = 83; pkt[239] = 99;
    let o = 240;
    pkt[o++] = 53; pkt[o++] = 1; pkt[o++] = 1;
    pkt[o++] = 255;
    return pkt.slice(0, o);
  }

  // ── Active rogue-DHCP scan (relay channel + best-effort client channel) ────
  // Serialised: a second caller while a scan is running gets the same
  // promise. Field lesson (2026-09-27): SCAN WIRE then SERVE ALL three seconds
  // later started two overlapping scans; the router's reply to the first
  // arrived during the second, matched "our probe", and was discarded — both
  // scans reported clear and SERVE ALL went live next to a real server.
  function activeRogueProbeShared() {
    if (scanInFlight) return scanInFlight;
    scanInFlight = activeRogueProbe().then(r => { lastScan = { ts: Date.now(), result: r }; return r; })
                                     .finally(() => { scanInFlight = null; });
    return scanInFlight;
  }
  // What the serve gate should see: the active scan (fresh or in flight) plus
  // any server heard passively or by an earlier scan in the last two minutes.
  async function serveGateProbe() {
    let r;
    if (lastScan && Date.now() - lastScan.ts < SCAN_REUSE_MS && !scanInFlight) r = { ...lastScan.result, reused: true };
    else r = await activeRogueProbeShared();
    const now = Date.now();
    const recent = Object.entries(foreignServers).filter(([, ts]) => now - ts < FOREIGN_FRESH_MS).map(([ip]) => ip);
    const servers = [...new Set([...(r.servers || []), ...recent])];
    const recentlyHeard = recent.filter(ip => !(r.servers || []).includes(ip));
    // Which of them are off the subnet we'd serve on — reachable via another adapter (Wi-Fi, usually)
    const cfg = serveCfg || previewCfg;
    const offSubnet = cfg ? servers.filter(ip => (ipToNum(ip) & ipToNum(cfg.subnet)) !== (ipToNum(cfg.adapterIp) & ipToNum(cfg.subnet))) : [];
    if (recentlyHeard.length) log(`GATE — ${recentlyHeard.join(', ')} heard on the wire in the last 2 min (didn't answer this probe)${offSubnet.length ? ' — not on the serve subnet, reachable via another adapter' : ''}`, 'warn');
    return { ...r, servers, recentlyHeard, offSubnet };
  }
  function probeSourceIp() {
    const live = lightAdapters().filter(a => a.connected && a.ip && !a.apipa).map(a => a.ip);
    if (!live.length) return null;
    if (serveCfg && live.includes(serveCfg.adapterIp))     return serveCfg.adapterIp;
    if (previewCfg && live.includes(previewCfg.adapterIp)) return previewCfg.adapterIp;
    return live[0];
  }
  function activeRogueProbe() {
    return new Promise(resolve => {
      if (!sock) { resolve({ ok: false, msg: 'Engine is offline — cannot scan', servers: [] }); return; }
      const found = {}, notes = [];
      scanDebug = { rx67: 0, matched67: 0, rx68: 0, logged: 0, cap: 25, clients: new Set() };
      fwRuleExists(FW_RULE_NAME).then(ok => log(`SCAN · firewall inbound UDP 67 rule: ${ok ? 'present' : 'MISSING — replies may be dropped'}`, ok ? 'info' : 'warn'));
      const xidA = crypto.randomBytes(4), xidB = crypto.randomBytes(4);
      probeXids.add(xidA.toString('hex')); probeXids.add(xidB.toString('hex'));

      const giaddr = probeSourceIp();
      if (giaddr) {
        relayCollector = { xid: xidA, found };
        try {
          const pktA = buildProbeDiscover(xidA, giaddr, false);
          sock.send(pktA, 0, pktA.length, 67, '255.255.255.255', err =>
            log(err ? `SCAN · relay send FAILED: ${err.code || err.message}` : `SCAN · relay DISCOVER sent (${pktA.length}b, giaddr=${giaddr}, src :67)`, err ? 'err' : 'info'));
        } catch (e) { notes.push('relay probe failed: ' + e.message); }
      } else notes.push('no usable local IP — relay probe skipped');

      let clientSock = null;
      try {
        clientSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        clientSock.on('error', () => { notes.push('port 68 busy — client probe skipped'); try { clientSock.close(); } catch {} clientSock = null; });
        clientSock.on('message', (msg, rinfo) => {
          if (msg.length < 240) return;
          if (scanDebug) { scanDebug.rx68++; if (scanDebug.logged < scanDebug.cap) { scanDebug.logged++; log(`SCAN · rx :68 from ${rinfo.address}:${rinfo.port} op=${msg[0]} xid=${msg.slice(4,8).toString('hex')}`, 'info'); } }
          if (msg[0] !== 2 || !msg.slice(4, 8).equals(xidB)) return;
          const ip = parseReplyServerIp(msg) || rinfo.address;
          if (ip) found[ip] = true;
        });
        clientSock.bind(68, '0.0.0.0', () => {
          try {
            clientSock.setBroadcast(true);
            const pktB = buildProbeDiscover(xidB, null, true);
            clientSock.send(pktB, 0, pktB.length, 67, '255.255.255.255', err =>
              log(err ? `SCAN · client send FAILED: ${err.code || err.message}` : `SCAN · client DISCOVER sent (${pktB.length}b, from :68, bcast flag)`, err ? 'err' : 'info'));
          } catch (e) { notes.push('client probe failed: ' + e.message); }
        });
      } catch (e) { notes.push('client probe unavailable: ' + e.message); }

      setTimeout(() => {
        relayCollector = null;
        probeXids.delete(xidA.toString('hex')); probeXids.delete(xidB.toString('hex'));
        if (clientSock) { try { clientSock.close(); } catch {} }
        const mine = localAdapterIps();
        const servers = Object.keys(found).filter(ip => !mine.has(ip));
        for (const s of servers) foreignServers[s] = Date.now();
        let clientsHeard = 0;
        if (scanDebug) {
          clientsHeard = scanDebug.clients.size;
          log(`SCAN · summary — :67 saw ${scanDebug.rx67} pkt (${scanDebug.matched67} matched our probe), :68 saw ${scanDebug.rx68} pkt, ${clientsHeard} other device${clientsHeard !== 1 ? 's' : ''} asking`, 'info');
          scanDebug = null;
        }
        const suffix = (!servers.length && notes.length) ? '  (' + notes.join('; ') + ')' : '';
        log(servers.length ? `SCAN — ${servers.length} other DHCP server${servers.length > 1 ? 's' : ''} answered: ${servers.join(', ')}` : 'SCAN — no other DHCP server answered' + suffix, servers.length ? 'warn' : 'ok');
        diagAdd({ kind: 'app', tag: 'dhcp-scan', ok: true, note: servers.length ? `other DHCP server(s): ${servers.join(', ')}` : 'no other DHCP server answered' + suffix });
        resolve({ ok: true, msg: notes.length ? notes.join('; ') : null, servers, clientsHeard });
      }, SCAN_WINDOW_MS);
    });
  }

  // ── Static-IP assist — ETHER's apply + verify path, recorded for revert ────
  async function staticAssistApply(adapterName) {
    const name = sanitizeAdapter(adapterName);
    if (!name) return { ok: false, msg: 'Invalid adapter name' };
    const inUse = lightAdapters().filter(a => a.ip).map(a => a.ip.split('.').slice(0, 3).join('.'));
    const base  = ASSIST_BASES.find(b => !inUse.includes(b)) || ASSIST_BASES[0];
    const newIp = base + '.1';
    let prev = { dhcp: true };
    try {
      const cfg = await readAdapterConfig(name);
      if (cfg && cfg.ok) prev = { dhcp: !!cfg.dhcp, ip: cfg.ip || null, mask: cfg.subnet || null, gw: cfg.gateway || null, dns: cfg.dns || null };
    } catch {}
    store.staticAssist = { adapter: name, applied: newIp, prev, ts: Date.now() };
    persist();
    const r = await applyStatic({ adapter: name, ip: newIp, subnet: '255.255.255.0', gateway: '', dns: '' });
    if (!r.ok) { store.staticAssist = null; persist(); return { ok: false, msg: r.err || 'netsh failed' }; }
    log(`STATIC ASSIST — ${name} set to ${newIp}/24 (reverts on quit)`, 'ok');
    await new Promise(res => setTimeout(res, 1500));
    return { ok: true, adapter: name, ip: newIp, subnet: '255.255.255.0' };
  }
  async function staticAssistRevert(silent) {
    const rec = store.staticAssist;
    if (!rec) return { ok: true, none: true };
    const name = sanitizeAdapter(rec.adapter);
    if (!name) { store.staticAssist = null; persist(); return { ok: false }; }
    let r;
    if (!rec.prev || rec.prev.dhcp || !rec.prev.ip || !isValidIp(rec.prev.ip) || !isValidSubnet(rec.prev.mask || '')) {
      r = await applyDhcp({ adapter: name });
    } else {
      r = await applyStatic({ adapter: name, ip: rec.prev.ip, subnet: rec.prev.mask, gateway: rec.prev.gw || '', dns: rec.prev.dns || '' });
    }
    store.staticAssist = null; persist();
    if (!silent) log(r.ok ? `STATIC ASSIST — ${name} reverted` : 'Static assist revert failed — check adapter settings manually', r.ok ? 'ok' : 'err');
    return { ok: !!r.ok };
  }

  // ── Self-test ──────────────────────────────────────────────────────────────
  async function selfTest(adapterName) {
    const checks = [];
    const adapters = lightAdapters();
    const safe = sanitizeAdapter(adapterName);
    const a = safe ? adapters.find(x => x.name === safe) : adapters.find(x => x.connected);
    if (!a)                      checks.push({ label: 'Network adapter', ok: false, detail: 'No adapter found or selected' });
    else if (!a.connected)       checks.push({ label: 'Network adapter', ok: false, detail: `${a.name}: no link — check the cable` });
    else if (!a.ip || a.apipa)   checks.push({ label: 'Network adapter', ok: false, detail: `${a.name}: connected but no usable address — use QUICK START to fix` });
    else                         checks.push({ label: 'Network adapter', ok: true,  detail: `${a.name} — ${a.ip}` });
    const squatter = await checkPort67();
    checks.push(squatter ? { label: 'DHCP port (UDP 67)', ok: false, detail: `Held by ${squatter} — the engine may not hear requests` }
                         : { label: 'DHCP port (UDP 67)', ok: true,  detail: mode !== 'off' ? 'Bound by NET//ETHER' : 'Free' });
    const fwOk = await fwRuleExists(FW_RULE_NAME);
    checks.push(fwOk ? { label: 'Firewall rule', ok: true,  detail: 'Inbound UDP 67 allowed' }
                     : { label: 'Firewall rule', ok: false, detail: 'Rule missing — added automatically when listening starts' });
    checks.push(mode !== 'off' ? { label: 'Listening', ok: true, detail: `Mode: ${mode}` } : { label: 'Listening', ok: false, detail: 'Engine is offline' });
    const foreign = Object.keys(foreignServers);
    checks.push(foreign.length ? { label: 'Other DHCP servers', ok: false, detail: `Heard on the wire: ${foreign.join(', ')}` }
                               : { label: 'Other DHCP servers', ok: true,  detail: 'None heard passively (use SCAN WIRE for an active check)' });
    const pol = await getPolicy();
    if (pol && pol.dhcpServerDisabled) checks.push({ label: 'Policy', ok: false, detail: 'DisableDhcpServer=1 — serving is blocked by IT policy' });
    return checks;
  }

  // ── IPC ────────────────────────────────────────────────────────────────────
  async function policyBlocked() {
    const pol = await getPolicy();
    return !!(pol && pol.dhcpServerDisabled);
  }

  function fullState() {
    return {
      ...modeState(),
      devices: buildDeviceList(),
      log: LOG_HISTORY.slice(-60),
      squatter: lastSquatter,
      staticAssist: store.staticAssist,
      idleMinutes: store.idleMinutes,
      profiles: Object.keys(store.profiles).sort(),
      reservations: { ...store.reservations },
      current: store.current || null,
      foreignServers: Object.keys(foreignServers),
      adapters: lightAdapters(),
    };
  }

  // Engine start = listen. Called by the renderer when the DHCP tab is opened.
  ipcMain.handle('dhcp-engine-start', async () => {
    if (await policyBlocked()) return { ok: false, err: 'POLICY', msg: 'DHCP server disabled by IT policy (DisableDhcpServer=1)' };
    if (mode !== 'off') return { ok: true, mode, state: fullState() };
    await refreshAdapters();
    lastSquatter = await checkPort67();
    if (lastSquatter) { log(`WARNING — UDP 67 is held by ${lastSquatter}. DHCP may not hear requests until it's stopped.`, 'warn'); send('dhcp-port67', { squatter: lastSquatter }); }
    try { await setMode('listen'); }
    catch (e) { log('Could not start listening: ' + e.message, 'err'); return { ok: false, err: e.message, state: fullState() }; }
    if (store.staticAssist) send('dhcp-static-pending', store.staticAssist);
    return { ok: true, mode, state: fullState() };
  });
  ipcMain.handle('dhcp-engine-stop', async () => { targets.clear(); await setMode('off'); await removeFirewallRule(); return { ok: true, mode }; });
  ipcMain.handle('dhcp-get-state', async () => ({ policyDisabled: await policyBlocked(), ...fullState() }));
  ipcMain.handle('dhcp-refresh-adapters', async () => refreshAdapters());

  ipcMain.handle('dhcp-get-adapter-config', async (_e, adapterName) => {
    const safe = sanitizeAdapter(adapterName);
    const a = safe && lightAdapters().find(x => x.name === safe);
    if (!a || !a.ip || !a.netmask || a.apipa) return null;
    return deriveCfgFromAdapter(a);
  });
  ipcMain.handle('dhcp-validate-config', async (_e, cfg) => validateCfg(cfg));
  ipcMain.handle('dhcp-set-preview', async (_e, opts) => {
    const v = validateCfg(opts);
    previewCfg = v.ok ? buildEngineCfg(opts) : null;
    emitDevices();
    return v;
  });
  ipcMain.handle('dhcp-save-config', async (_e, cfg) => { store.current = storableCfg(cfg || {}); persist(); return { ok: true }; });

  ipcMain.handle('dhcp-serve-all', async (_e, opts) => {
    if (await policyBlocked()) return { ok: false, msg: 'DHCP server disabled by IT policy' };
    if (mode === 'off') return { ok: false, msg: 'Engine is offline' };
    const v = validateCfg(opts);
    if (!v.ok) return v;
    store.current = storableCfg(opts); persist();
    serveCfg = buildEngineCfg(opts);
    try {
      await setMode('serve-all');
      const others = otherSubnetAdapters(serveCfg.adapterIp, serveCfg.subnet);
      const warning = others.length ? `Heads up: ${others.join(', ')} ${others.length > 1 ? 'are' : 'is'} also connected on another subnet. This server answers DHCP on all connected networks.` : null;
      if (warning) log('WARNING — ' + warning, 'warn');
      return { ok: true, warning };
    } catch (e) { return { ok: false, msg: e.message }; }
  });
  ipcMain.handle('dhcp-serve-device', async (_e, mac, opts) => {
    if (await policyBlocked()) return { ok: false, msg: 'DHCP server disabled by IT policy' };
    const m = cleanMac(mac);
    if (!m) return { ok: false, msg: 'Invalid MAC' };
    if (mode === 'off') return { ok: false, msg: 'Engine is offline' };
    if (mode === 'serve-all') return { ok: false, msg: 'Already serving everyone' };
    if (opts) {
      const v = validateCfg(opts);
      if (!v.ok) return v;
      store.current = storableCfg(opts); persist();
      serveCfg = buildEngineCfg(opts);
    }
    if (!serveCfg) return { ok: false, msg: 'No valid configuration' };
    targets.add(m);
    try {
      await setMode('serve-targeted');
      log(`TARGET — answering ${m} only (${targets.size} target${targets.size !== 1 ? 's' : ''})`, 'ok');
      announceMode();   // mode may not have changed — the target count did
      return { ok: true, targets: [...targets] };
    } catch (e) { targets.delete(m); return { ok: false, msg: e.message }; }
  });
  ipcMain.handle('dhcp-unserve-device', async (_e, mac) => {
    const m = cleanMac(mac);
    if (m) targets.delete(m);
    if (mode === 'serve-targeted' && targets.size === 0) { await setMode('listen'); log('No targets left — back to listening'); }
    else if (m) { log(`Target removed: ${m}`); announceMode(); }
    return { ok: true, targets: [...targets] };
  });
  ipcMain.handle('dhcp-stop-serving', async () => { if (isServing()) { targets.clear(); await setMode('listen'); } return { ok: true }; });

  ipcMain.handle('dhcp-quick-start', async () => {
    const adapters = lightAdapters().filter(a => a.connected);
    if (!adapters.length) return { ok: false, reason: 'no-link', msg: 'No connected network adapter found. Check the cable.' };
    const wiredFirst = adapters.slice().sort((a, b) => (/ethernet|local area/i.test(a.name) ? 0 : 1) - (/ethernet|local area/i.test(b.name) ? 0 : 1));
    const usable = wiredFirst.find(a => a.ip && !a.apipa);
    if (usable) return { ok: true, cfg: deriveCfgFromAdapter(usable) };
    return { ok: false, reason: 'needs-static', adapter: wiredFirst[0].name, msg: `${wiredFirst[0].name} is connected but has no usable address.` };
  });
  ipcMain.handle('dhcp-static-assist-apply',  async (_e, adapter) => staticAssistApply(adapter));
  ipcMain.handle('dhcp-static-assist-revert', async () => staticAssistRevert(false));
  ipcMain.handle('dhcp-static-assist-status', async () => store.staticAssist || null);

  ipcMain.handle('dhcp-probe',      async () => activeRogueProbeShared());
  ipcMain.handle('dhcp-serve-gate', async () => serveGateProbe());
  ipcMain.handle('dhcp-self-test',  async (_e, adapter) => selfTest(adapter));
  ipcMain.handle('dhcp-foreign',    async () => Object.keys(foreignServers));

  ipcMain.handle('dhcp-profiles-list',   async () => Object.keys(store.profiles).sort());
  ipcMain.handle('dhcp-profiles-save',   async (_e, name, cfg) => {
    const clean = String(name || '').trim().replace(/[^\x20-\x7E]/g, '').substring(0, 40);
    if (!clean) return { ok: false, msg: 'Profile needs a name' };
    store.profiles[clean] = storableCfg(cfg || {}); persist();
    return { ok: true, name: clean };
  });
  ipcMain.handle('dhcp-profiles-load',   async (_e, name) => store.profiles[String(name)] || null);
  ipcMain.handle('dhcp-profiles-delete', async (_e, name) => { delete store.profiles[String(name)]; persist(); return { ok: true }; });

  ipcMain.handle('dhcp-reservation-set', async (_e, mac, ip) => {
    const m = cleanMac(mac);
    if (!m) return { ok: false, msg: 'Invalid MAC' };
    if (!isValidIp(ip)) return { ok: false, msg: 'Invalid IP' };
    const cfg = serveCfg || previewCfg;
    if (cfg) {
      const mk = ipToNum(cfg.subnet);
      if ((ipToNum(ip) & mk) !== (ipToNum(cfg.adapterIp) & mk)) return { ok: false, msg: 'Reserved IP is not on the server subnet' };
      if (ip === cfg.adapterIp) return { ok: false, msg: 'That is the server IP' };
      if (cfg.gateway && ip === cfg.gateway) return { ok: false, msg: 'That is the gateway IP' };
    }
    for (const [m2, ip2] of Object.entries(store.reservations)) if (ip2 === ip && m2 !== m) return { ok: false, msg: `Already reserved for ${m2}` };
    store.reservations[m] = ip; persist();
    log(`RESERVED ${ip} for ${m}`, 'ok');
    emitDevices();
    return { ok: true };
  });
  ipcMain.handle('dhcp-reservation-clear', async (_e, mac) => {
    const m = cleanMac(mac);
    if (m && store.reservations[m]) { log(`Reservation cleared for ${m}`); delete store.reservations[m]; persist(); emitDevices(); }
    return { ok: true };
  });
  ipcMain.handle('dhcp-set-idle', async (_e, n) => {
    const v = Math.max(0, Math.min(720, parseInt(n, 10) || 0));
    store.idleMinutes = v; persist();
    log(v === 0 ? 'Idle auto-stop disabled' : `Idle auto-stop set to ${v} min`);
    return { ok: true, value: v };
  });

  ipcMain.handle('dhcp-release-all', async () => {
    let count = 0;
    for (const mac of Object.keys(devices)) if (devices[mac].state === 'leased' || devices[mac].state === 'offered') { delete devices[mac]; count++; }
    if (count > 0) { log(`RELEASE ALL — cleared ${count} lease${count !== 1 ? 's' : ''}`, 'warn'); emitDevices(); announceTray(); }
    return count;
  });
  ipcMain.handle('dhcp-revoke', async (_e, mac) => {
    const m = cleanMac(mac);
    const d = m && devices[m];
    if (d && (d.state === 'leased' || d.state === 'offered')) { const ip = d.ip; delete devices[m]; log(`REVOKE — ${ip}  ${m}`, 'warn'); emitDevices(); announceTray(); return { ok: true, ip }; }
    return { ok: false };
  });
  ipcMain.handle('dhcp-export-csv', async () => {
    const list = Object.entries(devices).filter(([, d]) => d.state === 'leased').map(([mac, d]) => ({ mac, ...d }));
    if (!list.length) return '';
    const rows = list.map(l => `${l.ip},${l.mac},"${csvEscape(csvSafe(l.vendor))}","${csvEscape(csvSafe(l.hostname || ''))}",${new Date(l.expires).toLocaleString()},${store.reservations[l.mac] ? 'yes' : ''}`);
    return 'IP,MAC,Vendor,Hostname,Expires,Reserved\n' + rows.join('\n');
  });
  ipcMain.handle('dhcp-export-log', async () => LOG_HISTORY.join('\n'));

  // ── Shutdown — awaited by main's quit path ─────────────────────────────────
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await staticAssistRevert(true); } catch {}
    try { await setMode('off'); } catch {}
    try { await removeFirewallRule(); } catch {}
  }

  return {
    shutdown,
    getMode: () => mode,
    getState: modeState,
    isActive: () => mode !== 'off',
    isServing,
    leaseCount: () => Object.values(devices).filter(d => d.state === 'leased').length,
  };
};
