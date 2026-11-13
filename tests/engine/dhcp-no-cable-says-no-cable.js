// Harness: a card with no cable whose static is only saved — validating its own address must say NO CABLE, not 'not on the card'.
// 2nd address (REACH / + ALIAS). Asking for settings from that 2nd address must work, and so must serving from it.
const Module = require('module'); const EventEmitter = require('events');
const binds = [];
const fakeDgram = { createSocket() { const s = new EventEmitter();
  s.bind = (p, a, cb) => { if (typeof a === 'function') { cb = a; a = '0.0.0.0'; } binds.push(a); setImmediate(cb); }; s.setBroadcast = () => {}; s.close = () => {}; s.send = (b, o, l, p, d, cb) => cb && cb(); return s; } };
const fakeCp = { execFile(file, args, opts, cb) { if (typeof opts === 'function') cb = opts; setTimeout(() => cb(null, file === 'netsh' ? 'Enabled: Yes' : ''), 5); } };
const fakeOs = { networkInterfaces: () => ({}) };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; if (req === 'os') return fakeOs; return origLoad.call(this, req, ...r); };
const handlers = {};
require(process.argv[2])({
  app: { getPath: () => '/tmp/dhcp-harness-' + process.pid }, ipcMain: { handle: (c, f) => handlers[c] = f }, getWin: () => null,
  diagAdd() {}, runElevated: async () => ({ ok: true }), isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || ''),
  isValidSubnet: m => /^255\.(255|0)\.(255|0)\.0$/.test(m), sanitizeAdapter: n => n, lookupVendor: () => '',
  // ETHER's own list calls the self-assigned address the card's main one
  getAdapters: async () => [{ name: 'Ethernet', ip: null, mac: null, isDhcp: false, savedIps: [{ ip: '192.168.0.146', subnet: '255.255.255.0' }] }],
  applyStatic: async () => ({ ok: true }), applyDhcp: async () => ({ ok: true }), readAdapterConfig: async () => ({ ok: false }), getPolicy: async () => ({}),
  onStateChange() {}, ipAddressState: async () => 'Preferred', readJsonSafe: (f, fb) => fb, writeJsonAtomic() {},
});
(async () => {
  await handlers['dhcp-engine-start']();
  await handlers['dhcp-refresh-adapters']();
  const cfg = { adapterName: 'Ethernet', adapterIp: '192.168.0.146', gateway: '', dns: '', lease: 300, subnet: '255.255.255.0', rangeStart: '192.168.0.100', rangeEnd: '192.168.0.200' };
  const v = await handlers['dhcp-validate-config'](null, cfg);
  console.log('  validate → ' + JSON.stringify(v));
  const ok = v && v.ok === false && v.code === 'NO_LINK' && /No cable/.test(v.msg);
  const w = await handlers['dhcp-validate-config'](null, { ...cfg, adapterIp: '192.168.0.9' });
  const ok2 = w && w.code === 'NOT_ON_CARD';
  console.log(ok && ok2 ? 'PASS' : 'FAIL'); process.exit(ok && ok2 ? 0 : 1);
})();
