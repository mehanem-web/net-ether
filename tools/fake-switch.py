#!/usr/bin/env python3
"""
NET//ETHER test tool — a fake managed switch port for RECON.

Sends, over a direct cable, what a managed port on a busy network would send:
LLDP and CDP announcements, spanning tree, an 802.1X prompt, a DHCP server
answering a client, two tagged VLANs, a few hosts, two names and an NTP client.
Every value is made up, so RECON's cards can be checked against the list this
script prints at the end.

  python fake-switch.py                    list the network cards
  python fake-switch.py "Ethernet"         send on that card for 75 seconds
  python fake-switch.py "Ethernet" 120     ...for 120 seconds
  python fake-switch.py --pcap out.pcap    write the frames to a file instead

Needs:  pip install scapy     and Npcap (installed with Wireshark).
Run it from an administrator PowerShell. Start RECON on the other machine
first, then start this.
"""
import sys, time

from scapy.all import (Ether, Dot3, LLC, SNAP, STP, Dot1Q, ARP, IP, UDP, BOOTP, DHCP, EAPOL, EAP,
                       NTP, DNS, DNSRR, Raw, conf, sendp, wrpcap)
from scapy.contrib.lldp import (LLDPDUChassisID, LLDPDUPortID, LLDPDUTimeToLive, LLDPDUPortDescription,
                                LLDPDUSystemName, LLDPDUSystemDescription, LLDPDUSystemCapabilities,
                                LLDPDUManagementAddress, LLDPDUGenericOrganisationSpecific, LLDPDUEndOfLLDPDU)
from scapy.contrib.cdp import (CDPv2_HDR, CDPMsgDeviceID, CDPMsgSoftwareVersion, CDPMsgPlatform, CDPMsgPortID,
                               CDPMsgNativeVLAN, CDPMsgAddr, CDPAddrRecordIPv4, CDPMsgCapabilities)

SW_MAC   = '02:5c:00:00:00:01'          # the "switch"
SW_NAME  = 'FAKE-SW-01'
SW_PORT  = 'Gi1/0/12'
SW_MGMT  = '10.99.99.2'
VLAN     = 110                          # the port's own (untagged) VLAN
TAGGED   = [20, 30]                     # tagged VLANs also on the port
DHCP_SRV = '10.99.99.254'
DHCP_MAC = '02:5c:00:00:00:fe'
NTP_SRV  = '10.99.99.250'
HOSTS    = [('02:5c:00:00:01:%02x' % i, '10.99.99.%d' % (20 + i)) for i in range(1, 6)]
CLIENT   = '02:5c:00:00:02:01'          # a device asking for an address
BCAST    = 'ff:ff:ff:ff:ff:ff'


def mac_bytes(m):
    return bytes(int(x, 16) for x in m.split(':'))


def nbns_registration(name, ip):
    """A NetBIOS name registration, built by hand so it does not depend on the scapy version."""
    padded = name.upper().ljust(15) + '\x00'
    enc = ''.join(chr(0x41 + (ord(c) >> 4)) + chr(0x41 + (ord(c) & 0x0f)) for c in padded).encode()
    qname = b'\x20' + enc + b'\x00'
    head = b'\x5c\x01' + b'\x29\x10' + b'\x00\x01\x00\x00\x00\x00\x00\x01'      # id, registration+broadcast, 1 question, 1 additional
    return (head + qname + b'\x00\x20\x00\x01'
            + b'\xc0\x0c\x00\x20\x00\x01' + (300000).to_bytes(4, 'big') + b'\x00\x06\x00\x00'
            + bytes(int(x) for x in ip.split('.')))


