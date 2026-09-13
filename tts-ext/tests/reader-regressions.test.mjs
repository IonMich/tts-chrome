import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import { AutoTokenizer, env } from '@huggingface/transformers';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=p=>root+p;
const compiled=async(path,globalName)=>{
 const result=await build({entryPoints:[source(path)],bundle:true,write:false,format:globalName?'iife':'esm',globalName,platform:'browser',tsconfig:source('tsconfig.json')});
 return result.outputFiles[0].text;
};
const moduleOf=async path=>import('data:text/javascript;base64,'+Buffer.from(await compiled(path)).toString('base64'));
const engineCode=await compiled('src/lib/readerEngine.ts','ReviewedReader');
const backgroundCode=await compiled('src/entrypoints/background.ts','ReviewedBackground');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

// These are control-flow regression tests. Audio/Chrome are deterministic fakes;
// they make no browser latency, audio quality, or process-memory claim.
function engineHarness({delayWorklet=false,nativeTransport,platform='Linux x86_64'}={}){
 const workers=[],contexts=[],timeouts=[],streams=[],intervals=[];let resolveWorklet;const clock={now:Date.now()};class ClockDate extends Date{static now(){return clock.now;}}
 class Context{
  constructor(){this.state='running';this.currentTime=0;this.destination={};this.scheduled=0;this.stopped=0;this.audioWorklet={addModule:()=>delayWorklet?new Promise(resolve=>{resolveWorklet=resolve;}):Promise.resolve()};contexts.push(this);}
  async resume(){this.state='running';} async suspend(){this.state='suspended';} async close(){this.state='closed';}
  createBuffer(channels,length,sampleRate){return{duration:length/sampleRate,copyToChannel(){}};}
  createBufferSource(){const ctx=this;return{connect(){},disconnect(){},start(){ctx.scheduled++;},stop(){ctx.stopped++;}};}
 }
 class Meter{constructor(){this.port={};}connect(){}disconnect(){}}
 class Worker{
  constructor(){this.messages=[];this.terminated=false;workers.push(this);}
  postMessage(message){this.messages.push(message);}
  terminate(){this.terminated=true;}
  ready(){this.onmessage?.({data:{type:'ready'}});}
  audio(index,seconds){this.onmessage?.({data:{type:'audio',index,samples:new Float32Array(24000*seconds).fill(.1),sampleRate:24000,generationMs:10}});}
 }
 const timers={setTimeout(fn,ms){const timer={fn,ms,cleared:false};timeouts.push(timer);return timer;},clearTimeout(timer){if(timer)timer.cleared=true;},setInterval(fn){const t={fn,cleared:false};intervals.push(t);return t;},clearInterval(t){if(t)t.cleared=true;}};
 const scope={URL,location:{href:'http://localhost/'},navigator:{platform},AudioContext:Context,AudioWorkletNode:Meter,Worker,performance,Float32Array,TextEncoder,TextDecoder,DataView,Uint8Array,atob,Date:ClockDate,console,...timers};
 vm.runInNewContext(engineCode,scope);
 class Stream{
  constructor(context){this.context=context;this.audio={paused:true,preservesPitch:true,playbackRate:1,ended:false};this.start=0;this.end=0;this.position=0;this.encodedBytes=0;}
  get ahead(){return this.end-this.position;}get retainedSec(){return this.end-this.start;}get ended(){return this.audio.ended;}
  async open(){} async append(samples,rate){this.end+=samples.length/rate;this.encodedBytes+=samples.length;} async finish(){}
  async play(){if(this.audio.paused)this.context.scheduled++;this.audio.paused=false;await this.context.resume();}
  pause(){this.audio.paused=true;}speed(v){this.audio.playbackRate=v;}seek(v){this.position=Math.max(this.start,Math.min(this.end,v));this.audio.ended=false;}async evict(){}
  close(){this.context.stopped++;this.start=0;this.end=0;this.audio.paused=true;}
 }
 const states=[];const engine=new scope.ReviewedReader.ReaderEngine(state=>states.push(state),new URL('http://localhost/'),context=>{const stream=new Stream(context);streams.push(stream);return stream;},nativeTransport);
 return{engine,workers,contexts,states,timeouts,streams,advance(ms){clock.now+=ms;for(const t of intervals)if(!t.cleared)t.fn();},finishWorklet:()=>resolveWorklet?.()};
}

