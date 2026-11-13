// Bench, 2026-11-13: the card on the cable is on DHCP with nobody answering, so it holds a
// self-assigned 169.254.x.x address, and the form still has another job's laptop address in it.
// The engine listened on every card: office Wi-Fi clients showed as ASKING devices "on this cable",
// and the Wi-Fi renewing its own lease raised OTHER DHCP SERVER ON WIRE on a bench with no server.
// Checks: the socket ends up bound to the card's self-assigned address; the Wi-Fi's own lease is
// not an other-server signal; a lease taken by the card on the cable still is.
const Module = require('module'); const EventEmitter = require('events');
const binds = []; let sockRef = null; const sentToWindow = []; const notYet = new Set(); let cableIps = [['169.254.122.136', '255.255.0.0']];
const fakeDgram = { createSocket() { const s = new EventEmitter();
  s.bind = (p, a, cb) => { if (typeof a === 'function') { cb = a; a = '0.0.0.0'; } binds.push(a);
    if (notYet.has(a)) return setImmediate(() => s.emit('error', Object.assign(new Error('bind EADDRNOTAVAIL'), { code: 'EADDRNOTAVAIL' })));
    setImmediate(cb); }; s.setBroadcast = () => {}; s.close = () => {}; s.send = (b, o, l, p, d, cb) => cb && cb(); sockRef = s; return s; } };
const fakeCp = { execFile(file, args, opts, cb) { if (typeof opts === 'function') cb = opts; setTimeout(() => cb(null, file === 'netsh' ? 'Enabled: Yes' : ''), 5); } };
const CABLE = '9c:bf:0d:01:61:f7', WIFI = 'c4:13:75:1a:9b:7f';
const fakeOs = { networkInterfaces: () => ({
  'Ethernet 2': cableIps.map(([address, netmask]) => ({ family: 'IPv4', internal: false, address, netmask, mac: CABLE })),
  'Wi-Fi 2':    [{ family: 'IPv4', internal: false, address: '10.0.30.70', netmask: '255.255.255.0', mac: WIFI }],
}) };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; if (req === 'os') return fakeOs; return origLoad.call(this, req, ...r); };
const handlers = {};
require(process.argv[2])({
  app: { getPath: () => '/tmp/dhcp-harness-' + process.pid }, ipcMain: { handle: (c, f) => handlers[c] = f },
  getWin: () => ({ isDestroyed: () => false, webContents: { send: (ch, payload) => sentToWindow.push([ch, payload]) } }),
  diagAdd() {}, runElevated: async () => ({ ok: true }), isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || ''),
  isValidSubnet: m => /^255\.(255|0)\.(255|0)\.0$/.test(m), sanitizeAdapter: n => n, lookupVendor: () => '',
  getAdapters: async () => [{ name: 'Ethernet 2', ip: '169.254.122.136', mac: CABLE.replace(/:/g, '-'), isDhcp: true }],   // ETHER lists wired cards only
  applyStatic: async () => ({ ok: true }), applyDhcp: async () => ({ ok: true }), readAdapterConfig: async () => ({ ok: false }), getPolicy: async () => ({}),
  onStateChange() {}, ipAddressState: async () => 'Preferred', readJsonSafe: (f, fb) => fb, writeJsonAtomic() {},
});
function request(mac, srv) { const b = Buffer.alloc(300); b[0] = 1; b[1] = 1; b[2] = 6; Buffer.from(mac.replace(/:/g, ''), 'hex').copy(b, 28); b.writeUInt32BE(0x77, 4);
  b[236] = 99; b[237] = 130; b[238] = 83; b[239] = 99; let o = 240; b[o++] = 53; b[o++] = 1; b[o++] = 3; b[o++] = 54; b[o++] = 4; srv.split('.').forEach(x => b[o++] = +x); b[o++] = 255; return b; }
