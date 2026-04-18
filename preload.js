const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hud', {
  // ── Window controls ──────────────────────────────────────
  close:        ()   => ipcRenderer.send('win-close'),
  quit:         ()   => ipcRenderer.send('win-quit'),
  minimize:     ()   => ipcRenderer.send('win-minimize'),
  hide:         ()   => ipcRenderer.send('win-hide'),
  // setSize now only sets height — width is user-controlled
  setSize:      (h)  => ipcRenderer.invoke('win-set-size', h),
  setOpacity:   (v)  => ipcRenderer.invoke('win-set-opacity', v),
  getOpacity:   ()   => ipcRenderer.invoke('win-get-opacity'),
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
  applyDhcp:        (adapter) => ipcRenderer.invoke('apply-dhcp', { adapter }),
  ping:             (host)    => ipcRenderer.invoke('ping-host', host),
  getAdapters:      ()        => ipcRenderer.invoke('get-adapters'),
  getCurrentIp:     (adapter) => ipcRenderer.invoke('get-current-ip', adapter),
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

  // ── Site / Intel database ────────────────────────────────
  sitesLoad:   ()        => ipcRenderer.invoke('sites-load'),
  sitesSave:   (sites)   => ipcRenderer.invoke('sites-save', sites),
  intelLoad:   ()        => ipcRenderer.invoke('intel-load'),
  intelSave:   (intel)   => ipcRenderer.invoke('intel-save', intel),
  exportExcel: (data)    => ipcRenderer.invoke('export-excel', data),

  // ── External / clipboard ─────────────────────────────────
  openExternal:  (url) => ipcRenderer.send('open-external', url),
  openGuide:     ()    => ipcRenderer.invoke('open-guide'),
  openRdp:       (ip)  => ipcRenderer.send('open-external', `rdp://${ip}`),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),

  // ── Launch state restore ──────────────────────────────────
  getLaunchSnapshot:  ()            => ipcRenderer.invoke('get-launch-snapshot'),
  getLaunchDeltas:    ()            => ipcRenderer.invoke('get-launch-deltas'),
  restoreLaunchState: (adapters)    => ipcRenderer.invoke('restore-launch-state', adapters),

});
