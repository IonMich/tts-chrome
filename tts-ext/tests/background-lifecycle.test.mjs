import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({ entryPoints: [root+'src/entrypoints/background.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: root+'tsconfig.json' });
const code = built.outputFiles[0].text;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i=0;i<8;i++) await new Promise(r=>setImmediate(r)); };
const supportedCapabilities=id=>({type:'capabilities',id,available:true,mode:'system-speech',canStop:true,canPause:false,canSeek:false,hasPcm:false,protocolVersion:2,shutdownAcknowledgement:1});

// Only deterministic Chrome/engine fakes: no speech, model, browser or native process.
function harness({ extract, create, close, start, storage, recovery, retained, local = {}, localGet, localSet, capabilities, shutdown } = {}) {
  const listeners={}, events=[], timers=[], nativeMessages=[], nativePorts=[]; let exists=!!retained, documents=retained?1:0, maxDocuments=documents;
  const event = name => ({ addListener: fn => { listeners[name]=fn; } });
  const chrome={
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:event('installed'),onMessage:event('message'),
      connectNative:()=>{let receive;const port={postMessage:m=>{nativeMessages.push(m);if(m.action==='capabilities')Promise.resolve(capabilities?.(m)).then(()=>receive?.(supportedCapabilities(m.id)));if(m.action==='shutdown')Promise.resolve(shutdown?.(m)).then(()=>receive?.({type:'shutdown-complete',id:m.id,stopped:true,processExited:true}));},disconnect(){this.disconnected=true;},onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(){}}};nativePorts.push({emit:message=>receive?.(message),port});return port;},
      sendMessage:async m=>{if(m.target!=='engine')return;events.push({action:m.action,...m});if(m.action==='get')return{snapshot:retained};if(m.action==='start')return await start?.(m)??{ok:true};return{ok:true};}},
    storage:{session:{get:async()=>await recovery?.()??(retained?{readerOwnerTab:1}:{}),set:async v=>{await storage?.(v);},remove:async()=>{}},local:{get:async()=>{await localGet?.();return {...local};},set:async v=>{await localSet?.(v);Object.assign(local,v);}},sync:{get:async()=>({})}},
    offscreen:{Reason:{WORKERS:'WORKERS'},hasDocument:async()=>exists,
      createDocument:async()=>{events.push({action:'creating'});await create?.();assert.equal(exists,false);exists=true;documents++;maxDocuments=Math.max(maxDocuments,documents);events.push({action:'created'});},
      closeDocument:async()=>{events.push({action:'closing'});await close?.();assert.equal(exists,true);exists=false;documents--;events.push({action:'closed'});}},
    tabs:{query:async()=>[{id:1}],onRemoved:event('removed'),onUpdated:event('updated'),
      sendMessage:async(id,m)=>{if(m.type==='reader:show')return{shown:true};if(m.type==='reader:extract'){events.push({action:'extract',id});return await extract?.(id,m)??{text:'Page '+id+'.',sourceId:'source-'+id};}}},
    contextMenus:{onClicked:event('context'),removeAll(){},create(){}},commands:{onCommand:event('command')},scripting:{executeScript:async()=>[]},
  };
  vm.runInNewContext(code,{chrome,defineBackground:fn=>fn(),crypto,TextEncoder,console,
    setTimeout(fn,ms){const timer={fn,ms,cleared:false};timers.push(timer);return timer;},clearTimeout(t){if(t)t.cleared=true;}});
  const send=(message,sender={id:'test',tab:{id:1}})=>new Promise(resolve=>listeners.message({channel:'local-reader-v2',target:'background',...message},sender,resolve));
  return{events,nativeMessages,nativePorts,local,listeners,send,command:(action,id=1)=>send({action,request:{text:'Page '+id+'.'}},{id:'test',tab:{id}}),
    get exists(){return exists;},get maxDocuments(){return maxDocuments;},
    starts:()=>events.filter(e=>e.action==='start'),async timeout(ms=5000){for(const t of [...timers])if(!t.cleared&&t.ms===ms){t.cleared=true;t.fn();}await flush();}};
}

