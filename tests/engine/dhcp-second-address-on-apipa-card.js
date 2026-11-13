// Harness: a card whose main address is self-assigned (169.254.x.x) but that carries a usable
// 2nd address (REACH / + ALIAS). Asking for settings from that 2nd address must work, and so must serving from it.
const Module = require('module'); const EventEmitter = require('events');
const binds = [];
const fakeDgram = { createSocket() { const s = new EventEmitter();
  s.bind = (p, a, cb) => { if (typeof a === 'function') { cb = a; a = '0.0.0.0'; } binds.push(a); setImmediate(cb); }; s.setBroadcast = () => {}; s.close = () => {}; s.send = (b, o, l, p, d, cb) => cb && cb(); return s; } };
const fakeCp = { execFile(file, args, opts, cb) { if (typeof opts === 'function') cb = opts; setTimeout(() => cb(null, file === 'netsh' ? 'Enabled: Yes' : ''), 5); } };
const fakeOs = { networkInterfaces: () => ({ 'Ethernet': [
  { family: 'IPv4', internal: false, address: '169.254.77.12', netmask: '255.255.0.0', mac: 'aa:aa:aa:aa:aa:aa' },
  { family: 'IPv4', internal: false, address: '10.90.44.200', netmask: '255.255.255.0', mac: 'aa:aa:aa:aa:aa:aa' }] }) };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; if (req === 'os') return fakeOs; return origLoad.call(this, req, ...r); };
const handlers = {};
require(process.argv[2])({
  app: { getPath: () => '/tmp/dhcp-harness-' + process.pid }, ipcMain: { handle: (c, f) => handlers[c] = f }, getWin: () => null,
  diagAdd() {}, runElevated: async () => ({ ok: true }), isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || ''),
  isValidSubnet: m => /^255\.(255|0)\.(255|0)\.0$/.test(m), sanitizeAdapter: n => n, lookupVendor: () => '',
  // ETHER's own list calls the self-assigned address the card's main one
  getAdapters: async () => [{ name: 'Ethernet', ip: '169.254.77.12', mac: 'aa-aa-aa-aa-aa-aa', isDhcp: true }],
  applyStatic: async () => ({ ok: true }), applyDhcp: async () => ({ ok: true }), readAdapterConfig: async () => ({ ok: false }), getPolicy: async () => ({}),
  onStateChange() {}, ipAddressState: async () => 'Preferred', readJsonSafe: (f, fb) => fb, writeJsonAtomic() {},
});
(async () => {
  await handlers['dhcp-engine-start']();
  await handlers['dhcp-refresh-adapters']();
  let fail = 0; const check = (name, ok, got) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : ' — got ' + JSON.stringify(got))); if (!ok) fail++; };
  const a = await handlers['dhcp-get-adapter-config'](null, 'Ethernet', '10.90.44.200');
  check('settings from the 2nd address', !!a && a.serverIp === '10.90.44.200' && a.rangeStart === '10.90.44.100', a);
  const b = await handlers['dhcp-get-adapter-config'](null, 'Ethernet');
  check('no address named: the usable one, never 169.254', !!b && b.serverIp === '10.90.44.200', b);
  const c = await handlers['dhcp-get-adapter-config'](null, 'Ethernet', '169.254.77.12');
  check('the self-assigned address is never served from', !c || c.serverIp !== '169.254.77.12', c);
  if (a) {
    const r = await handlers['dhcp-serve-all'](null, { adapterName: 'Ethernet', adapterIp: a.serverIp, gateway: '', dns: '', lease: 300, subnet: a.subnet, rangeStart: a.rangeStart, rangeEnd: a.rangeEnd });
    check('serving from it is accepted', r && r.ok, r);
    check('the engine is tied to that address', binds[binds.length - 1] === '10.90.44.200', binds);
  }
  console.log(fail ? 'FAIL' : 'PASS'); process.exit(fail ? 1 : 0);
})();
