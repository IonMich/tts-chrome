import {Output,WebMOutputFormat,AppendOnlyStreamTarget,AudioBufferSource,Quality} from 'mediabunny';
/** Encoded, seekable audio; inference PCM is not retained after append. */
export class NativeAudioStream {
 readonly audio=new Audio(); private media=new MediaSource();private url='';private buffer:SourceBuffer|null=null;private output:Output|null=null;private input:AudioBufferSource|null=null;private closed=false;private chain=Promise.resolve();private mediaNode:MediaElementAudioSourceNode|null=null;private finished=false;private cancelOpen:(()=>void)|null=null;
 generatedSec=0;encodedBytes=0;removedBeforeSec=0;
 constructor(private context:AudioContext,private destination:AudioNode,private changed:()=>void,private error:(e:unknown)=>void,private historySec=600){}
 get start(){return this.buffer?.buffered.length?this.buffer.buffered.start(0):0;}
 get end(){const ranges=this.buffer?.buffered;return ranges?.length?ranges.end(ranges.length-1):0;}
 get position(){return this.audio.currentTime;}
 get ahead(){return Math.max(0,this.end-this.position);}
 get retainedSec(){return Math.max(0,this.end-this.start);}
 get ended(){return this.finished&&this.audio.ended;}
 async open(){
  if(!MediaSource.isTypeSupported('audio/webm; codecs="opus"'))throw Error('This Chrome build does not support the installed streaming audio format.');
  this.audio.preservesPitch=true;this.audio.preload='auto';this.audio.disableRemotePlayback=true;
  for(const type of ['timeupdate','playing','waiting','pause','seeking','seeked','ended','ratechange'])this.audio.addEventListener(type,()=>{if(!this.closed)this.changed();});
  this.audio.addEventListener('error',()=>{if(!this.closed)this.error(Error(this.audio.error?.message||'Audio playback failed.'));});
  const opened=new Promise<void>((resolve,reject)=>{this.cancelOpen=resolve;this.media.addEventListener('sourceopen',()=>resolve(),{once:true});this.media.addEventListener('sourceclose',()=>{if(!this.closed)reject(Error('Audio stream closed during startup.'));},{once:true});});
  this.url=URL.createObjectURL(this.media);this.audio.src=this.url;this.audio.load();await opened;this.cancelOpen=null;if(this.closed)return;
  this.buffer=this.media.addSourceBuffer('audio/webm; codecs="opus"');this.mediaNode=this.context.createMediaElementSource(this.audio);this.mediaNode.connect(this.destination);
  const write=async(data:Uint8Array)=>{if(this.closed)return;this.encodedBytes+=data.byteLength;await this.mutate(()=>this.buffer!.appendBuffer(data.slice().buffer));this.changed();};
  this.output=new Output({format:new WebMOutputFormat({appendOnly:true,minimumClusterDuration:.25}),target:new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({write}))});
  this.input=new AudioBufferSource({codec:'opus',quality:new Quality({bitrate:64_000})});this.output.addAudioTrack(this.input);await this.output.start();
 }
 private mutate(action:()=>void):Promise<void>{
  const operation=this.chain.then(()=>new Promise<void>((resolve,reject)=>{if(this.closed||!this.buffer){resolve();return;}const b=this.buffer;const clean=()=>{b.removeEventListener('updateend',done);b.removeEventListener('error',failed);b.removeEventListener('abort',aborted);};const done=()=>{clean();resolve();};const failed=()=>{clean();reject(Error('The buffered audio could not be updated.'));};const aborted=()=>{clean();if(this.closed)resolve();else reject(Error('Audio buffering was interrupted.'));};b.addEventListener('updateend',done,{once:true});b.addEventListener('error',failed,{once:true});b.addEventListener('abort',aborted,{once:true});try{action();}catch(e){clean();reject(e);}}));
  this.chain=operation.catch(()=>{});return operation;
 }
 async append(samples:Float32Array,sampleRate:number){if(this.closed||!this.input)return;const buffer=this.context.createBuffer(1,samples.length,sampleRate);buffer.copyToChannel(samples,0);await this.input.add(buffer);if(this.closed)return;this.generatedSec+=buffer.duration;await this.evict();}
 async finish(){if(this.closed||!this.output)return;await this.output.finalize();await this.chain;if(this.closed)return;this.finished=true;if(this.media.readyState==='open'){this.media.duration=this.end;this.media.endOfStream();}this.changed();}
 async play(){if(this.closed)return;await this.context.resume();try{await this.audio.play();}catch(e){if(this.closed||(e instanceof DOMException&&e.name==='AbortError'))return;throw e;}}
 pause(){this.audio.pause();}
 speed(value:number){if(!Number.isFinite(value)||value<.5||value>2)throw Error('Choose a speed from 0.5× to 2×.');this.audio.playbackRate=value;this.audio.preservesPitch=true;}
 seek(seconds:number){if(!Number.isFinite(seconds))throw Error('Choose a finite audio position.');if(this.end<=this.start)return;this.audio.currentTime=Math.max(this.start,Math.min(this.end-.015,seconds));this.changed();}
 async evict(){const cut=Math.max(0,this.position-this.historySec);if(this.closed||!this.buffer||cut<this.start+2)return;await this.mutate(()=>this.buffer!.remove(0,cut));if(!this.closed){this.removedBeforeSec=this.start;if(this.finished&&this.media.readyState==='open')this.media.endOfStream();}}
 close(){if(this.closed)return;this.closed=true;this.cancelOpen?.();this.cancelOpen=null;this.audio.pause();this.mediaNode?.disconnect();this.mediaNode=null;try{if(this.buffer?.updating)this.buffer.abort();}catch{};void this.output?.cancel().catch(()=>{});this.input=null;this.output=null;this.audio.removeAttribute('src');this.audio.load();if(this.url)URL.revokeObjectURL(this.url);this.buffer=null;}
}