function fakeNativePort({postError=false}={}){
 const sent=[],messageListeners=[],disconnectListeners=[];let disconnects=0;
 const port={postMessage(message){if(postError)throw Error('closed');sent.push(message);},disconnect(){disconnects++;},onMessage:{addListener:fn=>messageListeners.push(fn)},onDisconnect:{addListener:fn=>disconnectListeners.push(fn)}};
 return{port,sent,get disconnects(){return disconnects;},receive:message=>messageListeners[0](message),drop:()=>disconnectListeners[0]()};
}

const supportedCapabilities=id=>({type:'capabilities',id,available:true,mode:'system-speech',canStop:true,canPause:false,canSeek:false,hasPcm:false});

test('Native bridge uses the host action contract, honors availability and closes idle catalog ports',async()=>{
 const {NativeMessagingBridge,NATIVE_HOST_NAME}=await moduleOf('src/lib/nativeMessaging.ts');
 const first=fakeNativePort(),second=fakeNativePort(),ports=[first,second];
 const bridge=new NativeMessagingBridge(()=>{},name=>{assert.equal(name,NATIVE_HOST_NAME);return ports.shift().port;});
 const available=bridge.listVoices(),availableRequest=first.sent.at(-1);
 assert.deepEqual(Object.keys(availableRequest).sort(),['action','id']);assert.equal(availableRequest.action,'capabilities');
 first.receive(supportedCapabilities(availableRequest.id));
 assert.deepEqual(await available,{macVoices:[{id:'macos-start-speaking',name:'Mac voice (Start Speaking)',language:'System'}]});
 assert.equal(first.disconnects,1,'an idle capability connection is disposable');
 const unavailable=bridge.listVoices(),unavailableRequest=second.sent.at(-1);
 second.receive({...supportedCapabilities(unavailableRequest.id),available:false});
 assert.deepEqual((await unavailable).macVoices,[]);assert.match((await Promise.resolve(unavailable)).macError,/unavailable|unsupported/);
 assert.equal(second.disconnects,1);
});

test('Catalog lookup shares an active speech port without closing it and stale disconnects cannot affect a replacement',async()=>{
 const {NativeMessagingBridge}=await moduleOf('src/lib/nativeMessaging.ts');
 const first=fakeNativePort(),second=fakeNativePort(),ports=[first,second],events=[];
 const bridge=new NativeMessagingBridge(message=>events.push(message),()=>ports.shift().port);
 bridge.speak('first-speech','Hello');assert.deepEqual(first.sent.at(-1),{action:'speak',id:'first-speech',text:'Hello'});
 const listing=bridge.listVoices(),request=first.sent.at(-1);assert.equal(request.action,'capabilities');
 first.receive(supportedCapabilities(request.id));assert.equal((await listing).macVoices.length,1);assert.equal(first.disconnects,0);
 first.receive({type:'ended',id:'stale'});assert.equal(events.length,0);assert.equal(first.disconnects,0);
 first.receive({type:'ended',id:'first-speech'});assert.equal(events.at(-1).type,'ended');assert.equal(first.disconnects,1);
 bridge.speak('replacement','Again');first.drop();assert.equal(events.length,1,'a late disconnect from the retired port is ignored');
 second.receive({type:'started',id:'replacement'});second.receive({type:'ended',id:'replacement'});
 assert.deepEqual(events.map(event=>event.type),['ended','started','ended']);assert.equal(second.disconnects,1);
});

