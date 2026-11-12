// ═══ v7.2 / 7.3.1 additions to the simulated backend (loaded after sim_ext.js) ═══
(() => {
  if (window === window.top) return;
  const P = window.parent, W = window.__world, hud = window.hud;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const L = {};
  const on = ch => cb => { (L[ch] = L[ch] || []).push(cb); };
  const emit = (ch, d) => (L[ch] || []).forEach(cb => { try { cb(d); } catch (e) { console.error(e); } });
  W.emit731 = emit;

  // ── housekeeping calls the 7.3.1 renderer makes on boot ──
  hud.minimize = () => {};
  hud.reportError = () => {};
  hud.storageProblems = async () => [];
  hud.leftoversGet = async () => [];
  hud.leftoversDismiss = async () => ({ ok: true });
  hud.leftoversRestore = async () => ({ ok: true });
  hud.onPower = on('power');
  hud.openDevice = ip => { P.__stage && P.__stage.note('open', 'http://' + ip); return Promise.resolve({ ok: true, url: 'http://' + ip, scheme: 'http' }); };
  hud.revealLastExport = async () => ({ ok: true });
  hud.wireHint = async () => ({ ok: true });
  const baseDiag = hud.diagGet;
  hud.diagGet = async () => { const d = await baseDiag(); d.state.version = '7.3.1'; return d; };
  delete hud.dhcp.quickStart;

  // ── duplicate check: W.taken = { ip: { mac, vendor } } ──
  W.taken = {};
  hud.checkDuplicateIp = async ip => { await wait(700); const t = W.taken[ip]; return t ? { conflict: true, mac: t.mac, vendor: t.vendor } : { conflict: false }; };

  // ── APPLY keeps the 2nd addresses (keep[]) and reports DAD duplicates ──
  hud.applyConfig = async cfg => {
    await wait(1500);
    const a = W.adapters.find(x => x.name === cfg.adapter) || W.adapters[0];
    const t = W.taken[cfg.ip];
    if (t) return { ok: true, duplicate: true, dupMac: t.mac, dupVendor: t.vendor };
    const keep = (cfg.keep || []).map(x => x.ip);
    Object.assign(a, { ip: cfg.ip, subnet: cfg.subnet, gateway: cfg.gateway || null, dns: cfg.dns || null, isDhcp: false });
    if (a.name === W.adapters[0].name) W.aliases = W.aliases.filter(x => keep.includes(x.ip));
    return { ok: true, verified: true, kept: keep, lost: [] };
  };
  const baseAliasAdd = hud.aliasAdd;
  hud.aliasAdd = async o => {
    const t = W.taken[o.ip];
    if (t) { await wait(1300); return { ok: false, duplicate: true, dupMac: t.mac, dupVendor: t.vendor }; }
    if (W.aliases.some(x => x.ip === o.ip)) { await wait(400); return { ok: true, verified: true, already: true }; }
    const wasDhcp = W.adapters[0].isDhcp;
    const r = await baseAliasAdd(o);
    return { ...r, verified: true, converted: wasDhcp };
  };

  // ── DHCP: wire watch, went-static, 7.2 device fields ──
  W.wire = [];                      // [{ ip, mac, vendor, model, hostname, name, lastSeen, sources }]
  hud.onWireWatch = on('wire');
  hud.wireWatchStart = async name => { W.wireOn = name; return { list: W.wire.slice() }; };
  hud.wireWatchStop = async () => { W.wireOn = null; return { ok: true }; };
  W.wirePush = dev => { W.wire = W.wire.filter(d => d.mac !== dev.mac).concat([{ lastSeen: Date.now(), name: '', hostname: '', ...dev }]);
                        emit('wire', { adapter: W.wireOn || W.adapters[0].name, list: W.wire.slice() }); };
  hud.dhcp.onStatic = on('dhcp-static');
  W.wentStatic = d => emit('dhcp-static', d);
  W.models = {};                    // mac -> { model, fw, vendorClass }
  const baseOnDevices = hud.dhcp.onDevices;
  hud.dhcp.onDevices = cb => baseOnDevices(list => cb((list || []).map(d => ({ ...d, ...(W.models[d.mac] || {}) }))));
  const baseState = hud.dhcp.getState;
  hud.dhcp.getState = async () => { const s = await baseState(); s.devices = (s.devices || []).map(d => ({ ...d, ...(W.models[d.mac] || {}) })); return s; };
})();
(() => {
  if (window === window.top) return;
  const W = window.__world, hud = window.hud, DH = W.dhcp;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // ── Wi-Fi that is on at the start of the film ──
  W.wifiUp = true;
  hud.getWifi = async () => [{ name: 'Wi-Fi', status: W.wifiUp ? 'Up' : 'Disabled', adminUp: W.wifiUp, connected: W.wifiUp }];
  hud.adapterSetEnabled = async (n, en) => { await wait(900); if (/wi-?fi/i.test(String(n))) W.wifiUp = !!en; return { ok: true }; };
  // ── DHCP card: real ips[] and laptop-IP assist ──
  const light = () => W.adapters.map(a => ({ name: a.name, ip: a.ip, netmask: a.subnet, connected: a.connected, apipa: false, isDhcp: a.isDhcp,
    ips: a.ip ? [{ ip: a.ip, netmask: a.subnet }, ...(a.name === W.adapters[0].name ? W.aliases.map(x => ({ ip: x.ip, netmask: x.subnet })) : [])] : [] }));
  const baseRefresh = hud.dhcp.refreshAdapters;
  hud.dhcp.refreshAdapters = async () => { await baseRefresh(); return light(); };
  const baseGetState = hud.dhcp.getState;
  hud.dhcp.getState = async () => { const s = await baseGetState(); s.adapters = light(); return s; };
  hud.dhcp.getAdapterConfig = async (n, ip) => {
    const a = W.adapters.find(x => x.name === n); const use = ip || (a && a.ip); if (!use) return null;
    const p = use.split('.').slice(0, 3).join('.');
    return { adapterName: n, serverIp: use, subnet: '255.255.255.0', rangeStart: p + '.100', rangeEnd: p + '.200', gateway: '', dns: '' };
  };
  hud.dhcp.staticAssistApply = async (n, ip) => { await wait(1200); const a = W.adapters.find(x => x.name === n) || W.adapters[0];
    Object.assign(a, { ip: ip || '192.168.0.1', subnet: '255.255.255.0', gateway: null, dns: null, isDhcp: false }); return { ok: true, ip: a.ip }; };
  // SERVE with a typed address: borrow the reservation path for one lease, hide the star
  W.tmpWant = new Set();
  const baseServe = hud.dhcp.serveDevice;
  hud.dhcp.serveDevice = async (mac, o, want) => {
    if (want) { DH.reservations[mac] = want; W.tmpWant.add(mac); setTimeout(() => { delete DH.reservations[mac]; W.tmpWant.delete(mac); }, 1150); }
    return baseServe(mac, o);
  };
  // a served camera set static on its own page → ✓ STATIC
  W.goStatic = mac => { const d = DH.devices[mac]; if (!d) return; d.state = 'static'; d.lastSeen = Date.now(); DH.targets.delete(mac); if (!DH.targets.size) hud.dhcp.stopServing();
    W.emit731('dhcp-static', { ip: d.ip, mac, model: (W.models[mac] || {}).model, vendor: d.vendor }); };
  const baseOnDevices2 = hud.dhcp.onDevices;
  hud.dhcp.onDevices = cb => baseOnDevices2(list => cb(list.map(d => {
    const r = DH.devices[d.mac] || {};
    return { ...d, ip: d.state === 'static' ? r.ip : d.ip, reserved: W.tmpWant.has(d.mac) ? null : d.reserved };
  })));
  // ── a believable DIAGNOSTICS log ──
  const baseDiag = hud.diagGet;
  hud.diagGet = async () => { const d = await baseDiag(); const t = Date.now();
    d.log = [
      { ts: t - 900000, kind: 'app', tag: 'launch', note: 'v7.3.1 · elevated' },
      { ts: t - 700000, kind: 'op', tag: 'adapter-wifi-off', ok: true, mode: 'worker', ms: 412, steps: [{ cmd: 'Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false', code: 0, out: '' }] },
      { ts: t - 600000, kind: 'op', tag: 'apply-static', ok: true, mode: 'worker', ms: 2876, steps: [{ cmd: 'netsh interface ip set address "Ethernet" static 192.168.0.2 255.255.255.0', code: 0, out: 'Ok.' }] },
      { ts: t - 598000, kind: 'verify', tag: 'apply-static', ok: true, note: '192.168.0.2 Preferred' },
      { ts: t - 400000, kind: 'op', tag: 'alias-add', ok: true, mode: 'worker', ms: 1310, steps: [{ cmd: 'netsh interface ip add address "Ethernet" 192.168.1.250 255.255.255.0', code: 0, out: 'Ok.' }] },
      { ts: t - 300000, kind: 'op', tag: 'dhcp-serve', ok: true, mode: 'engine', ms: 6, note: '00:07:5f:b2:41:0c → 192.168.0.101' },
      { ts: t - 120000, kind: 'op', tag: 'reach-add', ok: true, mode: 'worker', ms: 1288, steps: [{ cmd: 'netsh interface ip add address "Ethernet" 192.168.1.127 255.255.255.0', code: 0, out: 'Ok.' }] },
    ];
    Object.assign(d.state, { user: 'jbroman', electron: '38.2.0', node: '22.19.0', chrome: '140.0.7339.133', uptimeSec: 2412,
      exe: 'C:\\Program Files\\NET-ETHER\\NET-ETHER.exe', userData: 'C:\\Users\\jbroman\\AppData\\Roaming\\net-ether',
      tools: { wireshark: '4.6.1', tshark: true, tsharkVersion: '4.6.1', tsharkOk: true },
      creds: { format: 2, mode: 'safeStorage', count: 3, available: true } });
    d.state.dhcp = { mode: DH.mode, leases: 1, serveCfg: null };
    return d; };
})();

(() => { if (window === window.top) return; const W = window.__world, hud = window.hud;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // REACH: a free neighbour in the device's own /24
  hud.reachAdd = async ({ adapter, target, alias, mask }) => {
    await wait(1300);
    const ip = alias || (target.split('.').slice(0, 3).join('.') + '.' + (((+target.split('.')[3]) + 37) % 250 + 2));
    if (W.aliases.some(a => a.ip === ip)) return { ok: true, alias: ip, reused: true };
    W.reach.push({ ip, adapter, target }); W.aliases.push({ ip, subnet: mask || '255.255.255.0' });
    return { ok: true, alias: ip, reused: false };
  };
})();