test('Stop cancels pending extraction and all older queued starts; late extraction stays inert',async()=>{
 const gate=deferred(),h=harness({extract:id=>id===1?gate.promise:undefined});
 const first=h.command('read-page');await flush();assert.equal(h.events.at(-1).action,'extract');
 const second=h.command('start',2),third=h.command('read-page',3),stop=h.command('stop');
 const replies=await Promise.all([first,second,third,stop]);assert(replies.slice(0,3).every(r=>r.cancelled));assert(replies[3].ok);assert.equal(h.starts().length,0);
 const newer=await h.command('start',4);assert(newer.ok);gate.resolve({text:'Too late.',sourceId:'old'});await flush();assert.equal(h.starts().length,1);assert.equal(h.exists,true);assert.equal((await h.command('get')).snapshot.sessionId,newer.snapshot.sessionId);await h.command('stop');
});

test('A burst of launch requests keeps only the latest pending reading',async()=>{
 const gate=deferred(),h=harness({extract:()=>gate.promise});const first=h.command('read-page');await flush();
 const second=h.command('start',2),third=h.command('start',3);const replies=await Promise.all([first,second,third]);assert(replies[0].cancelled);assert(replies[1].cancelled);assert(replies[2].ok);assert.equal(h.starts().length,1);assert.equal(h.starts()[0].request.text,'Page 3.');gate.resolve({text:'Old.'});await flush();assert.equal(h.starts().length,1);await h.command('stop');
});

test('Stop interrupts an outstanding start acknowledgement and ignores its late response',async()=>{
 const gate=deferred(),h=harness({start:()=>gate.promise});const first=h.command('start');await flush();assert.equal(h.starts().length,1);
 assert((await h.command('stop')).ok);assert((await first).cancelled);assert.equal(h.exists,false);gate.resolve({error:'Late failure'});await flush();assert.equal((await h.command('get')).snapshot.phase,'idle');
});

test('Cancellation during document acquisition waits for its disposal before a replacement',async()=>{
 const gate=deferred();let creates=0;const h=harness({create:()=>++creates===1?gate.promise:undefined});
 const first=h.command('start');await flush();assert.equal(h.events.at(-1).action,'creating');const stop=h.command('stop'),second=h.command('start',2);await flush();assert.equal(h.starts().length,0);assert.equal(creates,1);
 gate.resolve();const replies=await Promise.all([first,stop,second]);assert(replies[0].cancelled);assert(replies[1].ok);assert(replies[2].ok);assert.equal(h.starts().length,1);assert.equal(h.maxDocuments,1);assert(h.events.findIndex(e=>e.action==='closed')<h.events.findLastIndex(e=>e.action==='created'));await h.command('stop');
});

test('A timed-out acquisition remains owned and late completion is cleaned before another launch',async()=>{
 const gate=deferred();let creates=0;const h=harness({create:()=>++creates===1?gate.promise:undefined});const first=h.command('start');await flush();
 const stop=h.command('stop');for(let i=0;i<6;i++)await h.timeout();assert((await first).error);assert((await stop).error);
 const second=h.command('start',2);for(let i=0;i<5;i++)await h.timeout();assert((await second).error);assert.equal(creates,1);assert.equal(h.starts().length,0);
 gate.resolve();await flush();assert.equal(h.exists,false);assert((await h.command('start',3)).ok);assert.equal(h.starts().length,1);assert.equal(h.maxDocuments,1);await h.command('stop');
});

test('Delayed document closure blocks replacement acquisition even after a Stop timeout',async()=>{
 const gate=deferred();let closes=0;const h=harness({close:()=>++closes===1?gate.promise:undefined});await h.command('start');
 const stop=h.command('stop');await flush();for(let i=0;i<3;i++)await h.timeout();assert((await stop).error);
 const next=h.command('start',2);await flush();assert.equal(h.starts().length,1);assert.equal(h.maxDocuments,1);gate.resolve();assert((await next).ok);assert.equal(h.starts().length,2);await h.command('stop');
});

test('Failed request publication and cleanup finish before a queued successor starts',async()=>{
 const gate=deferred();let attempts=0,errorSeen=false;const h=harness({start:()=>++attempts===1?{error:'First start failed'}:{ok:true},storage:v=>{if(v.readerSnapshot?.phase==='error'){errorSeen=true;return gate.promise;}}});
 const first=h.command('start');await flush();assert(errorSeen);const second=h.command('start',2);await flush();assert.equal(h.starts().length,1);
 gate.resolve();assert((await first).error);const result=await second;assert(result.ok);assert.equal(h.exists,true);assert.equal((await h.command('get')).snapshot.sessionId,result.snapshot.sessionId);await h.command('stop');
});

