// ═══ Virtual clock (installed in every frame) ═══════════════════════════════
(() => {
  if (window.__vclock) return;
  const rSetTimeout = window.setTimeout.bind(window);
  const RDate = Date;
  let now = 0, seq = 0;
  let dateBase = new RDate('2026-10-05T09:14:00').getTime();
  const timers = new Map();
  let rafs = [];
  window.setTimeout = (fn, d = 0, ...a) => { const id = ++seq; timers.set(id, { t: now + Math.max(0, +d || 0), fn, a, iv: 0 }); return id; };
  window.setInterval = (fn, d = 0, ...a) => { const id = ++seq; const iv = Math.max(1, +d || 1); timers.set(id, { t: now + iv, fn, a, iv }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.requestAnimationFrame = fn => { const id = ++seq; rafs.push({ id, fn }); return id; };
  window.cancelAnimationFrame = id => { rafs = rafs.filter(r => r.id !== id); };
  performance.now = () => now;
  class VDate extends RDate {
    constructor(...a) { if (a.length === 0) super(dateBase + now); else super(...a); }
    static now() { return dateBase + now; }
  }
  window.Date = VDate;
  const flush = () => new Promise(r => rSetTimeout(r, 0));
  window.__vclock = {
    now: () => now,
    shiftDate(ms) { dateBase += ms; },
    async tick(ms) {
      const target = now + ms;
      for (let guard = 0; guard < 400; guard++) {
        let best = null, bestId = 0;
        for (const [id, t] of timers) if (t.t <= target && (!best || t.t < best.t || (t.t === best.t && id < bestId))) { best = t; bestId = id; }
        if (!best) break;
        now = best.t;
        if (best.iv) best.t += best.iv; else timers.delete(bestId);
        try { best.fn(...best.a); } catch (e) { console.error(e); }
        await flush();
      }
      now = target;
      const rs = rafs; rafs = [];
      for (const r of rs) { try { r.fn(now); } catch (e) { console.error(e); } }
      await flush();
    },
  };
  // Freeze CSS/Web animations onto the virtual clock
  window.__syncAnims = () => {
    for (const an of document.getAnimations()) {
      if (an.__v === undefined) { an.__v = now; try { an.pause(); } catch {} }
      try { an.currentTime = now - an.__v; } catch {}
    }
  };
  window.__sfx = [];
  let seed = 1234567;
  Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
})();

// ═══ Simulated backend — only inside the app frame ═════════════════════════
(() => {
  if (window === window.top) return;
  const P = window.parent;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const listeners = {};
  const on = ch => cb => { (listeners[ch] = listeners[ch] || []).push(cb); };
  const emit = (ch, d) => (listeners[ch] || []).forEach(cb => { try { cb(d); } catch (e) { console.error(e); } });
  const off = (...chs) => () => chs.forEach(c => { listeners[c] = []; });

  // ── the world ──
  const W = window.__world = {
    adapters: [
      { name: 'Ethernet', ip: '10.20.30.57', subnet: '255.255.255.0', mac: '9c:eb:e8:41:7a:02', state: 'Connected', admin: 'Enabled', connected: true, isDhcp: true, gateway: '10.20.30.1', dns: '10.20.30.1' },
      { name: 'Ethernet 2', ip: null, subnet: null, mac: '00:e0:4c:68:11:9d', state: 'Disconnected', admin: 'Enabled', connected: false, isDhcp: true, gateway: null, dns: null },
    ],
    aliases: [],
    hosts: {},            // ip -> {ok, ms}
    scanSets: {},         // name -> array of hosts for SCAN
    scanSet: 'visit',
    scanDur: 5200,
    intel: {}, sites: {},
    presetsSaved: null,
  };
  const A = () => W.adapters[0];

  // ping reachability: anything in the visit set is up unless flagged down
  W.down = new Set(); W.slow = new Set();
  const lat = { '10.20.30.1': 2, '10.20.30.57': 1, '10.20.30.100': 4, '10.20.30.101': 5, '10.20.30.102': 4, '10.20.30.10': 3 };

  // ── DHCP engine sim ──
  const DH = W.dhcp = { mode: 'off', targets: new Set(), devices: {}, reservations: {}, preview: null, serveCfg: null, log: [] };
  const dlog = (msg, cls) => { emit('dhcp-log', { msg, time: new Date().toLocaleTimeString(), cls: cls || '' }); };
  const dmode = () => ({ mode: DH.mode, targets: [...DH.targets], leases: Object.values(DH.devices).filter(d => d.state === 'leased').length,
    serveCfg: DH.serveCfg ? { adapterName: 'Ethernet', adapterIp: DH.serveCfg.adapterIp, rangeStart: DH.serveCfg.rangeStart, rangeEnd: DH.serveCfg.rangeEnd } : null });
  const ipn = ip => ip.split('.').reduce((a, o) => (a << 8) + (+o), 0) >>> 0;
  const nip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  function preview() {
    const cfg = DH.serveCfg || DH.preview; if (!cfg) return {};
    const used = new Set(); Object.values(DH.devices).forEach(d => { if (d.ip && (d.state === 'leased' || d.state === 'offered')) used.add(d.ip); });
    const res = {}; let n = ipn(cfg.rangeStart);
    Object.entries(DH.devices).filter(([, d]) => d.state === 'asking').sort((a, b) => a[1].firstSeen - b[1].firstSeen).forEach(([mac]) => {
      if (DH.reservations[mac]) { res[mac] = DH.reservations[mac]; used.add(res[mac]); return; }
      while (used.has(nip(n))) n++; res[mac] = nip(n); used.add(nip(n));
    });
    return res;
  }
  function devList() {
    const pv = preview();
    return Object.entries(DH.devices).map(([mac, d]) => ({ mac, state: d.state, ip: (d.state === 'offered' || d.state === 'leased') ? d.ip : null,
      wouldOffer: d.state === 'asking' ? (pv[mac] || null) : null, vendor: d.vendor, hostname: d.hostname || '', firstSeen: d.firstSeen, lastSeen: d.lastSeen,
      attempts: d.attempts, expires: d.state === 'leased' ? d.expires : null, targeted: DH.targets.has(mac), reserved: DH.reservations[mac] || null, foreignServer: null }));
  }
  let emitT = null;
  const emitDevices = () => { if (emitT) return; emitT = setTimeout(() => { emitT = null; emit('dhcp-devices', devList()); }, 120); };
  const announce = () => { emit('dhcp-mode', dmode()); emitDevices(); };
  const lightAdapters = () => W.adapters.map(a => ({ name: a.name, ip: a.ip, netmask: a.subnet, connected: a.connected, apipa: false, isDhcp: a.isDhcp }));
  const derive = a => ({ adapterName: a.name, serverIp: a.ip, subnet: a.subnet, rangeStart: '10.20.30.100', rangeEnd: '10.20.30.200', gateway: a.ip, dns: '' });
  const fullState = () => ({ ...dmode(), devices: devList(), log: [], squatter: null, staticAssist: null, idleMinutes: 30, profiles: [], reservations: { ...DH.reservations }, current: null, foreignServers: [], adapters: lightAdapters() });

  // a device starts asking (DISCOVER); repeats every few seconds while nobody answers it
  W.dhcpAsk = (mac, vendor, hostname) => {
    const t = Date.now();
    DH.devices[mac] = { state: 'asking', vendor, hostname, firstSeen: t, lastSeen: t, attempts: 1 };
    dlog(`DISCOVER  ${mac}  ${vendor}${hostname ? ' · ' + hostname : ''}`);
    emitDevices();
  };
  // one retry heartbeat for every asker, so rows don't reshuffle
  setInterval(() => {
    if (DH.mode === 'off') return;
    const now = Date.now(); let any = false;
    for (const [mac, d] of Object.entries(DH.devices)) {
      if (d.state !== 'asking') continue;
      d.attempts++; d.lastSeen = now; any = true;
      if ((DH.targets.has(mac) || DH.mode === 'serve-all') && !d.leasing) lease(mac);
    }
    if (any) emitDevices();
  }, 3000);
  async function lease(mac) {
    const d = DH.devices[mac]; if (!d || d.state !== 'asking' || d.leasing) return;
    d.leasing = true;
    const ip = preview()[mac];
    dlog(`PING ${ip} — no reply, address is free`);
    await wait(500);
    d.state = 'offered'; d.ip = ip; d.lastSeen = Date.now();
    dlog(`OFFER     ${ip}  →  ${mac}`, 'ok'); emitDevices();
    await wait(700);
    dlog(`REQUEST   ${ip}  ←  ${mac}`);
    await wait(250);
    d.state = 'leased'; d.expires = Date.now() + 300000; d.lastSeen = Date.now();
    dlog(`ACK       ${ip}  →  ${mac}  lease 300s`, 'ok');
    emit('dhcp-lease', { mac, ip, vendor: d.vendor, hostname: d.hostname, expires: d.expires, time: new Date().toLocaleTimeString() });
    emit('dhcp-mode', dmode()); emitDevices();
  }

  const hud = window.hud = {
    close() {}, quit() {}, hide() {},
    setSize: async h => { P.__stage && P.__stage.appSize(null, h); },
    setWidth: async ({ wide, width }) => { P.__stage && P.__stage.appSize(wide ? width : 390, null); },
    setOpacity: async () => {}, getOpacity: async () => 1, getMaxHeight: async () => 760,
    onUserResized: () => {}, traySetMode: () => {},
    loadPresets: async () => W.presetsSaved, resetPresets: async () => ({ ok: true }), savePresets: async p => { W.presetsSaved = p; return { ok: true }; },

    getAdapters: async () => { await wait(60); return W.adapters.map(a => ({ ...a })); },
    getCurrentIp: async n => { const a = W.adapters.find(x => x.name === n) || A(); return a.ip ? { name: a.name, ip: a.ip, subnet: a.subnet } : null; },
    getAdapterConfig: async n => { const a = W.adapters.find(x => x.name === n) || A(); return { ok: true, ip: a.ip, subnet: a.subnet, gateway: a.gateway, dns: a.dns, dhcp: a.isDhcp }; },
    getFullSnapshot: async () => ({ ok: true, snapshot: {} }), getSavedSnapshot: async () => null,
    getAdapterMtu: async () => ({ ok: true, mtu: 1500 }), fixMtu: async () => ({ ok: true }),
    checkDuplicateIp: async () => ({ conflict: false }),
    applyConfig: async cfg => {
      await wait(1500);
      const a = W.adapters.find(x => x.name === cfg.adapter) || A();
      Object.assign(a, { ip: cfg.ip, subnet: cfg.subnet, gateway: cfg.gateway || null, dns: cfg.dns || null, isDhcp: false });
      return { ok: true, verified: true };
    },
    applyDhcp: async (arg) => { const adapter = typeof arg === 'string' ? arg : (arg && arg.adapter);
      await wait(1400);
      const a = W.adapters.find(x => x.name === adapter) || A();
      Object.assign(a, { ip: '10.20.30.57', subnet: '255.255.255.0', gateway: '10.20.30.1', dns: '10.20.30.1', isDhcp: true });
      W.aliases = [];
      return { ok: true };
    },
    ping: async host => {
      const up = !W.down.has(host);
      if (!up) { await wait(900); return { ok: false, err: 'TIMEOUT' }; }
      const base = W.slow.has(host) ? 190 : (lat[host] || 3); const ms = Math.max(1, Math.round(base + Math.random() * 3 + (Math.random() < 0.08 ? 9 : 0)));
      await wait(ms + 10); return { ok: true, ms };
    },

    scanStart: ({ baseIp, scanStart, scanEnd }) => {
      const set = (W.scanSets[W.scanSet] || []).slice().sort((a, b) => ipn(a.ip) - ipn(b.ip));
      const total = (scanEnd - scanStart + 1) || 254;
      const dur = W.scanDur;
      set.forEach((h, i) => {
        const last = +h.ip.split('.')[3];
        setTimeout(() => emit('scan-result', { host: h.ip, ok: true, ms: h.ms || 2, done: last, total, fromArp: false, mac: h.mac, vendor: h.vendor }), dur * (last / 254) * 0.9 + 60);
      });
      for (let k = 1; k <= 20; k++) setTimeout(() => emit('scan-progress', { done: Math.round(total * k / 20), total }), dur * k / 20);
      setTimeout(() => emit('scan-done', { aborted: false }), dur + 80);
    },
    scanStop: () => {}, arpSweep: async () => [],
    resolveHosts: async ips => {
      await wait(500);
      const set = W.scanSets[W.scanSet] || []; const results = {};
      ips.forEach(ip => { const h = set.find(x => x.ip === ip); if (h && h.hostname) results[ip] = { hostname: h.hostname, source: h.nbt ? 'nbt' : 'dns' }; });
      return { results, selfIps: [A().ip] };
    },
    onScanResult: on('scan-result'), onScanDone: on('scan-done'), onScanEnrich: on('scan-enrich'), onScanProgress: on('scan-progress'),
    offScan: off('scan-result', 'scan-done', 'scan-enrich', 'scan-progress'),
    portProbeStart: host => {
      const h = (W.scanSets[W.scanSet] || []).find(x => x.ip === host);
      setTimeout(() => emit('port-probe-result', { host, ports: (h && h.ports || []).map(p => ({ port: p, open: true })) }), 350 + Math.random() * 300);
    },
    onPortProbeResult: on('port-probe-result'), offPortProbe: off('port-probe-result'),
    macLookupOnline: async mac => ({ mac, vendor: null, source: 'none' }),
    getPolicy: async () => ({ onlineVendorDisabled: false }),
    tracertStart: () => {}, tracertStop: () => {}, onTracertHop: () => {}, onTracertDone: () => {}, offTracert: () => {},

    getAliases: async () => { const a = A(); return { ok: true, aliases: [{ ip: a.ip, subnet: a.subnet }, ...W.aliases] }; },
    aliasAdd: async ({ ip, subnet }) => { await wait(1100); A().isDhcp = false; W.aliases.push({ ip, subnet }); return { ok: true }; },
    aliasRemove: async ({ ip }) => { await wait(900); W.aliases = W.aliases.filter(x => x.ip !== ip); return { ok: true }; },
    aliasBuildCmd: async () => ({ ok: true, cmd: '' }),
    checkActiveAliases: async () => ({ ok: true, warnings: [] }),

    sitesLoad: async () => W.sites, sitesSave: async s => { W.sites = JSON.parse(JSON.stringify(s)); return { ok: true }; },
    intelLoad: async () => JSON.parse(JSON.stringify(W.intel)), intelSave: async d => { W.intel = JSON.parse(JSON.stringify(d)); return { ok: true }; },
    intelBackup: async () => ({ ok: true }), exportExcel: async () => ({ ok: true }), exportJson: async () => ({ ok: true }), importJson: async () => ({ ok: false }),
    openExternal: url => { P.__stage && P.__stage.note('open', url); }, openGuide: async () => ({ ok: true }), openRdp: () => {},
    clipboardWrite: async () => ({ ok: true }),
    getLaunchSnapshot: async () => null, getLaunchDeltas: async () => ({ ok: true, ts: Date.now(), deltas: [] }), restoreLaunchState: async () => ({ ok: true }),
    diagGet: async () => ({ state: { version: '7.0.0', packaged: true, elevated: true, integrity: 'High', host: 'FIELD-LT07', os: 'Windows_NT 10.0.26100 x64', ouiEntries: 57012, creds: {}, policy: {}, dhcp: null }, log: [] }),
    diagClear: async () => ({ ok: true }), onDiagEntry: () => {},

    dhcp: {
      engineStart: async () => { await wait(700); DH.mode = 'listen'; announce(); dlog('Engine up — listening on UDP 67 (Ethernet)'); return { ok: true, mode: DH.mode, state: fullState() }; },
      engineStop: async () => { await wait(400); DH.targets.clear(); DH.mode = 'off'; announce(); dlog('Engine off — UDP 67 released', 'warn'); return { ok: true, mode: 'off' }; },
      getState: async () => ({ policyDisabled: false, ...fullState() }),
      refreshAdapters: async () => { const l = lightAdapters(); emit('dhcp-adapters', { adapters: l, event: 'refresh' }); return l; },
      getAdapterConfig: async n => { const a = W.adapters.find(x => x.name === n); return a && a.ip ? derive(a) : null; },
      validateConfig: async () => ({ ok: true }),
      setPreview: async o => { DH.preview = { adapterIp: o.adapterIp, rangeStart: o.rangeStart, rangeEnd: o.rangeEnd }; emitDevices(); return { ok: true }; },
      saveConfig: async () => ({ ok: true }),
      serveAll: async o => {
        await wait(200);
        DH.serveCfg = { adapterIp: o.adapterIp, rangeStart: o.rangeStart, rangeEnd: o.rangeEnd };
        DH.mode = 'serve-all'; dlog('SERVE ALL — answering every DHCP request on Ethernet', 'ok'); announce();
        Object.entries(DH.devices).filter(([, d]) => d.state === 'asking').forEach(([mac], i) => setTimeout(() => lease(mac), 700 + i * 900));
        return { ok: true, warning: null };
      },
      serveDevice: async (mac, o) => {
        await wait(150);
        if (o) DH.serveCfg = { adapterIp: o.adapterIp, rangeStart: o.rangeStart, rangeEnd: o.rangeEnd };
        DH.targets.add(mac); DH.mode = 'serve-targeted';
        dlog(`TARGET — answering ${mac} only (${DH.targets.size} target${DH.targets.size !== 1 ? 's' : ''})`, 'ok');
        announce();
        setTimeout(() => lease(mac), 900);
        return { ok: true, targets: [...DH.targets] };
      },
      unserveDevice: async mac => { DH.targets.delete(mac); announce(); return { ok: true }; },
      stopServing: async () => { DH.targets.clear(); DH.mode = 'listen'; announce(); return { ok: true }; },
      quickStart: async () => ({ ok: true, cfg: derive(A()) }),
      staticAssistApply: async () => ({ ok: false }), staticAssistRevert: async () => ({ ok: true }), staticAssistStatus: async () => null,
      probe: async () => { await wait(2000); return { ok: true, servers: ['10.20.30.1'] }; },
      serveGate: async () => { dlog('SCAN — DISCOVER probe sent, listening for other servers…'); await wait(1900); dlog('SCAN — no other DHCP server answered', 'ok'); return { ok: true, servers: [], recentlyHeard: [], offSubnet: [] }; },
      selfTest: async () => [], foreignServers: async () => [],
      profilesList: async () => [], profilesSave: async () => ({ ok: true }), profilesLoad: async () => null, profilesDelete: async () => ({ ok: true }),
      setReservation: async (mac, ip) => { await wait(120); DH.reservations[mac] = ip; dlog(`RESERVE   ${ip}  ★  ${mac}`, 'ok'); emitDevices(); return { ok: true }; },
      clearReservation: async mac => { delete DH.reservations[mac]; emitDevices(); return { ok: true }; },
      setIdleMinutes: async n => ({ ok: true, value: n }),
      releaseAll: async () => 0, revoke: async () => ({ ok: false }), exportCsv: async () => '', exportLog: async () => '',
      onMode: cb => { listeners['dhcp-mode'] = [cb]; }, onDevices: cb => { listeners['dhcp-devices'] = [cb]; }, onLease: cb => { listeners['dhcp-lease'] = [cb]; },
      onRogue: cb => { listeners['dhcp-rogue'] = [cb]; }, onPort67: () => {}, onAutoStopped: () => {}, onStaticPending: () => {},
      onLog: cb => { listeners['dhcp-log'] = [cb]; }, onAdapters: cb => { listeners['dhcp-adapters'] = [cb]; },
    },
  };

  window.__clickLog = [];
  document.addEventListener('mousedown', e => window.__clickLog.push(['down', window.__vclock.now(), e.target.className || e.target.tagName, e.clientX|0, e.clientY|0]), true);
  document.addEventListener('click', e => window.__clickLog.push(['click', window.__vclock.now(), e.target.className || e.target.tagName, e.clientX|0, e.clientY|0]), true);
  // Record toner sounds on the virtual clock so the soundtrack can replay them exactly
  window.addEventListener('DOMContentLoaded', () => {
    const rec = (name, orig) => function (ctx, ...a) { window.__sfx.push({ k: name, t: window.__vclock.now(), a }); return orig && orig.call(this, ctx, ...a); };
    // AudioContext is useless offscreen — give the app a silent one
    ['monSonar', 'monAlarm', 'monSweep'].forEach(n => { if (typeof window[n] === 'function') window[n] = rec(n, null); });
    window.AudioContext = function () { return { state: 'running', resume: async () => {}, currentTime: 0 }; };
  });
})();