test('Native stop has a bounded cancellation fallback; disconnects and send failures release their ports',async()=>{
 const {NativeMessagingBridge}=await moduleOf('src/lib/nativeMessaging.ts');
 const stopped=fakeNativePort(),events=[];const bridge=new NativeMessagingBridge(message=>events.push(message),()=>stopped.port,5);
 bridge.speak('speech','Hello');bridge.stop();assert.deepEqual(stopped.sent.at(-1),{action:'stop',id:'speech'});
 await new Promise(resolve=>setTimeout(resolve,15));assert.equal(events.at(-1).type,'cancelled');assert.equal(stopped.disconnects,1);
 const dropped=fakeNativePort(),dropEvents=[],dropBridge=new NativeMessagingBridge(message=>dropEvents.push(message),()=>dropped.port);
 dropBridge.speak('dropped','Hello');dropped.drop();assert.equal(dropEvents.at(-1).type,'error');assert.equal(dropped.disconnects,1);
 const failed=fakeNativePort({postError:true}),failedBridge=new NativeMessagingBridge(()=>{},()=>failed.port);
 assert.match((await failedBridge.listVoices()).macError,/unavailable/);assert.equal(failed.disconnects,1);
 const closed=fakeNativePort(),closeBridge=new NativeMessagingBridge(()=>{},()=>closed.port);
 closeBridge.speak('closed','Hello');closeBridge.close();assert.equal(closed.disconnects,1);
});

test('Native speech rejects text or encoded frames beyond the host limits before connecting',async()=>{
 const {NativeMessagingBridge}=await moduleOf('src/lib/nativeMessaging.ts');let connections=0;
 const bridge=new NativeMessagingBridge(()=>{},()=>{connections++;return fakeNativePort().port;});
 assert.throws(()=>bridge.speak('large-text','😀'.repeat(225_001)),/too long for Mac Start Speaking/);
 assert.throws(()=>bridge.speak('large-frame','\u0000'.repeat(200_000)),/too long for Mac Start Speaking/);
 assert.equal(connections,0);
});

let tokenizer;
async function actualTokenizer(){
 env.allowRemoteModels=false;env.localModelPath=source('src/public/models/');
 tokenizer??=await AutoTokenizer.from_pretrained('Kokoro-82M-v1.0-ONNX');return tokenizer;
}

test('Actual Kokoro preprocessing: oversized numeric text is split with exact coverage, never truncated',async()=>{
 const {guardTokenizer,SegmentTooLong,splitOversized}=await moduleOf('src/lib/tokenGuard.ts');
 const wrapper=new KokoroTTS(null,guardTokenizer(await actualTokenizer()));
 let tokenCount;wrapper.generate_from_ids=async ids=>{tokenCount=ids.dims.at(-1);assert(tokenCount<=512);return null;};
 for(const original of ['1234567890 '.repeat(20).trim(),'3.14159265358979323846264338327950288419716939937510 '.repeat(4).trim(),'$123456.78 '.repeat(19).trim(),'The gravitational wave signal carries information about source masses and orbital motion.']){
  const pending=[original],accepted=[];let divisions=0;
  while(pending.length){const piece=pending.shift();try{await wrapper.generate(piece,{voice:'af_sarah'});accepted.push(piece);}catch(error){if(!(error instanceof SegmentTooLong))throw error;divisions++;const parts=splitOversized(piece);assert.equal(parts.join(''),piece);assert(parts.every(part=>part.length>0&&part.length<piece.length));pending.unshift(...parts);}}
  assert.equal(accepted.join(''),original);if(original.startsWith('$')||original.startsWith('123'))assert(divisions>0);
 }
});

test('Speech segmentation covers ordinary and unbroken inputs without a discarded suffix',async()=>{
 const {splitSpeech,normalizeSpeechText}=await moduleOf('src/lib/speechSegments.ts');
 const {validateRequest}=await moduleOf('src/lib/readerProtocol.ts');
 for(const raw of ['Alpha.\n\nBeta '+ 'word '.repeat(150), 'x'.repeat(1500), '1 '.repeat(500), 'A full article continues beyond the old document limit. '.repeat(3000)]){
  const normalized=normalizeSpeechText(raw),pieces=splitSpeech(raw);
  assert.equal(validateRequest({text:raw}).text,normalized);
  assert(pieces.length>0);assert(pieces.every(s=>s.trim().length<=160));
  assert.equal(pieces.join('').replace(/\s/g,''),normalized.replace(/\s/g,''));
 }
});

