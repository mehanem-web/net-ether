// Engine tests (7.4.0): the real dhcp.js run against pretend sockets, cards and launches — no
// network, no Windows, no Electron. Each file exits 0 when its checks hold. `npm run test:engine`.
// The files in manual/ print what the engine did and check nothing by themselves; they are the
// rigs the 7.4 audit was done with, kept for the next person who needs to watch a flow:
//   node tests/engine/manual/t_dhcp4.js "%CD%\dhcp.js"      (t_tracert.js takes main.js)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'run.js').sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f), path.join(root, 'dhcp.js')], { encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + f.replace(/\.js$/, ''));
  if (!ok) console.log(String(r.stdout || '').trim().split('\n').map(l => '          ' + l).join('\n') + (r.stderr ? '\n' + r.stderr : ''));
}
console.log(`\n${files.length - failed} of ${files.length} engine tests passed`);
process.exit(failed ? 1 : 0);
