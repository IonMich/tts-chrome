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

function fakeNativePort({postError=false,autoShutdown=true}={}){
 const sent=[],messageListeners=[],disconnectListeners=[];let disconnects=0;
 const port={postMessage(message){if(postError)throw Error('closed');sent.push(message);if(autoShutdown&&message.action==='shutdown')queueMicrotask(()=>messageListeners[0]?.({type:'shutdown-complete',id:message.id,stopped:true,processExited:true}));},disconnect(){disconnects++;},onMessage:{addListener:fn=>messageListeners.push(fn)},onDisconnect:{addListener:fn=>disconnectListeners.push(fn)}};
 return{port,sent,get disconnects(){return disconnects;},receive:message=>messageListeners[0](message),drop:()=>disconnectListeners[0]()};
}

const supportedCapabilities=id=>({type:'capabilities',id,available:true,mode:'system-speech',canStop:true,canPause:false,canSeek:false,hasPcm:false,protocolVersion:2,shutdownAcknowledgement:1});

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
 assert.deepEqual((await unavailable).macVoices,[]);assert.match((await Promise.resolve(unavailable)).macError,/Update the Mac voice helper/);
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
 first.receive({type:'ended',id:'first-speech'});assert.equal(events.at(-1).type,'ended');const shutdown=first.sent.at(-1);assert.equal(shutdown.action,'shutdown');assert.equal(first.disconnects,0);await flush();assert.equal(first.disconnects,1);
 bridge.speak('replacement','Again');first.drop();assert.equal(events.length,1,'a late disconnect from the retired port is ignored');
 second.receive({type:'started',id:'replacement'});second.receive({type:'ended',id:'replacement'});await flush();await flush();
 assert.deepEqual(events.map(event=>event.type),['ended','started','ended']);assert.equal(second.sent.at(-1).action,'shutdown');
});

test('Native stop has a bounded, truthful timeout failure; disconnects and send failures release their ports',async()=>{
 const {NativeMessagingBridge}=await moduleOf('src/lib/nativeMessaging.ts');
 const stopped=fakeNativePort(),events=[];const bridge=new NativeMessagingBridge(message=>events.push(message),()=>stopped.port,5);
 bridge.speak('speech','Hello');bridge.stop();assert.deepEqual(stopped.sent.at(-1),{action:'stop',id:'speech'});
 await new Promise(resolve=>setTimeout(resolve,15));assert.equal(events.at(-1).type,'error');assert.equal(events.at(-1).error,'stop-timeout');assert.equal(stopped.disconnects,1);
 const dropped=fakeNativePort(),dropEvents=[],dropBridge=new NativeMessagingBridge(message=>dropEvents.push(message),()=>dropped.port);
 dropBridge.speak('dropped','Hello');dropped.drop();assert.equal(dropEvents.at(-1).type,'error');assert.equal(dropped.disconnects,1);
 const failed=fakeNativePort({postError:true}),failedBridge=new NativeMessagingBridge(()=>{},()=>failed.port);
 assert.match((await failedBridge.listVoices()).macError,/unavailable/);assert.equal(failed.disconnects,1);
 const closed=fakeNativePort(),closeBridge=new NativeMessagingBridge(()=>{},()=>closed.port);
 closeBridge.speak('closed','Hello');const closing=closeBridge.close();assert.equal(closed.disconnects,0);await closing;assert.equal(closed.disconnects,1);
});

test('Native speech rejects text or encoded frames beyond the host limits before connecting',async()=>{
 const {NativeMessagingBridge}=await moduleOf('src/lib/nativeMessaging.ts');let connections=0;
 const bridge=new NativeMessagingBridge(()=>{},()=>{connections++;return fakeNativePort().port;});
 assert.throws(()=>bridge.speak('large-text','😀'.repeat(225_001)),/too long for Mac Start Speaking/);
 assert.throws(()=>bridge.speak('large-frame','\u0000'.repeat(200_000)),/too long for Mac Start Speaking/);
 assert.equal(connections,0);
});

test('Shutdown requires its matching process-exit acknowledgement and concurrent callers share failure',async()=>{
 const {NativeMessagingBridge}=await moduleOf('src/lib/nativeMessaging.ts');
 const port=fakeNativePort({autoShutdown:false}),bridge=new NativeMessagingBridge(()=>{},()=>port.port,5);
 bridge.speak('owned','Read.');const first=bridge.shutdown(),second=bridge.shutdown(),request=port.sent.at(-1);
 port.receive({type:'shutdown-complete',id:'stale',stopped:true,processExited:true});assert.equal(port.disconnects,0);
 await assert.rejects(first,/verify shutdown/);await assert.rejects(second,/verify shutdown/);
 assert.equal(request.action,'shutdown');assert.throws(()=>bridge.speak('successor','Blocked.'),/verify shutdown/);
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
 const {splitSpeech,normalizeSpeechText,MAX_SPEECH_CHUNK_LENGTH}=await moduleOf('src/lib/speechSegments.ts');
 const {validateRequest}=await moduleOf('src/lib/readerProtocol.ts');
 for(const raw of ['Alpha.\n\nBeta '+ 'word '.repeat(150), 'x'.repeat(1500), '1 '.repeat(500), 'A full article continues beyond the old document limit. '.repeat(3000)]){
  const normalized=normalizeSpeechText(raw),pieces=splitSpeech(raw);
  assert.equal(validateRequest({text:raw}).text,normalized);
  assert(pieces.length>0);assert(pieces.every(s=>s.trim().length<=MAX_SPEECH_CHUNK_LENGTH));
  assert.equal(pieces.join('').replace(/\s/g,''),normalized.replace(/\s/g,''));
 }
});