async function launchHarness({text='A selected passage.',injectable=true,extractionError,nativePort}={}){
 const listeners={},calls=[],states=[];let exists=false,injected=false;
 const event=name=>({addListener(fn){listeners[name]=fn;}});
 const chrome={
  runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onInstalled:event('installed'),onMessage:event('message'),connectNative:()=>nativePort?.port,sendMessage:async message=>{if(message.target==='engine')calls.push(message);return{ok:true};}},
  storage:{session:{get:async()=>({}),set:async value=>{if(value.readerSnapshot)states.push(value.readerSnapshot);}},sync:{get:async()=>({})}},
  offscreen:{hasDocument:async()=>exists,createDocument:async()=>{exists=true;},closeDocument:async()=>{exists=false;},Reason:{WORKERS:'WORKERS'}},
  tabs:{query:async()=>[{id:42}],update:async(id,options)=>{calls.push({action:'focus-tab',id,...options});return{windowId:7};},sendMessage:async(id,message)=>{if(message.type==='reader:show'){calls.push({action:'show',id,focus:message.focus});if(!injected)throw Error('No receiver');return{shown:true};}},onRemoved:event('removed'),onUpdated:event('updated')},
  windows:{update:async(id,options)=>calls.push({action:'focus-window',id,...options})},
  contextMenus:{onClicked:event('context'),removeAll(){},create(){}},commands:{onCommand:event('command')},
  scripting:{executeScript:async options=>{calls.push({action:options.files?'inject':'extract'});if(options.files){if(!injectable)throw Error('Page cannot be injected');injected=true;return[];}if(extractionError)throw Error(extractionError);return[{result:text}];}},
 };
 vm.runInNewContext(backgroundCode,{chrome,defineBackground:fn=>fn(),crypto,TextEncoder,setTimeout,clearTimeout,console});
 const command=(action,fields={},sender={id:'test-extension'})=>new Promise(resolve=>listeners.message({channel:'local-reader-v2',target:'background',action,...fields},sender,resolve));
 return{calls,states,command,listeners,get exists(){return exists;}};
}

test('Long page launches mount before extraction, preserve all text and acknowledge one page player',async()=>{
 const text='The next section of the article follows. '.repeat(4000),h=await launchHarness({text});
 const result=await h.command('read-page');assert.equal(result.playerShown,true);
 assert(h.calls.findIndex(c=>c.action==='inject')<h.calls.findIndex(c=>c.action==='extract'));
 assert.equal(h.calls.find(c=>c.action==='start').request.text,text.trim());
 assert.equal(h.calls.filter(c=>c.action==='inject').length,1);
 assert.equal(h.calls.filter(c=>c.action==='show').at(-1).focus,true);
 assert.equal((await h.command('get')).snapshot.pagePlayerAvailable,true);
 await h.command('show-player');assert.equal(h.calls.find(c=>c.action==='focus-tab').id,42);
 assert.equal(h.calls.filter(c=>c.action==='start').length,1,'showing a running player does not restart synthesis');
});

test('Empty selections and extraction failures remain visible; blocked pages retain popup fallback',async()=>{
 for(const options of [{text:''},{extractionError:'Cannot extract this document'}]){
  const h=await launchHarness(options),result=await h.command('read-page',{selectionOnly:true});
  assert(result.error);assert.equal(h.states.at(-1).phase,'error');assert.equal(h.states.at(-1).pagePlayerAvailable,true);
  assert.equal(h.calls.filter(c=>c.action==='start').length,0,'invalid input never starts inference');
 }
 const h=await launchHarness({injectable:false}),result=await h.command('start',{request:{text:'A pasted passage.'}});
 assert.equal(result.playerShown,false);assert.equal((await h.command('get')).snapshot.pagePlayerAvailable,false);
 assert.equal(h.calls.filter(c=>c.action==='start').length,1,'pasted text can run with popup fallback');
});

test('Owning-tab and error cleanup disconnect an active native host',async()=>{
 for(const cleanup of ['tab-close','error']){
  const port=fakeNativePort(),h=await launchHarness({nativePort:port});
  await h.command('start',{request:{text:'Read with the Mac.',voice:'mac:macos-start-speaking'}});
  const sender={id:'test-extension',url:'chrome-extension://test-extension/offscreen.html'};
  assert.equal((await h.command('native-speak',{id:'native',text:'Read with the Mac.'},sender)).ok,true);
  if(cleanup==='tab-close')h.listeners.removed(42);else await h.command('unknown');
  await flush();await flush();
  assert.equal(port.disconnects,1);assert.equal(h.exists,false);
 }
});

