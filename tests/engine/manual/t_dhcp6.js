// Harness: load the real dhcp.js with stubbed OS edges, replay two cameras booting at once.
const Module = require('module'); const EventEmitter = require('events');
const sent = []; let sockRef = null;
const socks = [];
const fakeDgram = { createSocket() { const s = new EventEmitter(); s.addr = null; s.closed = false;
  s.bind = (p, a, cb) => { if (typeof a === 'function') { cb = a; a = '0.0.0.0'; } s.addr = a; setImmediate(cb); }; s.setBroadcast = () => {}; s.close = () => { s.closed = true; };
  s.send = (buf, o, l, port, dest, cb) => { sent.push({ buf: Buffer.from(buf), port, dest, from: s.addr }); cb && cb(); }; socks.push(s); sockRef = s; return s; } };
const fakeCp = { execFile(file, args, opts, cb) { if (typeof opts === 'function') cb = opts;
  if (file === 'ping') return setTimeout(() => cb(new Error('exit 1'), 'Request timed out.'), 300);   // address is free; ping.exe takes 300 ms
  setTimeout(() => cb(null, file === 'netsh' ? 'Enabled: Yes' : ''), 5); } };
let CARD_UP = true;
const fakeOs = { networkInterfaces: () => (!CARD_UP ? { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.0.124', netmask: '255.255.255.0', mac: 'bb:bb:bb:bb:bb:bb' }] } : { 'Ethernet': [{ family: 'IPv4', internal: false, address: '10.99.99.1', netmask: process.env.CARDMASK || '255.255.255.0', mac: 'aa:aa:aa:aa:aa:aa' }] }) };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; if (req === 'os') return fakeOs; return origLoad.call(this, req, ...r); };
const handlers = {};
const eng = require(process.argv[2])({
  app: { getPath: () => '/tmp/dhcp-harness-' + process.pid }, ipcMain: { handle: (c, f) => handlers[c] = f }, getWin: () => null,
  diagAdd() {}, runElevated: async () => ({ ok: true }), isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || ''),
  isValidSubnet: m => /^255\.(255|0)\.(255|0)\.0$/.test(m), sanitizeAdapter: n => n, lookupVendor: () => 'Axis', getAdapters: async () => [{ name: 'Ethernet', ip: '10.99.99.1', mac: 'aa-aa-aa-aa-aa-aa' }],
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
  const live = () => socks.filter(s => !s.closed).map(s => s.addr).join(', ') || '(none)';
  const cfg = { adapterName: 'Ethernet', adapterIp: '10.99.99.1', subnet: '255.255.255.0', rangeStart: '10.99.99.100', rangeEnd: '10.99.99.120', gateway: '', dns: '', lease: 300 };
  await handlers['dhcp-engine-start'](); await wait(50);
  console.log('1. tab opened, no laptop address chosen yet → listening on:', live());
  await handlers['dhcp-set-preview'](null, cfg); await wait(80);
  console.log('2. laptop address 10.99.99.1 chosen          → listening on:', live());
  const r = await handlers['dhcp-serve-all'](null, cfg); await wait(50);
  console.log('3. SERVE EVERYONE: ' + (r.ok ? 'ok' : r.msg) + ', warning: ' + (r.warning || 'none') + '  → listening on:', live());
  sent.length = 0;
  const sock = socks.filter(s => !s.closed)[0];
  sock.emit('message', pkt(1, '00:40:8c:00:00:0a', { xid: 0xA }), { address: '0.0.0.0', port: 68 }); await wait(700);
  for (const x of sent) { const d = decode(x); console.log(`   ${d.type} ${d.ip} sent from the socket on ${x.from} to ${x.dest}`); }
  await handlers['dhcp-stop-serving'](); await wait(50);
  console.log('4. stopped serving                           → listening on:', live());
  process.exit(0);
})();
