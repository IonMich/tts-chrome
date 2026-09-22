// Silent actual-helper protocol/lifecycle check. Never sends a speak request.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const host = process.argv[2] || fileURLToPath(new URL('.build/local-reader-native-tts', import.meta.url));
const results = [];
function gone(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}
async function probe(index, mode = 'shutdown') {
  const child = spawn(host, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise((resolve, reject) => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
  let buffer = Buffer.alloc(0), stderr = '', helperPid;
  const messages = [], listeners = new Set();
  child.stdin.on('error', () => {});
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
      const size = buffer.readUInt32LE();
      const message = JSON.parse(buffer.subarray(4, 4 + size));
      buffer = buffer.subarray(4 + size); messages.push(message);
      for (const listener of listeners) listener(message);
    }
  });
  const send = value => {
    const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
  };
  const until = (predicate, ms = 12000) => new Promise((resolve, reject) => {
    const existing = messages.find(predicate); if (existing) return resolve(existing);
    const timer = setTimeout(() => { listeners.delete(listener); reject(Error(`Timeout: ${JSON.stringify(messages)} ${stderr}`)); }, ms);
    const listener = message => { if (predicate(message)) { clearTimeout(timer); listeners.delete(listener); resolve(message); } };
    listeners.add(listener);
  });
  const deadline = setTimeout(() => { child.stdin.end(); child.kill('SIGTERM'); }, 15000);
  try {
    send({ action: 'capabilities', id: `cap-${index}` });
    const capabilities = await until(message => message.type === 'capabilities');
    assert.equal(capabilities.protocolVersion, 2);
    assert.equal(capabilities.shutdownAcknowledgement, 1);
    helperPid = capabilities.pid;
    assert(Number.isInteger(helperPid) && helperPid > 1);
    if (mode !== 'shutdown') {
      if (mode === 'helper-failure') {
        process.kill(helperPid, 'SIGKILL');
        send({ action: 'shutdown', id: `failed-shutdown-${index}` });
      }
      child.stdin.end();
      const exit = await closed;
      assert(gone(helperPid), 'Disconnected/failed probe must leave no helper process');
      assert(!messages.some(message => message.type === 'shutdown-complete'), 'EOF and helper failure are not verified shutdown acknowledgements');
      return { index, mode, relayPid: child.pid, helperPid, helperExited: true, exit, messages };
    }
    send({ action: 'shutdown', id: `shutdown-${index}` });
    const done = await until(message => message.type === 'shutdown-complete');
    assert.equal(done.id, `shutdown-${index}`);
    assert.equal(done.stopped, true); assert.equal(done.processExited, true);
    helperPid = done.pid;
    assert(Number.isInteger(helperPid) && helperPid > 1);
    assert(gone(helperPid), 'Helper PID must have exited before final acknowledgement');
    assert(!messages.some(message => ['shutdown-ready', 'started'].includes(message.type)));
    child.stdin.end();
    const exit = await closed;
    assert.equal(exit.code, 0, stderr); assert.equal(stderr, '');
    return { index, relayPid: child.pid, helperPid, helperExited: gone(helperPid), exit, messages };
  } finally {
    clearTimeout(deadline); child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (helperPid && !gone(helperPid)) process.kill(helperPid, 'SIGTERM');
  }
}
for (let index = 0; index < 5; index++) results.push(await probe(index));
results.push(await probe(5, 'connection-eof'));
results.push(await probe(6, 'helper-failure'));
console.log(JSON.stringify({ passed: true, scope: 'Idle AppKit capabilities and verified process exit only; no speech or audio overlap measurement.', host, results }, null, 2));