test('One first clip exceeding the read-ahead limit still starts playback',async()=>{
 const h=engineHarness();await h.engine.start({text:'1 '.repeat(150),voice:'af_sarah',speed:.5},'long-first');
 h.workers[0].ready();h.workers[0].audio(0,30);await flush();
 assert.equal(h.contexts[0].scheduled,1);assert.equal(h.engine.snapshot.phase,'playing');
 assert.equal(h.workers[0].messages.filter(m=>m.type==='generate').length,1,'read-ahead remains bounded after playback starts');
 h.engine.stop();
});

test('Stop during audio initialization prevents a late worker from starting',async()=>{
 const h=engineHarness({delayWorklet:true});const starting=h.engine.start({text:'An explicitly requested passage.'},'cancel-init');
 h.engine.stop();h.finishWorklet();await starting;
 assert.equal(h.workers.length,0);assert.equal(h.contexts[0].state,'closed');assert.equal(h.engine.snapshot.phase,'idle');
});

test('Stop releases scheduled audio and ignores an old worker response after restart',async()=>{
 const h=engineHarness();await h.engine.start({text:'word '.repeat(100)},'first');const old=h.workers[0];old.ready();old.audio(0,8);await flush();
 assert(h.contexts[0].scheduled>0);h.engine.stop();
 assert.equal(old.terminated,true);assert.equal(h.contexts[0].state,'closed');assert(h.contexts[0].stopped>0);
 await h.engine.start({text:'word '.repeat(100)},'second');
 old.audio(1,8);await flush();assert.equal(h.engine.snapshot.sessionId,'second');assert.equal(h.engine.diagnostics.retainedSec,0);
 h.engine.stop();
});

test('Mac Nicole retains GPU execution and reader controls after pause, memory release and restart',async()=>{
 const h=engineHarness({platform:'MacIntel'}), request={text:'A long reading passage. '.repeat(100),voice:'af_nicole'};
 await h.engine.start(request,'nicole');const first=h.workers[0];assert.equal(first.messages[0].backend,'webgpu');
 first.ready();assert.equal(first.messages.at(-1).voice,'af_nicole');first.audio(0,14);await flush();
 assert.equal(h.engine.snapshot.phase,'playing');h.engine.setSpeed(1.25);assert.equal(h.streams[0].audio.playbackRate,1.25);
 await h.engine.pause();h.engine.seek(2);assert.equal(h.engine.snapshot.elapsedSec,2);assert.equal(h.engine.snapshot.phase,'paused');
 h.timeouts.find(t=>t.ms===30000&&!t.cleared).fn();assert.equal(first.terminated,true);
 await h.engine.resume();assert.equal(h.workers[1].messages[0].backend,'webgpu');assert.equal(h.engine.snapshot.voice,'af_nicole');assert.equal(h.streams[0].position,2);
 h.engine.stop();assert.equal(h.workers[1].terminated,true);assert.equal(h.contexts[0].state,'closed');
 await h.engine.start(request,'nicole-again');assert.equal(h.workers[2].messages[0].backend,'webgpu');h.engine.stop();
});

