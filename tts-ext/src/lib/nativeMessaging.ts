import { macVoiceValue, voiceLabel, type MacVoice, type VoiceCatalog } from './readerProtocol';

export const NATIVE_HOST_NAME = 'com.localreader.native_tts';
export const SYSTEM_SPEECH_VOICE: MacVoice = { id: 'macos-start-speaking', name: voiceLabel(macVoiceValue('macos-start-speaking')), language: 'System' };
const MAX_NATIVE_FRAME_BYTES = 1024 * 1024;
const MAX_NATIVE_TEXT_BYTES = 900_000;

export interface NativeCapabilities {
  mode: 'system-speech'; available: true; canStop: true; canPause: false; canSeek: false; hasPcm: false;
  protocolVersion: 2; shutdownAcknowledgement: 1;
}
export type NativeHostResponse =
  | ({ type: 'capabilities'; id: string } & NativeCapabilities)
  | { type: 'started'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'cancelled'; id: string }
  | { type: 'shutdown-complete'; id: string; stopped: true; processExited: true }
  | { type: 'error'; id: string; error?: string; message: string };

type PendingCapabilities = { resolve: (value: VoiceCatalog) => void; timer: ReturnType<typeof setTimeout>; port: NativePort };
type PendingShutdown = { id: string; port: NativePort; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type NativePort = Pick<chrome.runtime.Port, 'postMessage' | 'disconnect' | 'onMessage' | 'onDisconnect'>;

export const nativeUnavailableMessage = () => 'The Mac voice helper is unavailable. Install or repair it, then try again.';

export function validateNativeSpeech(id: string, text: string) {
  if (!id || !text) throw new Error('The Mac voice could not start.');
  const request = { action: 'speak', id, text };
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength > MAX_NATIVE_TEXT_BYTES || encoder.encode(JSON.stringify(request)).byteLength >= MAX_NATIVE_FRAME_BYTES) {
    throw new Error('This passage is too long for Mac Start Speaking. Select a shorter passage and try again.');
  }
  return request;
}

export class NativeMessagingBridge {
  private port: NativePort | null = null;
  private pendingCapabilities = new Map<string, PendingCapabilities>();
  private activeId: string | null = null;
  private helperOwned = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingShutdown: PendingShutdown | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private shutdownFailure: Error | null = null;

  constructor(
    private emit: (message: NativeHostResponse) => void,
    private connect: (name: string) => NativePort = name => chrome.runtime.connectNative(name),
    private stopTimeoutMs = 10_000,
  ) {}

  private ensurePort() {
    if (this.shutdownFailure) throw this.shutdownFailure;
    if (this.port) return this.port;
    const port = this.connect(NATIVE_HOST_NAME);
    this.port = port;
    port.onMessage.addListener(message => this.handleMessage(port, message));
    port.onDisconnect.addListener(() => this.handleDisconnect(port));
    return port;
  }