test('A stalled error publication is bounded and its late completion cannot close the successor',async()=>{
 const gate=deferred();let attempts=0;const h=harness({start:()=>++attempts===1?{error:'First failed'}:{ok:true},storage:v=>v.readerSnapshot?.phase==='error'?gate.promise:undefined});
 const first=h.command('start');await flush();const second=h.command('start',2);await h.timeout();assert((await first).error);const result=await second;assert(result.ok);gate.resolve();await flush();assert.equal(h.exists,true);assert.equal((await h.command('get')).snapshot.sessionId,result.snapshot.sessionId);await h.command('stop');
});

test('Cancelled sessions cannot send native speech or publish engine state',async()=>{
 const h=harness();const original=await h.command('start');const sender={id:'test',url:'chrome-extension://test/offscreen.html'};const id=original.snapshot.sessionId+':1:1';
 const stop=h.command('stop');const rejected=await h.send({action:'native-speak',id,text:'Old speech'},sender);assert(rejected.error);assert.equal(h.nativeMessages.length,0);await stop;
 const newer=await h.command('start',2);h.listeners.message({channel:'local-reader-v2',target:'background',action:'engine-state',snapshot:{...original.snapshot,phase:'error',error:'Stale'}},sender,()=>{});await flush();assert.equal((await h.command('get')).snapshot.sessionId,newer.snapshot.sessionId);assert.equal(h.exists,true);
 assert((await h.send({action:'native-speak',id:newer.snapshot.sessionId+':1:1',text:'Current speech'},sender)).ok);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,1);await h.command('stop');
});

test('Closing the old owner during handoff does not cancel the new tab reading',async()=>{
 const gate=deferred();let closes=0;const h=harness({close:()=>++closes===1?gate.promise:undefined});await h.command('start',1);
 const next=h.command('start',2);await flush();h.listeners.removed(1);await flush();gate.resolve();const result=await next;assert(result.ok);assert.equal(h.starts().at(-1).request.text,'Page 2.');assert.equal(h.exists,true);await h.command('stop');
});

test('Closing the tab with pending extraction cancels its launch',async()=>{
 const gate=deferred(),h=harness({extract:()=>gate.promise});const reading=h.command('read-page',2);await flush();h.listeners.updated(2,{status:'loading'});assert((await reading).cancelled);await h.command('get');assert.equal(h.starts().length,0);gate.resolve({text:'Late.'});await flush();assert.equal(h.starts().length,0);
});

test('Stalled initial recovery fails closed before Stop can release unknown native ownership',async()=>{
 const gate=deferred(),h=harness({recovery:()=>gate.promise});const stop=h.command('stop');await flush();await h.timeout();assert.match((await stop).error,/ownership recovery failed/i);gate.resolve({readerOwnerTab:99});await flush();assert.equal((await h.command('get')).snapshot.phase,'error');
});

test('Recovery restores the native session gate for retained speech and rejects another session',async()=>{
 const retained={phase:'playing',sessionId:'retained',voice:'mac:macos-start-speaking',speed:1,elapsedSec:0,durationSec:null,bufferedSec:0,modelResident:false,speechMode:'system'};
 const h=harness({retained});await h.command('get');const sender={id:'test',url:'chrome-extension://test/offscreen.html'};
 assert((await h.send({action:'native-speak',id:'retained:1:2',text:'Replay'},sender)).ok);
 assert((await h.send({action:'native-speak',id:'other:1:2',text:'Stale'},sender)).error);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,1);await h.command('stop');
});

const nativeSender={id:'test',url:'chrome-extension://test/offscreen.html'};
const nativeSpeak=(h,session,text='Current speech')=>h.send({action:'native-speak',id:session+':1:1',text},nativeSender);

test('Close during exact-port capability lookup prevents speech and leaves no durable owner',async()=>{
 const gate=deferred(),h=harness({capabilities:()=>gate.promise});const reading=await h.command('start');
 const speaking=nativeSpeak(h,reading.snapshot.sessionId);await flush();const closing=h.command('stop');await flush();
 gate.resolve();assert((await speaking).error);assert((await closing).ok);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);assert.notEqual(h.local.nativeOwnershipUnknown,true);
 assert.equal(h.nativeMessages.filter(m=>m.action==='shutdown').length,1);assert.equal(h.nativePorts[0].port.disconnected,true);
 const next=await h.command('start',2);assert(next.ok);assert((await nativeSpeak(h,next.snapshot.sessionId)).ok);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,1);await h.command('stop');
});

