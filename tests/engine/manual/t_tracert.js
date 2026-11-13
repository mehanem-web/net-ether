// harness: the traceroute handlers from main.js with a fake tracert process
const fs=require('fs'), EventEmitter=require('events');
const src=fs.readFileSync(process.argv[2],'utf8');
const a=src.indexOf('let tracertProc = null;'), b=src.indexOf('// ── IPC: second ARP pass');
const handlers={}; const ipcMain={on:(c,f)=>handlers[c]=f};
const procs=[]; const execFile=(f,args)=>{ const p=new EventEmitter(); p.stdout=new EventEmitter(); p.host=args[args.length-1]; p.killed=false; p.kill=()=>{ if(p.killed)return; p.killed=true; setTimeout(()=>p.emit('close'),30); }; procs.push(p); return p; };
const stripHostPort=h=>({host:h});
eval(src.slice(a,b));
const sent=[]; const e={sender:{isDestroyed:()=>false,send:(ch,d)=>sent.push(ch+(d?':'+d.raw:''))}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  // the window's sequence when TRCRT is clicked on host B while A is still running
  handlers['tracert-start'](e,{host:'10.0.0.1'}); await wait(10);
  procs[0].stdout.emit('data','  1    <1 ms    <1 ms    <1 ms  10.0.0.1\n');
  handlers['tracert-stop'](e);                       // tracertClose() for A
  handlers['tracert-start'](e,{host:'10.0.0.2'});    // then B starts
  const mark=sent.length; await wait(80);            // A's process finishes dying
  procs[1].stdout.emit('data','  1     2 ms     2 ms     2 ms  10.0.0.2\n');
  const afterSwitch=sent.slice(mark);
  console.log('events B\'s panel received after the switch:', JSON.stringify(afterSwitch));
  console.log(afterSwitch.includes('tracert-done') ? 'RESULT: B was told "done" by A\'s leftovers — its panel stops listening' : 'RESULT: ok — B only gets its own hops');
  // can B still be stopped?
  handlers['tracert-stop'](e); await wait(60);
  console.log('B killed by STOP:', procs[1].killed);
})();
// second check: a hop that arrives in pieces
setTimeout(async()=>{
  const fs=require('fs');
  sent.length=0; handlers['tracert-start'](e,{host:'1.1.1.1'}); await wait(5);
  const p=procs[procs.length-1];
  for (const piece of ['  7 ','   10 ms','    9 ms','   13 ms  141.101.74.111\r\n','  8 ','    *    ','    *    ','    *     Request timed out.\r\n']) p.stdout.emit('data', piece);
  console.log('hop lines the panel gets:', JSON.stringify(sent.filter(x=>x.startsWith('tracert-hop')).map(x=>x.slice(12))));
  process.exit(0);
},400);