  async listVoices(timeoutMs = 4000): Promise<VoiceCatalog> {
    if (this.shutdownPromise) {
      try { await this.shutdownPromise; }
      catch (error) { return { macVoices: [], macError: error instanceof Error ? error.message : String(error) }; }
    }
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
    if (this.shutdownPromise && !this.pendingShutdown) this.shutdownPromise = null;
    const request = validateNativeSpeech(id, text);
    const port = this.ensurePort();
    this.helperOwned = true;
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
      this.shutdownFailure = new Error('The Mac voice helper Stop timed out, so shutdown ownership is unknown. Reload the extension before reading again.');
      this.disconnectPort(port, false);
      this.emit({ type: 'error', id: requestId, error: 'stop-timeout', message: 'The Mac voice did not confirm Stop. Its connection was closed. Try reading again.' });
    }, this.stopTimeoutMs);
  }

  stopActive() { this.stop(); }

  async shutdown(): Promise<void> {
    if (this.shutdownFailure) throw this.shutdownFailure;
    if (this.shutdownPromise) return this.shutdownPromise;
    const port = this.port;
    if (!port) {
      if (this.helperOwned) throw new Error('The Mac voice helper shutdown could not be verified. Reload the extension before reading again.');
      return;
    }
    const id = crypto.randomUUID();
    this.shutdownPromise = new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        if (this.pendingShutdown?.id !== id) return;
        clearTimeout(this.pendingShutdown.timer);
        this.pendingShutdown = null;
        this.shutdownFailure = error;
        this.disconnectPort(port, false, true);
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('The Mac voice helper did not verify shutdown. Reload the extension after updating or repairing the helper.')), this.stopTimeoutMs);
      this.pendingShutdown = { id, port, resolve, reject: fail, timer };
      try { port.postMessage({ action: 'shutdown', id }); }
      catch { fail(new Error(nativeUnavailableMessage())); }
    });
    return this.shutdownPromise;
  }

  close() { return this.shutdown(); }

  failClosed(message: string) {
    if (!this.shutdownFailure) this.shutdownFailure = new Error(message);
  }

  private handleMessage(port: NativePort, message: unknown) {
    if (port !== this.port || !message || typeof message !== 'object') return;
    const response = message as Partial<NativeHostResponse>;
    if (response.type === 'shutdown-complete' && typeof response.id === 'string') {
      const pending = this.pendingShutdown;
      if (!pending || pending.port !== port || pending.id !== response.id || response.stopped !== true || response.processExited !== true) return;
      clearTimeout(pending.timer);
      this.pendingShutdown = null;
      this.activeId = null;
      this.helperOwned = false;
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
      this.disconnectPort(port, false);
      this.shutdownPromise = null;
      pending.resolve();
      return;
    }
    if (response.type === 'capabilities' && typeof response.id === 'string') {
      const pending = this.pendingCapabilities.get(response.id);
      if (!pending || pending.port !== port) return;
      clearTimeout(pending.timer);
      this.pendingCapabilities.delete(response.id);
      const supported = response.available === true && response.mode === 'system-speech' && response.canStop === true && response.canPause === false && response.canSeek === false && response.hasPcm === false && response.protocolVersion === 2 && response.shutdownAcknowledgement === 1;
      pending.resolve(supported ? { macVoices: [SYSTEM_SPEECH_VOICE] } : { macVoices: [], macError: 'Update the Mac voice helper before using Start Speaking (shutdown protocol 2 is required).' });
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
    if (response.type === 'ended' || response.type === 'cancelled' || response.type === 'error') {
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
      this.activeId = null;
    }
    // Retire the old request before notifying: a listener may start a replay.
    this.emit(response as NativeHostResponse);
    if (response.type === 'ended' || response.type === 'cancelled' || response.type === 'error') void this.shutdown().catch(() => {});
    else this.closeIfIdle(port);
  }

  private closeIfIdle(port: NativePort) {
    if (this.port === port && !this.helperOwned && !this.activeId && !this.hasPending(port) && !this.pendingShutdown) this.disconnectPort(port, false);
  }

  private hasPending(port: NativePort) {
    for (const pending of this.pendingCapabilities.values()) if (pending.port === port) return true;
    return false;
  }

  private handleDisconnect(port: NativePort) {
    void (globalThis as any).chrome?.runtime?.lastError;
    if (this.pendingShutdown?.port === port) {
      this.pendingShutdown.reject(new Error('The Mac voice helper disconnected before shutdown was verified. Reload the extension before reading again.'));
      return;
    }
    if (this.helperOwned) this.shutdownFailure = new Error('The Mac voice helper disconnected before shutdown was verified. Reload the extension before reading again.');
    this.disconnectPort(port, true, this.helperOwned);
  }

  private disconnectPort(port: NativePort, notifyActive: boolean, preserveFailure = false) {
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
    if (!preserveFailure && this.pendingShutdown?.port === port) {
      clearTimeout(this.pendingShutdown.timer);
      this.pendingShutdown = null;
    }
    if (notifyActive && activeId) this.emit({ type: 'error', id: activeId, error: 'host-disconnected', message });
  }

}