test('Close waits for a pending durable marker write and clears it only after verified exit',async()=>{
 const write=deferred(),ack=deferred(),h=harness({localSet:v=>v.nativeOwnershipUnknown?write.promise:undefined,shutdown:()=>ack.promise});
 const reading=await h.command('start');const speaking=nativeSpeak(h,reading.snapshot.sessionId);await flush();
 const closing=h.command('stop');await flush();assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);
 write.resolve();await flush();assert.equal(h.local.nativeOwnershipUnknown,true);assert.equal(h.nativeMessages.filter(m=>m.action==='shutdown').length,1);
 ack.resolve();assert((await speaking).error);assert((await closing).ok);assert.equal(h.local.nativeOwnershipUnknown,false);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);
});

test('Failed ownership marker write prevents speech and fails closed',async()=>{
 const h=harness({localSet:()=>{throw Error('Storage unavailable');}});const reading=await h.command('start');
 assert((await nativeSpeak(h,reading.snapshot.sessionId)).error);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);
 assert((await h.command('start',2)).error);assert.equal(h.starts().length,1);
});

test('Durable unknown ownership survives a fresh background and blocks all replacement',async()=>{
 const local={nativeOwnershipUnknown:true},h=harness({local});assert((await h.command('start')).error);assert.equal(h.starts().length,0);assert.equal(h.nativeMessages.length,0);assert.equal(local.nativeOwnershipUnknown,true);
 const restarted=harness({local});assert((await restarted.command('start')).error);assert.equal(restarted.starts().length,0);assert.equal(local.nativeOwnershipUnknown,true);
});

test('Ownership read failure blocks speech and replacement',async()=>{
 const h=harness({localGet:()=>{throw Error('Read failed');}});assert((await h.command('start')).error);assert.equal(h.starts().length,0);assert.equal(h.nativeMessages.length,0);
});

test('Natural native completion promptly clears the durable marker after verified exit',async()=>{
 const h=harness();const reading=await h.command('start');assert((await nativeSpeak(h,reading.snapshot.sessionId)).ok);assert.equal(h.local.nativeOwnershipUnknown,true);
 const speak=h.nativeMessages.find(m=>m.action==='speak');h.nativePorts.at(-1).emit({type:'ended',id:speak.id});await flush();
 assert.equal(h.local.nativeOwnershipUnknown,false);assert.equal(h.nativeMessages.filter(m=>m.action==='shutdown').length,1);await h.command('stop');
});

test('Stale or missing-session shutdown cannot stop the current native owner',async()=>{
 const h=harness();const reading=await h.command('start');assert((await nativeSpeak(h,reading.snapshot.sessionId)).ok);
 for(const sessionId of [undefined,'obsolete'])assert((await h.send({action:'native-shutdown',sessionId},nativeSender)).error);
 assert.equal(h.nativeMessages.filter(m=>m.action==='shutdown').length,0);assert.equal(h.local.nativeOwnershipUnknown,true);await h.command('stop');
});

test('A late marker write and old cancellation finish before a successor can acquire ownership',async()=>{
 const write=deferred();let first=true;const h=harness({localSet:v=>{if(v.nativeOwnershipUnknown&&first){first=false;return write.promise;}}});
 const reading=await h.command('start');const old=nativeSpeak(h,reading.snapshot.sessionId);await flush();
 const closing=h.command('stop'),next=h.command('start',2);await flush();assert.equal(h.starts().length,1);write.resolve();
 assert((await old).error);assert((await closing).ok);const replacement=await next;assert(replacement.ok);assert.equal(h.local.nativeOwnershipUnknown,false);
 assert((await nativeSpeak(h,replacement.snapshot.sessionId)).ok);await flush();assert.equal(h.local.nativeOwnershipUnknown,true);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,1);await h.command('stop');
});

test('Immediate replay waits for prior verified exit and records the new owner afterward',async()=>{
 const ack=deferred();let shutdowns=0;const h=harness({shutdown:()=>++shutdowns===1?ack.promise:undefined});
 const reading=await h.command('start');const sessionId=reading.snapshot.sessionId;assert((await nativeSpeak(h,sessionId)).ok);
 h.nativePorts.at(-1).emit({type:'ended',id:sessionId+':1:1'});
 const replay=h.send({action:'native-speak',id:sessionId+':1:2',text:'Replay'},nativeSender);await flush();
 assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,1);assert.equal(h.local.nativeOwnershipUnknown,true);
 ack.resolve();assert((await replay).ok);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,2);assert.equal(h.local.nativeOwnershipUnknown,true);await h.command('stop');
});

