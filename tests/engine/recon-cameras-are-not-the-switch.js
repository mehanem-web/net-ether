// RECON on a small unmanaged switch with cameras on it (bench, 2026-11-13). Two Bosch, an Avigilon
// and a Hanwha each announce themselves over LLDP (the Hanwha over CDP as well) and the switch
// passes that along. dev.22 folded all of them into one SWITCH card:
//   "Not set · port 00:07:5f:95:aa:ee — LLDP+CDP · Not set · Linux · mgmt 10.90.44.27".
// The frames in fixtures/recon-hub-cameras.json are the real ones, cut down to the fields RECON reads.
// Checks: none of them is the switch; they are listed once each as neighbours; a real switch
// announcing next to them still gets the SWITCH card.
const fs = require('fs'), path = require('path'), EventEmitter = require('events');
const root = path.dirname(process.argv[2] || path.join(__dirname, '..', '..', 'dhcp.js'));
const frames = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'recon-hub-cameras.json'), 'utf8'));
const realSwitch = { 'frame.protocols': 'eth:ethertype:lldp', 'eth.src': '00:1a:eb:11:22:33', 'lldp.chassis.id.mac': '00:1a:eb:11:22:33',
  'lldp.port.id': 'port1.0.7', 'lldp.tlv.system.name': 'BENCH-SW-1', 'lldp.tlv.system_cap': '0x0014', 'lldp.tlv.enable_system_cap': '0x0004' };
const asTshark = list => '[\n' + list.map(f => '  {\n' + Object.entries(f).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n  }').join(',\n') + '\n]\n';

let feed = '';
const fakeExecFile = () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {};
  setTimeout(() => { p.stdout.emit('data', Buffer.from(feed)); p.emit('close', 0); }, 5); return p; };
const D = require(path.join(root, 'discover.js'))({ diagAdd() {}, lookupVendor: m => /^00:07:5f/i.test(m) ? 'Bosch' : '', execFile: fakeExecFile, execAsync: async () => '', isValidIp: ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip || '') });

const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };
async function listen(list) { feed = asTshark(list); const ev = await D.reconListen({ tshark: 'tshark', npf: 'X', durationS: 1 }); return D.reconVerdicts(ev, {}); }

