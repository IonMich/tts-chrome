import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({entryPoints:[root+'src/lib/readerScrubber.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {ReaderScrubber}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;return{promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:(v)=>resolve(v),reject:(v)=>reject(v)};};
function harness(phase='playing'){
 const calls=[],views=[];let state={sessionId:'reading',revision:1,phase,elapsedSec:10,seekableStartSec:0,seekableEndSec:100};
 const replies=[];
 const command=(kind,value)=>{const reply=deferred();calls.push({kind,value});replies.push({kind,value,reply});return reply.promise;};
 const scrub=new ReaderScrubber(state,{pause:()=>command('pause'),seek:n=>command('seek',n),resume:()=>command('resume')},view=>views.push(view));
 return{scrub,calls,views,get state(){return state;},observe(patch){state={...state,...patch};scrub.observe(state);},async reply(index,patch={},observe=true){state={...state,...patch,revision:state.revision+1};if(observe)scrub.observe(state);replies[index].reply.resolve({...state});await flush();return{...state};}};
}
test('Pointer scrub pauses, freezes both bounds and holds preview until the seek/resume acknowledgment',async()=>{
 const h=harness();h.scrub.begin(1);h.scrub.move(70);await flush();assert.deepEqual(h.calls,[{kind:'pause',value:undefined}]);
 h.observe({elapsedSec:10.1,seekableStartSec:2,seekableEndSec:120,revision:2});assert.deepEqual(h.scrub.preview,{start:0,end:100,seconds:70,dragging:true});
 h.scrub.end(1,70);h.scrub.seek(70);await flush();assert.equal(h.calls.length,1,'release does not race the pending pause or duplicate change');
 await h.reply(0,{phase:'paused'});assert.equal(h.calls[1].kind,'seek');assert.equal(h.calls[1].value,70);
 h.observe({elapsedSec:10.1,revision:4});assert.equal(h.scrub.preview.seconds,70,'stale playhead does not snap the thumb back');
 await h.reply(1,{elapsedSec:70});assert.equal(h.calls[2].kind,'resume');
 const ack=await h.reply(2,{phase:'playing'},false);assert.equal(h.scrub.preview.seconds,70,'response alone does not expose old rendered state');
 h.observe(ack);assert.equal(h.scrub.preview,null);
});
test('A paused drag stays paused and a cancel restores the original running state without seeking',async()=>{
 const paused=harness('paused');paused.scrub.begin(2);paused.scrub.move(40);paused.scrub.end(2,40);await flush();assert.deepEqual(paused.calls,[{kind:'seek',value:40}]);await paused.reply(0,{elapsedSec:40});assert.equal(paused.scrub.preview,null);
 const h=harness();h.scrub.begin(3);await flush();h.scrub.move(80);h.scrub.cancel(3);await h.reply(0,{phase:'paused'});assert.equal(h.calls[1].kind,'resume');await h.reply(1,{phase:'playing'});assert.equal(h.calls.some(c=>c.kind==='seek'),false);assert.equal(h.scrub.preview,null);
});
test('Rapid replacement skips queued stale seeks and resumes once after the latest target',async()=>{
 const h=harness();h.scrub.begin(1);await flush();h.scrub.end(1,30);h.scrub.begin(2);h.scrub.move(80);h.scrub.end(2,80);
 await h.reply(0,{phase:'paused'});assert.equal(h.calls[1].kind,'pause');await h.reply(1,{phase:'paused'});assert.deepEqual(h.calls[2],{kind:'seek',value:80});await h.reply(2,{elapsedSec:80});assert.equal(h.calls[3].kind,'resume');await h.reply(3,{phase:'playing'});assert.equal(h.calls.filter(c=>c.kind==='seek').length,1);
});
test('Commit clamps moved history, expiration suppresses pending work and keyboard changes serialize',async()=>{
 const h=harness('paused');h.scrub.begin(1);h.scrub.move(5);h.observe({seekableStartSec:20});assert.equal(h.scrub.preview.start,0);h.scrub.end(1,5);await flush();assert.equal(h.calls[0].value,20);await h.reply(0,{elapsedSec:20});
 h.scrub.seek(40);await flush();h.scrub.seek(50);h.scrub.seek(60);await h.reply(1,{elapsedSec:40});assert.equal(h.calls[2].value,60);await h.reply(2,{elapsedSec:60});assert.equal(h.calls.some(c=>c.kind==='resume'),false);
 h.scrub.begin(2);h.scrub.move(90);h.observe({phase:'complete',seekableStartSec:0,seekableEndSec:0});h.scrub.end(2,90);await flush();assert.equal(h.scrub.preview,null);assert.equal(h.calls.length,3);
});
test('An old session or disposed UI cannot resume after an outstanding seek',async()=>{
 const h=harness();h.scrub.begin(1);await flush();await h.reply(0,{phase:'paused'});h.scrub.end(1,70);await flush();h.observe({sessionId:'new-reading',phase:'preparing',seekableEndSec:0});await h.reply(1,{elapsedSec:70});assert.equal(h.calls.some(c=>c.kind==='resume'),false);
 const d=harness();d.scrub.begin(1);await flush();d.scrub.end(1,40);d.scrub.dispose();await d.reply(0,{phase:'paused'});assert.equal(d.calls.length,1);
});

test('A late initial state query cannot overwrite a newer session broadcast; same-session revisions never go backwards',async()=>{
 const bundled=await build({entryPoints:[root+'src/lib/readerClient.ts'],bundle:true,write:false,format:'iife',globalName:'Client',platform:'browser'});
 const initial=deferred();let listener;const seen=[];
 const scope={Date,chrome:{runtime:{sendMessage:()=>initial.promise,onMessage:{addListener(fn){listener=fn;},removeListener(){}}}}};vm.runInNewContext(bundled.outputFiles[0].text,scope);
 const unsubscribe=scope.Client.subscribeReader(snapshot=>seen.push(snapshot));
 const next={sessionId:'new-reading',revision:3,phase:'playing'};
 listener({channel:'local-reader-v2',action:'state',snapshot:next});
 initial.resolve({snapshot:{phase:'idle'}});await flush();
 listener({channel:'local-reader-v2',action:'state',snapshot:{...next,revision:2,elapsedSec:0}});
 assert.deepEqual(seen,[next]);unsubscribe();
});