test('Failed shutdown blocks a bundled-voice replacement but still closes the old offscreen document',async()=>{
 const h=harness({shutdown:()=>{throw Error('Helper failed');}});const reading=await h.command('start');assert((await nativeSpeak(h,reading.snapshot.sessionId)).ok);
 assert((await h.command('start',2)).error);assert.equal(h.starts().length,1);assert.equal(h.exists,false);assert.equal(h.local.nativeOwnershipUnknown,true);
});

test('Failed durable clear retains the block after verified helper exit',async()=>{
 const local={},h=harness({local,localSet:v=>{if(v.nativeOwnershipUnknown===false)throw Error('Clear failed');}});const reading=await h.command('start');assert((await nativeSpeak(h,reading.snapshot.sessionId)).ok);
 assert((await h.command('stop')).error);assert.equal(local.nativeOwnershipUnknown,true);assert((await h.command('start',2)).error);assert.equal(h.starts().length,1);
});

test('Legacy session ownership migrates to durable local storage without permitting new speech',async()=>{
 const local={},h=harness({local,recovery:()=>({nativeOwnershipUnknown:true})});assert((await h.command('start')).error);assert.equal(local.nativeOwnershipUnknown,true);assert.equal(h.nativeMessages.length,0);
});


test('Native Stop cancels pending capability lookup and allows a healthy replay',async()=>{
 const gate=deferred(),h=harness({capabilities:()=>gate.promise});const reading=await h.command('start');const sessionId=reading.snapshot.sessionId;
 const pending=nativeSpeak(h,sessionId);await flush();const stopped=h.send({action:'native-stop',sessionId,id:sessionId+':1:1'},nativeSender);await flush();gate.resolve();
 assert((await pending).cancelled);assert((await stopped).ok);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);assert.notEqual(h.local.nativeOwnershipUnknown,true);
 assert((await h.send({action:'native-speak',id:sessionId+':1:2',text:'Replay'},nativeSender)).ok);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,1);await h.command('stop');
});

test('Native Stop during marker persistence cancels the post and waits for verified retirement',async()=>{
 const write=deferred(),ack=deferred(),h=harness({localSet:v=>v.nativeOwnershipUnknown?write.promise:undefined,shutdown:()=>ack.promise});
 const reading=await h.command('start');const sessionId=reading.snapshot.sessionId;const pending=nativeSpeak(h,sessionId);await flush();
 const stopped=h.send({action:'native-stop',sessionId,id:sessionId+':1:1'},nativeSender);await flush();write.resolve();await flush();
 assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);assert.equal(h.local.nativeOwnershipUnknown,true);
 ack.resolve();assert((await pending).cancelled);assert((await stopped).ok);assert.equal(h.local.nativeOwnershipUnknown,false);await h.command('stop');
});

test('A stale Stop from the previous replay cannot cancel the next pending replay',async()=>{
 const gate=deferred();let lookups=0;const h=harness({capabilities:()=>++lookups===2?gate.promise:undefined});
 const reading=await h.command('start'),sessionId=reading.snapshot.sessionId;assert((await nativeSpeak(h,sessionId)).ok);
 h.nativePorts.at(-1).emit({type:'ended',id:sessionId+':1:1'});await flush();
 const replay=h.send({action:'native-speak',id:sessionId+':1:2',text:'New replay'},nativeSender);await flush();
 assert((await h.send({action:'native-stop',sessionId,id:sessionId+':1:1'},nativeSender)).error);gate.resolve();
 assert((await replay).ok);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,2);assert.equal(h.local.nativeOwnershipUnknown,true);await h.command('stop');
});


test('A timed-out marker write cannot later post abandoned speech',async()=>{
 const write=deferred(),h=harness({localSet:v=>v.nativeOwnershipUnknown?write.promise:undefined});
 const reading=await h.command('start');const pending=nativeSpeak(h,reading.snapshot.sessionId);await flush();await h.timeout(15000);
 assert((await pending).error);assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);
 write.resolve();await flush();assert.equal(h.nativeMessages.filter(m=>m.action==='speak').length,0);assert.equal(h.local.nativeOwnershipUnknown,false);
 assert((await h.command('start',2)).ok);await h.command('stop');
});