test('Actual Kokoro preprocessing accepts the Kennedy Center sentence without a token-driven split',async()=>{
 const {sourceSpeechChunks}=await moduleOf('src/lib/speechPosition.ts');
 const {guardTokenizer}=await moduleOf('src/lib/tokenGuard.ts');
 const first='A storm brought down a five-foot piece of ceiling plaster at the John F. Kennedy Center for the Performing Arts this month and its leadership sprang into action.';
 const second='One thing they did not do was repair the damage.';
 const chunks=sourceSpeechChunks(first+' '+second),counts=[];
 assert.equal(chunks.length,2);assert.equal(chunks[0].text,first);
 const wrapper=new KokoroTTS(null,guardTokenizer(await actualTokenizer()));
 wrapper.generate_from_ids=async ids=>{counts.push(ids.dims.at(-1));return null;};
 for(const chunk of chunks)await wrapper.generate(chunk.text,{voice:'af_nicole'});
 assert.equal(counts.length,2);assert(counts.every(count=>count<=512));
});

async function launchHarness({text='A selected passage.',injectable=true,extractionError,nativePort,mappedSource,settings={}}={}){
 const listeners={},calls=[],states=[];let exists=false,injected=false;
 const event=name=>({addListener(fn){listeners[name]=fn;}});
 const chrome={
  runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onInstalled:event('installed'),onMessage:event('message'),connectNative:()=>nativePort?.port,sendMessage:async message=>{if(message.target==='engine')calls.push(message);return{ok:true};}},
  storage:{session:{get:async()=>({}),set:async value=>{if(value.readerSnapshot)states.push(value.readerSnapshot);}},sync:{get:async()=>({...settings})}},
  offscreen:{hasDocument:async()=>exists,createDocument:async()=>{exists=true;},closeDocument:async()=>{exists=false;},Reason:{WORKERS:'WORKERS'}},
  tabs:{query:async()=>[{id:42}],update:async(id,options)=>{calls.push({action:'focus-tab',id,...options});return{windowId:7};},sendMessage:async(id,message)=>{if(message.type==='reader:show'){calls.push({action:'show',id,focus:message.focus});if(!injected)throw Error('No receiver');return{shown:true};}if(message.type==='reader:extract'){calls.push({action:'source-extract',...message});return mappedSource;}},onRemoved:event('removed'),onUpdated:event('updated')},
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

test('Mapped page capture shares its session/source tuple, and Stop publishes the released tuple',async()=>{
 const h=await launchHarness({mappedSource:{text:'A😀 sentence.\nAnother one.',sourceId:'source-dom'}});
 await h.command('read-page',{selectionOnly:true});const start=h.calls.find(c=>c.action==='start');
 assert.equal(start.request.sourceId,'source-dom');assert.equal(start.request.text,'A😀 sentence.\nAnother one.');
 const capture=h.calls.find(c=>c.action==='source-extract');assert.equal(capture.sessionId,start.sessionId);assert.equal(capture.selectionOnly,true);
 assert.equal(h.calls.filter(c=>c.action==='extract').length,0,'no second text extraction can change the mapping');
 await h.command('stop');const stopped=h.states.at(-1);assert.equal(stopped.phase,'idle');assert.equal(stopped.sessionId,start.sessionId);assert.equal(stopped.sourceId,'source-dom');
});

test('Context-menu selections retain text fallback on blocked documents and never borrow another frame source',async()=>{
 for(const frameId of [0,3]){
  const h=await launchHarness({injectable:false,extractionError:'Cannot extract this document',mappedSource:frameId?{text:'Wrong top-frame selection.',sourceId:'wrong'}:undefined});
  h.listeners.context({menuItemId:'readText',selectionText:'Requested selection.',frameId},{id:42});await h.command('get');
  const start=h.calls.find(c=>c.action==='start');assert.equal(start.request.text,'Requested selection.');assert.equal(start.request.sourceId,undefined);
 }
});

test('Every selection launch uses the saved voice ID even when its cached name belongs to another engine',async()=>{
 for(const [voice,staleName,expectedName] of [
  ['af_nicole','Mac voice (Start Speaking)','Nicole · American'],
  ['mac:macos-start-speaking','Nicole · American','Mac voice (Start Speaking)'],
 ]){
  for(const route of ['context','frame-context','shortcut','popup']){
   const h=await launchHarness({settings:{voice,voiceName:staleName,speed:1.25}});
   if(route==='context'||route==='frame-context')h.listeners.context({menuItemId:'readText',selectionText:'A selected passage.',frameId:route==='frame-context'?3:0},{id:42});
   else if(route==='shortcut')h.listeners.command('trigger_tts');
   else await h.command('read-page',{selectionOnly:true});
   const result=await h.command('get');
   const start=h.calls.find(call=>call.action==='start');
   assert(start,route);assert.equal(start.request.voice,voice);assert.equal(start.request.voiceName,expectedName);assert.equal(start.request.speed,1.25);
   assert.equal(result.snapshot.voice,voice);assert.equal(result.snapshot.voiceName,expectedName);
   assert.equal(result.snapshot.speechMode,voice.startsWith('mac:')?'system':undefined);
  }
 }
});

test('The engine label and synthesis route agree despite stale caller voice metadata',async()=>{
 const nativeCalls=[],h=engineHarness({nativeTransport:async(action,fields)=>{nativeCalls.push({action,...fields});return{ok:true};}});
 await h.engine.start({text:'A selected passage.',voice:'af_nicole',voiceName:'Mac voice (Start Speaking)'},'kokoro-label');
 h.workers[0].ready();await flush();
 assert.equal(h.workers[0].messages.find(message=>message.type==='generate').voice,'af_nicole');
 assert.equal(h.engine.snapshot.voiceName,'Nicole · American');assert.equal(h.engine.snapshot.speechMode,undefined);assert.equal(nativeCalls.length,0);
 h.engine.stop();
 await h.engine.start({text:'A selected passage.',voice:'mac:macos-start-speaking',voiceName:'Nicole · American'},'native-label');
 assert.equal(h.workers.length,1,'the Mac request must not create another Kokoro worker');
 assert.equal(nativeCalls.filter(call=>call.action==='native-speak').length,1);
 assert.equal(h.engine.snapshot.voiceName,'Mac voice (Start Speaking)');assert.equal(h.engine.snapshot.speechMode,'system');
 h.engine.stop();
});

test('Owning-tab and error cleanup disconnect an active native host',async()=>{
 for(const cleanup of ['tab-close','error']){
  const port=fakeNativePort(),h=await launchHarness({nativePort:port});
  const started=await h.command('start',{request:{text:'Read with the Mac.',voice:'mac:macos-start-speaking'}});
  const sender={id:'test-extension',url:'chrome-extension://test-extension/offscreen.html'};
  const speaking=h.command('native-speak',{id:started.snapshot.sessionId+':1:1',text:'Read with the Mac.'},sender);await flush();const capability=port.sent.find(message=>message.action==='capabilities');port.receive(supportedCapabilities(capability.id));assert.equal((await speaking).ok,true);
  if(cleanup==='tab-close')h.listeners.removed(42);else await h.command('unknown');
  await flush();await flush();
  assert(port.disconnects>=1);assert.equal(h.exists,false);
 }
});

test('One first clip exceeding the read-ahead limit still starts playback',async()=>{
 const h=engineHarness();await h.engine.start({text:'1 '.repeat(150),voice:'af_sarah',speed:.5},'long-first');
 h.workers[0].ready();h.workers[0].audio(0,30);await flush();
 assert.equal(h.contexts[0].scheduled,1);assert.equal(h.engine.snapshot.phase,'playing');
 assert.equal(h.workers[0].messages.filter(m=>m.type==='generate').length,1,'read-ahead remains bounded after playback starts');
 h.engine.stop();
});

test('Source sentence position follows media playback, pause, seek and replay rather than generation or wall time',async()=>{
 const h=engineHarness();await h.engine.start({text:'Same sentence. Same sentence.',sourceId:'source-a'},'source-session');
 const worker=h.workers[0];worker.ready();worker.audio(0,5);await flush();worker.audio(1,7);await flush();
 const position=()=>JSON.parse(JSON.stringify(h.engine.snapshot.spokenPosition));
 assert.equal(h.engine.snapshot.generatedChunks,2);
 assert.deepEqual(position(),{precision:'sentence',start:0,end:14});
 h.advance(20000);assert.deepEqual(position(),{precision:'sentence',start:0,end:14},'generation/wall time do not select a later sentence');
 h.streams[0].position=5.1;h.advance(250);assert.deepEqual(position(),{precision:'sentence',start:15,end:29});
 await h.engine.pause();h.advance(20000);assert.equal(h.engine.snapshot.phase,'paused');assert.equal(position().start,15);
 h.engine.seek(1);assert.equal(position().start,0);assert.equal(h.engine.snapshot.phase,'paused');
 h.engine.setSpeed(1.5);assert.equal(position().start,0);await h.engine.resume();assert.equal(position().start,0);
 h.streams[0].position=12;h.streams[0].audio.ended=true;h.advance(250);assert.equal(h.engine.snapshot.phase,'complete');assert.equal(position().precision,'unavailable');
 await h.engine.resume();assert.equal(position().start,0,'replay uses the retained media start');
 h.engine.stop();assert.equal(h.engine.snapshot.phase,'idle');assert.equal(h.engine.snapshot.sourceId,undefined);
});

test('Retained source cues evict with audio and replacement/failure cannot retain old spoken positions',async()=>{
 const h=engineHarness();await h.engine.start({text:'First sentence. Second sentence.',sourceId:'source-a'},'first');
 const old=h.workers[0];old.ready();old.audio(0,5);await flush();old.audio(1,8);await flush();
 h.streams[0].start=5.5;h.engine.seek(0);assert.equal(h.engine.snapshot.spokenPosition.start,16);
 await h.engine.start({text:'Replacement sentence.',sourceId:'source-b'},'second');old.audio(1,8);await flush();
 assert.equal(h.engine.snapshot.sourceId,'source-b');assert.equal(h.engine.snapshot.spokenPosition.precision,'unavailable');
 h.workers[1].ready();h.workers[1].onmessage({data:{type:'error',error:'Injected generation failure'}});await flush();
 assert.equal(h.engine.snapshot.phase,'error');assert.equal(h.engine.snapshot.spokenPosition.precision,'unavailable');h.engine.stop();
});

test('Worker token split keeps the parent source sentence across both actual audio cues',async()=>{
 const h=engineHarness();await h.engine.start({text:'A long sentence has many words.',sourceId:'source-split'},'split');
 const worker=h.workers[0];worker.ready();const text=worker.messages.at(-1).text;
 worker.onmessage({data:{type:'split',index:0,parts:[text.slice(0,16),text.slice(16)]}});await flush();
 worker.audio(0,5);await flush();worker.audio(1,5);await flush();h.streams[0].position=6;h.advance(250);
 assert.equal(h.engine.snapshot.spokenPosition.start,0);assert.equal(h.engine.snapshot.spokenPosition.end,31);h.engine.stop();
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
 h.engine.handleNativeMessage({type:'started',id:active.id});await flush();await h.engine.pause();assert.equal(h.engine.snapshot.stopping,true);h.engine.handleNativeMessage({type:'cancelled',id:active.id});await flush();assert.equal(h.engine.snapshot.phase,'complete');assert.equal(h.engine.snapshot.stopReason,'user');assert.match(h.engine.snapshot.message,/Stopped/);assert(calls.some(call=>call.action==='native-stop'&&call.id===active.id));assert.equal(h.workers.length,0);assert.equal(h.contexts.length,0);
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

test('Native Stop waits for terminal acknowledgement and ignores a late started signal',async()=>{
 const calls=[],h=engineHarness({nativeTransport:async(action,fields)=>{calls.push({action,...fields});return{ok:true};}});
 await h.engine.start({text:'Stop before startup completes.',voice:'mac:macos-start-speaking'},'stopping');
 const id=calls.find(c=>c.action==='native-speak').id;
 await h.engine.pause();
 assert.notEqual(h.engine.snapshot.phase,'complete','transport acceptance does not confirm speech stopped');
 assert.equal(h.engine.snapshot.stopping,true);
 h.engine.handleNativeMessage({type:'started',id});await flush();
 assert.notEqual(h.engine.snapshot.phase,'playing');
 h.engine.handleNativeMessage({type:'cancelled',id});await flush();
 assert.equal(h.engine.snapshot.phase,'complete');assert.equal(h.engine.snapshot.stopReason,'user');
 assert.equal(h.engine.snapshot.stopping,false);h.engine.stop();
});

test('A deferred native Stop response cannot overwrite replacement or closed sessions',async()=>{
 for(const replacement of [false,true]){
  const finishStops=[];const h=engineHarness({nativeTransport:(action)=>action==='native-stop'?new Promise(resolve=>{finishStops.push(resolve);}):Promise.resolve({ok:true})});
  await h.engine.start({text:'Original.',voice:'mac:macos-start-speaking'},'old');
  const stop=h.engine.pause();h.engine.stop();
  if(replacement)await h.engine.start({text:'Replacement.',voice:'mac:macos-start-speaking'},'new');
  for(const finishStop of finishStops)finishStop({ok:true});await stop;
  assert.equal(h.engine.snapshot.phase,replacement?'preparing':'idle');
  assert.equal(h.engine.snapshot.sessionId,replacement?'new':undefined);h.engine.stop();
 }
});

test('Native bridge terminal listeners may start replacement without losing its active port',async()=>{
 const {NativeMessagingBridge}=await moduleOf('src/lib/nativeMessaging.ts');const port=fakeNativePort(),events=[];
 const bridge=new NativeMessagingBridge(message=>{events.push(message);if(message.id==='old')bridge.speak('new','Replacement.');},()=>port.port);
 bridge.speak('old','Original.');port.receive({type:'ended',id:'old'});
 assert.equal(port.disconnects,0);
 port.receive({type:'started',id:'new'});assert.equal(events.at(-1).id,'new');bridge.close();
});

test('Native Stop failure stays an error and late Stop failure cannot corrupt a replacement',async()=>{
 for(const replace of [false,true]){
  const pending=[],h=engineHarness({nativeTransport:action=>action==='native-stop'?new Promise(resolve=>pending.push(resolve)):Promise.resolve({ok:true})});
  await h.engine.start({text:'Original.',voice:'mac:macos-start-speaking',sourceId:'source-a'},'a');const stop=h.engine.pause();
  if(replace)await h.engine.start({text:'New.',voice:'mac:macos-start-speaking',sourceId:'source-b'},'b');
  pending.forEach(resolve=>resolve({error:'Stop failed'}));await stop;
  assert.equal(h.engine.snapshot.phase,replace?'preparing':'error');assert.equal(h.engine.snapshot.stopping,false);
  assert.equal(h.engine.snapshot.stopReason,undefined);assert.equal(h.engine.snapshot.sourceId,replace?'source-b':'source-a');
  assert.equal(h.engine.snapshot.spokenPosition.precision,'unavailable');h.engine.stop();
 }
});

test('Native Stop is idempotent while pending and replay clears Stopped without changing the source',async()=>{
 const calls=[],h=engineHarness({nativeTransport:async(action,fields)=>{calls.push({action,...fields});return{ok:true};}});
 await h.engine.start({text:'Full source retained.',voice:'mac:macos-start-speaking',sourceId:'source'},'session');
 const first=calls.find(c=>c.action==='native-speak');await h.engine.pause();await h.engine.pause();
 assert.equal(calls.filter(c=>c.action==='native-stop').length,1);
 h.engine.handleNativeMessage({type:'ended',id:first.id});await flush();assert.equal(h.engine.snapshot.stopReason,'user');
 await h.engine.resume();const replay=calls.filter(c=>c.action==='native-speak').at(-1);
 assert.equal(replay.text,first.text);assert.notEqual(replay.id,first.id);assert.equal(h.engine.snapshot.sourceId,'source');
 assert.equal(h.engine.snapshot.stopReason,undefined);assert.equal(h.engine.snapshot.stopping,false);
 h.engine.handleNativeMessage({type:'cancelled',id:first.id});await flush();assert.equal(h.engine.snapshot.phase,'preparing');
 h.engine.stop();
});

const switchText='First sentence is already behind us. Second sentence should continue here. Third sentence finishes the reading.';
const availableNative={macVoices:[{id:'macos-start-speaking'}]};
async function playingSwitchHarness(options={}){
 const h=engineHarness(options);await h.engine.start({text:switchText,sourceId:options.sourceId,voice:'af_sarah'},'voice-session');
 const worker=h.workers[0];worker.ready();worker.audio(0,6);await flush();worker.audio(1,6);await flush();
 h.engine.seek(7);return h;
}

test('Changing Kokoro voice continues the current sentence for mapped selections and unmapped pasted text',async()=>{
 for(const sourceId of [undefined,'original-source']){
  const h=await playingSwitchHarness({sourceId}),old=h.workers[0],oldStream=h.streams[0];
  h.engine.setSpeed(1.5);await h.engine.changeVoice('af_nicole','voice-session');
  assert.equal(h.engine.snapshot.sessionId,'voice-session');assert.equal(h.engine.snapshot.sourceId,sourceId);
  assert.equal(h.engine.snapshot.voice,'af_nicole');assert.equal(h.engine.snapshot.speed,1.5);assert.equal(old.terminated,true);assert.equal(oldStream.end,0);
  const next=h.workers[1];next.ready();assert.equal(next.messages.at(-1).text,'Second sentence should continue here.');assert.equal(next.messages.at(-1).voice,'af_nicole');
  old.audio(2,6);await flush();assert.equal(h.streams[1].end,0,'late old audio is discarded');
  next.audio(0,6);await flush();assert.equal(h.engine.snapshot.phase,'playing');
  if(sourceId)assert.equal(h.engine.snapshot.spokenPosition.start,switchText.indexOf('Second'));
  else assert.equal(h.engine.snapshot.spokenPosition.precision,'unavailable','unmapped sources do not claim DOM highlighting');
  h.engine.stop();
 }
});

test('Changing a paused voice stays silent; Play generates the selected voice at the original sentence',async()=>{
 const h=await playingSwitchHarness({sourceId:'original-source'});await h.engine.pause();
 await h.engine.changeVoice('bf_lily','voice-session');
 assert.equal(h.engine.snapshot.phase,'paused');assert.equal(h.workers.length,1);assert.equal(h.contexts[1].state,'suspended');assert.equal(h.streams[1].audio.paused,true);
 await h.engine.resume();const replacement=h.workers[1];replacement.ready();assert.equal(replacement.messages.at(-1).voice,'bf_lily');assert.equal(replacement.messages.at(-1).text,'Second sentence should continue here.');
 replacement.audio(0,6);await flush();assert.equal(h.engine.snapshot.phase,'playing');assert.equal(h.engine.snapshot.spokenPosition.start,switchText.indexOf('Second'));h.engine.stop();
});

test('Successive voice changes retain full original offsets and completed replay starts the original passage',async()=>{
 const h=await playingSwitchHarness({sourceId:'original-source'});await h.engine.changeVoice('af_nicole');let next=h.workers[1];next.ready();next.audio(0,6);await flush();next.audio(1,6);await flush();
 h.engine.seek(7);await h.engine.changeVoice('bm_fable');next=h.workers[2];next.ready();assert.equal(next.messages.at(-1).text,'Third sentence finishes the reading.\n');
 next.audio(0,6);await flush();assert.equal(h.engine.snapshot.spokenPosition.start,switchText.indexOf('Third'));
 h.streams[2].position=6;h.streams[2].audio.ended=true;h.advance(1);assert.equal(h.engine.snapshot.phase,'complete');
 await h.engine.resume();const replay=h.workers[3];replay.ready();assert.equal(replay.messages.at(-1).text,'First sentence is already behind us.');assert.equal(replay.messages.at(-1).voice,'bm_fable');assert.equal(h.engine.snapshot.sourceId,'original-source');h.engine.stop();
});

test('Kokoro to native keeps the current sentence and paused intent; native replay retains the original passage',async()=>{
 for(const paused of [false,true]){
  const calls=[],h=await playingSwitchHarness({sourceId:'source',nativeTransport:async(action,fields)=>{calls.push({action,...fields});return action==='native-list'?availableNative:{ok:true};}});
  if(paused)await h.engine.pause();await h.engine.changeVoice('mac:macos-start-speaking','voice-session');
  assert.equal(h.engine.snapshot.sourceId,'source');assert.equal(h.engine.snapshot.speechMode,'system');assert.equal(h.contexts[0].state,'closed');
  if(paused){assert.equal(h.engine.snapshot.phase,'paused');assert.equal(calls.filter(c=>c.action==='native-speak').length,0);await h.engine.resume();}
  const speech=calls.find(c=>c.action==='native-speak');assert.equal(speech.text,switchText.slice(switchText.indexOf('Second')));
  h.engine.handleNativeMessage({type:'ended',id:speech.id});await flush();await h.engine.resume();assert.equal(calls.filter(c=>c.action==='native-speak').at(-1).text,switchText);h.engine.stop();
 }
});

test('Native to Kokoro waits for confirmed Stop and ignores late native lifecycle messages',async()=>{
 const calls=[],h=engineHarness({nativeTransport:async(action,fields)=>{calls.push({action,...fields});return{ok:true};}});
 await h.engine.start({text:switchText,sourceId:'source',voice:'mac:macos-start-speaking'},'voice-session');const native=calls.find(c=>c.action==='native-speak');h.engine.handleNativeMessage({type:'started',id:native.id});await flush();
 const changing=h.engine.changeVoice('af_nicole','voice-session');await flush();assert(calls.some(c=>c.action==='native-stop'&&c.id===native.id));assert.equal(h.workers.length,0);assert.equal(h.engine.snapshot.voice,'mac:macos-start-speaking');
 h.engine.handleNativeMessage({type:'started',id:native.id});await flush();assert.equal(h.workers.length,0);
 h.engine.handleNativeMessage({type:'cancelled',id:native.id});await changing;
 assert.equal(h.engine.snapshot.voice,'af_nicole');assert.equal(h.engine.snapshot.sourceId,'source');h.workers[0].ready();assert.equal(h.workers[0].messages.at(-1).text,'First sentence is already behind us.');
 h.engine.handleNativeMessage({type:'ended',id:native.id});h.engine.handleNativeMessage({type:'error',id:native.id,message:'Old native error'});await flush();assert.equal(h.engine.snapshot.voice,'af_nicole');assert.notEqual(h.engine.snapshot.phase,'complete');assert.notEqual(h.engine.snapshot.phase,'error');h.engine.stop();
});

test('Voice validation, native preflight and stale session rejection preserve active audio',async()=>{
 const h=await playingSwitchHarness({nativeTransport:async()=>({macVoices:[],macError:'The Mac helper is unavailable.'})}),stream=h.streams[0],worker=h.workers[0];
 await assert.rejects(h.engine.changeVoice('no-such-voice'),/not available/);
 await assert.rejects(h.engine.changeVoice('af_nicole','old-session'),/session ended/);
 await assert.rejects(h.engine.changeVoice('mac:macos-start-speaking'),/Mac helper is unavailable/);
 assert.equal(h.engine.snapshot.voice,'af_sarah');assert.equal(h.engine.snapshot.phase,'playing');assert.equal(worker.terminated,false);assert.equal(stream.position,7);assert.equal(stream.audio.paused,false);h.engine.stop();
});

test('Rapid changes and a delayed native preflight cannot revive an older voice',async()=>{
 let finishCatalog;const h=await playingSwitchHarness({nativeTransport:()=>new Promise(resolve=>{finishCatalog=resolve;})});
 const toNative=h.engine.changeVoice('mac:macos-start-speaking');const rejected=assert.rejects(toNative,/session ended/);
 await h.engine.changeVoice('af_nicole');await h.engine.changeVoice('bm_fable');finishCatalog(availableNative);await rejected;
 assert.equal(h.engine.snapshot.voice,'bm_fable');assert.equal(h.workers[1].terminated,true);const current=h.workers[2];current.ready();assert.equal(current.messages.at(-1).voice,'bm_fable');assert.equal(current.messages.at(-1).text,'Second sentence should continue here.');
 h.workers[0].audio(2,6);h.workers[1].audio(0,6);await flush();assert.equal(h.streams.at(-1).end,0);h.engine.stop();
});

test('Completed voice changes stay paused; expired and failed readings reject without relabeling',async()=>{
 for(const release of ['retained','expired','failed']){
  const h=engineHarness();await h.engine.start({text:'Short passage.',voice:'af_sarah'},'voice-session');h.workers[0].ready();h.workers[0].audio(0,6);await flush();
  if(release==='failed'){h.workers[0].onerror?.({message:'Voice error'});h.engine.stop();await h.engine.start({text:'Fail this.'},'voice-session');h.workers[1].onerror({message:'Voice error'});}
  else{h.streams[0].position=6;h.streams[0].audio.ended=true;h.advance(1);if(release==='expired')h.advance(120001);}
  if(release==='retained'){await h.engine.changeVoice('af_nicole');assert.equal(h.engine.snapshot.phase,'paused');assert.equal(h.engine.snapshot.voice,'af_nicole');assert.equal(h.workers.length,1);}
  else{await assert.rejects(h.engine.changeVoice('af_nicole'),/expired/);assert.equal(h.engine.snapshot.voice,'af_sarah');}
  h.engine.stop();
 }
});

async function voiceBackgroundHarness({active=true,engineError}={}){
 const listeners={},events=name=>({addListener(fn){listeners[name]=fn;}}),calls=[],saved={voice:'af_sarah'},published=[];let exists=active;
 let state={phase:'paused',sessionId:'retained-session',sourceId:'retained-source',voice:'af_sarah',speed:1,elapsedSec:7,durationSec:30,bufferedSec:10,revision:1};
 const chrome={
  runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onInstalled:events('installed'),onMessage:events('message'),sendMessage:async m=>{if(m.target!=='engine')return;calls.push(m);if(m.action==='voice'){if(engineError)return{error:engineError};state={...state,voice:m.voice,revision:state.revision+1};}return{ok:true,snapshot:state};}},
  storage:{session:{get:async()=>({readerOwnerTab:42,readerSnapshot:{pagePlayerAvailable:true}}),set:async values=>{if(values.readerSnapshot)published.push(values.readerSnapshot);}},sync:{get:async()=>saved,set:async values=>Object.assign(saved,values)}},
  offscreen:{hasDocument:async()=>exists,closeDocument:async()=>{exists=false;},createDocument:async()=>{exists=true;},Reason:{WORKERS:'WORKERS'}},
  tabs:{query:async()=>[{id:42}],sendMessage:async(id,message)=>{calls.push({tab:id,...message});},onRemoved:events('removed'),onUpdated:events('updated')},
  contextMenus:{onClicked:events('context'),removeAll(){},create(){}},commands:{onCommand:events('command')},scripting:{executeScript:async()=>{throw Error('Voice changes must not re-extract source.');}},
 };
 vm.runInNewContext(backgroundCode,{chrome,defineBackground:fn=>fn(),crypto,TextEncoder,setTimeout,clearTimeout,console});
 const command=(action,fields={})=>new Promise(resolve=>listeners.message({channel:'local-reader-v2',target:'background',action,...fields},{id:'test-extension'},resolve));
 return{command,calls,saved,published,listeners,get exists(){return exists;}};
}

test('Background voice command persists its accepted preference and publishes the retained session to its owner',async()=>{
 const h=await voiceBackgroundHarness();const response=await h.command('voice',{voice:'af_nicole',sessionId:'retained-session'});
 assert.equal(response.snapshot.voice,'af_nicole');assert.equal(response.snapshot.phase,'paused');assert.equal(response.snapshot.sourceId,'retained-source');assert.equal(response.snapshot.pagePlayerAvailable,true);assert.equal(h.saved.voice,'af_nicole');assert.equal(h.saved.voiceName,'Nicole · American');
 assert.deepEqual(h.calls.filter(c=>c.target==='engine').map(c=>c.action),['get','voice']);assert.equal(h.calls.find(c=>c.action==='voice').sessionId,'retained-session');assert(h.calls.some(c=>c.tab===42&&c.snapshot?.voice==='af_nicole'));assert.equal(h.exists,true);
});

test('Rejected background voice changes leave active state, resources and preference untouched',async()=>{
 for(const fields of [{voice:'no-such-voice'},{voice:'af_nicole',sessionId:'stale'},{voice:'mac:macos-start-speaking'}]){
  const h=await voiceBackgroundHarness({engineError:'The Mac helper is unavailable.'});const result=await h.command('voice',fields);
  assert(result.error);assert.equal(h.saved.voice,'af_sarah');assert.equal(h.exists,true);assert.equal((await h.command('get')).snapshot.phase,'paused');assert.equal((await h.command('get')).snapshot.voice,'af_sarah');assert.equal(h.calls.some(c=>['stop','start'].includes(c.action)),false);
 }
});

test('Idle voice choice only saves a preference; rapid popup choices apply in order without launching or extracting',async()=>{
 const idle=await voiceBackgroundHarness({active:false});const preference=await idle.command('voice',{voice:'bf_lily'});
 assert.equal(idle.saved.voice,'bf_lily');assert.equal(preference.snapshot.phase,'idle');assert.equal(idle.exists,false);assert.equal(idle.calls.some(c=>c.target==='engine'),false);
 const h=await voiceBackgroundHarness();const responses=await Promise.all(['af_nicole','bm_fable'].map(voice=>h.command('voice',{voice,sessionId:'retained-session'})));
 assert.deepEqual(responses.map(r=>r.snapshot.voice),['af_nicole','bm_fable']);assert.equal(h.saved.voice,'bm_fable');assert.equal((await h.command('get')).snapshot.voice,'bm_fable');
});

test('A native Stop timeout never starts overlapping Kokoro; closing during Stop cancels the pending switch',async()=>{
 for(const close of [false,true]){
  const h=engineHarness({nativeTransport:async()=>({ok:true})});await h.engine.start({text:switchText,voice:'mac:macos-start-speaking'},'voice-session');
  const changing=h.engine.changeVoice('af_nicole');const rejection=assert.rejects(changing,close?/session ended/:/did not confirm Stop/);
  if(close)h.engine.stop();else h.timeouts.find(t=>t.ms===5000&&!t.cleared).fn();await rejection;
  assert.equal(h.workers.length,0);assert.equal(h.engine.snapshot.voice,close?'af_sarah':'mac:macos-start-speaking');assert.equal(h.engine.snapshot.phase,close?'idle':'preparing');h.engine.stop();
 }
});

test('Changing a stopped native reading waits for Play and still retains the source',async()=>{
 const calls=[],h=engineHarness({nativeTransport:async(action,fields)=>{calls.push({action,...fields});return{ok:true};}});await h.engine.start({text:switchText,voice:'mac:macos-start-speaking',sourceId:'source'},'voice-session');
 const id=calls.find(c=>c.action==='native-speak').id;await h.engine.pause();h.engine.handleNativeMessage({type:'cancelled',id});await flush();
 await h.engine.changeVoice('bf_lily');assert.equal(h.engine.snapshot.phase,'paused');assert.equal(h.engine.snapshot.sourceId,'source');assert.equal(h.workers.length,0);
 await h.engine.resume();h.workers[0].ready();assert.equal(h.workers[0].messages.at(-1).text,'First sentence is already behind us.');assert.equal(h.workers[0].messages.at(-1).voice,'bf_lily');h.engine.stop();
});

test('Stale engine snapshots cannot replace the new voice within the same session',async()=>{
 const h=await voiceBackgroundHarness();await h.command('voice',{voice:'af_nicole',sessionId:'retained-session'});
 h.listeners.message({channel:'local-reader-v2',target:'background',action:'engine-state',snapshot:{phase:'playing',sessionId:'retained-session',sourceId:'retained-source',voice:'af_sarah',speed:1,revision:1}},{id:'test-extension',url:'chrome-extension://test-extension/offscreen.html'},()=>{});
 assert.equal((await h.command('get')).snapshot.voice,'af_nicole');assert.equal((await h.command('get')).snapshot.revision,2);assert.equal(h.saved.voice,'af_nicole');
});