(async () => {
  let V = await listen(frames);
  let sw = V.find(v => v.tag === 'SWITCH'), nb = V.filter(v => v.tag === 'NEIGHBOUR');
  check(sw && sw.kind === 'quiet' && /not announcing itself/i.test(sw.title), 'cameras only: SWITCH card should say the switch is not announcing itself, got: ' + (sw && sw.title));
  check(nb.length === 1, 'cameras only: expected one NEIGHBOUR card, got ' + nb.length);
  const text = nb.map(v => v.title + ' ' + v.detail).join(' ');
  check(/^4 devices/.test((nb[0] || {}).title || ''), 'cameras only: four devices expected (the Hanwha speaks LLDP and CDP and is one device), got: ' + ((nb[0] || {}).title));
  check((text.match(/PNM-7002VD/g) || []).length === 1, 'the Hanwha should be listed once');
  check(/avacam-aclo-r63a-shx4 \(10\.90\.44\.27\)/.test(text), 'the Avigilon should be listed with its address');
  check(/Bosch 00:07:5f:95:aa:ee/.test(text) && !/Not set/.test(text), 'a Bosch has no name ("Not set") and should be listed by maker and MAC');

  V = await listen(frames.concat([realSwitch]));
  sw = V.find(v => v.tag === 'SWITCH'); nb = V.filter(v => v.tag === 'NEIGHBOUR');
  check(sw && sw.kind === 'ok' && /BENCH-SW-1 · port port1\.0\.7/.test(sw.title), 'switch + cameras: SWITCH card should be the switch, got: ' + (sw && sw.title));
  check(sw && !/10\.90\.44\.27|Linux/.test(sw.title + sw.detail), 'switch + cameras: nothing from a camera may leak into the SWITCH card: ' + (sw && sw.detail));
  check(nb.length === 1 && /^4 devices/.test(nb[0].title), 'switch + cameras: the four cameras still listed as neighbours');

  V = await listen([realSwitch]);
  sw = V.find(v => v.tag === 'SWITCH');
  check(sw && sw.kind === 'ok' && /BENCH-SW-1/.test(sw.title) && !V.some(v => v.tag === 'NEIGHBOUR'), 'switch alone: one SWITCH card and no NEIGHBOUR');

  // office trunk port, 2026-11-13 (values from the capture): SonicWall access points announce over CDP as
  // router + switch + host (0x19), cameras as host (0x10), and tagged traffic brings replies from the
  // internet into the capture
  const cdpCam = (name, caps) => ({ 'frame.protocols': 'eth:llc:cdp', 'eth.src': '00:09:18:00:00:01', 'cdp.deviceid': name, 'cdp.portid': 'eth0', 'cdp.platform': 'Linux', 'cdp.capabilities': caps });
  const ipFrom = ip => ({ 'frame.protocols': 'eth:ethertype:vlan:ethertype:ip:tcp', 'ip.src': ip });
  const remote = []; for (let i = 0; i < 40; i++) remote.push(ipFrom(`52.${96 + i}.57.10`));
  const local = ['10.0.30.11', '10.0.30.12', '10.0.30.13', '10.0.20.5', '10.0.60.1', '192.168.1.100', '10.0.190.2', '10.73.241.9', '10.0.40.7', '10.0.50.7'].map(ipFrom);
  V = await listen([cdpCam('EHQ 1st Floor S', '0x00000019'), cdpCam('EHQ 2nd Floor', '0x00000019'), cdpCam('axis-b8a44f7c96ef', '0x00000010')].concat(remote, local));
  sw = V.find(v => v.tag === 'SWITCH'); nb = V.filter(v => v.tag === 'NEIGHBOUR');
  const hosts = V.find(v => v.tag === 'HOSTS');
  check(sw && sw.kind === 'quiet', 'trunk: an access point announcing router + switch + host over CDP is not the switch, got: ' + (sw && sw.title));
  check(nb.length === 1 && /^3 devices/.test(nb[0].title) && /EHQ 1st Floor S/.test(nb[0].detail) && /EHQ 2nd Floor/.test(nb[0].detail) && /axis-b8a44f7c96ef/.test(nb[0].detail), 'trunk: all three CDP neighbours listed, got: ' + (nb[0] && nb[0].title + ' — ' + nb[0].detail));
  check(hosts && /^3 hosts talking on 10\.0\.30\.x/.test(hosts.title), 'trunk: HOSTS title, got: ' + (hosts && hosts.title));
  check(hosts && !/52\./.test(hosts.detail), 'trunk: internet addresses are not subnets on this port: ' + (hosts && hosts.detail));
  check(hosts && (hosts.detail.match(/\.x \(/g) || []).length === 5 && /and 2 more subnets/.test(hosts.detail), 'trunk: the subnet list is cut at five, got: ' + (hosts && hosts.detail));

  // a port has one switch: two senders that both look like network gear are being passed along
  const gear = (name, mac) => Object.assign({}, realSwitch, { 'eth.src': mac, 'lldp.chassis.id.mac': mac, 'lldp.tlv.system.name': name });
  V = await listen([gear('AP-NORTH', '18:c2:41:00:00:01'), gear('AP-SOUTH', '18:c2:41:00:00:02')]);
  sw = V.find(v => v.tag === 'SWITCH'); nb = V.filter(v => v.tag === 'NEIGHBOUR');
  check(sw && sw.kind === 'quiet' && nb.length === 1 && /^2 devices/.test(nb[0].title), 'two gear-like LLDP senders: neither is the switch, both are neighbours, got: ' + (sw && sw.title));
  V = await listen([cdpCam('SW-A', '0x00000028'), cdpCam('SW-B', '0x00000028')]);
  sw = V.find(v => v.tag === 'SWITCH'); nb = V.filter(v => v.tag === 'NEIGHBOUR');
  check(sw && sw.kind === 'quiet' && nb.length === 1 && /^2 devices/.test(nb[0].title), 'two gear-like CDP senders: neither is the switch, got: ' + (sw && sw.title));
  V = await listen([cdpCam('CORE-SW-2', '0x00000028'), cdpCam('C455HD-00171903aeee', '0x00000490')]);
  sw = V.find(v => v.tag === 'SWITCH');
  check(sw && sw.kind === 'ok' && /CORE-SW-2/.test(sw.title), 'one CDP switch and a phone: the switch keeps the card, got: ' + (sw && sw.title));

  // trunk port: suggest an address on the untagged network, with a gateway that belongs to it,
  // and leave the laptop's own name out of NAMES (values from the 10:34 listen, 2026-11-13)
  const tagged = (ip, vlan) => ({ 'frame.protocols': 'eth:ethertype:vlan:ethertype:ip:udp', 'vlan.id': String(vlan), 'ip.src': ip });
  const ack = (router, vlan) => Object.assign({ 'frame.protocols': 'eth:ethertype:ip:udp:dhcp', 'ip.src': '10.0.60.1', 'dhcp.option.dhcp': '5', 'dhcp.option.dhcp_server_id': '10.0.60.1',
    'dhcp.option.router': router, 'dhcp.option.subnet_mask': '255.255.255.0' }, vlan ? { 'vlan.id': String(vlan), 'frame.protocols': 'eth:ethertype:vlan:ethertype:ip:udp:dhcp' } : {});
  const nbName = n => ({ 'frame.protocols': 'eth:ethertype:ip:udp:nbns', 'ip.src': '10.0.60.90', 'nbns.name': n + '<00>', 'nbns.flags.opcode': '5', 'nbns.flags.response': '0' });
  const trunkFrames = [];
  for (let i = 1; i <= 12; i++) trunkFrames.push(tagged('10.0.30.' + i, 30));
  for (let i = 1; i <= 5; i++) trunkFrames.push(tagged('10.0.20.' + i, 20));
  for (let i = 11; i <= 14; i++) trunkFrames.push(ipFrom('10.0.60.' + i));
  trunkFrames.push(ack('10.0.60.254', 0), ack('10.0.30.254', 30), nbName('BENCH-LAPTOP'), nbName('ORION-30008'));
  feed = asTshark(trunkFrames);
  let ev = await D.reconListen({ tshark: 'tshark', npf: 'X', durationS: 1 });
  V = D.reconVerdicts(ev, { selfIps: ['10.0.60.90'], selfName: 'bench-laptop' });
  const addr = V.find(v => v.tag === 'ADDRESS'), names = V.find(v => v.tag === 'NAMES'), h2 = V.find(v => v.tag === 'HOSTS');
  check(V.some(v => v.tag === 'TRUNK'), 'trunk fixture: a TRUNK card is expected');
  check(h2 && /^12 hosts talking on 10\.0\.30\.x/.test(h2.title), 'trunk: HOSTS still names the busiest network, got: ' + (h2 && h2.title));
  check(addr && /^10\.0\.60\.250 looks free/.test(addr.title), 'trunk: the suggested address is on the untagged network, got: ' + (addr && addr.title));
  check(addr && addr.action && addr.action.gateway === '10.0.60.254', 'trunk: the gateway belongs to the suggested network, got: ' + (addr && addr.action && addr.action.gateway));
  check(names && /ORION-30008/.test(names.title) && !/BENCH-LAPTOP/i.test(names.title), 'the laptop\'s own name is not in NAMES, got: ' + (names && names.title));
  // one network, two routers named: the gateway offered must be the one on that network
  feed = asTshark([ipFrom('10.0.30.11'), ipFrom('10.0.30.12'), ack('10.0.60.254', 0), ack('10.0.30.254', 0)]);
  ev = await D.reconListen({ tshark: 'tshark', npf: 'X', durationS: 1 });
  const a2 = D.reconVerdicts(ev, { selfIps: [], selfName: '' }).find(v => v.tag === 'ADDRESS');
  check(a2 && /^10\.0\.30\.250/.test(a2.title) && a2.action.gateway === '10.0.30.254', 'access port: gateway on the suggested network, got: ' + (a2 && a2.title + ' gw ' + a2.action.gateway));

  // the same host under two spellings is one name
  const nm = D.reconVerdicts(Object.assign({}, ev, { names: ['oss', 'ORION-30008', 'OSS', 'ORION-30008.oss', 'EHQVMAPP04'] }), { selfIps: [], selfName: '' }).find(v => v.tag === 'NAMES');
  check(nm && nm.title === 'oss, ORION-30008, EHQVMAPP04', 'NAMES lists each host once, got: ' + (nm && nm.title));
  // no lease heard: a gateway at .1 is a guess and the card says so
  feed = asTshark([ipFrom('10.0.60.1'), ipFrom('10.0.60.12')]);
  ev = await D.reconListen({ tshark: 'tshark', npf: 'X', durationS: 1 });
  const a3 = D.reconVerdicts(ev, { selfIps: [], selfName: '' }).find(v => v.tag === 'ADDRESS');
  check(a3 && /gateway 10\.0\.60\.1\? \(a guess/.test(a3.detail), 'no lease: the .1 gateway is marked as a guess, got: ' + (a3 && a3.detail));
  check(a2 && / · gateway 10\.0\.30\.254 /.test(a2.detail + ' ') && !/guess/.test(a2.detail), 'lease heard: the gateway is stated plainly, got: ' + (a2 && a2.detail));

  if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
  console.log('RECON: cameras announcing through an unmanaged switch are neighbours, not the switch'); process.exit(0);
})();
