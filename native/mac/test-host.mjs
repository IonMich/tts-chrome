import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(path.join(dir, '.build/local-reader-native-tts'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
let bytes = Buffer.alloc(0), stderr = '';
const messages = [], waiters = [];
child.stderr.on('data', value => { stderr += value; });
child.stdout.on('data', value => { bytes = Buffer.concat([bytes, value]); parse(); });
function parse() {
  while (bytes.length >= 4) {
    const size = bytes.readUInt32LE(0); assert(size < 256 * 1024);
    if (bytes.length < size + 4) return;
    const message = JSON.parse(bytes.subarray(4, size + 4));
    bytes = bytes.subarray(size + 4); messages.push(message);
    for (const waiter of [...waiters]) if (waiter.predicate(message)) {
      waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message);
    }
  }
}
function send(value) {
  const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length); child.stdin.write(Buffer.concat([header, body]));
}
function until(predicate, timeout = 12000) {
  const existing = messages.find(predicate); if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: setTimeout(() => reject(Error(`timeout; messages=${JSON.stringify(messages)}; stderr=${stderr}`)), timeout) };
    waiters.push(waiter);
  });
}
send({ id: 'cap-1', action: 'capabilities' });
const capabilities = await until(m => m.type === 'capabilities');
assert.deepEqual({ mode: capabilities.mode, available: capabilities.available, canStop: capabilities.canStop,
  canPause: capabilities.canPause, canSeek: capabilities.canSeek, hasPcm: capabilities.hasPcm },
  { mode: 'system-speech', available: true, canStop: true, canPause: false, canSeek: false, hasPcm: false });
send({ id: 'voices-1', action: 'listVoices' });
const voices = await until(m => m.type === 'voices');
assert.deepEqual(voices.voices, [{ id: 'macos-start-speaking', name: 'Mac voice (Start Speaking)', available: true }]);
send({ id: 'speech-1', action: 'speak', text: 'Local Reader is ready with your Mac Start Speaking voice.' });
await until(m => m.type === 'started' && m.id === 'speech-1');
await until(m => m.type === 'ended' && m.id === 'speech-1');
send({ id: 'speech-2', action: 'speak', text: 'This second request confirms that stop works without leaving the speech helper running. '.repeat(20) });
await until(m => m.type === 'started' && m.id === 'speech-2');
await new Promise(resolve => setTimeout(resolve, 300));
send({ id: 'speech-2', action: 'stop' });
await until(m => m.type === 'cancelled' && m.id === 'speech-2');
child.stdin.end();
const exit = await new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
assert.equal(exit.code, 0, stderr);
console.log(JSON.stringify({ passed: true, capabilities, voices, lifecycle: messages.filter(m => ['started', 'ended', 'cancelled'].includes(m.type)), exit, stderr }, null, 2));