const wait = ms => new Promise(r => setTimeout(r, ms));
const rogue = () => sentToWindow.filter(x => x[0] === 'dhcp-rogue').map(x => x[1].server);
(async () => {
  const problems = [];
  await handlers['dhcp-engine-start']();
  // the form as the tab sends it: the card picked, and a laptop address from another job that is not on it
  await handlers['dhcp-set-preview'](null, { adapterName: 'Ethernet 2', adapterIp: '10.99.99.111', subnet: '255.255.255.0', rangeStart: '10.99.99.100', rangeEnd: '10.99.99.200', gateway: '', dns: '', lease: 300 });
  await wait(100);
  if (binds[binds.length - 1] !== '169.254.122.136') problems.push('the socket should end up on the card\'s self-assigned address; binds were: ' + binds.join(' → '));
  sockRef.emit('message', request(WIFI, '10.0.60.1'), { address: '10.0.30.70', port: 68 });
  await wait(50);
  if (rogue().length) problems.push('the Wi-Fi card renewing its own lease was reported as another DHCP server on the wire: ' + rogue().join(', '));
  sockRef.emit('message', request(CABLE, '192.168.50.1'), { address: '0.0.0.0', port: 68 });
  await wait(50);
  if (!rogue().includes('192.168.50.1')) problems.push('the card on the cable leasing from 192.168.50.1 should still be reported as another DHCP server');
  // REACH has just added 10.90.44.250 under the self-assigned address; Windows lists it but will not
  // let it be bound for a few seconds. The engine must wait on the cable, not on every card.
  cableIps = [['169.254.122.136', '255.255.0.0'], ['10.90.44.250', '255.255.255.0']]; notYet.add('10.90.44.250'); binds.length = 0;
  await handlers['dhcp-set-preview'](null, { adapterName: 'Ethernet 2', adapterIp: '10.90.44.250', subnet: '255.255.255.0', rangeStart: '10.90.44.100', rangeEnd: '10.90.44.200', gateway: '', dns: '', lease: 300 });
  await wait(100);
  if (binds.includes('0.0.0.0') || binds[binds.length - 1] !== '169.254.122.136') problems.push('while Windows is still adding the new address the socket should stay on the cable; binds were: ' + binds.join(' → '));
  // dev.30 on the bench: for about three seconds neither address could be bound. The engine may sit
  // on every card then, but must not list what it hears there.
  notYet.add('169.254.122.136'); binds.length = 0;
  await handlers['dhcp-set-preview'](null, { adapterName: 'Ethernet 2', adapterIp: '10.90.44.250', subnet: '255.255.255.0', rangeStart: '10.90.44.110', rangeEnd: '10.90.44.200', gateway: '', dns: '', lease: 300 });
  await wait(100);
  const before = sentToWindow.length;
  const stray = '5f:44:40:43:50:5f';
  const disc = Buffer.from(request(stray, '0.0.0.0')); disc[242] = 1;      // a DISCOVER from an office Wi-Fi client
  sockRef.emit('message', disc, { address: '0.0.0.0', port: 68 });
  await wait(700);
  const listed = sentToWindow.slice(before).some(x => JSON.stringify(x[1] || '').toLowerCase().includes(stray));
  if (listed) problems.push('a device heard while no address of the card could be bound was listed as on this cable');
  // Windows is done: the address binds, and a device on the cable is heard again
  notYet.clear(); binds.length = 0;
  await handlers['dhcp-set-preview'](null, { adapterName: 'Ethernet 2', adapterIp: '10.90.44.250', subnet: '255.255.255.0', rangeStart: '10.90.44.120', rangeEnd: '10.90.44.200', gateway: '', dns: '', lease: 300 });
  await wait(100);
  if (binds[binds.length - 1] !== '10.90.44.250') problems.push('once the address is ready the socket should move to it; binds were: ' + binds.join(' → '));
  const cam = '00:07:5f:95:aa:ee', mark = sentToWindow.length;
  const d2 = Buffer.from(request(cam, '0.0.0.0')); d2[242] = 1;
  sockRef.emit('message', d2, { address: '0.0.0.0', port: 68 });
  await wait(700);
  if (!sentToWindow.slice(mark).some(x => JSON.stringify(x[1] || '').toLowerCase().includes(cam))) problems.push('after the address is ready a camera on the cable should be listed again');
  if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
  console.log('listen: bound to the cable\'s self-assigned address; only the cable card\'s lease counts as another server'); process.exit(0);
})();
