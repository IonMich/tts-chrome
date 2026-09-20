import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const moduleOf = async path => {
  const result = await build({entryPoints:[new URL('../src/lib/'+path,import.meta.url).pathname],bundle:true,write:false,format:'esm'});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
};
const position = await moduleOf('speechPosition.ts');
const { MAX_SPEECH_CHUNK_LENGTH } = await moduleOf('speechSegments.ts');
const { normalizeSourceFragments } = await moduleOf('sourceText.ts');
const { validateRequest, isCurrentSnapshot, idleSnapshot } = await moduleOf('readerProtocol.ts');

test('Normalization keeps UTF-16 provenance across inline nodes and collapsed spaces/newlines', () => {
  const a={data:' \tA😀  bright'}, b={data:'\u00a0star.\r\n  Again! '};
  const result=normalizeSourceFragments([{text:a.data,node:a},{text:b.data,node:b}]);
  assert.equal(result.text,'A😀 bright star.\nAgain!');
  for(const run of result.runs) assert.equal(result.text.slice(run.start,run.end),run.node.data.slice(run.nodeStart,run.nodeEnd));
  const sentences=position.sourceSentences(result.text);
  assert.deepEqual(sentences.map(s=>result.text.slice(s.start,s.end)),['A😀 bright star.','Again!']);
  assert.equal(sentences[0].end,16,'exclusive end counts both UTF-16 surrogate units');
  assert.equal(sentences[1].start,17);
});

test('Selection-relative offsets retain the selected occurrence instead of searching repeated text', () => {
  const node={data:'Same sentence. Same sentence. Last sentence.'},offset=15;
  const result=normalizeSourceFragments([{text:node.data.slice(offset,37),node,offset}]);
  assert.equal(result.text,'Same sentence. Last se');
  assert.equal(result.runs[0].start,0); assert.equal(result.runs[0].nodeStart,15);
  assert.deepEqual(position.sourceSentences(result.text).map(s=>result.text.slice(s.start,s.end)),['Same sentence.','Last se']);
  for(const run of result.runs) assert(run.nodeStart>=15&&run.nodeEnd<=37);
});

