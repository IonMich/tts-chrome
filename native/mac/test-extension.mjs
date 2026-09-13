// Opt-in, audible integration test: actual extension engine/bridge + native host.
// Chrome's port transport is represented by a framed child process; this does
// not establish installation, page extraction, or acceptance inside Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import crypto from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(`${root}/tts-ext/package.json`);
const { build } = require('esbuild');
const host = process.argv[2] || fileURLToPath(new URL('.build/local-reader-native-tts', import.meta.url));
const compile = async (entry, globalName) => (await build({
  entryPoints: [`${root}/tts-ext/src/lib/${entry}.ts`], bundle: true,
  write: false, format: 'iife', globalName, platform: 'browser',
  tsconfig: `${root}/tts-ext/tsconfig.json`,
})).outputFiles[0].text;
let workerAllocations = 0, audioAllocations = 0;
const scope = {
  console, URL, performance, crypto, TextEncoder, TextDecoder, Uint8Array,
  DataView, Float32Array, atob, setTimeout, clearTimeout, setInterval, clearInterval,
  location: { href: 'http://localhost/' },
  Worker: class { constructor() { workerAllocations++; throw Error('Unexpected worker'); } },
  AudioContext: class { constructor() { audioAllocations++; throw Error('Unexpected audio context'); } },
};
vm.createContext(scope);
vm.runInContext(await compile('nativeMessaging', 'Native'), scope);
vm.runInContext(await compile('readerEngine', 'Reader'), scope);
const connections = [], events = [], states = [];
const waitFor = async (predicate, label, timeout = 14000) => {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > deadline) throw Error(`Timeout: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
function connect(name) {
  assert.equal(name, 'com.localreader.native_tts');
  const child = spawn(host, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const record = { pid: child.pid, requests: [], responses: [], stderr: '', closed: false, disconnects: 0 };
  connections.push(record);
  let bytes = Buffer.alloc(0);
  const messages = [], disconnects = [];
  child.stdout.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    while (bytes.length >= 4) {
      const length = bytes.readUInt32LE();
      assert(length > 0 && length < 1024 * 1024);
      if (bytes.length < 4 + length) break;
      const value = JSON.parse(bytes.subarray(4, 4 + length));
      bytes = bytes.subarray(4 + length);
      record.responses.push(value);
      for (const listener of messages) listener(value);
    }
  });
  child.stderr.on('data', chunk => { record.stderr += chunk; });
  child.stdin.on('error', () => {});
  child.on('error', error => { record.stderr += error.message; });
  child.on('close', (code, signal) => {
    record.closed = true; record.code = code; record.signal = signal;
    for (const listener of disconnects) listener();
  });
  const port = {
    postMessage(value) {
      assert.equal(typeof value.action, 'string');
      assert.equal(value.type, undefined);
      record.requests.push({ action: value.action, id: value.id, ...(value.text ? { textLength: value.text.length } : {}) });
      const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([header, body]));
    },
    disconnect() { record.disconnects++; child.stdin.end(); },
    onMessage: { addListener: listener => messages.push(listener) },
    onDisconnect: { addListener: listener => disconnects.push(listener) },
  };
  record.disconnect = port.disconnect;
  return port;
}
let engine;
const bridge = new scope.Native.NativeMessagingBridge(message => {
  events.push(message); engine?.handleNativeMessage(message);
}, connect);
const transport = async (action, fields) => {
  if (action === 'native-speak') bridge.speak(fields.id, fields.text);
  else if (action === 'native-stop') bridge.stop(fields.id);
  else throw Error(`Unexpected action: ${action}`);
  return { ok: true };
};
engine = new scope.Reader.ReaderEngine(state => states.push(state), new URL('http://localhost/'),
  () => { throw Error('Unexpected PCM stream'); }, transport);
try {
  const catalog = await bridge.listVoices(12000);
  assert.equal(catalog.macVoices[0]?.id, 'macos-start-speaking');
  await waitFor(() => connections.every(c => c.closed), 'catalog helper exits');
  const request = { voice: 'mac:macos-start-speaking', voiceName: 'Mac voice (Start Speaking)', text: 'Local Reader is ready.' };
  await engine.start(request, 'natural');
  await waitFor(() => engine.snapshot.phase === 'complete', 'natural completion');
  assert(events.some(e => e.type === 'started'));
  assert(events.some(e => e.type === 'ended'));
  await waitFor(() => connections.every(c => c.closed), 'completed helper exits');
  await engine.resume();
  await waitFor(() => engine.snapshot.phase === 'playing', 'replay starts');
  await engine.pause(); // The system-speech UI labels this operation Stop.
  assert.equal(engine.snapshot.phase, 'complete');
  await waitFor(() => connections.every(c => c.closed), 'stopped helper exits');
  assert(events.some(e => e.type === 'cancelled'));
  await engine.start({ ...request, text: 'This reading will be replaced. '.repeat(10) }, 'old');
  await waitFor(() => engine.snapshot.phase === 'playing', 'old reading starts');
  await engine.start({ ...request, text: 'The replacement reading is active. '.repeat(10) }, 'new');
  await waitFor(() => engine.snapshot.phase === 'playing', 'replacement starts');
  assert.equal(engine.snapshot.sessionId, 'new');
  engine.stop();
  await waitFor(() => connections.every(c => c.closed), 'closed reader releases helper');
  await engine.start({ ...request, text: 'This tests unexpected connection closure. '.repeat(10) }, 'disconnect');
  await waitFor(() => engine.snapshot.phase === 'playing', 'disconnect test starts');
  connections.at(-1).disconnect();
  await waitFor(() => engine.snapshot.phase === 'error', 'connection failure reaches engine');
  await waitFor(() => connections.every(c => c.closed), 'failed helper exits');
  assert.equal(workerAllocations, 0);
  assert.equal(audioAllocations, 0);
  for (const c of connections) { assert.equal(c.code, 0, c.stderr); assert.equal(c.stderr, ''); }
  console.log(JSON.stringify({ passed: true, host, workerAllocations, audioAllocations,
    checks: ['catalog idle exit', 'natural completion', 'replay', 'stop', 'replacement', 'close', 'disconnect error'],
    connections: connections.map(({ disconnect, ...record }) => record),
    states: states.map(s => ({ phase: s.phase, sessionId: s.sessionId, speechMode: s.speechMode })),
    limitation: 'Real engine, adapter and host; framed subprocess replaces Chrome Port. Chrome article acceptance remains manual.' }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ passed: false, error: String(error), workerAllocations, audioAllocations,
    events, states, connections: connections.map(({ disconnect, ...record }) => record) }, null, 2));
  throw error;
} finally {
  engine.stop();
  for (const c of connections) if (!c.closed) c.disconnect();
  await waitFor(() => connections.every(c => c.closed), 'final cleanup');
}
