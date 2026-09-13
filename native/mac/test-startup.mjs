// Silent repeated launch/EOF check for native FIFO startup races.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const host = process.argv[2] || fileURLToPath(new URL('.build/local-reader-native-tts', import.meta.url));
const results = [];
for (let i = 0; i < 30; i++) {
  const started = performance.now();
  const child = spawn(host, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let bytes = Buffer.alloc(0), stderr = '', received = false, timedOut = false;
  const body = Buffer.from(JSON.stringify({ action: 'capabilities', id: `probe-${i}` }));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  const timeout = setTimeout(() => { timedOut = true; child.stdin.end(); }, 2000);
  const kill = setTimeout(() => child.kill('SIGTERM'), 9000);
  child.stdout.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.length < 4 || bytes.length < bytes.readUInt32LE() + 4) return;
    const value = JSON.parse(bytes.subarray(4, 4 + bytes.readUInt32LE()));
    received = value.type === 'capabilities' && value.available === true;
    clearTimeout(timeout); child.stdin.end();
  });
  child.stdin.write(Buffer.concat([header, body]));
  const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  clearTimeout(timeout); clearTimeout(kill);
  results.push({ i, pid: child.pid, received, timedOut, code, elapsedMs: performance.now() - started, stderr });
}
const failures = results.filter(r => !r.received || r.timedOut || r.code !== 0 || r.stderr);
console.log(JSON.stringify({ passed: !failures.length, host, count: results.length, failures, results }, null, 2));
process.exitCode = failures.length ? 1 : 0;
