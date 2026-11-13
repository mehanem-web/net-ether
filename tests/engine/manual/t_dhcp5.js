const REAL=(()=>{const IP_RE     = /^(\d{1,3}\.){3}\d{1,3}$/;
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

return {isValidIp,isValidSubnet};})();
// Harness: load the real dhcp.js with stubbed OS edges, replay two cameras booting at once.
const Module = require('module'); const EventEmitter = require('events');
const sent = []; let sockRef = null;
const fakeDgram = { createSocket() { const s = new EventEmitter();
  s.bind = (p, a, cb) => { if (typeof a === 'function') cb = a; setImmediate(cb); }; s.setBroadcast = () => {}; s.close = () => {};
  s.send = (buf, o, l, port, dest, cb) => { sent.push({ buf: Buffer.from(buf), port, dest }); cb && cb(); }; sockRef = s; return s; } };
const fakeCp = { execFile(file, args, opts, cb) { if (typeof opts === 'function') cb = opts;
  if (file === 'ping') return setTimeout(() => cb(new Error('exit 1'), 'Request timed out.'), 300);   // address is free; ping.exe takes 300 ms
  setTimeout(() => cb(null, file === 'netsh' ? 'Enabled: Yes' : ''), 5); } };
const fakeOs = { networkInterfaces: () => ({ 'Ethernet': [{ family: 'IPv4', internal: false, address: '10.99.99.1', netmask: process.env.CARDMASK || '255.255.255.0', mac: 'aa:aa:aa:aa:aa:aa' }] }) };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; if (req === 'os') return fakeOs; return origLoad.call(this, req, ...r); };
const handlers = {};
const eng = require(process.argv[2])({
  app: { getPath: () => '/tmp/dhcp-harness-' + process.pid }, ipcMain: { handle: (c, f) => handlers[c] = f }, getWin: () => null,
  diagAdd() {}, runElevated: async () => ({ ok: true }), isValidIp: REAL.isValidIp,
  isValidSubnet: REAL.isValidSubnet, sanitizeAdapter: n => n, lookupVendor: () => 'Axis', getAdapters: async () => [{ name: 'Ethernet', ip: '10.99.99.1', mac: 'aa-aa-aa-aa-aa-aa' }],
  applyStatic: async () => ({ ok: true }), applyDhcp: async () => ({ ok: true }), readAdapterConfig: async () => ({ ok: false }), getPolicy: async () => ({}),
  onStateChange() {}, ipAddressState: async () => 'Preferred', readJsonSafe: (f, fb) => fb, writeJsonAtomic() {},
});
function pkt(type, mac, opts = {}) { const b = Buffer.alloc(300); b[0] = 1; b[1] = 1; b[2] = 6; Buffer.from(mac.replace(/:/g, ''), 'hex').copy(b, 28); b.writeUInt32BE(opts.xid || 0x1000, 4);
  b[236] = 99; b[237] = 130; b[238] = 83; b[239] = 99; let o = 240; b[o++] = 53; b[o++] = 1; b[o++] = type;
  if (opts.req) { b[o++] = 50; b[o++] = 4; opts.req.split('.').forEach(x => b[o++] = +x); }
  if (opts.srv) { b[o++] = 54; b[o++] = 4; opts.srv.split('.').forEach(x => b[o++] = +x); } b[o++] = 255; return b; }
const decode = s => { const b = s.buf; let t = 0, i = 240; while (i < b.length && b[i] !== 255) { if (b[i] === 53) t = b[i + 2]; i += 2 + b[i + 1]; }
  return { type: { 2: 'OFFER', 5: 'ACK', 6: 'NAK' }[t], mac: b.slice(28, 34).toString('hex').match(/../g).join(':'), ip: [...b.slice(16, 20)].join('.') }; };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await handlers['dhcp-engine-start']();
  const base = { adapterName: 'Ethernet', adapterIp: '10.99.99.1', subnet: '255.255.255.0', rangeStart: '10.99.99.100', rangeEnd: '10.99.99.120', gateway: '', dns: '', lease: 300 };
  const cases = [
    ['baseline', {}],
    ['pool contains the laptop itself', { rangeStart: '10.99.99.1', rangeEnd: '10.99.99.20' }],
    ['pool is only the laptop address', { rangeStart: '10.99.99.1', rangeEnd: '10.99.99.1' }],
    ['pool starts at network address', { rangeStart: '10.99.99.0', rangeEnd: '10.99.99.10' }],
    ['pool ends at broadcast', { rangeStart: '10.99.99.250', rangeEnd: '10.99.99.255' }],
    ['pool is only the broadcast address', { rangeStart: '10.99.99.255', rangeEnd: '10.99.99.255' }],
    ['mask 255.255.255.255', { subnet: '255.255.255.255', rangeStart: '10.99.99.1', rangeEnd: '10.99.99.1' }],
    ['mask 255.255.255.254', { subnet: '255.255.255.254', rangeStart: '10.99.99.0', rangeEnd: '10.99.99.1' }],
    ['mask 0.0.0.0', { subnet: '0.0.0.0' }],
    ['mask 255.255.255.252 pool = the other host', { subnet: '255.255.255.252', rangeStart: '10.99.99.2', rangeEnd: '10.99.99.2' }],
    ['gateway inside the pool', { gateway: '10.99.99.110' }],
    ['dns 0.0.0.0', { dns: '0.0.0.0' }],
    ['address with leading zeros 010.099.099.100', { rangeStart: '010.099.099.100' }],
    ['spaces around first', { rangeStart: ' 10.99.99.100 ' }],
    ['lease "abc"', { lease: 'abc' }],
    ['multicast pool 224.0.0.x', { adapterIp: '10.99.99.1', rangeStart: '224.0.0.5', rangeEnd: '224.0.0.9' }],
  ];
  for (const [label, part] of cases) {
    const r = await handlers['dhcp-validate-config'](null, { ...base, ...part });
    console.log((r.ok ? 'ACCEPTED ' : 'refused  ') + label.padEnd(46) + (r.ok ? '' : '— ' + r.msg.slice(0, 70)));
  }
  process.exit(0);
})();
