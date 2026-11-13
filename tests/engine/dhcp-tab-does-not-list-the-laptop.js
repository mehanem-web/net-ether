// DHCP tab, "devices on this cable" (wire-watch). Office trunk port, 2026-11-13: the laptop's own
// Wi-Fi card (c4:13:75:1a:9b:7f on 10.0.30.70) was listed as a SITTING device with a REACH button,
// because only the watched card's addresses were treated as "me". Every card of the laptop is "me".
const path = require('path'), Module = require('module'), EventEmitter = require('events');
const root = path.dirname(process.argv[2] || path.join(__dirname, '..', '..', 'dhcp.js'));
const fakeOs = { networkInterfaces: () => ({
  'Ethernet 2': [{ family: 'IPv4', internal: false, address: '10.0.60.90', mac: '9c:bf:0d:01:61:f7' }],
  'Wi-Fi 2':    [{ family: 'IPv4', internal: false, address: '10.0.30.70', mac: 'c4:13:75:1a:9b:7f' }],
}) };
const fakeDgram = { createSocket() { const s = new EventEmitter(); s.bind = (p, cb) => setImmediate(cb); s.addMembership = s.setMulticastInterface = s.setMulticastTTL = s.close = () => {}; s.send = () => {}; return s; } };
let tsharkOut = null;
const fakeCp = { spawn() { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; tsharkOut = p.stdout; return p; }, execFile() {} };
const origLoad = Module._load;
Module._load = function (req, ...r) { if (req === 'os') return fakeOs; if (req === 'dgram') return fakeDgram; if (req === 'child_process') return fakeCp; return origLoad.call(this, req, ...r); };
const D = require(path.join(root, 'discover.js'))({ diagAdd() {}, lookupVendor: () => '', execFile() {}, execAsync: async () => '', isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || '') });

const w = D.wireWatch({ ifaceIps: ['10.0.60.90'], tshark: 'tshark', npf: 'X', onUpdate() {} });
const line = (eth, ip, mac) => `${eth}|${ip}|${mac}|||\n`;
setTimeout(() => {
  tsharkOut.emit('data', Buffer.from(
    line('c4:13:75:1a:9b:7f', '10.0.30.70', 'c4:13:75:1a:9b:7f') +      // the laptop's Wi-Fi, heard over the cable
    line('c4:13:75:1a:9b:7f', '169.254.9.9', 'c4:13:75:1a:9b:7f') +     // …same card under an address Windows has not reported yet
    line('9c:bf:0d:01:61:f7', '10.0.60.90', '9c:bf:0d:01:61:f7') +      // the watched card itself
    line('a0:b3:39:2a:5a:ee', '10.0.30.62', 'a0:b3:39:2a:5a:ee')));     // a real neighbour
  const rows = w.list().map(r => r.ip).sort();
  try { w.stop && w.stop(); } catch {}
  if (rows.join(',') !== '10.0.30.62') { console.log('expected only 10.0.30.62 in the list, got: ' + (rows.join(', ') || 'nothing')); process.exit(1); }
  console.log('wire-watch: the laptop\'s own cards are not listed as devices'); process.exit(0);
}, 50);