test('Mac Start Speaking sends the whole request and has lifecycle-only controls without Kokoro or browser audio',async()=>{
 const calls=[],h=engineHarness({nativeTransport:async(action,fields)=>{calls.push({action,...fields});return{ok:true};}});
 const article='A native passage. '+ 'Keep the whole article together. '.repeat(100);
 await h.engine.start({text:article,voice:'mac:macos-start-speaking',voiceName:'Mac voice (Start Speaking)'},'native');
 await flush();const speech=calls.find(call=>call.action==='native-speak');assert(speech);assert.equal(speech.text,article.trim());
 assert.equal(h.workers.length,0);assert.equal(h.contexts.length,0);assert.equal(h.streams.length,0);assert.equal(h.engine.snapshot.speechMode,'system');assert.equal(h.engine.snapshot.durationSec,null);
 h.engine.handleNativeMessage({type:'started',id:'stale'});await flush();assert.equal(h.engine.snapshot.phase,'preparing');
 h.engine.handleNativeMessage({type:'started',id:speech.id});await flush();assert.equal(h.engine.snapshot.phase,'playing');assert.equal(h.engine.snapshot.elapsedSec,0);
 h.engine.handleNativeMessage({type:'ended',id:speech.id});await flush();assert.equal(h.engine.snapshot.phase,'complete');assert.equal(h.engine.snapshot.generatedChunks,1);
 await h.engine.resume();await flush();const replay=calls.filter(call=>call.action==='native-speak').at(-1);assert.notEqual(replay.id,speech.id);assert.equal(replay.text,article.trim());
 h.engine.stop();await flush();assert(calls.some(call=>call.action==='native-stop'&&call.id===replay.id));
});

test('A missing Mac helper reports an error and never falls back to Kokoro',async()=>{
 const calls=[],h=engineHarness({nativeTransport:async(action,fields)=>{calls.push({action,...fields});return action==='native-speak'?{error:'The Mac voice helper is unavailable. Install or repair it, then try again.'}:{ok:true};}});
 await h.engine.start({text:'Use only the requested source.',voice:'mac:macos-start-speaking',voiceName:'Mac voice (Start Speaking)'},'native-missing');await flush();await flush();
 assert.equal(h.engine.snapshot.phase,'error');assert.match(h.engine.snapshot.error,/Mac voice helper is unavailable/);assert.equal(h.workers.length,0);assert.equal(h.contexts.length,0);assert.equal(calls.filter(call=>call.action==='native-speak').length,1);
});

test('Stopping active Mac system speech stops its native request',async()=>{
 const calls=[],h=engineHarness({nativeTransport:async(action,fields)=>{calls.push({action,...fields});return{ok:true};}});
 await h.engine.start({text:'Stop this passage.',voice:'mac:macos-start-speaking',voiceName:'Mac voice (Start Speaking)'},'native-stop');await flush();const active=calls.find(call=>call.action==='native-speak');
 h.engine.handleNativeMessage({type:'started',id:active.id});await flush();await h.engine.pause();assert.equal(h.engine.snapshot.phase,'complete');assert.match(h.engine.snapshot.message,/Stopped/);assert(calls.some(call=>call.action==='native-stop'&&call.id===active.id));assert.equal(h.workers.length,0);assert.equal(h.contexts.length,0);
});

test('A long pause releases the worker; resume retains buffers and creates only one replacement',async()=>{
 const h=engineHarness();await h.engine.start({text:'word '.repeat(100)},'pause');const old=h.workers[0];old.ready();old.audio(0,8);await flush();
 await h.engine.pause();assert.equal(h.contexts[0].state,'suspended');
 const release=h.timeouts.find(t=>t.ms===30_000&&!t.cleared);assert(release);release.fn();
 assert.equal(old.terminated,true);assert.equal(h.engine.diagnostics.modelResident,false);assert.equal(h.engine.snapshot.phase,'paused');
 const existingSources=h.engine.diagnostics.retainedSec;await h.engine.resume();
 assert.equal(h.workers.length,2);assert.equal(h.contexts[0].state,'running');assert.equal(h.engine.diagnostics.retainedSec,existingSources);
 old.audio(1,8);assert.equal(h.engine.diagnostics.retainedSec,existingSources,'late old response is ignored');
 h.engine.stop();
});

