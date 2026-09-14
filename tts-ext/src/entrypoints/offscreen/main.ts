import { ReaderEngine } from '@/lib/readerEngine';
import { READER_CHANNEL } from '@/lib/readerProtocol';
import type { NativeHostResponse } from '@/lib/nativeMessaging';
let revision = 0;
const engine = new ReaderEngine(snapshot => {
  void chrome.runtime.sendMessage({ channel: READER_CHANNEL, target: 'background', action: 'engine-state', snapshot: { ...snapshot, revision: ++revision }, ...(['complete', 'error'].includes(snapshot.phase) ? { diagnostics: engine.diagnostics } : {}) }).catch(() => {});
}, new URL('./', location.href));
const currentSnapshot = () => ({ ...engine.snapshot, revision });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.channel !== READER_CHANNEL || message.target !== 'engine') return;
  if (message.action === 'get') { respond({ snapshot: currentSnapshot() }); return; }
  if (message.action === 'diagnostics') { respond({ diagnostics: engine.diagnostics }); return; }
  if (message.action === 'native-message') { engine.handleNativeMessage(message.message as NativeHostResponse); respond({ ok: true }); return; }
  if (message.action === 'start') { void engine.start(message.request, message.sessionId, message.requestedAt); respond({ ok: true }); return; }
  Promise.resolve(message.action === 'stop' ? engine.stop() : message.action === 'pause' ? engine.pause() : message.action === 'seek' ? engine.seek(message.seconds) : message.action === 'speed' ? engine.setSpeed(message.speed) : engine.resume()).then(() => respond({ ok: true, snapshot: currentSnapshot() })).catch(error => respond({error: error instanceof Error ? error.message : String(error)}));
  return true;
});
// Test diagnostics expose timings/resource counts, never page text or raw audio.
Object.defineProperty(window, 'readerDiagnostics', { get: () => engine.diagnostics });
