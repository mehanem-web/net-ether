// reservations: broadcast / network / in-use refusals
const Module = require('module');
const fakeDgram = { createSocket: () => { const s = { on(){return s;}, bind(p,a,cb){ if (typeof a==='function') a(); else cb&&cb(); }, setBroadcast(){}, send(b,o,l,p,a,cb){ cb&&cb(); }, close(cb){cb&&cb();}, address:()=>({}) }; return s; } };
const fakeCp = { exec: (c,o,cb)=>{ (typeof o==='function'?o:cb)(null,'',''); }, execFile:(f,a,o,cb)=>{ (typeof o==='function'?o:cb)(null,'',''); }, spawn:()=>({ on(){}, stdout:{on(){}}, stderr:{on(){}}, kill(){} }) };
const fakeOs = { networkInterfaces: () => ({ 'Ethernet': [{ family: 'IPv4', internal: false, address: '10.99.99.1', netmask: '255.255.255.0', mac: 'aa:aa:aa:aa:aa:aa' }] }), hostname:()=>'x', platform:()=>'win32', tmpdir:()=>'/tmp' };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; if (req === 'os') return fakeOs; return origLoad.call(this, req, ...r); };
const handlers = {};
require(process.argv[2])({ app: { getPath: () => '/tmp/dhcp-h7-' + process.pid }, ipcMain: { handle: (c, f) => handlers[c] = f }, getWin: () => null,
  diagAdd() {}, runElevated: async () => ({ ok: true }), isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || ''),
  isValidSubnet: m => m === '255.255.255.0', sanitizeAdapter: n => n, lookupVendor: () => 'Axis',
  getAdapters: async () => [{ name: 'Ethernet', ip: '10.99.99.1', mac: 'aa-aa-aa-aa-aa-aa' }], applyStatic: async()=>({ok:true}), applyDhcp: async()=>({ok:true}), readAdapterConfig: async()=>({ok:false}), getPolicy: async()=>({}),
  onStateChange() {}, ipAddressState: async () => 'Preferred', readJsonSafe: (f, fb) => fb, writeJsonAtomic() {} });
(async () => {
  const cfg = { adapterName: 'Ethernet', adapterIp: '10.99.99.1', rangeStart: '10.99.99.100', rangeEnd: '10.99.99.200', subnet: '255.255.255.0', gateway: '', leaseTime: 300 };
  await handlers['dhcp-set-preview'](null, cfg);
  let bad = 0;
  for (const [ip, want] of [['10.99.99.255', false], ['10.99.99.0', false], ['10.99.99.150', true], ['10.99.99.1', false]]) {
    const r = await handlers['dhcp-reservation-set'](null, '02:00:00:00:00:' + ip.split('.')[3].slice(-2).padStart(2,'0'), ip);
    const ok = !!r.ok === want; if (!ok) bad++;
    console.log((ok ? 'ok   ' : 'FAIL ') + ip.padEnd(14) + (r.ok ? 'accepted' : 'refused: ' + r.msg));
  }
  console.log(bad ? bad + ' FAILED' : 'all as expected'); process.exit(bad ? 1 : 0);
})();
