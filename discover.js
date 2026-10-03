'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// NET//ETHER — discover.js (v7.1.0)
//
// Two things the subnet sweep can't do:
//
//   discover()   — multicast discovery: WS-Discovery/ONVIF (UDP 3702), SSDP
//                  (UDP 1900) and mDNS (UDP 5353). Finds cameras and boxes that
//                  sit on a *different* subnet from the laptop — the 169.254.x.x
//                  camera straight out of the box, the device on the wrong VLAN —
//                  because the probe is multicast and the reply comes back
//                  unicast over the same wire regardless of IP. Three seconds.
//
//   lldpListen() — switch-port identity: listens for LLDP (every 30 s) and CDP
//                  (every 60 s) through tshark. Nothing is transmitted. Reports
//                  switch name, port, VLAN as they arrive; stops early once both
//                  have been heard, otherwise runs the full window.
//
// Pure dgram for discovery, execFile for tshark. No shell strings anywhere.
// ─────────────────────────────────────────────────────────────────────────────

const dgram  = require('dgram');
const crypto = require('crypto');

module.exports = function initDiscover(deps) {
  const { diagAdd, lookupVendor, execFile, execAsync, isValidIp } = deps;

  // ── helpers ────────────────────────────────────────────────
  const toNum = s => s.split('.').reduce((n, o) => ((n << 8) + (+o)) >>> 0, 0);
  const ipInPrefix24 = (ip, base) => ip.startsWith(base + '.');

  // arp -a across every interface — discovery replies come from any subnet
  async function arpAll() {
    const out = await execAsync('arp -a', { timeout: 3000 }).catch(() => '');
    const map = {};
    String(out).split('\n').forEach(line => {
      const m = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(dynamic|static)/i);
      if (!m) return;
      if (/^(ff-ff-ff-ff|01-00-5e|33-33)/i.test(m[2])) return;
      map[m[1]] = m[2].toLowerCase();
    });
    return map;
  }

  // ── WS-Discovery ───────────────────────────────────────────
  function wsdProbe(types) {
    const id = crypto.randomUUID();
    return `<?xml version="1.0" encoding="UTF-8"?>` +
      `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" ` +
      `xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" ` +
      `xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ` +
      `xmlns:dn="http://www.onvif.org/ver10/network/wsdl">` +
      `<e:Header><w:MessageID>uuid:${id}</w:MessageID>` +
      `<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>` +
      `<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>` +
      `<e:Body><d:Probe>${types ? `<d:Types>${types}</d:Types>` : ''}</d:Probe></e:Body></e:Envelope>`;
  }
  const tag = (xml, name) => {
    const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([^<]*)<`, 'i'));
    return m ? m[1].trim() : '';
  };
  function parseWsd(xml) {
    const xaddrs = tag(xml, 'XAddrs').split(/\s+/).filter(Boolean);
    const scopes = tag(xml, 'Scopes').split(/\s+/).filter(Boolean);
    const types  = tag(xml, 'Types');
    const scope  = key => {
      const s = scopes.find(x => new RegExp(`onvif\\.org/${key}/`, 'i').test(x));
      if (!s) return '';
      try { return decodeURIComponent(s.split(`/${key}/`)[1] || ''); } catch { return s.split(`/${key}/`)[1] || ''; }
    };
    const ips = [];
    xaddrs.forEach(u => { const m = u.match(/^https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})/i); if (m && !ips.includes(m[1])) ips.push(m[1]); });
    return {
      ips, xaddrs, types,
      name:     scope('name'),
      hardware: scope('hardware'),
      location: scope('location'),
      onvif:    /NetworkVideoTransmitter|onvif/i.test(types) || scopes.some(s => /onvif\.org/i.test(s)),
    };
  }

  // ── SSDP ───────────────────────────────────────────────────
  const SSDP_MSEARCH = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n';
  function parseSsdp(txt) {
    const h = {};
    txt.split(/\r?\n/).forEach(line => { const m = line.match(/^([A-Za-z-]+):\s*(.*)$/); if (m) h[m[1].toLowerCase()] = m[2].trim(); });
    return { location: h.location || '', server: h.server || '', usn: h.usn || '', st: h.st || '' };
  }

  // ── mDNS ───────────────────────────────────────────────────
  const MDNS_TYPES = [
    '_services._dns-sd._udp.local', '_http._tcp.local', '_https._tcp.local', '_rtsp._tcp.local',
    '_printer._tcp.local', '_ipp._tcp.local', '_workstation._tcp.local', '_smb._tcp.local',
    '_axis-video._tcp.local', '_googlecast._tcp.local', '_airplay._tcp.local', '_hap._tcp.local',
  ];
  function encodeName(name) {
    const parts = name.split('.').filter(Boolean);
    const bufs = parts.map(p => Buffer.concat([Buffer.from([p.length]), Buffer.from(p, 'utf8')]));
    return Buffer.concat([...bufs, Buffer.from([0])]);
  }
  function mdnsQuery() {
    const head = Buffer.alloc(12);
    head.writeUInt16BE(0x1234, 0);           // id (legacy unicast — any port ≠ 5353 gets a unicast reply)
    head.writeUInt16BE(0x0000, 2);           // flags: standard query
    head.writeUInt16BE(MDNS_TYPES.length, 4);
    const qs = MDNS_TYPES.map(t => Buffer.concat([encodeName(t), Buffer.from([0, 12, 0, 1])])); // PTR, IN
    return Buffer.concat([head, ...qs]);
  }
  function readName(buf, off, depth = 0) {
    const labels = [];
    let jumped = false, end = off;
    while (off < buf.length) {
      const len = buf[off];
      if (len === 0) { off++; break; }
      if ((len & 0xc0) === 0xc0) {
        if (depth > 8) break;
        const ptr = ((len & 0x3f) << 8) | buf[off + 1];
        if (!jumped) end = off + 2;
        jumped = true;
        const r = readName(buf, ptr, depth + 1);
        labels.push(...r.name.split('.').filter(Boolean));
        break;
      }
      labels.push(buf.slice(off + 1, off + 1 + len).toString('utf8'));
      off += 1 + len;
    }
    if (!jumped) end = off;
    return { name: labels.join('.'), end };
  }
  function parseMdns(buf) {
    const out = { ptr: [], srv: [], a: [], txt: [] };
    try {
      const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6), ns = buf.readUInt16BE(8), ar = buf.readUInt16BE(10);
      let off = 12;
      for (let i = 0; i < qd; i++) { const n = readName(buf, off); off = n.end + 4; }
      const total = an + ns + ar;
      for (let i = 0; i < total && off < buf.length; i++) {
        const n = readName(buf, off); off = n.end;
        const type = buf.readUInt16BE(off); const rdlen = buf.readUInt16BE(off + 8);
        const rd = off + 10; off = rd + rdlen;
        if (type === 12)      out.ptr.push({ name: n.name, target: readName(buf, rd).name });
        else if (type === 33) out.srv.push({ name: n.name, port: buf.readUInt16BE(rd + 4), target: readName(buf, rd + 6).name });
        else if (type === 1 && rdlen === 4) out.a.push({ name: n.name, ip: Array.from(buf.slice(rd, rd + 4)).join('.') });
        else if (type === 16) {
          const strs = []; let p = rd;
          while (p < rd + rdlen) { const l = buf[p]; strs.push(buf.slice(p + 1, p + 1 + l).toString('utf8')); p += 1 + l; }
          out.txt.push({ name: n.name, strs });
        }
      }
    } catch {}
    return out;
  }

  // ── discover() ─────────────────────────────────────────────
  // sources: list of local IPv4s to send from (one per address on the adapter —
  // a 169.254 alias, if present, lets APIPA cameras reply to something they can route to).
  async function discover({ sources, waitMs = 3000, baseIp = '' }) {
    const found = {};   // ip → record
    const rec = ip => (found[ip] ||= { ip, sources: [], name: '', model: '', vendorHint: '', hostname: '', xaddrs: [], services: [], onvif: false, ssdpServer: '', location: '' });
    const addSrc = (r, s) => { if (!r.sources.includes(s)) r.sources.push(s); };
    const socks = [];
    const t0 = Date.now();

    function openSock(bindIp, onMsg) {
      return new Promise(resolve => {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        s.on('error', () => { try { s.close(); } catch {} resolve(null); });
        s.on('message', onMsg);
        s.bind(0, bindIp, () => {
          try { s.setBroadcast(true); s.setMulticastTTL(1); s.setMulticastInterface(bindIp); } catch {}
          socks.push(s); resolve(s);
        });
      });
    }
    const send = (s, buf, port, host) => new Promise(r => { try { s.send(buf, 0, buf.length, port, host, () => r()); } catch { r(); } });

    for (const src of sources) {
      // WS-Discovery
      const wsd = await openSock(src, (msg, rinfo) => {
        const xml = msg.toString('utf8');
        if (!/ProbeMatch|Hello/i.test(xml)) return;
        const p = parseWsd(xml);
        const ips = p.ips.length ? p.ips : [rinfo.address];
        if (!ips.includes(rinfo.address)) ips.push(rinfo.address);
        ips.forEach(ip => {
          if (!isValidIp(ip)) return;
          const r = rec(ip); addSrc(r, p.onvif ? 'onvif' : 'wsd');
          if (p.name && !r.name) r.name = p.name;
          if (p.hardware && !r.model) r.model = p.hardware;
          if (p.location && !r.location) r.location = p.location;
          r.onvif = r.onvif || p.onvif;
          p.xaddrs.forEach(x => { if (!r.xaddrs.includes(x)) r.xaddrs.push(x); });
          if (ips.length > 1) r.altIps = ips.filter(x => x !== ip);
        });
      });
      if (wsd) {
        await send(wsd, Buffer.from(wsdProbe('dn:NetworkVideoTransmitter')), 3702, '239.255.255.250');
        await send(wsd, Buffer.from(wsdProbe('')), 3702, '239.255.255.250');
      }
      // SSDP
      const ssdp = await openSock(src, (msg, rinfo) => {
        const txt = msg.toString('utf8');
        if (!/^HTTP\/1\.1 200/i.test(txt) && !/^NOTIFY/i.test(txt)) return;
        const h = parseSsdp(txt);
        const r = rec(rinfo.address); addSrc(r, 'ssdp');
        if (h.server && !r.ssdpServer) r.ssdpServer = h.server;
        if (h.location) { const m = h.location.match(/^https?:\/\/[^/]+/i); if (m && !r.xaddrs.includes(m[0])) r.xaddrs.push(m[0]); }
      });
      if (ssdp) await send(ssdp, Buffer.from(SSDP_MSEARCH), 1900, '239.255.255.250');
      // mDNS (legacy unicast: we send from an ephemeral port, so answers come back unicast)
      const mdns = await openSock(src, (msg, rinfo) => {
        const d = parseMdns(msg);
        const r = rec(rinfo.address); addSrc(r, 'mdns');
        // hostname: an A record for our responder, else the SRV target
        const a = d.a.find(x => x.ip === rinfo.address) || d.a[0];
        const srv = d.srv[0];
        const host = (a && a.name) || (srv && srv.target) || '';
        if (host && !r.hostname) r.hostname = host.replace(/\.local\.?$/i, '');
        d.ptr.forEach(p => {
          if (/^_services\._dns-sd/i.test(p.name)) { const t = p.target.replace(/\.local\.?$/i, ''); if (!r.services.includes(t)) r.services.push(t); }
          else {
            const t = p.name.replace(/\.local\.?$/i, ''); if (!r.services.includes(t)) r.services.push(t);
            // instance label is often the friendly name: "Front Door Camera._rtsp._tcp"
            const inst = p.target.replace(/\._[a-z0-9-]+\._(tcp|udp)\.local\.?$/i, '').replace(/\\032/g, ' ');
            if (inst && !/^_/.test(inst) && !r.name) r.name = inst;
          }
        });
        d.txt.forEach(t => t.strs.forEach(s => {
          const m = s.match(/^(?:model|md|ty|product)=(.+)$/i);
          if (m && !r.model) r.model = m[1];
        }));
      });
      if (mdns) await send(mdns, mdnsQuery(), 5353, '224.0.0.251');
    }

    await new Promise(r => setTimeout(r, waitMs));
    socks.forEach(s => { try { s.close(); } catch {} });

    // MAC + vendor from the ARP cache — unicast replies left an entry for any subnet
    const arp = await arpAll();
    const results = Object.values(found).map(r => {
      const mac = arp[r.ip] || '';
      return { ...r, mac, vendor: mac ? (lookupVendor(mac) || '') : '', offSubnet: baseIp ? !ipInPrefix24(r.ip, baseIp) : false, linkLocal: /^169\.254\./.test(r.ip) };
    }).sort((a, b) => toNum(a.ip) - toNum(b.ip));

    const n = s => results.filter(r => r.sources.includes(s)).length;
    diagAdd({ kind: 'app', tag: 'discover', ok: true,
      note: `${results.length} device(s): ${n('onvif')} ONVIF, ${n('wsd')} WSD, ${n('ssdp')} SSDP, ${n('mdns')} mDNS · ${results.filter(r => r.offSubnet).length} off-subnet · ${Date.now() - t0}ms` });
    return results;
  }

  // ── LLDP / CDP via tshark ──────────────────────────────────
  // tshark -T json prints one key per line; we grep the lines rather than depend
  // on the exact nesting. Field names are checked against 4.6 — if a dissector
  // field is renamed in a later Wireshark, tshark exits non-zero and that shows
  // up as an ERROR entry with its stderr, never as a silent blank chip.
  let lldpProc = null;
  function lldpStop() { if (lldpProc) { try { lldpProc.kill(); } catch {} lldpProc = null; } }

  function lldpListen({ tshark, npf, durationS = 65, onUpdate }) {
    return new Promise(resolve => {
      lldpStop();
      const t0 = Date.now();
      const r = { lldp: null, cdp: null, err: null, packets: 0, ms: 0 };
      const args = [
        '-i', npf, '-l', '-n',
        '-a', `duration:${durationS}`,
        '-f', 'ether proto 0x88cc or ether dst 01:00:0c:cc:cc:cc',
        '-Y', 'lldp || cdp',
        '-T', 'json',
      ];
      let out = '', errTxt = '', cur = null, depth = 0;
      const KEYS = {
        'lldp.tlv.system.name':  (v, o) => o.sysName = v,
        'lldp.tlv.system.desc':  (v, o) => o.sysDesc = o.sysDesc || v,
        'lldp.port.desc':        (v, o) => o.portDesc = v,
        'lldp.chassis.id.mac':   (v, o) => o.chassis = v,
        'lldp.mgn.addr.ip4':     (v, o) => o.mgmtIp = v,
        'cdp.deviceid':          (v, o) => o.sysName = v,
        'cdp.portid':            (v, o) => o.port = v,
        'cdp.native_vlan':       (v, o) => o.vlan = v,
        'cdp.platform':          (v, o) => o.platform = v,
        'cdp.software_version':  (v, o) => o.sysDesc = o.sysDesc || v,
        'cdp.nrgyz.ip_address':  (v, o) => o.mgmtIp = o.mgmtIp || v,
      };
      const KEY_RX = /^\s*"([a-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"/i;

      function finishPacket(p) {
        if (!p) return;
        r.packets++;
        const o = p.obj;
        if (p.kind === 'lldp') {
          if (!r.lldp) r.lldp = {};
          Object.assign(r.lldp, Object.fromEntries(Object.entries(o).filter(([, v]) => v)));
        } else if (p.kind === 'cdp') {
          if (!r.cdp) r.cdp = {};
          Object.assign(r.cdp, Object.fromEntries(Object.entries(o).filter(([, v]) => v)));
        }
        r.ms = Date.now() - t0;
        if (onUpdate) try { onUpdate({ ...r }); } catch {}
        if (r.lldp && r.cdp) lldpStop();   // both heard — nothing more to learn
      }

      function onLine(line) {
        // packet boundaries: tshark's json has one top-level object per packet
        if (/^\s*\{\s*$/.test(line) && depth === 0) { cur = { kind: null, obj: {} }; }
        const bare = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');   // braces inside string values don't count
        depth += (bare.match(/\{/g) || []).length - (bare.match(/\}/g) || []).length;
        if (!cur) return;
        const m = line.match(KEY_RX);
        if (m) {
          const key = m[1], val = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          if (key === 'frame.protocols') cur.kind = /\bcdp\b/.test(val) ? 'cdp' : /\blldp\b/.test(val) ? 'lldp' : cur.kind;
          if (key in KEYS) KEYS[key](val, cur.obj);
          else if (/^lldp\.port\.id(?:\.[a-z0-9_]+)?$/.test(key)) cur.obj.port = cur.obj.port || val;
          else if (/^lldp\.ieee\.802_1\..*vlan.*id$/.test(key)) cur.obj.vlan = cur.obj.vlan || val;
          else if (/^lldp\.ieee\.802_1\.vlan\.name$/.test(key)) cur.obj.vlanName = cur.obj.vlanName || val;
        }
        if (depth <= 0 && cur) { finishPacket(cur); cur = null; depth = 0; }
      }

      try {
        lldpProc = execFile(tshark, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      } catch (err) {
        r.err = err.message; return resolve(r);
      }
      lldpProc.stdout.on('data', d => {
        out += d.toString('utf8');
        let i;
        while ((i = out.indexOf('\n')) >= 0) { onLine(out.slice(0, i)); out = out.slice(i + 1); }
      });
      lldpProc.stderr.on('data', d => { errTxt += d.toString('utf8'); });
      lldpProc.on('close', code => {
        lldpProc = null;
        if (out.trim()) { onLine(out); out = ''; }
        if (cur) finishPacket(cur);
        r.ms = Date.now() - t0;
        if (code && !r.lldp && !r.cdp) {
          const e = errTxt.trim().split('\n').filter(l => l.trim() && !/^Capturing on/i.test(l)).slice(-3).join(' · ');
          r.err = e || `tshark exited ${code}`;
        }
        resolve(r);
      });
    });
  }

  // ── RECON — listen before you talk ─────────────────────────
  // Same tshark plumbing as lldpListen, wider net: everything a port tells you
  // in the first minute. Evidence is accumulated per packet from the JSON key
  // lines; reconVerdicts() turns it into field-language verdicts. Nothing is
  // transmitted — the display filter is read-only and the capture is passive.
  const RECON_FILTER = 'lldp || cdp || eapol || stp || arp || dhcp || nbns || mdns || llmnr || ssdp || ntp || vlan || igmp';
  function emptyEvidence() {
    return {
      packets: 0, ms: 0, err: null,
      lldp: null, cdp: null,
      eapol: { count: 0, from: new Set() },
      stp:   { count: 0, root: null, bridge: null, vlans: new Set(), proto: null },
      vlanTags: new Set(),
      arpSeen: {}, arpAsked: new Set(),
      ipCount: {}, macs: new Set(),
      dhcp: { servers: new Set(), offers: 0, acks: 0, discovers: 0, routers: new Set(), masks: new Set(), dns: new Set() },
      names: new Set(), ntp: new Set(),
    };
  }
  function serializeEvidence(ev) {
    const arr = x => (x instanceof Set ? [...x] : x);
    return {
      packets: ev.packets, ms: ev.ms, err: ev.err, lldp: ev.lldp, cdp: ev.cdp,
      eapol: { count: ev.eapol.count, from: arr(ev.eapol.from) },
      stp: { count: ev.stp.count, root: ev.stp.root, bridge: ev.stp.bridge, vlans: arr(ev.stp.vlans), proto: ev.stp.proto },
      vlanTags: arr(ev.vlanTags), arpSeen: ev.arpSeen, arpAsked: arr(ev.arpAsked),
      ipCount: ev.ipCount, macs: arr(ev.macs),
      dhcp: { servers: arr(ev.dhcp.servers), offers: ev.dhcp.offers, acks: ev.dhcp.acks, discovers: ev.dhcp.discovers, routers: arr(ev.dhcp.routers), masks: arr(ev.dhcp.masks), dns: arr(ev.dhcp.dns) },
      names: arr(ev.names), ntp: arr(ev.ntp),
    };
  }

  let reconProc = null;
  function reconStop() { if (reconProc) { try { reconProc.kill(); } catch {} reconProc = null; } }

  function reconListen({ tshark, npf, durationS = 65, onUpdate }) {
    return new Promise(resolve => {
      reconStop();
      const t0 = Date.now();
      const ev = emptyEvidence();
      // Capture filter (BPF, in npcap) keeps everything else away from the dissectors:
      // LLDP, CDP (SNAP to the Cisco multicast), EAPOL, STP (LLC to the bridge group),
      // ARP, 802.1Q, IGMP, and the UDP ports we actually read.
      const RECON_BPF = 'ether proto 0x88cc or ether dst 01:00:0c:cc:cc:cc or ether proto 0x888e or ether dst 01:80:c2:00:00:00 ' +
        'or arp or vlan or igmp or (udp and (port 67 or port 68 or port 137 or port 5353 or port 5355 or port 1900 or port 123))';
      const args = ['-i', npf, '-l', '-n', '-a', `duration:${durationS}`, '-f', RECON_BPF, '-Y', RECON_FILTER, '-T', 'json'];
      let out = '', errTxt = '', cur = null, depth = 0, lastPush = 0;
      const KEY_RX = /^\s*"([a-z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"/i;
      const ipOk = v => /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v !== '0.0.0.0' && v !== '255.255.255.255';
      const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };

      function finishPacket(p) {
        if (!p) return;
        ev.packets++;
        const o = p.obj, proto = p.protos || '';
        if (/\blldp\b/.test(proto)) { ev.lldp = ev.lldp || {}; Object.assign(ev.lldp, Object.fromEntries(Object.entries(p.lldp).filter(([, v]) => v))); }
        if (/\bcdp\b/.test(proto))  { ev.cdp  = ev.cdp  || {}; Object.assign(ev.cdp,  Object.fromEntries(Object.entries(p.cdp).filter(([, v]) => v))); }
        if (/\beapol\b/.test(proto)) { ev.eapol.count++; if (o.ethSrc) ev.eapol.from.add(o.ethSrc); }
        if (/\bstp\b/.test(proto)) {
          ev.stp.count++;
          if (o.stpRoot && !ev.stp.root) ev.stp.root = o.stpRoot;
          if (o.stpBridge && !ev.stp.bridge) ev.stp.bridge = o.stpBridge;
          if (o.stpVlan) ev.stp.vlans.add(o.stpVlan);
          if (o.stpProto && !ev.stp.proto) ev.stp.proto = o.stpProto;
        }
        if (o.vlanId) ev.vlanTags.add(o.vlanId);
        if (o.ethSrc) ev.macs.add(o.ethSrc);
        if (/\barp\b/.test(proto)) {
          if (ipOk(o.arpSrcIp || '')) { ev.arpSeen[o.arpSrcIp] = o.arpSrcMac || ev.arpSeen[o.arpSrcIp] || ''; bump(ev.ipCount, o.arpSrcIp); }
          if (ipOk(o.arpDstIp || '') && o.arpOp === '1') ev.arpAsked.add(o.arpDstIp);
        } else if (ipOk(o.ipSrc || '')) bump(ev.ipCount, o.ipSrc);
        if (/\bdhcp\b/.test(proto)) {
          const t = o.dhcpType;
          if (t === '1') ev.dhcp.discovers++;
          if (t === '2') ev.dhcp.offers++;
          if (t === '5') ev.dhcp.acks++;
          if ((t === '2' || t === '5') && ipOk(o.dhcpServer || '')) ev.dhcp.servers.add(o.dhcpServer);
          if ((t === '2' || t === '5') && ipOk(o.dhcpRouter || '')) ev.dhcp.routers.add(o.dhcpRouter);
          if ((t === '2' || t === '5') && o.dhcpMask) ev.dhcp.masks.add(o.dhcpMask);
          if ((t === '2' || t === '5') && ipOk(o.dhcpDns || '')) ev.dhcp.dns.add(o.dhcpDns);
        }
        // NAMES: only what a host *says about itself* — NetBIOS registrations/responses and mDNS
        // answers. Queries ("who has WPAD?") and wildcards are what Windows asks, not who is here.
        if (o.nbName && (o.nbResponse === '1' || /^[5-7]$/.test(o.nbOpcode || ''))) {
          const n = o.nbName.replace(/(<[0-9a-f]{2}>)+$/i, '').replace(/[\x00-\x1f]+$/g, '').trim();
          if (n && !/^[*\x00]/.test(n) && !/^(WORKGROUP|__MSBROWSE__|MSHOME|WPAD|ISATAP|.*<GROUP>)$/i.test(n)) ev.names.add(n.toUpperCase());
        }
        if (o.dnsName && o.dnsResponse === '1' && /\.local$/i.test(o.dnsName) && !/^_/.test(o.dnsName)) {
          // "Johan-5080._dosvc._tcp.local" → "Johan-5080"; "axis-00408c.local" → "axis-00408c"
          const n = o.dnsName.replace(/\.local$/i, '').replace(/\._[a-z0-9-]+\._(tcp|udp)$/i, '').replace(/\._[a-z0-9-]+$/i, '').trim();
          if (n && !/^_/.test(n) && !/^(wpad|isatap)$/i.test(n)) ev.names.add(n);
        }
        if (/\bntp\b/.test(proto) && ipOk(o.ipDst || '') && o.ntpMode === '3') ev.ntp.add(o.ipDst);
        ev.ms = Date.now() - t0;
        if (onUpdate && Date.now() - lastPush > 1500) { lastPush = Date.now(); try { onUpdate(serializeEvidence(ev)); } catch {} }
      }

      function onLine(line) {
        if (/^\s*\{\s*$/.test(line) && depth === 0) cur = { protos: '', obj: {}, lldp: {}, cdp: {} };
        const bare = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        depth += (bare.match(/\{/g) || []).length - (bare.match(/\}/g) || []).length;
        if (!cur) return;
        const m = line.match(KEY_RX);
        if (m) {
          const key = m[1], val = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          const o = cur.obj;
          switch (key) {
            case 'frame.protocols': cur.protos = val; break;
            case 'eth.src': o.ethSrc = o.ethSrc || val.toLowerCase(); break;
            case 'vlan.id': o.vlanId = o.vlanId || val; break;
            case 'ip.src': o.ipSrc = o.ipSrc || val; break;
            case 'ip.dst': o.ipDst = o.ipDst || val; break;
            case 'arp.opcode': o.arpOp = o.arpOp || val; break;
            case 'arp.src.proto_ipv4': o.arpSrcIp = val; break;
            case 'arp.src.hw_mac': o.arpSrcMac = val.toLowerCase(); break;
            case 'arp.dst.proto_ipv4': o.arpDstIp = val; break;
            case 'dhcp.option.dhcp': o.dhcpType = o.dhcpType || val; break;
            case 'dhcp.option.dhcp_server_id': o.dhcpServer = val; break;
            case 'dhcp.option.router': o.dhcpRouter = o.dhcpRouter || val; break;
            case 'dhcp.option.subnet_mask': o.dhcpMask = val; break;
            case 'dhcp.option.domain_name_server': o.dhcpDns = o.dhcpDns || val; break;
            case 'stp.root.hw': o.stpRoot = val.toLowerCase(); break;
            case 'stp.bridge.hw': o.stpBridge = val.toLowerCase(); break;
            case 'stp.pvst.origvlan': o.stpVlan = val; break;
            case 'stp.protocol': o.stpProto = val; break;
            case 'nbns.name': o.nbName = o.nbName || val; break;
            case 'nbns.flags.opcode': o.nbOpcode = o.nbOpcode || val; break;
            case 'nbns.flags.response': o.nbResponse = o.nbResponse || val; break;
            case 'dns.flags.response': o.dnsResponse = o.dnsResponse || val; break;
            case 'dns.resp.name': o.dnsName = o.dnsName || val; break;
            case 'ntp.flags.mode': o.ntpMode = val; break;
            // LLDP / CDP — same keys as lldpListen
            case 'lldp.tlv.system.name': cur.lldp.sysName = val; break;
            case 'lldp.tlv.system.desc': cur.lldp.sysDesc = cur.lldp.sysDesc || val; break;
            case 'lldp.port.desc':       cur.lldp.portDesc = val; break;
            case 'lldp.chassis.id.mac':  cur.lldp.chassis = val; break;
            case 'lldp.mgn.addr.ip4':    cur.lldp.mgmtIp = val; break;
            case 'cdp.deviceid':         cur.cdp.sysName = val; break;
            case 'cdp.portid':           cur.cdp.port = val; break;
            case 'cdp.native_vlan':      cur.cdp.vlan = val; break;
            case 'cdp.platform':         cur.cdp.platform = val; break;
            case 'cdp.software_version': cur.cdp.sysDesc = cur.cdp.sysDesc || val; break;
            default:
              if (/^lldp\.port\.id(?:\.[a-z0-9_]+)?$/.test(key)) cur.lldp.port = cur.lldp.port || val;
              else if (/^lldp\.ieee\.802_1\..*vlan.*id$/.test(key)) cur.lldp.vlan = cur.lldp.vlan || val;
          }
        }
        if (depth <= 0 && cur) { finishPacket(cur); cur = null; depth = 0; }
      }

      try { reconProc = execFile(tshark, args, { windowsHide: true, maxBuffer: 256 * 1024 * 1024 }); }
      catch (err) { ev.err = err.message; return resolve(serializeEvidence(ev)); }
      reconProc.stdout.on('data', d => {
        out += d.toString('utf8');
        let i;
        while ((i = out.indexOf('\n')) >= 0) { onLine(out.slice(0, i)); out = out.slice(i + 1); }
      });
      reconProc.stderr.on('data', d => { errTxt += d.toString('utf8'); });
      reconProc.on('close', code => {
        reconProc = null;
        if (out.trim()) { onLine(out); out = ''; }
        if (cur) finishPacket(cur);
        ev.ms = Date.now() - t0;
        if (code && !ev.packets) {
          const e = errTxt.trim().split('\n').filter(l => l.trim() && !/^Capturing on/i.test(l)).slice(-3).join(' · ');
          ev.err = e || `tshark exited ${code}`;
        }
        resolve(serializeEvidence(ev));
      });
    });
  }

  // Evidence → verdicts. Pure, so it can be tested without a wire.
  // Each verdict: { kind: 'ok'|'warn'|'info'|'quiet', tag, title, detail, action? }
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

  return { discover, lldpListen, lldpStop, reconListen, reconStop, reconVerdicts, _parse: { parseWsd, parseSsdp, parseMdns } };   // _parse: test hook
};
