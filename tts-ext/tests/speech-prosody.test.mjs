import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const moduleOf=async path=>{const r=await build({entryPoints:[new URL('../src/lib/'+path,import.meta.url).pathname],bundle:true,write:false,format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));};
test('Block boundaries survive validation and preserve the title, subtitle, date and source words',async()=>{
 const {splitSpeech,MAX_SPEECH_CHUNK_LENGTH}=await moduleOf('speechSegments.ts'),{validateRequest}=await moduleOf('readerProtocol.ts');
 const text='The Adolescence of Technology\nConfronting and Overcoming the Risks of Powerful AI\nJanuary 2026\nThere is a scene in the movie version of Carl Sagan’s book Contact where the main character, an astronomer who has detected the first radio signal from an alien civilization, is being considered for the role of humanity’s representative to meet the aliens.';
 const chunks=splitSpeech(validateRequest({text}).text);
 assert.equal(chunks[0].trim(),'The Adolescence of Technology');assert.equal(chunks[1].trim(),'Confronting and Overcoming the Risks of Powerful AI');assert.equal(chunks[2].trim(),'January 2026');
 assert.equal(chunks.join('').replace(/\s/g,''),text.replace(/\s/g,''));assert(chunks.every(c=>c.trim().length<=MAX_SPEECH_CHUNK_LENGTH));assert(!chunks.some(c=>/\bthe\s*$/i.test(c)));
});
test('Sentence and clause cuts preserve decimals, common abbreviations and unbroken text coverage',async()=>{
 const {splitSpeech,MAX_SPEECH_CHUNK_LENGTH}=await moduleOf('speechSegments.ts');
 for(const text of ['Dr. Smith checked 3.14 units in the U.S. laboratory, and then wrote a complete report. '+ 'Measurements continued without a gap. '.repeat(30),'word '.repeat(70)+'the risks are substantial. '+ 'Unbroken'.repeat(90),'1234567890'.repeat(200)]){
  const chunks=splitSpeech(text);assert(chunks.every(c=>c.trim().length<=MAX_SPEECH_CHUNK_LENGTH));assert.equal(chunks.join('').replace(/\s/g,''),text.replace(/\s/g,''));assert(!chunks.some(c=>/\b(?:Dr|U\.S)\.\s*$/.test(c)));
 }
});
test('A nearby sentence ending keeps the final word and a middle initial with its sentence',async()=>{
 const {splitSpeech}=await moduleOf('speechSegments.ts');
 const first='A storm brought down a five-foot piece of ceiling plaster at the John F. Kennedy Center for the Performing Arts this month and its leadership sprang into action.';
 const second='One thing they did not do was repair the damage.';
 assert.equal(first.length,161,'the final period is just beyond the old hard cut');
 assert.deepEqual(splitSpeech(first+' '+second),[first,second+'\n']);
 assert.deepEqual(splitSpeech(first+'\n'+second),[first+'\n',second+'\n']);
});
test('Lookahead is bounded and prefers a complete sentence or clause over a word cut',async()=>{
 const {splitSpeech,MAX_SPEECH_CHUNK_LENGTH}=await moduleOf('speechSegments.ts');
 const sentence='The curator reviewed '+ 'paintings '.repeat(15)+'before dinner.';
 assert(sentence.length>160&&sentence.length<MAX_SPEECH_CHUNK_LENGTH);
 assert.deepEqual(splitSpeech(sentence),[sentence+'\n']);
 const clause='The curator reviewed '+ 'paintings '.repeat(15)+'with care,';
 const tail=' then continued examining the collection without stopping until the museum closed for the evening.';
 assert.deepEqual(splitSpeech(clause+tail),[clause,tail.trim()+'\n']);
 const atCap='word '.repeat(43)+'some end.';
 assert.equal(atCap.length,MAX_SPEECH_CHUNK_LENGTH);
 assert.deepEqual(splitSpeech(atCap),[atCap+'\n']);
 const overCap='word '.repeat(43)+'some ends.';
 assert.equal(overCap.length,MAX_SPEECH_CHUNK_LENGTH+1);
 const chunks=splitSpeech(overCap);
 assert.equal(chunks.length,2);assert(chunks[1].trim().length>=35,'a hard fallback leaves a substantial sentence tail');
 for(const text of [overCap,'word '.repeat(1000),'1234567890'.repeat(1000)]){
  const parts=splitSpeech(text);assert(parts.every(c=>c.trim().length<=MAX_SPEECH_CHUNK_LENGTH));
  assert.equal(parts.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 }
});
test('Nonfinite custom targets retain bounded chunks and full coverage',async()=>{
 const {splitSpeech,MAX_SPEECH_CHUNK_LENGTH}=await moduleOf('speechSegments.ts');
 const text='Long sentence without punctuation '.repeat(30);
 for(const target of [NaN,Infinity,-Infinity]){
  const chunks=splitSpeech(text,target,target);
  assert(chunks.every(c=>c.trim().length>0&&c.trim().length<=MAX_SPEECH_CHUNK_LENGTH));
  assert.equal(chunks.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 }
});
test('Padding removal preserves quiet consonant margins, internal pauses and semantic tail differences',async()=>{
 const {trimSpeechPadding}=await moduleOf('speechAudio.ts');const rate=24000,pcm=new Float32Array(rate*3);
 pcm.fill(.00005,rate*.43,rate*.5);pcm.fill(.01,rate*.5,rate*.9);pcm.fill(.00015,rate*.9,rate*.98);pcm.fill(.02,rate*1.5,rate*2);pcm.fill(.00005,rate*2,rate*2.07);
 const phrase=trimSpeechPadding(pcm,rate,'soft phrases'),sentence=trimSpeechPadding(pcm,rate,'Soft phrases.'),paragraph=trimSpeechPadding(pcm,rate,'Soft phrases.\n');
 assert(phrase.removedStartSec<=.42);assert.equal(phrase.samples[0],pcm[Math.round(phrase.removedStartSec*rate)]);assert.equal(phrase.samples.buffer,pcm.buffer);
 assert(paragraph.samples.length>sentence.samples.length&&sentence.samples.length>phrase.samples.length);
 assert(phrase.samples.includes(.00005)||phrase.samples.some(v=>Math.abs(v-.00005)<1e-9));
 assert.equal(phrase.samples[Math.round((1.2-phrase.removedStartSec)*rate)],0,'Internal pauses must remain untouched');
 const quiet=new Float32Array(1000).fill(.00001);assert.equal(trimSpeechPadding(quiet,rate).samples,quiet,'Very quiet clips remain intact');
});
