import { useEffect, useRef, useState } from 'react';
import { ReaderScrubber, type ScrubCommandResult, type ScrubView } from '@/lib/readerScrubber';
import { AudioLines, ChevronDown, LoaderCircle, Pause, Play, RotateCcw, RotateCw, Square, X } from 'lucide-react';
import './reader.css';
export type PlayerPhase = 'idle'|'installing'|'preparing'|'buffering'|'playing'|'paused'|'complete'|'error';
export interface PlayerState { phase:PlayerPhase; elapsedSec:number; durationSec:number|null; bufferedSec:number; seekableStartSec?:number; seekableEndSec?:number; replayExpiresAt?:number; progress?:number; message?:string; error?:string; voice:string; voiceName?:string; speed:number; speechMode?:'system'; sessionId?:string; revision?:number; }
type PlayerCommand = () => ScrubCommandResult | Promise<ScrubCommandResult>;
export interface ReaderPlayerProps { state:PlayerState; onPause:PlayerCommand; onResume:PlayerCommand; onClose:()=>void; onSeek?:(seconds:number)=>ScrubCommandResult|Promise<ScrubCommandResult>; onSpeed?:(speed:number)=>void; onReplay?:()=>void; floating?:boolean; }
const labels:Record<PlayerPhase,string>={idle:'Ready to read',installing:'Setting up voice',preparing:'Preparing speech',buffering:'Buffering',playing:'Reading aloud',paused:'Paused',complete:'Finished reading',error:'Reading interrupted'};
export function formatReaderTime(seconds:number){const s=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
export function ReaderPlayer({state,onPause,onResume,onClose,onSeek,onSpeed,onReplay,floating=false}:ReaderPlayerProps){
 const [expanded,setExpanded]=useState(false),[preview,setPreview]=useState<ScrubView|null>(null);
 const scrubber=useRef<ReaderScrubber|null>(null);
 scrubber.current??=new ReaderScrubber(state,{pause:onPause,resume:onResume,seek:seconds=>onSeek?.(seconds)},setPreview);
 const scrub=scrubber.current;
 scrub.commands={pause:onPause,resume:onResume,seek:seconds=>onSeek?.(seconds)};
 useEffect(()=>{scrub.activate();return()=>scrub.dispose();},[scrub]);
 useEffect(()=>scrub.observe(state),[scrub,state]);
 const start=Math.max(0,state.seekableStartSec??0),end=Math.max(start,state.seekableEndSec??0),known=Number.isFinite(state.durationSec)&&(state.durationSec??0)>0;
 const system=state.speechMode==='system';
 const seekable=!system&&!!onSeek&&end>start+.02, shown=preview?.seconds??state.elapsedSec, min=preview?.start??start, max=preview?.end??end;
 const active=['playing','buffering'].includes(state.phase),resume=state.phase==='paused',replay=state.phase==='complete'&&(system||seekable);
 const fraction=max>min?Math.max(0,Math.min(100,(shown-min)/(max-min)*100)):0;
 const seek=(value:number)=>scrub.seek(value);
 const control=(action:PlayerCommand)=>{void Promise.resolve().then(action).catch(()=>{});};
 const busy=['preparing','installing','buffering'].includes(state.phase);
 return <section className={`reader-player${floating?' reader-player--floating':''}`} aria-label="Reading player" data-phase={state.phase}>
  <div className="reader-player__heading"><span className="reader-player__title" role="status" aria-live="polite">{labels[state.phase]}</span>{!system&&<span className="reader-player__time"><time>{formatReaderTime(shown)}</time>{known&&<> / <time>{formatReaderTime(state.durationSec!)}</time></>}</span>}<button className="reader-player__icon" aria-label="Close player and stop reading" onClick={onClose}><X size={16}/></button></div>
  <div className="reader-player__controls">
   {!system&&<button className="reader-player__skip" aria-label="Back 15 seconds" title="Back 15 seconds" disabled={!seekable||!!preview?.dragging||shown<=start+.01} onClick={()=>seek(shown-15)}><RotateCcw size={22}/><span>15</span></button>}
   <button className="reader-player__main" aria-label={system&&state.phase==='playing'?'Stop reading':replay?(system?'Replay from beginning':'Replay available audio'):active?'Pause reading':resume?'Resume reading':labels[state.phase]} disabled={!!preview||!active&&!resume&&!replay&&!onReplay} onClick={()=>{if(system){if(state.phase==='playing')control(onPause);else if(replay)control(onResume);}else if(active)control(onPause);else if(resume)control(onResume);else if(replay)scrub.seek(start,true);else onReplay?.();}}>{system&&state.phase==='playing'?<Square size={17} fill="currentColor"/>:active?<Pause size={19} fill="currentColor"/>:resume||replay?<Play size={19} fill="currentColor"/>:busy?<LoaderCircle className="reader-spin" size={20}/>:<AudioLines size={20}/>}</button>
   {!system&&<button className="reader-player__skip" aria-label="Forward 15 seconds" title="Forward 15 seconds" disabled={!seekable||!!preview?.dragging||shown>=end-.01} onClick={()=>seek(shown+15)}><RotateCw size={22}/><span>15</span></button>}
   {!system&&<label className="reader-player__speed"><span className="reader-sr">Playback speed</span><select aria-label="Playback speed" value={state.speed} disabled={!onSpeed} onChange={e=>onSpeed?.(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,1.75,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></label>}
   <button className="reader-player__icon" aria-label={expanded?'Hide reading details':'Show reading details'} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><ChevronDown size={16} className={expanded?'reader-chevron-up':''}/></button>
  </div>
  {!system&&<div className="reader-player__timeline"><input type="range" className="reader-player__seek" aria-label="Seek in available audio" aria-valuetext={`${formatReaderTime(shown)}; available ${formatReaderTime(min)} to ${formatReaderTime(max)}${known?'':'; final duration not known'}`} min={min} max={Math.max(min+.01,max)} step={.1} value={Math.max(min,Math.min(max,shown))} disabled={!seekable} style={{'--reader-position':`${fraction}%`,touchAction:'none'} as React.CSSProperties}
    onPointerDown={e=>{if(!e.isPrimary||e.button!==0)return;scrub.begin(e.pointerId);e.currentTarget.setPointerCapture(e.pointerId);}}
    onChange={e=>{const value=Number(e.target.value);if(scrub.pointerId!==null)scrub.move(value);else seek(value);}}
    onPointerUp={e=>{scrub.end(e.pointerId,Number(e.currentTarget.value));if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onPointerCancel={e=>scrub.cancel(e.pointerId)}
    onLostPointerCapture={e=>scrub.cancel(e.pointerId)}
    onBlur={()=>{if(scrub.pointerId!==null)scrub.cancel(scrub.pointerId);}}/>
   <div className="reader-player__range"><span>{state.replayExpiresAt?`Replay for ${formatReaderTime((state.replayExpiresAt-Date.now())/1000)}`:start>0?`From ${formatReaderTime(start)}`:seekable?'Audio available':busy?'Waiting for audio':'No audio retained'}</span><span>{seekable?`${formatReaderTime(end)}${known?'':' · growing'}`:state.phase==='installing'&&state.progress!==undefined?`${Math.round(state.progress)}%`:''}</span></div>
  </div>}
  {(expanded||state.phase==='error')&&<div className="reader-player__details">{state.phase==='error'?<p role="alert" className="reader-player__error">{state.error||'Reading could not continue.'}</p>:<p>{state.message||(system?'The Mac voice follows your system Start Speaking setting.':state.phase==='buffering'?'You reached the available audio. Reading continues when more is ready.':state.phase==='complete'?'Replay the retained audio, or Close to release this session.':'Speed changes the current playback. Seeking stays within the audio already available.')}</p>}<p className="reader-player__hint">{state.voiceName||state.voice.replace(/^[a-z]{2}_/,'').replace(/_/g,' ')}{system?'':` · ${Math.round(state.bufferedSec)} s ahead${start>0?' · older audio released':''}`}. Close stops and clears the session.</p></div>}
 </section>;
}
