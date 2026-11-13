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

  // office trunk port, 2026-11-13: two cameras announce over CDP only (one names itself router + host),
  // and tagged traffic brings replies from the internet into the capture
  const cdpCam = (name, caps) => ({ 'frame.protocols': 'eth:llc:cdp', 'eth.src': '00:09:18:00:00:01', 'cdp.deviceid': name, 'cdp.portid': 'eth0', 'cdp.platform': 'Linux', 'cdp.capabilities': caps });
  const ipFrom = ip => ({ 'frame.protocols': 'eth:ethertype:vlan:ethertype:ip:tcp', 'ip.src': ip });
  const remote = []; for (let i = 0; i < 40; i++) remote.push(ipFrom(`52.${96 + i}.57.10`));
  const local = ['10.0.30.11', '10.0.30.12', '10.0.30.13', '10.0.20.5', '10.0.60.1', '192.168.1.100', '10.0.190.2', '10.73.241.9', '10.0.40.7', '10.0.50.7'].map(ipFrom);
  V = await listen([cdpCam('EHQ 1st Floor S', '0x00000011'), cdpCam('axis-b8a44f7c96ef', '0x00000010')].concat(remote, local));
  sw = V.find(v => v.tag === 'SWITCH'); nb = V.filter(v => v.tag === 'NEIGHBOUR');
  const hosts = V.find(v => v.tag === 'HOSTS');
  check(sw && sw.kind === 'quiet', 'trunk: a camera announcing router + host over CDP is not the switch, got: ' + (sw && sw.title));
  check(nb.length === 1 && /^2 devices/.test(nb[0].title) && /EHQ 1st Floor S/.test(nb[0].detail) && /axis-b8a44f7c96ef/.test(nb[0].detail), 'trunk: both CDP neighbours listed, got: ' + (nb[0] && nb[0].title + ' — ' + nb[0].detail));
  check(hosts && /^3 hosts talking on 10\.0\.30\.x/.test(hosts.title), 'trunk: HOSTS title, got: ' + (hosts && hosts.title));
  check(hosts && !/52\./.test(hosts.detail), 'trunk: internet addresses are not subnets on this port: ' + (hosts && hosts.detail));
  check(hosts && (hosts.detail.match(/\.x \(/g) || []).length === 5 && /and 2 more subnets/.test(hosts.detail), 'trunk: the subnet list is cut at five, got: ' + (hosts && hosts.detail));

  if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
  console.log('RECON: cameras announcing through an unmanaged switch are neighbours, not the switch'); process.exit(0);
})();
