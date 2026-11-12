#!/usr/bin/env node
// fake-cameras.js — pretend to be several DHCP devices booting at the same moment.
//
// Test rig for NET//ETHER's DHCP engine (7.4 audit, finding 1.2): two devices that ask in the
// same half-second must not be leased the same address.
//
//   node fake-cameras.js <ETHER laptop's address on the cable> [devices=4] [gap ms=20]
//   node fake-cameras.js 10.99.99.1
//
// ONLY on an isolated wire (one cable between this PC and the laptop running ETHER). ETHER has to
// be on SERVE EVERYONE for this, and that must never be done on a network with real devices.
//
// Every run uses fresh random MAC addresses, so ETHER sees brand-new devices each time.
// Sends nothing but DHCP DISCOVER / REQUEST broadcasts to that one subnet. No dependencies.

const dgram = require('dgram');
const crypto = require('crypto');

const serverIp = process.argv[2];
const COUNT = Math.max(2, Math.min(16, parseInt(process.argv[3], 10) || 4));
const GAP_MS = Math.max(0, Math.min(500, parseInt(process.argv[4], 10) || 20));
if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(serverIp || '')) {
  console.error('usage: node fake-cameras.js <ETHER laptop address on the cable> [devices=4] [gap ms=20]');
  process.exit(2);
}
// /24 assumed: replies and requests both use the subnet broadcast, so they stay on the cable even
// when Wi-Fi holds the default route.
const BCAST = process.env.FAKE_BCAST || serverIp.replace(/\.\d+$/, '.255');

const run = crypto.randomBytes(3);
const devs = Array.from({ length: COUNT }, (_, i) => {
  const mac = Buffer.from([0x02, 0xee, run[0], run[1], run[2], i + 1]);   // 02:… = locally administered
  return { n: i + 1, mac, macStr: [...mac].map(b => b.toString(16).padStart(2, '0')).join(':'),
           xid: crypto.randomBytes(4), offered: null, server: null, acked: null, nak: false, discovers: 0 };
});
const byMac = new Map(devs.map(d => [d.macStr, d]));

function packet(d, type, extra = []) {
  const b = Buffer.alloc(300);
  b[0] = 1; b[1] = 1; b[2] = 6;                 // BOOTREQUEST, Ethernet, 6-byte address
  d.xid.copy(b, 4);
  b.writeUInt16BE(0x8000, 10);                  // please answer by broadcast
  d.mac.copy(b, 28);
  Buffer.from([99, 130, 83, 99]).copy(b, 236);  // magic cookie
  let o = 240;
  const opt = (code, bytes) => { b[o++] = code; b[o++] = bytes.length; for (const x of bytes) b[o++] = x; };
  opt(53, [type]);
  opt(12, [...Buffer.from('FAKE-CAM-' + d.n)]);
  opt(60, [...Buffer.from('FAKE,Test Device,ETHER-RIG,1.0')]);
  for (const [code, bytes] of extra) opt(code, bytes);
  b[o++] = 255;
  return b;
}
const ipBytes = ip => ip.split('.').map(Number);

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
sock.on('error', e => {
  console.error('\nsocket error: ' + e.message);
  if (e.code === 'EADDRINUSE' || e.code === 'EACCES') console.error('UDP 68 is not available — close ETHER on THIS PC (its DHCP tab uses it) and run this from an admin terminal.');
  process.exit(1);
});
sock.on('message', msg => {
  if (msg.length < 244 || msg[0] !== 2) return;                       // BOOTREPLY only
  const mac = [...msg.subarray(28, 34)].map(b => b.toString(16).padStart(2, '0')).join(':');
  const d = byMac.get(mac);
  if (!d) return;
  const yi = [...msg.subarray(16, 20)].join('.');
  let type = 0, server = null, i = 240;
  while (i < msg.length && msg[i] !== 255) {
    if (msg[i] === 0) { i++; continue; }
    const len = msg[i + 1];
    if (msg[i] === 53) type = msg[i + 2];
    if (msg[i] === 54) server = [...msg.subarray(i + 2, i + 6)].join('.');
    i += 2 + len;
  }
  if (type === 2 && !d.offered) { d.offered = yi; d.server = server; console.log(`  OFFER  ${mac}  ${yi}`); }
  if (type === 5 && !d.acked)   { d.acked = yi; console.log(`  ACK    ${mac}  ${yi}`); }
  if (type === 6)               { d.nak = true; console.log(`  NAK    ${mac}`); }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = buf => new Promise(res => sock.send(buf, 0, buf.length, 67, BCAST, err => { if (err) console.error('send failed: ' + err.message); res(); }));
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return fn(); }

sock.bind(68, async () => {
  sock.setBroadcast(true);
  console.log(`${COUNT} fake devices → ${BCAST}:67, ${GAP_MS} ms apart (ETHER at ${serverIp})`);
  devs.forEach(d => console.log(`  device ${d.n}  ${d.macStr}`));

  // 1. Everyone asks at once; like a real device, anyone without an offer asks again every 3 s.
  for (let round = 1; round <= 6 && devs.some(d => !d.offered); round++) {
    console.log(`\nDISCOVER round ${round}`);
    for (const d of devs.filter(x => !x.offered)) { d.discovers++; await send(packet(d, 1)); if (GAP_MS) await sleep(GAP_MS); }
    await until(() => devs.every(d => d.offered), 3000);
  }
  if (!devs.some(d => d.offered)) {
    console.log('\nNo offers at all. Is ETHER on SERVE EVERYONE, on the card this cable is in, and is this PC on the same subnet?');
    process.exit(1);
  }

  // 2. Everyone accepts what it was offered, at once.
  console.log('\nREQUEST');
  for (const d of devs.filter(x => x.offered)) {
    await send(packet(d, 3, [[50, ipBytes(d.offered)], ...(d.server ? [[54, ipBytes(d.server)]] : [])]));
    if (GAP_MS) await sleep(GAP_MS);
  }
  await until(() => devs.every(d => !d.offered || d.acked || d.nak), 4000);

  // 3. Verdict
  console.log('\n  device  MAC                offered          leased');
  for (const d of devs) console.log(`  ${String(d.n).padEnd(6)}  ${d.macStr}  ${(d.offered || '—').padEnd(15)}  ${d.acked || (d.nak ? 'refused (NAK)' : '—')}`);
  const dup = list => { const seen = new Map(); for (const ip of list) seen.set(ip, (seen.get(ip) || 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([ip, n]) => `${ip} ×${n}`); };
  const dupOffer = dup(devs.map(d => d.offered).filter(Boolean)), dupLease = dup(devs.map(d => d.acked).filter(Boolean));
  const leased = devs.filter(d => d.acked).length;
  console.log('');
  if (dupLease.length)      console.log(`FAIL — the same address was LEASED to more than one device: ${dupLease.join(', ')}`);
  else if (dupOffer.length) console.log(`WARN — the same address was OFFERED to more than one device (${dupOffer.join(', ')}) but only one got the lease`);
  else if (leased === COUNT) console.log(`PASS — ${COUNT} devices, ${COUNT} different addresses`);
  else                      console.log(`INCOMPLETE — ${leased} of ${COUNT} devices got a lease, no duplicates among them`);
  sock.close();
  process.exit(dupLease.length ? 1 : 0);
});