async function backgroundHarness(action){
 const listeners={};let exists=true,releaseRecovery;const events=name=>({addListener(fn){listeners[name]=fn;}});
 const active={phase:'playing',sessionId:'retained-session',voice:'af_sarah',speed:1,elapsedSec:12,durationSec:120,bufferedSec:15,modelResident:true};
 const chrome={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onInstalled:events('installed'),onMessage:events('message'),sendMessage:async m=>m.target==='engine'&&m.action==='get'?{snapshot:active}:{ok:true}},storage:{session:{set:async()=>{},get:()=>new Promise(resolve=>{releaseRecovery=()=>resolve({readerOwnerTab:42});})},sync:{get:async()=>({})}},offscreen:{hasDocument:async()=>exists,closeDocument:async()=>{exists=false;},createDocument:async()=>{},Reason:{WORKERS:'WORKERS'}},tabs:{query:async()=>[{id:42}],sendMessage:async()=>{},onRemoved:events('removed'),onUpdated:events('updated')},contextMenus:{onClicked:events('context'),removeAll(){},create(){}},commands:{onCommand:events('command')},scripting:{executeScript:async()=>[]}};
 vm.runInNewContext(backgroundCode,{chrome,defineBackground:fn=>fn(),crypto,setTimeout,clearTimeout,console});
 let response;
 if(action==='get')listeners.message({channel:'local-reader-v2',target:'background',action:'get'},{id:'test-extension'},r=>response=r);
 if(action==='close')listeners.removed(42);
 if(action==='navigation')listeners.updated(42,{status:'loading'});
 if(action==='unrelated')listeners.removed(99);
 releaseRecovery();await flush();await flush();return{exists,response};
}

test('Recovery precedes state queries and owning-tab cleanup, including events arriving during recovery',async()=>{
 assert.equal((await backgroundHarness('get')).response?.snapshot.sessionId,'retained-session');
 assert.equal((await backgroundHarness('close')).exists,false);
 assert.equal((await backgroundHarness('navigation')).exists,false);
 assert.equal((await backgroundHarness('unrelated')).exists,true);
});

// Current controls act on retained source-time audio, independently of synthesis speed.
test('Speed changes current playback once; seeking clamps to the generated range',async()=>{
 const h=engineHarness();await h.engine.start({text:'word '.repeat(100),speed:1.5},'controls');h.workers[0].ready();h.workers[0].audio(0,30);await flush();
 assert.equal(h.workers[0].messages.find(m=>m.type==='generate').speed,1);
 h.engine.setSpeed(2);assert.equal(h.engine.diagnostics.playbackRate,2);assert.equal(h.engine.diagnostics.preservesPitch,true);
 h.engine.seek(-15);assert.equal(h.engine.snapshot.elapsedSec,0);h.engine.seek(100);assert.equal(h.engine.snapshot.elapsedSec,30);
 await h.engine.pause();h.engine.seek(8);assert.equal(h.engine.snapshot.elapsedSec,8);assert.equal(h.engine.snapshot.phase,'paused');
 assert.throws(()=>h.engine.setSpeed(0));h.engine.stop();assert.equal(h.engine.diagnostics.encodedStreamResident,false);
});

test('Unknown duration remains unknown until synthesis completes; future audio cannot be selected',async()=>{
 const h=engineHarness();await h.engine.start({text:'word '.repeat(100)},'range');h.workers[0].ready();h.workers[0].audio(0,10);await flush();
 assert.equal(h.engine.snapshot.durationSec,null);assert.equal(h.engine.snapshot.seekableEndSec,10);h.engine.seek(500);assert.equal(h.engine.snapshot.elapsedSec,10);h.engine.stop();assert.equal(h.engine.snapshot.seekableEndSec,undefined);
});

test('Completed replay retains a finite deadline after seek or replay-pause, then clears audio',async()=>{
 const h=engineHarness();await h.engine.start({text:'A short passage.'},'expiry');h.workers[0].ready();h.workers[0].audio(0,8);await flush();const stream=h.streams[0];stream.position=8;stream.audio.ended=true;h.advance(1);assert.equal(h.engine.snapshot.phase,'complete');const firstDeadline=h.engine.snapshot.replayExpiresAt;assert(firstDeadline);
 h.engine.seek(3);assert.equal(h.engine.snapshot.phase,'paused');assert(h.engine.snapshot.replayExpiresAt>=firstDeadline);await h.engine.resume();assert.equal(h.engine.snapshot.replayExpiresAt,undefined);await h.engine.pause();assert(h.engine.snapshot.replayExpiresAt);h.advance(120001);assert.equal(h.engine.snapshot.seekableEndSec,0);assert.equal(h.engine.diagnostics.encodedStreamResident,false);assert.equal(h.contexts[0].state,'closed');
});
