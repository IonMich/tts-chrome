import type { MacVoice, VoiceCatalog } from './readerProtocol';

export const NATIVE_HOST_NAME = 'com.localreader.native_tts';
export const SYSTEM_SPEECH_VOICE: MacVoice = { id: 'macos-start-speaking', name: 'Mac voice (Start Speaking)', language: 'System' };
const MAX_NATIVE_FRAME_BYTES = 1024 * 1024;
const MAX_NATIVE_TEXT_BYTES = 900_000;

export interface NativeCapabilities {
  mode: 'system-speech'; available: true; canStop: true; canPause: false; canSeek: false; hasPcm: false;
}
export type NativeHostResponse =
  | ({ type: 'capabilities'; id: string } & NativeCapabilities)
  | { type: 'started'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'cancelled'; id: string }
  | { type: 'error'; id: string; error?: string; message: string };

type PendingCapabilities = { resolve: (value: VoiceCatalog) => void; timer: ReturnType<typeof setTimeout>; port: NativePort };
type NativePort = Pick<chrome.runtime.Port, 'postMessage' | 'disconnect' | 'onMessage' | 'onDisconnect'>;

export const nativeUnavailableMessage = () => 'The Mac voice helper is unavailable. Install or repair it, then try again.';

export class NativeMessagingBridge {
  private port: NativePort | null = null;
  private pendingCapabilities = new Map<string, PendingCapabilities>();
  private activeId: string | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private emit: (message: NativeHostResponse) => void,
    private connect: (name: string) => NativePort = name => chrome.runtime.connectNative(name),
    private stopTimeoutMs = 2000,
  ) {}

  private ensurePort() {
    if (this.port) return this.port;
    const port = this.connect(NATIVE_HOST_NAME);
    this.port = port;
    port.onMessage.addListener(message => this.handleMessage(port, message));
    port.onDisconnect.addListener(() => this.handleDisconnect(port));
    return port;
  }

  async listVoices(timeoutMs = 4000): Promise<VoiceCatalog> {
    const id = crypto.randomUUID();
    try {
      const port = this.ensurePort();
      return await new Promise<VoiceCatalog>(resolve => {
        const timer = setTimeout(() => {
          const pending = this.pendingCapabilities.get(id);
          if (!pending || pending.port !== port) return;
          this.pendingCapabilities.delete(id);
          resolve({ macVoices: [], macError: nativeUnavailableMessage() });
          this.closeIfIdle(port);
        }, timeoutMs);
        this.pendingCapabilities.set(id, { resolve, timer, port });
        try { port.postMessage({ action: 'capabilities', id }); }
        catch {
          clearTimeout(timer);
          this.pendingCapabilities.delete(id);
          resolve({ macVoices: [], macError: nativeUnavailableMessage() });
          this.disconnectPort(port, true);
        }
      });
    } catch {
      return { macVoices: [], macError: nativeUnavailableMessage() };
    }
  }

  speak(id: string, text: string) {
    if (!id || !text) throw new Error('The Mac voice could not start.');
    const request = { action: 'speak', id, text };
    const encoder = new TextEncoder();
    if (encoder.encode(text).byteLength > MAX_NATIVE_TEXT_BYTES || encoder.encode(JSON.stringify(request)).byteLength >= MAX_NATIVE_FRAME_BYTES) {
      throw new Error('This passage is too long for Mac Start Speaking. Select a shorter passage and try again.');
    }
    const port = this.ensurePort();
    this.activeId = id;
    clearTimeout(this.stopTimer);
    try { port.postMessage(request); }
    catch {
      this.disconnectPort(port, false);
      throw new Error(nativeUnavailableMessage());
    }
  }

  stop(id?: string) {
    const requestId = id ?? this.activeId;
    const port = this.port;
    if (!requestId || !port) return;
    try { port.postMessage({ action: 'stop', id: requestId }); }
    catch {
      this.disconnectPort(port, false);
      throw new Error(nativeUnavailableMessage());
    }
    if (requestId !== this.activeId) return;
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      if (this.port !== port || this.activeId !== requestId) return;
      this.activeId = null;
      this.emit({ type: 'cancelled', id: requestId });
      this.disconnectPort(port, false);
    }, this.stopTimeoutMs);
  }

  stopActive() { this.stop(); }

  close() {
    const port = this.port;
    if (port) this.disconnectPort(port, false);
  }

  private handleMessage(port: NativePort, message: unknown) {
    if (port !== this.port || !message || typeof message !== 'object') return;
    const response = message as Partial<NativeHostResponse>;
    if (response.type === 'capabilities' && typeof response.id === 'string') {
      const pending = this.pendingCapabilities.get(response.id);
      if (!pending || pending.port !== port) return;
      clearTimeout(pending.timer);
      this.pendingCapabilities.delete(response.id);
      const supported = response.available === true && response.mode === 'system-speech' && response.canStop === true && response.canPause === false && response.canSeek === false && response.hasPcm === false;
      pending.resolve(supported ? { macVoices: [SYSTEM_SPEECH_VOICE] } : { macVoices: [], macError: 'This Mac voice helper is unavailable or unsupported.' });
      this.closeIfIdle(port);
      return;
    }
    if (response.type === 'error' && typeof response.id === 'string') {
      const pending = this.pendingCapabilities.get(response.id);
      if (pending?.port === port) {
        clearTimeout(pending.timer);
        this.pendingCapabilities.delete(response.id);
        pending.resolve({ macVoices: [], macError: response.message || nativeUnavailableMessage() });
        this.closeIfIdle(port);
        return;
      }
    }
    if (!['started', 'ended', 'cancelled', 'error'].includes(String(response.type)) || typeof response.id !== 'string') return;
    if (response.id !== this.activeId) return;
    this.emit(response as NativeHostResponse);
    if (response.type === 'ended' || response.type === 'cancelled' || response.type === 'error') {
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
      this.activeId = null;
      this.closeIfIdle(port);
    }
  }

  private closeIfIdle(port: NativePort) {
    if (this.port === port && !this.activeId && !this.hasPending(port)) this.disconnectPort(port, false);
  }

  private hasPending(port: NativePort) {
    for (const pending of this.pendingCapabilities.values()) if (pending.port === port) return true;
    return false;
  }

  private handleDisconnect(port: NativePort) {
    void (globalThis as any).chrome?.runtime?.lastError;
    this.disconnectPort(port, true);
  }

  private disconnectPort(port: NativePort, notifyActive: boolean) {
    if (this.port !== port) return;
    this.port = null;
    clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    const activeId = this.activeId;
    this.activeId = null;
    const message = nativeUnavailableMessage();
    for (const [id, pending] of this.pendingCapabilities) {
      if (pending.port !== port) continue;
      clearTimeout(pending.timer);
      this.pendingCapabilities.delete(id);
      pending.resolve({ macVoices: [], macError: message });
    }
    try { port.disconnect(); } catch {}
    if (notifyActive && activeId) this.emit({ type: 'error', id: activeId, error: 'host-disconnected', message });
  }

}
