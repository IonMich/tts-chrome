import { idleSnapshot, isCurrentSnapshot, READER_CHANNEL, type ReaderRequest, type ReaderSnapshot, type ReaderLaunchResult, type VoiceCatalog } from './readerProtocol';
async function command(action: string, fields: object = {}) {
  const result = await chrome.runtime.sendMessage({ channel: READER_CHANNEL, target: 'background', action, requestedAt: Date.now(), ...fields });
  if (result?.error) throw new Error(result.error);
  return result;
}
export async function getReaderState(): Promise<ReaderSnapshot> { return (await command('get'))?.snapshot ?? idleSnapshot(); }
export async function getVoiceCatalog(): Promise<VoiceCatalog> { return command('native-list'); }
export async function startReader(request: ReaderRequest): Promise<ReaderLaunchResult> { return command('start', { request }); }
export async function readCurrentPage(selectionOnly = false): Promise<ReaderLaunchResult> { return command('read-page', { selectionOnly }); }
export async function showReaderPlayer(): Promise<ReaderLaunchResult> { return command('show-player'); }
export async function pauseReader(sessionId?: string): Promise<ReaderSnapshot | undefined> { return (await command('pause', { sessionId }))?.snapshot; }
export async function resumeReader(sessionId?: string): Promise<ReaderSnapshot | undefined> { return (await command('resume', { sessionId }))?.snapshot; }
export async function stopReader(): Promise<void> { await command('stop'); }
export async function seekReader(seconds: number, sessionId?: string): Promise<ReaderSnapshot | undefined> { return (await command('seek', { seconds, sessionId }))?.snapshot; }
export async function setReaderSpeed(speed: number): Promise<void> { await command('speed', { speed }); }
export async function changeReaderVoice(voice: string, sessionId?: string): Promise<ReaderSnapshot | undefined> { return (await command('voice', { voice, sessionId }))?.snapshot; }
export const disposeReader = stopReader;
export function subscribeReader(callback: (snapshot: ReaderSnapshot) => void): () => void {
  let active = true;
  let receivedBroadcast = false;
  let current = idleSnapshot();
  const accept = (snapshot: ReaderSnapshot) => {
    if (active && isCurrentSnapshot(current, snapshot)) { current = snapshot; callback(snapshot); }
  };
  const listener = (message: any) => {
    if (message?.channel === READER_CHANNEL && message.action === 'state') { receivedBroadcast = true; accept(message.snapshot); }
  };
  chrome.runtime.onMessage.addListener(listener);
  void getReaderState().then(snapshot => { if (!receivedBroadcast) accept(snapshot); }).catch(() => {});
  return () => { active = false; chrome.runtime.onMessage.removeListener(listener); };
}
