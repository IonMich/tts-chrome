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

// Only deterministic Chrome/engine fakes: no speech, model, browser or native process.
function harness({ extract, create, close, start, storage, recovery, retained } = {}) {
  const listeners={}, events=[], timers=[], nativeMessages=[]; let exists=!!retained, documents=retained?1:0, maxDocuments=documents;
  const event = name => ({ addListener: fn => { listeners[name]=fn; } });
  const chrome={
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:event('installed'),onMessage:event('message'),
      connectNative:()=>({postMessage:m=>nativeMessages.push(m),disconnect(){},onMessage:{addListener(){}},onDisconnect:{addListener(){}}}),
      sendMessage:async m=>{if(m.target!=='engine')return;events.push({action:m.action,...m});if(m.action==='get')return{snapshot:retained};if(m.action==='start')return await start?.(m)??{ok:true};return{ok:true};}},
    storage:{session:{get:async()=>await recovery?.()??(retained?{readerOwnerTab:1}:{}),set:async v=>{await storage?.(v);}},sync:{get:async()=>({})}},
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
  return{events,nativeMessages,listeners,send,command:(action,id=1)=>send({action,request:{text:'Page '+id+'.'}},{id:'test',tab:{id}}),
    get exists(){return exists;},get maxDocuments(){return maxDocuments;},
    starts:()=>events.filter(e=>e.action==='start'),async timeout(){for(const t of [...timers])if(!t.cleared&&t.ms===5000){t.cleared=true;t.fn();}await flush();}};
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
 assert((await h.send({action:'native-speak',id:newer.snapshot.sessionId+':1:1',text:'Current speech'},sender)).ok);assert.equal(h.nativeMessages.length,1);await h.command('stop');
});

test('Closing the old owner during handoff does not cancel the new tab reading',async()=>{
 const gate=deferred();let closes=0;const h=harness({close:()=>++closes===1?gate.promise:undefined});await h.command('start',1);
 const next=h.command('start',2);await flush();h.listeners.removed(1);await flush();gate.resolve();const result=await next;assert(result.ok);assert.equal(h.starts().at(-1).request.text,'Page 2.');assert.equal(h.exists,true);await h.command('stop');
});

test('Closing the tab with pending extraction cancels its launch',async()=>{
 const gate=deferred(),h=harness({extract:()=>gate.promise});const reading=h.command('read-page',2);await flush();h.listeners.updated(2,{status:'loading'});assert((await reading).cancelled);await h.command('get');assert.equal(h.starts().length,0);gate.resolve({text:'Late.'});await flush();assert.equal(h.starts().length,0);
});

test('Stalled initial recovery is bounded and cannot prevent Stop indefinitely',async()=>{
 const gate=deferred(),h=harness({recovery:()=>gate.promise});const stop=h.command('stop');await flush();await h.timeout();assert((await stop).ok);gate.resolve({readerOwnerTab:99});await flush();assert.equal((await h.command('get')).snapshot.phase,'idle');
});

test('Recovery restores the native session gate for retained speech and rejects another session',async()=>{
 const retained={phase:'playing',sessionId:'retained',voice:'mac:macos-start-speaking',speed:1,elapsedSec:0,durationSec:null,bufferedSec:0,modelResident:false,speechMode:'system'};
 const h=harness({retained});await h.command('get');const sender={id:'test',url:'chrome-extension://test/offscreen.html'};
 assert((await h.send({action:'native-speak',id:'retained:1:2',text:'Replay'},sender)).ok);
 assert((await h.send({action:'native-speak',id:'other:1:2',text:'Stale'},sender)).error);assert.equal(h.nativeMessages.length,1);await h.command('stop');
});