def frames():
    f = []

    # LLDP — who the switch is, which port, which VLAN
    f.append(Ether(dst='01:80:c2:00:00:0e', src=SW_MAC, type=0x88cc)
             / LLDPDUChassisID(subtype=4, id=mac_bytes(SW_MAC))
             / LLDPDUPortID(subtype=5, id=SW_PORT.encode())
             / LLDPDUTimeToLive(ttl=120)
             / LLDPDUPortDescription(description='GigabitEthernet1/0/12')
             / LLDPDUSystemName(system_name=SW_NAME)
             / LLDPDUSystemDescription(description='NET//ETHER fake switch, test software 1.0')
             / LLDPDUSystemCapabilities(mac_bridge_available=1, mac_bridge_enabled=1)
             / LLDPDUManagementAddress(management_address_subtype=1,
                                       management_address=bytes(int(x) for x in SW_MGMT.split('.')),
                                       interface_numbering_subtype=2, interface_number=12)
             / LLDPDUGenericOrganisationSpecific(org_code=0x0080c2, subtype=1, data=VLAN.to_bytes(2, 'big'))
             / LLDPDUEndOfLLDPDU())

    # CDP — the same facts, the Cisco way
    f.append(Dot3(dst='01:00:0c:cc:cc:cc', src=SW_MAC) / LLC(dsap=0xaa, ssap=0xaa, ctrl=3)
             / SNAP(OUI=0x00000c, code=0x2000)
             / CDPv2_HDR(vers=2, ttl=180)
             / CDPMsgDeviceID(val=SW_NAME.encode())
             / CDPMsgSoftwareVersion(val=b'NET//ETHER fake switch, test software 1.0')
             / CDPMsgPlatform(val=b'FAKE-3850')
             / CDPMsgAddr(naddr=1, addr=CDPAddrRecordIPv4(addr=SW_MGMT))
             / CDPMsgPortID(iface=SW_PORT.encode())
             / CDPMsgCapabilities(cap=0x28)
             / CDPMsgNativeVLAN(vlan=VLAN))

    # Spanning tree (rapid)
    f.append(Dot3(dst='01:80:c2:00:00:00', src=SW_MAC) / LLC(dsap=0x42, ssap=0x42, ctrl=3)
             / STP(version=2, bpdutype=2, bpduflags=0x3c, rootid=32768, rootmac='02:5c:00:00:00:aa',
                   pathcost=4, bridgeid=32768, bridgemac=SW_MAC, portid=0x800c, age=1, maxage=20,
                   hellotime=2, fwddelay=15) / Raw(b'\x00'))

    # 802.1X — the port asking "who are you?"
    f.append(Ether(dst='01:80:c2:00:00:03', src=SW_MAC, type=0x888e) / EAPOL(version=2, type=0)
             / EAP(code=1, id=1, type=1))

    # DHCP — a device asks, a server answers
    xid = 0x5c5c0001
    chaddr = mac_bytes(CLIENT) + b'\x00' * 10
    f.append(Ether(dst=BCAST, src=CLIENT) / IP(src='0.0.0.0', dst='255.255.255.255') / UDP(sport=68, dport=67)
             / BOOTP(op=1, xid=xid, chaddr=chaddr, flags=0x8000)
             / DHCP(options=[('message-type', 'discover'), ('hostname', 'FAKE-CAM-9'), 'end']))
    for kind in ('offer', 'ack'):
        f.append(Ether(dst=BCAST, src=DHCP_MAC) / IP(src=DHCP_SRV, dst='255.255.255.255') / UDP(sport=67, dport=68)
                 / BOOTP(op=2, xid=xid, yiaddr='10.99.99.150', siaddr=DHCP_SRV, chaddr=chaddr, flags=0x8000)
                 / DHCP(options=[('message-type', kind), ('server_id', DHCP_SRV), ('subnet_mask', '255.255.255.0'),
                                 ('router', DHCP_SRV), ('name_server', DHCP_SRV), ('lease_time', 3600), 'end']))
        if kind == 'offer':
            f.append(Ether(dst=BCAST, src=CLIENT) / IP(src='0.0.0.0', dst='255.255.255.255') / UDP(sport=68, dport=67)
                     / BOOTP(op=1, xid=xid, chaddr=chaddr, flags=0x8000)
                     / DHCP(options=[('message-type', 'request'), ('requested_addr', '10.99.99.150'),
                                     ('server_id', DHCP_SRV), ('hostname', 'FAKE-CAM-9'), 'end']))

    # Tagged VLANs — what a trunk carries
    for i, v in enumerate(TAGGED):
        f.append(Ether(dst=BCAST, src='02:5c:00:00:03:%02x' % v) / Dot1Q(vlan=v)
                 / ARP(op=1, hwsrc='02:5c:00:00:03:%02x' % v, psrc='10.%d.0.10' % v, pdst='10.%d.0.1' % v))

    # A few hosts talking (untagged)
    for mac, ip in HOSTS:
        f.append(Ether(dst=BCAST, src=mac) / ARP(op=1, hwsrc=mac, psrc=ip, pdst=DHCP_SRV))

    # Names: what hosts say about themselves (NetBIOS registration, mDNS answer)
    m, ip = HOSTS[0]
    f.append(Ether(dst=BCAST, src=m) / IP(src=ip, dst='10.99.99.255') / UDP(sport=137, dport=137)
             / Raw(nbns_registration('FAKE-NVR', ip)))
    m, ip = HOSTS[1]
    f.append(Ether(dst='01:00:5e:00:00:fb', src=m) / IP(src=ip, dst='224.0.0.251', ttl=255) / UDP(sport=5353, dport=5353)
             / DNS(qr=1, aa=1, rd=0, qd=None, an=DNSRR(rrname='fake-cam.local', type='A', ttl=120, rdata=ip)))

    # A device asking the time
    m, ip = HOSTS[3]
    f.append(Ether(dst=BCAST, src=m) / IP(src=ip, dst=NTP_SRV) / UDP(sport=123, dport=123) / NTP(version=4, mode=3))
    return f


