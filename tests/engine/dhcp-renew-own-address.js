// Harness: RELEASE ALL then SERVE EVERYONE — a camera renewing the address it still uses (the address answers ping).
const Module = require('module'); const EventEmitter = require('events');
const sent = []; let sockRef = null;
const fakeDgram = { createSocket() { const s = new EventEmitter();
  s.bind = (p, a, cb) => { if (typeof a === 'function') cb = a; setImmediate(cb); }; s.setBroadcast = () => {}; s.close = () => {};
  s.send = (buf, o, l, port, dest, cb) => { sent.push({ buf: Buffer.from(buf), port, dest }); cb && cb(); }; sockRef = s; return s; } };
const fakeCp = { execFile(file, args, opts, cb) { if (typeof opts === 'function') cb = opts;
  if (/ping/i.test(file)) return setTimeout(() => cb(null, 'Reply from 10.99.99.100: bytes=32 time=1ms TTL=64'), 50);   // the address answers: the camera itself
  setTimeout(() => cb(null, file === 'netsh' ? 'Enabled: Yes' : ''), 5); } };
const fakeOs = { networkInterfaces: () => ({ 'Ethernet': [{ family: 'IPv4', internal: false, address: '10.99.99.1', netmask: process.env.CARDMASK || '255.255.255.0', mac: 'aa:aa:aa:aa:aa:aa' }] }) };
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
  await handlers['dhcp-engine-start']();
  const cfg = { adapterName: 'Ethernet', adapterIp: '10.99.99.1', gateway: '', dns: '', lease: 300, subnet: '255.255.255.0', rangeStart: '10.99.99.100', rangeEnd: '10.99.99.120' };
  const r = await handlers['dhcp-serve-all'](null, cfg);
  if (!r.ok) { console.log('serve refused: ' + r.msg); process.exit(1); }
  sent.length = 0;
  const mac = '00:07:5f:00:00:01';
  // a renewal: no option 50, no server id, ciaddr = the address, sent FROM the address
  const p = pkt(3, mac, { xid: 0xB }); [10, 99, 99, 100].forEach((x, i) => p[12 + i] = x);
  sockRef.emit('message', p, { address: '10.99.99.100', port: 68 });
  await wait(900);
  const got = sent.map(decode).filter(d => d.mac === mac);
  for (const d of got) console.log(`  ${d.type} ${d.ip}`);
  const ok = got.some(d => d.type === 'ACK' && d.ip === '10.99.99.100');
  console.log(ok ? 'PASS — the camera keeps 10.99.99.100' : 'FAIL — no ACK for 10.99.99.100 (' + (got.length ? got.map(d => d.type).join(',') : 'silence') + ')');
  process.exit(ok ? 0 : 1);
})();
