// Harness: load the real dhcp.js with stubbed OS edges, replay two cameras booting at once.
const Module = require('module'); const EventEmitter = require('events');
const sent = []; let sockRef = null;
const fakeDgram = { createSocket() { const s = new EventEmitter();
  s.bind = (p, a, cb) => { if (typeof a === 'function') cb = a; setImmediate(cb); }; s.setBroadcast = () => {}; s.close = () => {};
  s.send = (buf, o, l, port, dest, cb) => { sent.push({ buf: Buffer.from(buf), port, dest }); cb && cb(); }; sockRef = s; return s; } };
const fakeCp = { execFile(file, args, opts, cb) { if (typeof opts === 'function') cb = opts;
  if (file === 'ping') return setTimeout(() => cb(new Error('exit 1'), 'Request timed out.'), 300);   // address is free; ping.exe takes 300 ms
  setTimeout(() => cb(null, file === 'netsh' ? 'Enabled: Yes' : ''), 5); } };
const fakeOs = { networkInterfaces: () => ({ 'Ethernet': [{ family: 'IPv4', internal: false, address: '192.168.0.1', netmask: '255.255.255.0', mac: 'aa:aa:aa:aa:aa:aa' }] }) };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; if (req === 'os') return fakeOs; return origLoad.call(this, req, ...r); };
const handlers = {};
const eng = require(process.argv[2])({
  app: { getPath: () => '/tmp/dhcp-harness-' + process.pid }, ipcMain: { handle: (c, f) => handlers[c] = f }, getWin: () => null,
  diagAdd() {}, runElevated: async () => ({ ok: true }), isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || ''),
  isValidSubnet: m => m === '255.255.255.0', sanitizeAdapter: n => n, lookupVendor: () => 'Axis', getAdapters: async () => [{ name: 'Ethernet', ip: '192.168.0.1', mac: 'aa-aa-aa-aa-aa-aa' }],
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
let created=0; const _cs=fakeDgram.createSocket; const socks=[]; fakeDgram.createSocket=function(){created++; const s=_cs(); let closed=false; const c=s.close; s.close=()=>{closed=true}; s._closed=()=>closed; socks.push(s); return s;};
(async () => {
  await Promise.all([handlers["dhcp-engine-start"](), handlers["dhcp-engine-start"]()]);
  console.log("two overlapping engine-start calls → UDP 67 sockets created:", created);
  await handlers["dhcp-engine-stop"]();
  console.log("after engine-stop → sockets still open:", socks.filter(s=>!s._closed()).length, "(still has a message listener:", socks.filter(s=>!s._closed()).map(s=>s.listenerCount("message")).join(","), ")");
  process.exit(0);
  await handlers['dhcp-engine-start']();
  const cfg = { adapterName: 'Ethernet', adapterIp: '192.168.0.1', subnet: '255.255.255.0', rangeStart: '192.168.0.100', rangeEnd: '192.168.0.200', gateway: '', dns: '', lease: 300 };
  console.log('serve-all:', JSON.stringify(await handlers['dhcp-serve-all'](null, cfg)));
  const A = '00:40:8c:00:00:0a', B = '00:40:8c:00:00:0b';
  sockRef.emit('message', pkt(1, A, { xid: 0xA }), { address: '0.0.0.0', port: 68 });           // camera A DISCOVER
  await wait(50);
  sockRef.emit('message', pkt(1, B, { xid: 0xB }), { address: '0.0.0.0', port: 68 });           // camera B DISCOVER, 50 ms later
  await wait(900);
  const offers = sent.map(decode).filter(x => x.type === 'OFFER'); offers.forEach(o => console.log('OFFER', o.mac, '→', o.ip));
  for (const o of offers) sockRef.emit('message', pkt(3, o.mac, { req: o.ip, srv: '192.168.0.1' }), { address: '0.0.0.0', port: 68 });
  await wait(600);
  const acks = sent.map(decode).filter(x => x.type === 'ACK'); acks.forEach(o => console.log('ACK  ', o.mac, '→', o.ip));
  const ips = acks.map(a => a.ip); console.log(new Set(ips).size < ips.length ? 'RESULT: DUPLICATE — two devices were leased the same address' : 'RESULT: ok — distinct addresses');
  // CSV
  console.log('CSV:\n' + await handlers['dhcp-export-csv']());
  process.exit(0);
})();
