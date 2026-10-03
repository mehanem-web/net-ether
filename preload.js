const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hud', {
  // ── Window controls ──────────────────────────────────────
  close:        ()   => ipcRenderer.send('win-close'),
  quit:         ()   => ipcRenderer.send('win-quit'),
  hide:         ()   => ipcRenderer.send('win-hide'),
  // setSize now only sets height — width is user-controlled
  setSize:      (h)  => ipcRenderer.invoke('win-set-size', h),
  setOpacity:   (v)  => ipcRenderer.invoke('win-set-opacity', v),
  getOpacity:   ()   => ipcRenderer.invoke('win-get-opacity'),
  getMaxHeight: ()   => ipcRenderer.invoke('win-get-max-height'),
  setWidth:     (o)  => ipcRenderer.invoke('win-set-width', o),
  // user-resized event — renderer listens to back off autoResize
  onUserResized:(cb) => ipcRenderer.on('window-user-resized', cb),

  // ── Tray ─────────────────────────────────────────────────
  traySetMode:  (mode)    => ipcRenderer.send('tray-set-mode', mode),

  // ── Presets ──────────────────────────────────────────────
  loadPresets:  ()        => ipcRenderer.invoke('presets-load'),
  resetPresets: ()        => ipcRenderer.invoke('presets-reset'),
  savePresets:  (presets) => ipcRenderer.invoke('presets-save', presets),

  // ── Network config ───────────────────────────────────────
  applyConfig:      (cfg)     => ipcRenderer.invoke('apply-network-config', cfg),
  applyDhcp:        (adapter, tag) => ipcRenderer.invoke('apply-dhcp', { adapter, tag }),
  ping:             (host)    => ipcRenderer.invoke('ping-host', host),
  getAdapters:      ()        => ipcRenderer.invoke('get-adapters'),
  getCurrentIp:     (adapter) => ipcRenderer.invoke('get-current-ip', adapter),
  // v7.1.0: adapter tools
  getWifi:          ()        => ipcRenderer.invoke('get-wifi'),
  adapterSetEnabled:(adapter, enabled) => ipcRenderer.invoke('adapter-set-enabled', { adapter, enabled }),
  adapterRenew:     (adapter) => ipcRenderer.invoke('adapter-renew', adapter),
  getTools:         ()        => ipcRenderer.invoke('get-tools'),
  wiresharkOpen:    (opts)    => ipcRenderer.invoke('wireshark-open', opts),
  wolSend:          (mac)     => ipcRenderer.invoke('wol-send', mac),
  notifyHidden:     (opts)    => ipcRenderer.send('notify-hidden', opts),
  // v7.1.0: discovery, LLDP/CDP, link-local REACH
  discoverRun:      (opts)    => ipcRenderer.invoke('discover-run', opts),
  reconStart:       (opts)    => ipcRenderer.invoke('recon-start', opts),
  reconStop:        ()        => ipcRenderer.send('recon-stop'),
  onReconUpdate:    (cb)      => ipcRenderer.on('recon-update', (_, d) => cb(d)),
  reconVerdicts:    (ev, opts) => ipcRenderer.invoke('recon-verdicts', ev, opts),
  reachAdd:         (opts)    => ipcRenderer.invoke('reach-add', opts),
  reachList:        ()        => ipcRenderer.invoke('reach-list'),
  reachClear:       ()        => ipcRenderer.invoke('reach-clear'),
  portBlink:        (opts)    => ipcRenderer.invoke('port-blink', opts),
  getAdapterConfig: (adapter) => ipcRenderer.invoke('get-adapter-config', adapter),

  // ── Snapshot / revert ────────────────────────────────────
  getFullSnapshot:  (adapter) => ipcRenderer.invoke('get-full-snapshot', adapter),
  getSavedSnapshot: ()        => ipcRenderer.invoke('get-saved-snapshot'),

  // ── MTU ──────────────────────────────────────────────────
  getAdapterMtu: (adapter)       => ipcRenderer.invoke('get-adapter-mtu', adapter),
  fixMtu:        (adapter, mtu)  => ipcRenderer.invoke('fix-mtu', { adapter, mtu }),

  // ── Duplicate IP check ───────────────────────────────────
  checkDuplicateIp: (ip) => ipcRenderer.invoke('check-duplicate-ip', ip),

  // ── Subnet scanner — streaming ───────────────────────────
  scanStart:    (opts)    => ipcRenderer.send('scan-start', opts),
  scanStop:     ()        => ipcRenderer.send('scan-stop'),
  arpSweep:     (opts)    => ipcRenderer.invoke('arp-sweep', opts),
  resolveHosts: (ips)     => ipcRenderer.invoke('resolve-hosts', ips),
  onScanResult:   (cb)    => ipcRenderer.on('scan-result',   (_, d) => cb(d)),
  onScanDone:     (cb)    => ipcRenderer.on('scan-done',     (_, d) => cb(d)),
  onScanEnrich:   (cb)    => ipcRenderer.on('scan-enrich',   (_, d) => cb(d)),
  onScanProgress: (cb)    => ipcRenderer.on('scan-progress', (_, d) => cb(d)),
  offScan:        ()      => {
    ipcRenderer.removeAllListeners('scan-result');
    ipcRenderer.removeAllListeners('scan-done');
    ipcRenderer.removeAllListeners('scan-enrich');
    ipcRenderer.removeAllListeners('scan-progress');
  },

  // ── Port probe — streaming ───────────────────────────────
  portProbeStart:    (host, ports) => ipcRenderer.send('port-probe-start', { host, ports }),
  onPortProbeResult: (cb)          => ipcRenderer.on('port-probe-result', (_, d) => cb(d)),
  offPortProbe:      ()            => ipcRenderer.removeAllListeners('port-probe-result'),

  // ── MAC vendor lookup ────────────────────────────────────
  macLookupOnline: (mac) => ipcRenderer.invoke('mac-lookup-online', mac),
  getPolicy:       ()    => ipcRenderer.invoke('get-policy'),

  // ── Traceroute — streaming ───────────────────────────────
  tracertStart:  (host) => ipcRenderer.send('tracert-start', { host }),
  tracertStop:   ()     => ipcRenderer.send('tracert-stop'),
  onTracertHop:  (cb)   => ipcRenderer.on('tracert-hop',  (_, d) => cb(d)),
  onTracertDone: (cb)   => ipcRenderer.on('tracert-done', ()    => cb()),
  offTracert:    ()     => {
    ipcRenderer.removeAllListeners('tracert-hop');
    ipcRenderer.removeAllListeners('tracert-done');
  },

  // ── IP aliases ───────────────────────────────────────────
  getAliases:    (adapter) => ipcRenderer.invoke('get-aliases', adapter),
  aliasAdd:      (opts)    => ipcRenderer.invoke('alias-add', opts),
  aliasRemove:   (opts)    => ipcRenderer.invoke('alias-remove', opts),
  aliasBuildCmd: (opts)    => ipcRenderer.invoke('alias-build-cmd', opts),
  checkActiveAliases: ()   => ipcRenderer.invoke('check-active-aliases'),

  // ── SCAN library + SITES knowledge base ─────────────────
  sitesLoad:   ()        => ipcRenderer.invoke('sites-load'),
  sitesSave:   (sites)   => ipcRenderer.invoke('sites-save', sites),
  intelLoad:   ()        => ipcRenderer.invoke('sitekb-load'),
  intelSave:   (intel)   => ipcRenderer.invoke('sitekb-save', intel),
  intelBackup: (label)   => ipcRenderer.invoke('sitekb-backup', label),
  exportExcel: (data)    => ipcRenderer.invoke('export-excel', data),
  exportJson:  (data)    => ipcRenderer.invoke('export-json', data),
  importJson:  ()        => ipcRenderer.invoke('import-json'),

  // ── External / clipboard ─────────────────────────────────
  openExternal:  (url) => ipcRenderer.send('open-external', url),
  openGuide:     ()    => ipcRenderer.invoke('open-guide'),
  openRdp:       (ip)  => ipcRenderer.send('open-external', `rdp://${ip}`),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),

  // ── Launch state restore ──────────────────────────────────
  getLaunchSnapshot:  ()            => ipcRenderer.invoke('get-launch-snapshot'),
  getLaunchDeltas:    ()            => ipcRenderer.invoke('get-launch-deltas'),
  restoreLaunchState: (adapters)    => ipcRenderer.invoke('restore-launch-state', adapters),

  // ── Diagnostics overlay ───────────────────────────────────
  diagGet:     ()   => ipcRenderer.invoke('diag-get'),
  diagClear:   ()   => ipcRenderer.invoke('diag-clear'),
  onDiagEntry: (cb) => ipcRenderer.on('diag-entry', (_, d) => cb(d)),

  // ── DHCP server engine (dhcp.js) — fixed, named surface ──
  dhcp: {
    engineStart:      ()          => ipcRenderer.invoke('dhcp-engine-start'),
    engineStop:       ()          => ipcRenderer.invoke('dhcp-engine-stop'),
    getState:         ()          => ipcRenderer.invoke('dhcp-get-state'),
    refreshAdapters:  ()          => ipcRenderer.invoke('dhcp-refresh-adapters'),
    getAdapterConfig: (name, ip)  => ipcRenderer.invoke('dhcp-get-adapter-config', name, ip),
    validateConfig:   (cfg)       => ipcRenderer.invoke('dhcp-validate-config', cfg),
    setPreview:       (cfg)       => ipcRenderer.invoke('dhcp-set-preview', cfg),
    saveConfig:       (cfg)       => ipcRenderer.invoke('dhcp-save-config', cfg),
    serveAll:         (opts)      => ipcRenderer.invoke('dhcp-serve-all', opts),
    serveDevice:      (mac, opts) => ipcRenderer.invoke('dhcp-serve-device', mac, opts),
    unserveDevice:    (mac)       => ipcRenderer.invoke('dhcp-unserve-device', mac),
    stopServing:      ()          => ipcRenderer.invoke('dhcp-stop-serving'),
    quickStart:       ()          => ipcRenderer.invoke('dhcp-quick-start'),
    staticAssistApply:  (adapter) => ipcRenderer.invoke('dhcp-static-assist-apply', adapter),
    staticAssistRevert: ()        => ipcRenderer.invoke('dhcp-static-assist-revert'),
    staticAssistStatus: ()        => ipcRenderer.invoke('dhcp-static-assist-status'),
    probe:            ()          => ipcRenderer.invoke('dhcp-probe'),
    serveGate:        ()          => ipcRenderer.invoke('dhcp-serve-gate'),
    selfTest:         (adapter)   => ipcRenderer.invoke('dhcp-self-test', adapter),
    foreignServers:   ()          => ipcRenderer.invoke('dhcp-foreign'),
    profilesList:     ()          => ipcRenderer.invoke('dhcp-profiles-list'),
    profilesSave:     (name, cfg) => ipcRenderer.invoke('dhcp-profiles-save', name, cfg),
    profilesLoad:     (name)      => ipcRenderer.invoke('dhcp-profiles-load', name),
    profilesDelete:   (name)      => ipcRenderer.invoke('dhcp-profiles-delete', name),
    setReservation:   (mac, ip)   => ipcRenderer.invoke('dhcp-reservation-set', mac, ip),
    clearReservation: (mac)       => ipcRenderer.invoke('dhcp-reservation-clear', mac),
    setIdleMinutes:   (n)         => ipcRenderer.invoke('dhcp-set-idle', n),
    releaseAll:       ()          => ipcRenderer.invoke('dhcp-release-all'),
    revoke:           (mac)       => ipcRenderer.invoke('dhcp-revoke', mac),
    exportCsv:        ()          => ipcRenderer.invoke('dhcp-export-csv'),
    exportLog:        ()          => ipcRenderer.invoke('dhcp-export-log'),
    // events (one listener per channel — safe across re-init)
    onMode:          (cb) => { ipcRenderer.removeAllListeners('dhcp-mode');           ipcRenderer.on('dhcp-mode',           (_, d) => cb(d)); },
    onDevices:       (cb) => { ipcRenderer.removeAllListeners('dhcp-devices');        ipcRenderer.on('dhcp-devices',        (_, d) => cb(d)); },
    onLease:         (cb) => { ipcRenderer.removeAllListeners('dhcp-lease');          ipcRenderer.on('dhcp-lease',          (_, d) => cb(d)); },
    onRogue:         (cb) => { ipcRenderer.removeAllListeners('dhcp-rogue');          ipcRenderer.on('dhcp-rogue',          (_, d) => cb(d)); },
    onPort67:        (cb) => { ipcRenderer.removeAllListeners('dhcp-port67');         ipcRenderer.on('dhcp-port67',         (_, d) => cb(d)); },
    onAutoStopped:   (cb) => { ipcRenderer.removeAllListeners('dhcp-auto-stopped');   ipcRenderer.on('dhcp-auto-stopped',   (_, d) => cb(d)); },
    onStaticPending: (cb) => { ipcRenderer.removeAllListeners('dhcp-static-pending'); ipcRenderer.on('dhcp-static-pending', (_, d) => cb(d)); },
    onLog:           (cb) => { ipcRenderer.removeAllListeners('dhcp-log');            ipcRenderer.on('dhcp-log',            (_, d) => cb(d)); },
    onAdapters:      (cb) => { ipcRenderer.removeAllListeners('dhcp-adapters');       ipcRenderer.on('dhcp-adapters',       (_, d) => cb(d)); },
  },

});
