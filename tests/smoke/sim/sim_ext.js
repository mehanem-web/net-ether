// ═══ v7.1 additions to the simulated backend (loaded after sim.js) ═════════
(() => {
  if (window === window.top) return;
  const P = window.parent, W = window.__world, hud = window.hud;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const L = {};
  const emit = (ch, d) => (L[ch] || []).forEach(cb => { try { cb(d); } catch (e) { console.error(e); } });

  // ── adapters: 7.1 fields (ips[], link speed, noAddress) ──
  const baseGet = hud.getAdapters;
  const withIps = a => ({ ...a, ips: a.ip ? [{ ip: a.ip, subnet: a.subnet }, ...(a.name === W.adapters[0].name ? W.aliases.map(x => ({ ip: x.ip, subnet: x.subnet })) : [])] : [],
                          noAddress: a.connected && !a.ip, linkSpeed: a.connected ? '1 Gbps' : null, linkBps: a.connected ? 1e9 : 0 });
  hud.getAdapters = async () => (await baseGet()).map(withIps);
  const baseRefresh = hud.dhcp.refreshAdapters;
  hud.dhcp.refreshAdapters = async () => { const l = await baseRefresh(); return l; };

  // ── tools, wifi, adapter power, renew, WoL, notify ──
  hud.getTools = async () => ({ wireshark: true, tshark: true, tsharkVersion: '4.6.1', tsharkOk: true });
  hud.getWifi = async () => [{ name: 'Wi-Fi', status: 'Disconnected', adminUp: true }];
  hud.adapterSetEnabled = async () => ({ ok: true });
  hud.adapterRenew = async () => { await wait(1200); return { ok: true }; };
  hud.wolSend = async () => ({ ok: true });
  hud.wiresharkOpen = async () => ({ ok: true });
  hud.notifyHidden = () => {};
  hud.diagGet = async () => ({ state: { version: '7.1.0', packaged: true, elevated: true, integrity: 'High', host: 'FIELD-LT07', os: 'Windows_NT 10.0.26100 x64', ouiEntries: 57012, creds: {}, policy: {}, dhcp: null }, log: [] });

  // ── BLINK ──
  W.blinks = [];
  hud.portBlink = async ({ host, seconds }) => { W.blinks.push({ host, seconds, t: window.__vclock.now() }); P.__stage && P.__stage.note('blink', host, seconds); return { ok: true }; };

  // ── DISCOVER (multicast) — answers are scripted per scan set, released when the timeline says ──
  W.discSets = {};            // scanSet -> [result]
  W.discHold = 3000;          // ms the "listen" lasts
  hud.discoverRun = async () => { await wait(W.discHold); return { ok: true, results: JSON.parse(JSON.stringify(W.discSets[W.scanSet] || [])) }; };

  // ── REACH ──
  W.reach = [];
  hud.reachAdd = async ({ adapter, target }) => {
    await wait(1300);
    const alias = '169.254.' + target.split('.')[2] + '.' + (((+target.split('.')[3]) + 37) % 250 + 2);
    W.reach.push({ ip: alias, adapter, target }); W.aliases.push({ ip: alias, subnet: '255.255.0.0' });
    W.adapters[0].isDhcp = false;
    return { ok: true, alias, reused: false };
  };
  hud.reachList = async () => W.reach.map(r => ({ ip: r.ip, adapter: r.adapter }));
  hud.reachClear = async () => { await wait(800); const n = W.reach.length; W.aliases = W.aliases.filter(a => !W.reach.some(r => r.ip === a.ip)); W.reach = []; return { ok: true, removed: n, total: n }; };

  // ── RECON — evidence is fed by the timeline; verdicts come from the real engine ──
  function reconVerdicts(ev, opts = {}) {
    const silent = !!opts.silent;
    const V = [];
    const secs = Math.max(1, Math.round((ev.ms || 0) / 1000));
    const toNum = s => s.split('.').reduce((n, o) => ((n << 8) + (+o)) >>> 0, 0);
    const numToIp = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

    // switch identity
    const sw = ev.lldp || ev.cdp;
    if (sw) {
      const proto = ev.lldp && ev.cdp ? 'LLDP+CDP' : ev.lldp ? 'LLDP' : 'CDP';
      const name = sw.sysName || (ev.cdp && ev.cdp.sysName) || (ev.lldp && ev.lldp.chassis) || '?';
      const port = sw.port || (ev.cdp && ev.cdp.port) || sw.portDesc || '?';
      const vlan = sw.vlan || (ev.cdp && ev.cdp.vlan) || (ev.lldp && ev.lldp.vlan) || '';
      V.push({ kind: 'ok', tag: 'SWITCH', title: `${name} · port ${port}${vlan ? ' · VLAN ' + vlan : ''}`,
        detail: [proto, sw.portDesc && sw.portDesc !== port ? sw.portDesc : '', (ev.cdp && ev.cdp.platform) || '', sw.mgmtIp ? 'mgmt ' + sw.mgmtIp : ''].filter(Boolean).join(' · ') });
    } else {
      V.push({ kind: 'quiet', tag: 'SWITCH', title: 'No LLDP/CDP announcement', detail: secs < 60 ? `${secs} s so far — CDP needs up to 60 s` : 'LLDP/CDP is off on this port, or it is not a managed switch' });
    }

    // 802.1X
    if (ev.eapol.count) V.push({ kind: 'warn', tag: '802.1X', title: 'Port wants 802.1X', detail: `${ev.eapol.count} EAPOL frame${ev.eapol.count !== 1 ? 's' : ''} from the switch — a device without a certificate gets MAB or the guest VLAN, if anything` });
    else V.push({ kind: 'ok', tag: '802.1X', title: 'No 802.1X challenge', detail: `nothing asked for authentication in ${secs} s` });

    // spanning tree / trunk
    const pv = ev.stp.vlans || [];
    if (ev.stp.count) {
      const flavour = pv.length ? 'PVST+' : ev.stp.proto === '2' ? 'RSTP' : ev.stp.proto === '3' ? 'MSTP' : 'STP';
      V.push({ kind: 'info', tag: 'STP', title: `${flavour} running on this port`, detail: `root ${ev.stp.root || '?'} · don't hang a switch off it unguarded` });
    }
    const tags = ev.vlanTags || [];
    if (tags.length > 1 || pv.length > 1) {
      const list = [...new Set([...tags, ...pv])].sort((a, b) => a - b);
      V.push({ kind: 'warn', tag: 'TRUNK', title: `Trunk port — VLANs ${list.join(', ')}`, detail: 'tagged frames or per-VLAN BPDUs for more than one VLAN; an untagged device lands on the native VLAN' });
    } else if (tags.length === 1) {
      V.push({ kind: 'info', tag: 'VLAN', title: `Tagged frames for VLAN ${tags[0]}`, detail: 'this port carries one tagged VLAN alongside untagged' });
    }

    // DHCP
    const srv = ev.dhcp.servers || [];
    if (srv.length) {
      const traffic = ev.dhcp.offers ? `${ev.dhcp.offers} offer${ev.dhcp.offers !== 1 ? 's' : ''}${ev.dhcp.acks ? ', ' + ev.dhcp.acks + ' ack' + (ev.dhcp.acks !== 1 ? 's' : '') : ''}`
                    : `${ev.dhcp.acks} lease${ev.dhcp.acks !== 1 ? 's' : ''} renewed`;
      V.push({ kind: 'ok', tag: 'DHCP', title: `DHCP server${srv.length !== 1 ? 's' : ''} ${srv.join(', ')}`, detail: `${traffic}${ev.dhcp.routers.length ? ' · gateway ' + ev.dhcp.routers.join(', ') : ''}${ev.dhcp.masks.length ? ' · mask ' + ev.dhcp.masks[0] : ''}${ev.dhcp.dns.length ? ' · DNS ' + ev.dhcp.dns.join(', ') : ''}` });
    }
    else if (ev.dhcp.discovers) V.push({ kind: 'warn', tag: 'DHCP', title: 'Clients asking, nobody answering', detail: `${ev.dhcp.discovers} DISCOVER${ev.dhcp.discovers !== 1 ? 's' : ''} heard, no OFFER — static site or the server is down` });
    else if (silent) V.push({ kind: 'quiet', tag: 'DHCP', title: 'No DHCP heard — SILENT', detail: `nothing asked, so nothing answered; another client's renewal would show here. A STANDARD listen asks for a lease and finds the server` });
    else V.push({ kind: 'quiet', tag: 'DHCP', title: 'No DHCP traffic', detail: `${secs} s — static site, or quiet` });

    // subnets + hosts
    const ips = Object.keys(ev.ipCount || {});
    const by24 = {};
    ips.forEach(ip => { const k = ip.split('.').slice(0, 3).join('.'); (by24[k] ||= []).push(ip); });
    const nets = Object.entries(by24).sort((a, b) => b[1].length - a[1].length);
    if (nets.length) {
      const [top, hosts] = nets[0];
      V.push({ kind: 'ok', tag: 'HOSTS', title: `${hosts.length} host${hosts.length !== 1 ? 's' : ''} talking on ${top}.x`,
        detail: nets.slice(1).length ? 'also: ' + nets.slice(1).map(([k, h]) => `${k}.x (${h.length})`).join(', ') : 'one subnet heard' });
      // free-address suggestion in the dominant subnet
      const seen = new Set([...hosts, ...(ev.arpAsked || []).filter(ip => ip.startsWith(top + '.'))]);
      const mask = ev.dhcp.masks && ev.dhcp.masks[0] && /^255\.255\.255\./.test(ev.dhcp.masks[0]) ? ev.dhcp.masks[0] : '255.255.255.0';
      let pick = null;
      for (const last of [250, 249, 248, 247, 246, 245, 244, 243, 242, 241, 240, 239, 238, 237, 236, 235, 234, 233, 232, 231, 230, 229, 228, 227, 226, 225, 224, 223, 222, 221, 220]) {
        const ip = `${top}.${last}`; if (!seen.has(ip)) { pick = ip; break; }
      }
      const gw = (ev.dhcp.routers && ev.dhcp.routers[0]) || (seen.has(top + '.1') ? top + '.1' : '');
      if (pick) V.push({ kind: 'info', tag: 'ADDRESS', title: `${pick} looks free`, detail: `nobody used or asked for it in ${secs} s · mask ${mask}${gw ? ' · gateway ' + gw : ''} — APPLY still runs the duplicate check`, action: { ip: pick, subnet: mask, gateway: gw } });
    } else {
      V.push({ kind: 'quiet', tag: 'HOSTS', title: 'Nothing talking', detail: `${secs} s — empty port, wrong VLAN, or a very quiet segment` });
    }

    // names
    const names = ev.names || [];
    if (names.length) V.push({ kind: 'info', tag: 'NAMES', title: names.slice(0, 8).join(', ') + (names.length > 8 ? ` +${names.length - 8}` : ''), detail: 'NetBIOS / mDNS names heard' });
    // ntp
    if ((ev.ntp || []).length) V.push({ kind: 'info', tag: 'NTP', title: ev.ntp.join(', '), detail: 'time server(s) clients are asking' });

    return V;
  }

  hud.reconVerdicts = async (ev, opts) => reconVerdicts(ev, opts || {});
  hud.onReconUpdate = cb => { (L['recon-update'] = L['recon-update'] || []).push(cb); };
  const emptyEv = () => ({ packets: 0, ms: 0, lldp: null, cdp: null, eapol: { count: 0, from: [] }, stp: { count: 0, root: null, bridge: null, vlans: [], proto: null },
    vlanTags: [], arpSeen: {}, arpAsked: [], ipCount: {}, macs: [], dhcp: { servers: [], offers: 0, acks: 0, discovers: 0, routers: [], masks: [], dns: [] }, names: [], ntp: [] });
  let reconDone = null;
  W.recon = { ev: emptyEv(), t0: 0 };
  W.reconPush = (patch) => { const ev = W.recon.ev; patch(ev); ev.ms = Date.now() - W.recon.t0; emit('recon-update', JSON.parse(JSON.stringify(ev))); };
  W.reconFinish = () => { const ev = W.recon.ev; ev.ms = Date.now() - W.recon.t0; if (reconDone) { const r = reconDone; reconDone = null; r({ ok: true, evidence: JSON.parse(JSON.stringify(ev)), verdicts: reconVerdicts(ev, { silent: W.recon.silent }) }); } };
  hud.reconStart = ({ silent }) => new Promise(res => { W.recon = { ev: emptyEv(), t0: Date.now(), silent }; reconDone = res; });
  hud.reconStop = () => W.reconFinish();
})();
(() => { if (window === window.top) return; const P = window.parent;
  window.hud.setWidth = async ({ wide, width }) => { P.__stage && P.__stage.appSize(wide ? Math.max(width, 470) : 470, null); };
})();
(() => { if (window === window.top) return; const W = window.__world, hud = window.hud;
  // host:port targets — REFUSED when the port is shut (CLOSED in the UI), else the normal reply
  W.closed = new Set(); const basePing = hud.ping;
  hud.ping = async host => {
    const m = String(host).match(/^(.+):(\d{1,5})$/);
    if (!m) return basePing(host);
    if (W.closed.has(host)) { await new Promise(r => setTimeout(r, 40)); return { ok: false, err: 'REFUSED' }; }
    return basePing(m[1]);
  };
})();