test('Sentence chunks preserve abbreviations, decimals, duplicates, block tails and full source coverage', () => {
  for(const text of [
    'Title\nDr. Smith measured 3.14 units in the U.S. laboratory. Same sentence. Same sentence.',
    'One short sentence. Two short sentences.\nNext paragraph.',
    '😀 '+ 'long text '.repeat(70)+'ends.\n'+'1234567890'.repeat(70),
    '短い文。次の文！Third sentence? “Fourth sentence.”',
  ]) {
    const sentences=position.sourceSentences(text),chunks=position.sourceSpeechChunks(text);
    assert.equal(chunks.map(c=>c.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
    for(const c of chunks){
      assert.equal(c.text.trim(),text.slice(c.start,c.end));assert(c.text.trim().length<=MAX_SPEECH_CHUNK_LENGTH);
      assert(sentences.some(s=>c.start>=s.start&&c.end<=s.end),'no generated clip spans sentences');
      assert.equal(c.text.endsWith('\n'),c.end===text.length||text[c.end]==='\n');
      assert(!/^Dr\.$/.test(c.text.trim()));
    }
    assert.equal(new Set(sentences.map(s=>s.id)).size,sentences.length,'duplicate prose has unique source-offset IDs');
  }
});

test('Selected Kennedy Center passage retains full sentences, accurate offsets and paragraph cues', () => {
  const first='A storm brought down a five-foot piece of ceiling plaster at the John F. Kennedy Center for the Performing Arts this month and its leadership sprang into action.';
  const second='One thing they did not do was repair the damage.';
  for(const separator of [' ','\n']){
    const text=first+separator+second,sentences=position.sourceSentences(text),chunks=position.sourceSpeechChunks(text);
    assert.deepEqual(sentences.map(s=>text.slice(s.start,s.end)),[first,second]);
    assert.deepEqual(chunks,[
      {text:first+(separator==='\n'?'\n':''),start:0,end:161},
      {text:second+'\n',start:162,end:210},
    ]);
    const cues=chunks.map((chunk,index)=>({...chunk,audioStart:index*10,audioEnd:(index+1)*10}));
    assert.deepEqual(position.spokenPositionAt(cues,sentences,5),{precision:'sentence',start:0,end:161});
    assert.deepEqual(position.spokenPositionAt(cues,sentences,10),{precision:'sentence',start:162,end:210});
  }
});

test('Long sentence fallbacks preserve complete source coverage and sentence highlighting', () => {
  const text='Dr. Kennedy reviewed '+ 'lengthy reports '.repeat(40)+'before taking action.\nNext paragraph.';
  const sentences=position.sourceSentences(text),chunks=position.sourceSpeechChunks(text);
  assert(chunks.length>2);assert.equal(sentences.length,2);
  assert.equal(chunks.map(c=>c.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
  const cues=chunks.map((chunk,index)=>({...chunk,audioStart:index*10,audioEnd:(index+1)*10}));
  for(const [index,chunk] of chunks.entries()){
    assert.equal(chunk.text.trim(),text.slice(chunk.start,chunk.end));assert(chunk.text.trim().length<=MAX_SPEECH_CHUNK_LENGTH);
    const sentence=sentences.find(s=>chunk.start>=s.start&&chunk.end<=s.end);
    assert(sentence);
    assert.deepEqual(position.spokenPositionAt(cues,sentences,index*10+5),{precision:'sentence',start:sentence.start,end:sentence.end});
  }
});

test('Worker re-splits preserve source offsets including whitespace and synthetic paragraph cue', () => {
  const text='First sentence.\nSecond sentence.';
  const chunk=position.sourceSpeechChunks(text)[1];
  const parts=['Second ', 'sentence.', '\n'];
  const split=position.splitSourceChunk(chunk,parts);
  assert.deepEqual(split.map(c=>[c.start,c.end]),[[16,22],[23,32],[32,32]]);
  assert.equal(split.map(c=>c.text).join(''),chunk.text);
  assert.throws(()=>position.splitSourceChunk(chunk,['discarded']),/Invalid speech split/);
});

test('Media cue boundaries are half-open and never interpolate speech within a coarser cue', () => {
  const text='One. Two.',sentences=position.sourceSentences(text);
  const cues=[{text:'One.',start:0,end:4,audioStart:0,audioEnd:2},{text:'Two.',start:5,end:9,audioStart:2,audioEnd:5}];
  assert.deepEqual(position.spokenPositionAt(cues,sentences,1.999),{precision:'sentence',start:0,end:4});
  assert.deepEqual(position.spokenPositionAt(cues,sentences,2),{precision:'sentence',start:5,end:9});
  for(const seconds of [-1,5,NaN,Infinity])assert.equal(position.spokenPositionAt(cues,sentences,seconds).precision,'unavailable');
  assert.deepEqual(position.spokenPositionAt([{text,start:0,end:9,audioStart:0,audioEnd:5}],sentences,4),{precision:'chunk',start:0,end:9});
});

test('Source identifiers are bounded opaque tokens and survive exact request normalization', () => {
  const valid=validateRequest({text:' A\r\n B ',sourceId:'source-ABC-123'});
  assert.equal(valid.text,'A\nB');assert.equal(valid.sourceId,'source-ABC-123');
  for(const sourceId of ['', 'x'.repeat(101), '../source', 'a_b', '<style>',42])assert.equal(validateRequest({text:'Some text.',sourceId}).sourceId,undefined);
});

test('A delayed idle tuple cannot dismiss a newer player; explicit replacements and matching Stop still work',()=>{
 const current={...idleSnapshot(),phase:'playing',sessionId:'new-session',sourceId:'new-source',revision:10};
 assert.equal(isCurrentSnapshot(current,{...idleSnapshot(),sessionId:'old-session'}),false);
 assert.equal(isCurrentSnapshot(current,idleSnapshot()),false);
 assert.equal(isCurrentSnapshot(current,{...idleSnapshot(),sessionId:'new-session',sourceId:'new-source'}),true);
 assert.equal(isCurrentSnapshot(current,{...current,sessionId:'replacement',sourceId:'replacement',revision:1}),true);
});
