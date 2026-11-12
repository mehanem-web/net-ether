#!/usr/bin/env node
// NET//ETHER — UI smoke test.
//
// Opens the real window (src/index.html) in a headless browser against a pretend backend
// (tests/smoke/sim — the same fake network the tutorial film is made with), clicks through
// every tab and the main flows, and fails if anything throws, logs an error, or a screen
// doesn't show what it should. It runs on a virtual clock, so a 65-second RECON listen
// takes a moment.
//
// It proves the SCREEN works. It cannot prove Windows applied an address or a camera got
// one — that is what tools/fake-cameras.js, tools/fake-switch.py and real gear are for.
//
//   npm i --no-save playwright && npx playwright install chromium     (once)
//   node tests/smoke/smoke.js            add --shots to keep a picture of every step
//
// PW_CHROME=<path to chrome> uses an existing browser instead of Playwright's download.

const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require(process.env.PW_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = process.argv.includes('--shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const VISIT = [
  { ip: '10.20.30.1',   mac: '74:83:c2:1e:05:a0', vendor: 'Ubiquiti', hostname: 'udm-gw',        ports: [80, 443, 22],  ms: 1 },
  { ip: '10.20.30.10',  mac: 'b0:7b:25:33:9e:41', vendor: 'Dell',     hostname: 'SC-ARCHIVER01', ports: [80, 443, 3389], ms: 1, nbt: true },
  { ip: '10.20.30.20',  mac: '70:0f:6a:c4:12:88', vendor: 'Cisco',    hostname: 'core-sw01',     ports: [22, 443],      ms: 1 },
  { ip: '10.20.30.24',  mac: 'ac:cc:8e:41:0b:c3', vendor: 'Axis',     hostname: 'axis-accc8e410bc3', ports: [80, 443, 554], ms: 3 },
  { ip: '10.20.30.57',  mac: '9c:eb:e8:41:7a:02', vendor: 'Realtek',  hostname: 'FIELD-LT07',    ports: [],             ms: 0 },
  { ip: '10.20.30.100', mac: '00:07:5f:b2:41:0c', vendor: 'Bosch',    hostname: '',              ports: [80, 443, 554], ms: 4 },
  { ip: '10.20.30.101', mac: '00:07:5f:b2:41:17', vendor: 'Bosch',    hostname: '',              ports: [80, 443, 554], ms: 4 },
];

(async () => {
  // a tiny static server — file:// frames can't see each other
  const srv = http.createServer((q, r) => {
    const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  const errors = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console error: ' + m.text()); });
  for (const f of ['sim.js', 'sim_ext.js', 'sim_731.js']) await page.addInitScript({ path: path.join(__dirname, 'sim', f) });
  await page.goto(base + '/tests/smoke/host.html');
  const app = page.frame({ url: /src\/index\.html/ });
  if (!app) throw new Error('the app frame did not load');

  // ── helpers ──
  const tick = async (ms, step = 100) => { for (let t = 0; t < ms; t += step) await app.evaluate(s => window.__vclock.tick(s), step); };
  const visible = sel => app.evaluate(s => { const e = document.querySelector(s); return !!(e && e.getClientRects().length); }, sel);
  const text = sel => app.evaluate(s => { const e = document.querySelector(s); return e ? (e.value !== undefined && e.tagName === 'INPUT' ? e.value : e.textContent).trim() : null; }, sel);
  const count = sel => app.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).length, sel);
  const bodyHas = t => app.evaluate(t => document.body.innerText.toUpperCase().includes(t.toUpperCase()), t);
  const click = async (sel, t) => { const l = t ? app.locator(sel, { hasText: t }).first() : app.locator(sel).first(); await l.click({ timeout: 5000 }); };
  const type = async (sel, v) => { const l = app.locator(sel).first(); await l.click({ timeout: 5000 }); await l.fill(v); };
  const tab = async name => { await click('#tab-' + name); await tick(1200); };

  const results = []; let shotN = 0;
  const step = async (name, fn) => {
    const before = errors.length; let fail = null;
    try { await fn(); } catch (e) { fail = (e && e.message || String(e)).split('\n')[0]; }
    const newErrs = errors.slice(before);
    if (!fail && newErrs.length) fail = newErrs[0];
    results.push({ name, ok: !fail, why: fail, errs: newErrs });
    console.log((fail ? 'FAIL  ' : 'ok    ') + name + (fail ? '\n        ' + fail : ''));
    if (SHOTS || fail) { fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); await page.screenshot({ path: path.join(__dirname, 'shots', String(++shotN).padStart(2, '0') + '-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) + '.png') }).catch(() => {}); }
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

  await app.evaluate(v => { window.__world.scanSets.visit = v; window.__world.scanDur = 1500; window.__world.discHold = 600; }, VISIT);
  await tick(4000);

  // ── the flows ──
  await step('boot: window drawn, version chip and all six tabs present', async () => {
    for (const t of ['net', 'tools', 'scan', 'intel', 'dhcp', 'recon']) expect(await visible('#tab-' + t), 'tab missing: ' + t);
    expect(await bodyHas('NETWORK CARD'), 'IP tab did not draw');
  });

  await step('IP: the card and its address are shown', async () => {
    expect(await bodyHas('10.20.30.57'), 'address of the pretend card not shown');
    expect((await text('#apply-btn') || '').length > 0, 'apply button has no label');
  });

  await step('IP: a zero-padded address is cleaned when the field is left', async () => {
    await app.evaluate(() => { const e = document.getElementById('ip'); e.removeAttribute('readonly'); e.focus(); e.value = '010.020.030.255'; e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); });
    await tick(300);
    expect(await text('#ip') === '10.20.30.255', 'ip field reads "' + await text('#ip') + '", wanted 10.20.30.255');
  });

  await step('IP: the broadcast address is refused in plain words', async () => {
    expect(await app.evaluate(() => typeof ipHostProblem === 'function' && /BROADCAST/.test(ipHostProblem('10.20.30.255', '255.255.255.0'))), 'ipHostProblem did not flag the broadcast address');
    expect(await app.evaluate(() => ipHostProblem('10.20.30.50', '255.255.255.0') === ''), 'ipHostProblem flagged a good address');
    await app.evaluate(() => { const e = document.getElementById('ip'); e.value = '10.20.30.57'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await tick(300);
  });

  await step('help overlay opens and closes', async () => {
    await app.evaluate(() => openHelp()); await tick(600);
    expect(await bodyHas('FULL MANUAL'), 'help overlay did not open');
    await app.evaluate(() => closeHelp()); await tick(400);
  });

  await step('PING: add the gateway, start, a reply shows in ms', async () => {
    await tab('tools');
    await click('.cmd-btn, .mon-quick, span, div', '+ GATEWAY'); await tick(300);
    await click('#mon-btn-start'); await tick(3500);
    expect(await count('.monitor-row') >= 1, 'no PING row');
    expect(await app.evaluate(() => /\d+ms/.test(document.querySelector('.monitor-row').textContent)), 'PING row shows no time');
  });

  await step('PING: TRCRT and toner buttons on the row respond (inline handlers)', async () => {
    await click('.monitor-row .trcrt-btn, .monitor-row [onclick^="tracertToggle"]'); await tick(2500);
    await click('.monitor-row .tone-btn, .monitor-row [onclick^="monToneToggle"]'); await tick(1200);
    await click('.monitor-row .tone-btn, .monitor-row [onclick^="monToneToggle"]'); await tick(400);
    await click('#mon-btn-stop, .mon-btn-stop, [onclick^="monStop"]'); await tick(500);
  });

  await step('SCAN: sweep finds the pretend hosts', async () => {
    await tab('scan');
    await type('#scan-base', '10.20.30'); await tick(200);
    await click('#scan-start-btn'); await tick(9000);
    const n = await count('[id^="sr-"]');
    expect(n >= 6, 'scan shows ' + n + ' rows, wanted at least 6');
    expect(await bodyHas('SC-ARCHIVER01') || await bodyHas('udm-gw'), 'no hostnames on scan rows');
  });

  await step('SCAN: row buttons (copy IP / MAC) respond', async () => {
    await click('#sr-10_20_30_24 [onclick^="scanCopy"]'); await tick(300);
    await click('#sr-10_20_30_24 [data-mac="1"]'); await tick(1500);
  });

  await step('SCAN → SAVE SITE creates a site', async () => {
    await click('#scan-save-site-btn'); await tick(600);
    const inp = await app.evaluate(() => { const e = document.querySelector('#scan-site-name-input, .scan-name-input, input[placeholder*="ite name" i]'); return e && e.getClientRects().length ? (e.id || e.className) : null; });
    if (inp) { await app.locator('#scan-site-name-input, .scan-name-input, input[placeholder*="ite name" i]').first().fill('SMOKE SITE'); await page.keyboard.press('Enter'); }
    await tick(1500);
    expect(await app.evaluate(() => Object.keys(intelDB).length >= 1), 'no site in the site database after SAVE SITE');
  });

  await step('SITES: the site card opens, devices list', async () => {
    await tab('intel');
    expect(await count('.intel-site-card') >= 1, 'no site card');
    await click('.intel-site-card .intel-site-meta, .intel-site-card'); await tick(1200);
    expect(await count('.intel-device-row') >= 5, 'device list shows ' + await count('.intel-device-row') + ' rows');
  });

  await step('SITES: device drawer — note, login add/remove, type chip (inline handlers)', async () => {
    await click('.intel-device-row'); await tick(600);
    const ta = app.locator('.intel-device-row + * textarea, .intel-drawer textarea, textarea[oninput^="intelUpdateNote"]').first();
    await ta.fill('smoke note'); await tick(400);
    expect(await app.evaluate(() => Object.values(intelDB).some(s => (s.devices || []).some(d => d.notes === 'smoke note' || d.note === 'smoke note'))), 'the note did not reach the site data');
    await click('[onclick^="intelAddCred"]'); await tick(400);
    expect(await count('.intel-cred-key') >= 1, 'no login row after + ADD CREDENTIAL');
    await app.locator('.intel-cred-key').first().fill('admin'); await tick(200);
    await click('[onclick^="intelRemoveCred"]'); await tick(400);
    await click('[onclick*="intelCycleType"]'); await tick(400);
  });

  await step('DHCP: tab starts the engine listening', async () => {
    await tab('dhcp'); await tick(1500);
    expect(await bodyHas('LISTENING'), 'DHCP tab does not say LISTENING');
  });

  await step('DHCP: a device asks, shows as a row, SERVE gives it an address', async () => {
    await app.evaluate(() => window.__world.dhcpAsk('00:07:5f:b2:41:22', 'Bosch', '')); await tick(1500);
    expect(await count('.dhcp-row') >= 1, 'no DHCP row for the asking device');
    // step 2 of the tab: the pretend card is on DHCP with no lease, so give the laptop an address
    if (await count('.dhcp-chip.set')) {
      await click('.dhcp-chip.set'); await tick(600);
      expect(await bodyHas('SET LAPTOP IP'), 'SET LAPTOP IP prompt did not open');
      await click('#hud-modal .modal-btn', 'SET'); await tick(6000);
      expect(await count('.dhcp-chip.on') >= 1, 'no laptop address chip after SET LAPTOP IP');
    }
    await click('.dhcp-row [data-serve]'); await tick(700);
    const st = await text('#dhcp-status') || '';
    await tick(5000);
    const dbg = await app.evaluate(() => 'card=' + document.getElementById('dhcp-adapter').value + ' chips=' + [...document.querySelectorAll('.dhcp-chip')].map(c => c.textContent.trim()).join(',') + ' first=' + document.getElementById('dcfg-rangeStart').value);
    const rowTxt = await app.evaluate(() => [...document.querySelectorAll('.dhcp-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' || '));
    expect(/SERVED|OFFERED/i.test(rowTxt), 'row did not become SERVED / OFFERED — rows read: ' + rowTxt.slice(0, 200) + ' · status after click: ' + st + ' · ' + dbg);
    // while serving, the settings are what is being handed out — locked
    const locked = await app.evaluate(() => ['rangeStart', 'rangeEnd', 'subnet', 'gateway'].map(k => document.getElementById('dcfg-' + k).readOnly));
    expect(locked.every(Boolean), 'while serving, the settings fields are still editable: ' + JSON.stringify(locked));
    await app.evaluate(() => hud.dhcp.stopServing()); await tick(800);
    expect(await app.evaluate(() => !document.getElementById('dcfg-rangeStart').readOnly), 'the settings stayed locked after STOP SERVING');
  });

  await step('RECON: listen runs, stops, and draws its result', async () => {
    await tab('recon');
    await click('#recon-btn'); await tick(3000);
    expect((await text('#recon-btn') || '').includes('STOP'), 'RECON button did not switch to STOP');
    await app.evaluate(() => window.__world.reconPush(ev => { ev.packets = 40; ev.lldp = [{ sysName: 'core-sw01', portId: 'Gi1/0/12', vlan: '30', mgmt: '10.20.30.20' }]; }));
    await tick(2000);
    await click('#recon-btn'); await tick(2000);
    expect((await text('#recon-btn') || '').includes('LISTEN'), 'RECON button did not return to LISTEN');
    expect(await count('.recon-card') + await count('.recon-empty') >= 1, 'RECON drew nothing');
  });

  await step('every tab once more — nothing left broken behind', async () => {
    for (const t of ['net', 'tools', 'scan', 'intel', 'dhcp', 'recon', 'net']) await tab(t);
  });

  await step('IP: adding only a gateway to a static card is applied, not "no change"', async () => {
    await app.evaluate(() => { const a = window.__world.adapters[0]; a.isDhcp = false; a.gateway = ''; a.dns = ''; loadAdapters(true); });
    await tick(3000);
    await tab('net');
    await app.evaluate(() => loadPreset(0, true)); await tick(1500);          // CURRENT: the form shows what the card has
    const pre = await app.evaluate(() => ({ form: document.getElementById('ip').value, card: window.__world.adapters[0].ip, gw: document.getElementById('gateway').value }));
    expect(pre.form === pre.card && !pre.gw, 'setup: form ' + pre.form + ' / card ' + pre.card + ' / gateway "' + pre.gw + '"');
    const gw = pre.card.split('.').slice(0, 3).join('.') + '.254';
    await app.evaluate(g => { const e = document.getElementById('gateway'); e.focus(); e.value = g; e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); }, gw);
    await tick(500);
    await click('#apply-btn'); await tick(6000);
    const st = await text('#net-status') || '';
    expect(!/NO CHANGE/i.test(st), 'APPLY answered: ' + st);
    expect(await app.evaluate(g => window.__world.adapters[0].gateway === g, gw), 'the gateway did not reach the (pretend) card — status: ' + st);
  });

  await step('IP: picking another card shows ITS gateway and DNS, not the last card\'s', async () => {
    await app.evaluate(() => {
      const W = window.__world;
      Object.assign(W.adapters[0], { ip: '10.20.30.57', subnet: '255.255.255.0', gateway: '10.20.30.1', dns: '10.20.30.1', isDhcp: false, connected: true, state: 'Connected' });
      Object.assign(W.adapters[1], { ip: '192.168.50.20', subnet: '255.255.255.0', gateway: '', dns: '', isDhcp: false, connected: true, state: 'Connected' });
      loadAdapters();
    });
    await tick(3000);
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet'))); await tick(1200);
    expect(await text('#gateway') === '10.20.30.1', 'setup: first card should show its gateway, shows "' + await text('#gateway') + '"');
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet 2'))); await tick(1200);
    expect(await text('#ip') === '192.168.50.20', 'second card address not shown: ' + await text('#ip'));
    expect(await text('#gateway') === '' && await text('#dns') === '', 'second card has no gateway/DNS but the form shows gateway "' + await text('#gateway') + '" dns "' + await text('#dns') + '"');
  });

  await step('IP: picking a card that is on DHCP leaves it on DHCP (no "APPLY <its lease>")', async () => {
    await app.evaluate(() => { Object.assign(window.__world.adapters[1], { isDhcp: true, gateway: '192.168.50.1', dns: '192.168.50.1' }); loadAdapters(); });
    await tick(3000);
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet'))); await tick(1200);
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet 2'))); await tick(1200);
    const v = await app.evaluate(() => ({ mode: ipMode, btn: document.getElementById('apply-btn').textContent.trim(), ro: document.getElementById('ip').readOnly, dirty: isDirty }));
    expect(v.mode === 'dhcp' && /ON DHCP/.test(v.btn) && v.ro && !v.dirty, 'after picking the DHCP card: ' + JSON.stringify(v));
  });

  await step('IP: after APPLY on the second card the form stays on that card', async () => {
    await app.evaluate(() => { Object.assign(window.__world.adapters[1], { isDhcp: false, gateway: '', dns: '' }); loadAdapters(); });
    await tick(3000);
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet 2'))); await tick(1200);
    await app.evaluate(() => { const e = document.getElementById('ip'); e.focus(); e.value = '192.168.50.77'; e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); });
    await tick(400);
    await click('#apply-btn'); await tick(4000);
    expect(await app.evaluate(() => window.__world.adapters[1].ip === '192.168.50.77'), 'the address did not reach the second (pretend) card — status: ' + await text('#net-status'));
    await tick(20000);                                   // through the 2 s refresh and a 15 s poll
    const v = await app.evaluate(() => ({ card: document.getElementById('adapter').value, ip: document.getElementById('ip').value }));
    expect(v.card === 'Ethernet 2' && v.ip === '192.168.50.77', 'form shows ' + JSON.stringify(v));
    expect(await app.evaluate(() => document.querySelector('.ip-field-wrap').classList.contains('applied')), 'no ACTIVE tag after APPLY');
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet'))); await tick(800);
    expect(await app.evaluate(() => !document.querySelector('.ip-field-wrap').classList.contains('applied')), 'the ACTIVE tag from the other card\'s APPLY is still showing after picking a different card');
  });

  await step('IP: a static card switched to DHCP keeps REVERT, and REVERT puts the static back', async () => {
    await app.evaluate(() => {
      const W = window.__world;
      Object.assign(W.adapters[0], { ip: '10.20.30.57', subnet: '255.255.255.0', gateway: '10.20.30.1', dns: '10.20.30.1', isDhcp: false, connected: true, state: 'Connected' });
      previousConfig = null; hideRevertBtn(); loadAdapters();
    });
    await tick(3000);
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet'))); await tick(1200);
    await click('#ip-mode-dhcp'); await tick(400);
    expect(/SWITCH TO DHCP/.test(await text('#apply-btn') || ''), 'button reads "' + await text('#apply-btn') + '"');
    await click('#apply-btn'); await tick(5000);
    expect(await app.evaluate(() => window.__world.adapters[0].isDhcp === true), 'the (pretend) card did not go to DHCP — status: ' + await text('#net-status'));
    expect(await visible('#revert-btn'), 'no REVERT button after switching a static card to DHCP');
    await click('#revert-btn'); await tick(8000);
    const a = await app.evaluate(() => { const x = window.__world.adapters[0]; return { ip: x.ip, dhcp: x.isDhcp, gw: x.gateway }; });
    expect(a.ip === '10.20.30.57' && a.dhcp === false && a.gw === '10.20.30.1', 'after REVERT the card is ' + JSON.stringify(a) + ' — status: ' + await text('#net-status'));
  });

  await step('IP: APPLY then REVERT puts the address back and leaves an unchanged MTU alone', async () => {
    await app.evaluate(() => {
      Object.assign(window.__world.adapters[0], { ip: '10.20.30.57', subnet: '255.255.255.0', gateway: '10.20.30.1', dns: '10.20.30.1', isDhcp: false });
      window.__mtuWrites = 0; if (!hud.fixMtu.__counted) { const f = hud.fixMtu; hud.fixMtu = async (...a) => { window.__mtuWrites++; return f(...a); }; hud.fixMtu.__counted = true; }
      previousConfig = null; hideRevertBtn(); loadAdapters();
    });
    await tick(3000);
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet'))); await tick(1200);
    await app.evaluate(() => { const e = document.getElementById('ip'); e.focus(); e.value = '10.20.30.58'; e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); });
    await tick(400);
    await click('#apply-btn'); await tick(5000);
    expect(await app.evaluate(() => window.__world.adapters[0].ip === '10.20.30.58'), 'APPLY did not reach the (pretend) card — status: ' + await text('#net-status'));
    expect(await visible('#revert-btn'), 'no REVERT button after APPLY');
    await click('#revert-btn'); await tick(8000);
    expect(await app.evaluate(() => window.__world.adapters[0].ip === '10.20.30.57'), 'REVERT did not put 10.20.30.57 back — status: ' + await text('#net-status'));
    expect(await app.evaluate(() => window.__mtuWrites === 0), 'REVERT wrote the MTU ' + await app.evaluate(() => window.__mtuWrites) + ' time(s) although it had not changed');
  });

  await step('IP: a shortcut keeps the card, and picking a card keeps the shortcut', async () => {
    await app.evaluate(() => {
      const W = window.__world;
      Object.assign(W.adapters[0], { ip: '10.20.30.57', subnet: '255.255.255.0', gateway: '10.20.30.1', dns: '10.20.30.1', isDhcp: false, connected: true, state: 'Connected' });
      Object.assign(W.adapters[1], { ip: '192.168.50.20', subnet: '255.255.255.0', gateway: '', dns: '', isDhcp: false, connected: true, state: 'Connected' });
      loadAdapters();
    });
    await tick(3000);
    await app.evaluate(() => loadPreset(0, true)); await tick(300);
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet 2'))); await tick(1200);
    await app.evaluate(() => loadPreset(1)); await tick(400);                       // OFFICE
    let v = await app.evaluate(() => ({ card: document.getElementById('adapter').value, shown: document.getElementById('adapter-name-display').textContent.trim(), ip: document.getElementById('ip').value }));
    expect(v.card === 'Ethernet 2' && v.shown === 'Ethernet 2' && v.ip === '10.0.0.50', 'after the shortcut: ' + JSON.stringify(v));
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet'))); await tick(1200);
    v = await app.evaluate(() => ({ card: document.getElementById('adapter').value, ip: document.getElementById('ip').value, gw: document.getElementById('gateway').value, btn: document.getElementById('apply-btn').textContent.trim() }));
    expect(v.card === 'Ethernet' && v.ip === '10.0.0.50' && v.gw === '10.0.0.1' && /APPLY 10\.0\.0\.50/.test(v.btn), 'after picking the other card: ' + JSON.stringify(v));
    await app.evaluate(() => loadPreset(0, true)); await tick(300);
  });

  await step('IP: APPLY never carries one card\'s 2nd address onto another card', async () => {
    await app.evaluate(() => {
      const W = window.__world;
      Object.assign(W.adapters[0], { ip: '10.20.30.57', subnet: '255.255.255.0', gateway: '10.20.30.1', dns: '', isDhcp: false, connected: true, state: 'Connected' });
      Object.assign(W.adapters[1], { ip: '192.168.50.20', subnet: '255.255.255.0', gateway: '', dns: '', isDhcp: false, connected: true, state: 'Connected' });
      loadAdapters();
    });
    await tick(3000);
    await app.evaluate(() => loadPreset(0, true));
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet'))); await tick(1500);
    // the first card has a 2nd address on screen; then the read for the next card fails
    await app.evaluate(() => {
      cardExtras = [{ ip: '172.16.5.5', subnet: '255.255.255.0' }]; cardExtrasFor = 'Ethernet';
      window.__keep = null;
      const g = hud.getAliases; hud.getAliases = async () => ({ ok: false, aliases: [] });
      const f = hud.applyConfig; hud.applyConfig = async cfg => { window.__keep = { card: cfg.adapter, keep: (cfg.keep || []).map(k => k.ip) }; hud.applyConfig = f; hud.getAliases = g; return f(cfg); };
    });
    await app.evaluate(() => selectAdapter(adapterList.find(a => a.name === 'Ethernet 2'))); await tick(1200);
    await app.evaluate(() => { const e = document.getElementById('ip'); e.focus(); e.value = '192.168.50.88'; e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); });
    await tick(400);
    await click('#apply-btn'); await tick(5000);
    const k = await app.evaluate(() => window.__keep);
    expect(k && k.card === 'Ethernet 2', 'APPLY did not run on the second card: ' + JSON.stringify(k) + ' — status: ' + await text('#net-status'));
    expect(k.keep.length === 0, 'APPLY on Ethernet 2 was told to keep ' + k.keep.join(', ') + ', which belongs to the other card');
    await app.evaluate(() => loadPreset(0, true));
  });

  await step('PING: PAUSE then RESUME while a ping is still out does not double the ping rate', async () => {
    await tab('tools');
    await app.evaluate(() => { try { monStop(); } catch {} });
    await tick(500);
    await app.evaluate(() => {
      window.__pings = 0;
      const p = hud.ping; hud.ping = async h => { window.__pings++; await new Promise(r => setTimeout(r, 1500)); return p(h); };   // a slow host: 1.5 s per answer
      monHosts = ['10.20.30.1']; monRenderHostEditor(); monSetInterval(1000); monStart();
    });
    await tick(300);
    await app.evaluate(() => { monPause(); monResume(); });      // inside the first ping's 1.5 s
    await tick(600);
    await app.evaluate(() => { monPause(); monResume(); });      // and once more
    await app.evaluate(() => { window.__pings = 0; });
    await tick(20000);
    const n = await app.evaluate(() => window.__pings);
    await app.evaluate(() => monStop()); await tick(2500);
    // one chain: a 1.5 s ping + 1 s wait = one ping every 2.5 s → 8 in 20 s. Doubled chains give 16, tripled 24.
    expect(n <= 9, n + ' pings in 20 s for one host (one every 2.5 s would be 8) — more than one ping loop is running');
  });

  await step('SCAN: sweeping part of a subnet does not report the rest of the site as missing', async () => {
    await tab('scan');
    await app.evaluate(v => { window.__world.scanSet = 'visit'; window.__world.scanSets.visit = v; }, VISIT);
    // a full sweep first, so the saved site holds every pretend host
    await type('#scan-base', '10.20.30'); await type('#scan-range', '1-254'); await tick(200);
    await click('#scan-start-btn'); await tick(12000);
    const site = await app.evaluate(() => { const s = Object.values(intelDB).find(x => x.subnet === '10.20.30'); return s ? { id: s.id, n: (s.devices || []).length } : null; });
    expect(site && site.n >= 5, 'setup: the saved site has ' + (site ? site.n : 'no') + ' devices');
    await app.evaluate(id => { delete intelPendingChanges[id]; }, site.id);
    // now only .1 – .30: three of the hosts are in range and answer; .100 and .101 are outside it
    await app.evaluate(v => { window.__world.scanSets.part = v.filter(h => +h.ip.split('.')[3] <= 30); window.__world.scanSet = 'part'; }, VISIT);
    await type('#scan-range', '1-30'); await tick(200);
    await click('#scan-start-btn'); await tick(12000);
    await app.evaluate(() => { window.__world.scanSet = 'visit'; });
    const ch = await app.evaluate(id => { const c = intelPendingChanges[id]; return c ? { missing: c.missing.map(d => d.ip), n: c.new.length } : { missing: [], n: 0 }; }, site.id);
    expect(!ch.missing.some(ip => +ip.split('.')[3] > 30), 'a 1-30 sweep reported ' + ch.missing.join(', ') + ' as missing');
    await type('#scan-range', '1-254');
  });

  await step('SCAN: a zero-padded base (010.020.030) is cleaned before the sweep', async () => {
    await app.evaluate(() => { window.__scanArgs = null; const f = hud.scanStart; hud.scanStart = a => { window.__scanArgs = a; hud.scanStart = f; return f(a); }; });
    await type('#scan-base', '010.020.030'); await tick(200);
    await click('#scan-start-btn'); await tick(9000);
    const a = await app.evaluate(() => window.__scanArgs);
    expect(a && a.baseIp === '10.20.30', 'the sweep was started with base ' + JSON.stringify(a && a.baseIp));
    expect(await text('#scan-base') === '10.20.30', 'the field still reads ' + await text('#scan-base'));
  });

  await step('SCAN: SAVE SITE files the rows under the subnet they were scanned on, and never stores "UNKNOWN" as a vendor', async () => {
    await tab('scan');
    await type('#scan-base', '10.20.30'); await type('#scan-range', '1-254'); await tick(200);
    await click('#scan-start-btn'); await tick(12000);
    expect(await count('#scan-results .scan-result-row') >= 5, 'setup: ' + await count('#scan-results .scan-result-row') + ' rows');
    const unk = await app.evaluate(() => { const st = Object.values(intelDB).find(x => x.subnet === '10.20.30'); return (st.devices || []).filter(d => /^unknown$/i.test(d.vendor || '')).map(d => d.ip); });
    expect(unk.length === 0, 'the word UNKNOWN was stored as the vendor of ' + unk.join(', '));
    // the base box now says something else — SAVE must still mean the network on screen
    await type('#scan-base', '10.99.88'); await tick(200);
    await click('#scan-save-site-btn'); await tick(1500);
    const stray = await app.evaluate(() => ({ legacy: !!allSites['10.99.88'], intel: Object.values(intelDB).some(x => x.subnet === '10.99.88') }));
    expect(!stray.legacy && !stray.intel, 'the 10.20.30 rows were saved under 10.99.88 ' + JSON.stringify(stray));
    await type('#scan-base', '10.20.30');
  });

  await step('SCAN: every device from a maker looked up online gets the name, on a second scan too', async () => {
    await tab('scan');
    const got = await app.evaluate(async () => {
      const was = { f: hud.macLookupOnline, en: onlineVendorEnabled, pol: onlineVendorPolicyOff };
      let asked = 0;
      hud.macLookupOnline = async mac => { asked++; return { mac, vendor: 'SMOKE CAMERA CO', source: 'online' }; };
      onlineVendorEnabled = true; onlineVendorPolicyOff = false;
      const add = (ip, mac) => appendScanResult(ip, 3, false, mac, '');
      add('10.20.30.201', 'ac-de-48-00-00-01'); add('10.20.30.202', 'ac-de-48-00-00-02'); add('10.20.30.203', 'ac-de-48-00-00-03');
      window.__vend = { was, asked: () => asked };
      return true;
    });
    await tick(6000);
    const first = await app.evaluate(() => ['201', '202', '203'].map(n => document.querySelector('#sr-10_20_30_' + n + ' .scan-result-vendor')?.textContent.trim()));
    expect(first.every(v => v === 'SMOKE CAMERA CO'), 'three cameras from one maker show: ' + first.join(' / '));
    // the same devices found again later in the session
    await app.evaluate(() => { ['201', '202', '203'].forEach(n => document.getElementById('sr-10_20_30_' + n)?.remove()); appendScanResult('10.20.30.201', 3, false, 'ac-de-48-00-00-01', ''); });
    await tick(6000);
    const again = await app.evaluate(() => document.querySelector('#sr-10_20_30_201 .scan-result-vendor')?.textContent.trim());
    const asked = await app.evaluate(() => { const n = window.__vend.asked(); const w = window.__vend.was; hud.macLookupOnline = w.f; onlineVendorEnabled = w.en; onlineVendorPolicyOff = w.pol; document.getElementById('sr-10_20_30_201')?.remove(); return n; });
    expect(again === 'SMOKE CAMERA CO', 'found again in the same session it shows: ' + again);
    expect(asked === 1, 'the maker was asked for ' + asked + ' times (once is enough)');
  });

  await step('DHCP: a card that leaves the list and comes back is picked again; the card is locked while serving', async () => {
    await tab('dhcp'); await tick(1500);
    const r = await app.evaluate(() => {
      const sel = document.getElementById('dhcp-adapter');
      const list = D.adapters.slice();
      const picked = sel.value || (list[0] && list[0].name);
      if (!picked) return { err: 'no card in the list' };
      sel.value = picked; dhcpFillAdapterSelect(list);
      dhcpFillAdapterSelect(list.filter(a => a.name !== picked));      // the USB card is pulled
      const gone = sel.value;
      dhcpFillAdapterSelect(list);                                     // …and put back
      const back = sel.value;
      const mode = D.mode, targets = D.targets;
      dhcpApplyMode({ mode: 'serve-all', targets: [] }); const locked = sel.disabled;
      dhcpApplyMode({ mode, targets }); const unlocked = !sel.disabled;
      return { picked, gone, back, locked, unlocked };
    });
    expect(!r.err, r.err);
    expect(r.gone === '', 'setup: with the card gone the pick reads ' + JSON.stringify(r.gone));
    expect(r.back === r.picked, 'after the card came back the pick reads ' + JSON.stringify(r.back) + ', not ' + r.picked);
    expect(r.locked && r.unlocked, 'card pick while serving: locked=' + r.locked + ', free again after=' + r.unlocked);
  });

  await step('PING: a target added while it runs gets a row and is pinged; removing one drops its row', async () => {
    await tab('tools');
    await app.evaluate(() => { try { monStop(); } catch {} monHosts = ['10.20.30.1']; monRenderHostEditor(); monSetInterval(1000); monStart(); });
    await tick(2500);
    expect(await count('.monitor-row') === 1, 'setup: ' + await count('.monitor-row') + ' rows');
    await click('.add-host-btn'); await tick(200);                     // while running
    const inp = app.locator('#host-editor .host-input').nth(1);
    await inp.fill('10.20.30.10'); await page.keyboard.press('Enter'); await tick(4000);
    expect(await count('.monitor-row') === 2, 'after adding a target while running there are ' + await count('.monitor-row') + ' rows');
    expect(await app.evaluate(() => /\d+ms/.test(document.getElementById('mr-' + safeid('10.20.30.10')).textContent)), 'the added target shows no reply time');
    await click('#host-editor .host-remove-btn'); await tick(2500);     // remove the first, still running
    const ids = await app.evaluate(() => [...document.querySelectorAll('.monitor-row')].map(r => r.id));
    expect(ids.length === 1 && ids[0] === await app.evaluate(() => 'mr-' + safeid('10.20.30.10')), 'rows after removing the first target: ' + ids.join(', '));
    // and the paused case: add while paused, resume
    await app.evaluate(() => monPause()); await tick(300);
    await click('.add-host-btn'); await tick(200);
    await app.locator('#host-editor .host-input').nth(1).fill('10.20.30.20'); await page.keyboard.press('Tab'); await tick(300);
    await app.evaluate(() => monResume()); await tick(3500);
    expect(await count('.monitor-row') === 2, 'after adding a target while paused and resuming there are ' + await count('.monitor-row') + ' rows');
    await app.evaluate(() => monStop()); await tick(500);
  });

  await step('SITES: removing a device and deleting a site use ETHER\'s own prompt; a deleted site stays deleted', async () => {
    await tab('intel');
    await app.evaluate(() => intelShowList()); await tick(500);
    const before = await app.evaluate(() => ({ sites: Object.keys(intelDB).length, lib: Object.keys(allSites || {}).length }));
    expect(before.sites >= 1, 'setup: no site to delete');
    await click('.intel-site-card .intel-site-meta, .intel-site-card'); await tick(1000);
    const devs = await count('.intel-device-row');
    await click('.intel-device-row'); await tick(500);
    await click('[onclick^="intelDeleteDevice"]'); await tick(400);
    expect(await bodyHas('REMOVE THIS DEVICE'), 'no ETHER prompt for removing a device');
    await click('#hud-modal .modal-btn', 'REMOVE'); await tick(800);
    expect(await count('.intel-device-row') === devs - 1, 'device rows: ' + devs + ' → ' + await count('.intel-device-row'));
    await click('[onclick="intelDeleteSite()"]'); await tick(400);
    expect(await bodyHas('DELETE THIS SITE'), 'no ETHER prompt for deleting the site');
    await click('#hud-modal .modal-btn', 'DELETE SITE'); await tick(1500);
    expect(await app.evaluate(() => Object.keys(intelDB).length) === before.sites - 1, 'the site is still in the database');
    // leave the tab and come back, the way a tech would — the site must not be re-imported
    await tab('net'); await tab('intel'); await tick(1500);
    const after = await app.evaluate(() => ({ sites: Object.keys(intelDB).length, names: Object.values(intelDB).map(s => s.name) }));
    expect(after.sites === before.sites - 1, 'after reopening SITES there are ' + after.sites + ' sites (' + after.names.join(', ') + ') — the deleted one came back');
  });

  await browser.close(); srv.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} steps passed` + (failed.length ? ` — ${failed.length} FAILED` : ''));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('SMOKE TEST CRASHED: ' + (e && e.stack || e)); process.exit(2); });