EXPECT = f"""
What RECON should show (all of it made up by this script):
  SWITCH   {SW_NAME} · port {SW_PORT} · VLAN {VLAN}
  802.1X   Port wants 802.1X
  STP      RSTP running on this port   (dev.2 and older say plain STP — fixed in dev.3)
  TRUNK    VLANs {', '.join(str(v) for v in TAGGED)}   (may be missing: some network cards strip VLAN tags)
  DHCP     DHCP server {DHCP_SRV}
  HOSTS    hosts talking on 10.99.99.x
  ADDRESS  10.99.99.249 looks free   (not .250: that is the time server; dev.2 and older say .250)
  NAMES    FAKE-NVR, fake-cam
  NTP      {NTP_SRV}
"""


def main():
    a = sys.argv[1:]
    if a and a[0] == '--pcap':
        out = a[1] if len(a) > 1 else 'fake-switch.pcap'
        pk = frames()
        wrpcap(out, pk * 3)
        print(f'{len(pk) * 3} frames written to {out}')
        print(EXPECT)
        return
    if not a:
        print(__doc__)
        print('Network cards on this PC:\n')
        print(conf.ifaces)
        return
    iface = a[0]
    secs = int(a[1]) if len(a) > 1 else 75
    if iface not in [i.name for i in conf.ifaces.values()] and iface not in [i.description for i in conf.ifaces.values()]:
        print(f'No card called "{iface}". Run with no arguments to list them.')
        sys.exit(1)
    pk = frames()
    print(f'Fake switch {SW_NAME} on "{iface}" for {secs} s — {len(pk)} frames every 5 s. Ctrl+C stops it.')
    end = time.time() + secs
    n = 0
    try:
        while time.time() < end:
            sendp(pk, iface=iface, verbose=False, inter=0.02)
            n += 1
            print(f'  round {n} sent ({int(end - time.time())} s left)')
            time.sleep(max(0, min(5, end - time.time())))
    except KeyboardInterrupt:
        print('  stopped')
    print(EXPECT)


if __name__ == '__main__':
    main()
