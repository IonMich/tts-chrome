import { READER_CHANNEL, idleSnapshot, validateRequest, isCurrentSnapshot, voiceLabel, macVoiceId, type ReaderSnapshot, type ReaderRequest } from '@/lib/readerProtocol';
import { extractReadableText } from '@/lib/pageText';
import { NativeMessagingBridge } from '@/lib/nativeMessaging';
export default defineBackground(() => {
  let snapshot = idleSnapshot();
  let ownerTab: number | undefined;
  let pagePlayerAvailable: boolean | undefined;
  let lifecycle = Promise.resolve();
  class CancelledLaunch extends Error { constructor() { super('This reading was cancelled by a newer request.'); } }
  type Launch = { tabId?: number; cancelled: boolean; cancellation: Promise<never>; cancel: () => void };
  let launch: Launch | undefined;
  let engineSession: string | undefined;
  let nativeOwnershipUnknown = false;
  let nativeLease = 0;
  let nativeRequestedId: string | undefined;
  let nativeOwner: { id: string; lease: number } | undefined;
  let nativeTask: Promise<unknown> = Promise.resolve();
  const nativeRecoveryError = 'A previous Mac voice helper may still be running. Reading is blocked until its process exit is independently verified and the saved ownership marker is repaired. Reloading the extension or reinstalling the Mac helper does not clear this safety block.';
  function queueNative<T>(work: () => Promise<T>): Promise<T> {
    const result = nativeTask.then(work, work);
    nativeTask = result.then(() => {}, () => {});
    return result;
  }
  async function persistNativeOwnership(value: boolean) {
    // Retain the actual write in nativeTask: a timed-out write must never land
    // after a successor's marker or its verified-shutdown clear.
    try {
      await chrome.storage.local.set({ nativeOwnershipUnknown: value });
      nativeOwnershipUnknown = value;
    } catch (error) {
      nativeOwnershipUnknown = true;
      native.failClosed('Native ownership storage failed. ' + nativeRecoveryError);
      throw error;
    }
  }
  async function retireNativeOwned() {
    const verified = await native.shutdown();
    if (nativeOwnershipUnknown) {
      if (verified !== true) throw new Error(nativeRecoveryError);
      await persistNativeOwnership(false);
    }
    nativeOwner = undefined;
  }
  const retireNative = () => queueNative(retireNativeOwned);
  // Creation/closure can finish after a timeout. Keep ownership until the actual
  // Chrome operation settles; a timeout must never permit a second acquisition.
  let documentTask: Promise<unknown> = Promise.resolve();
  function invalidateLaunch() { launch?.cancel(); engineSession = undefined; }
  function newLaunch(tabId?: number): Launch {
    invalidateLaunch();
    let reject!: (error: Error) => void;
    const ticket: Launch = { tabId, cancelled: false, cancellation: new Promise((_, fail) => { reject = fail; }),
      cancel() { if (!ticket.cancelled) { ticket.cancelled = true; reject(new CancelledLaunch()); } } };
    void ticket.cancellation.catch(() => {});
    return launch = ticket;
  }
  function check(ticket?: Launch) { if (ticket?.cancelled) throw new CancelledLaunch(); }
  async function bounded<T>(work: Promise<T>, ticket?: Launch, ms = 5000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      check(ticket);
      return await Promise.race([work, ...(ticket ? [ticket.cancellation] : []),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The reader operation timed out. Close the reader and try again.')), ms); })]);
    } finally { clearTimeout(timer); }
  }
  async function step<T>(ticket: Launch, work: () => Promise<T>) { check(ticket); const result = await bounded(work(), ticket); check(ticket); return result; }
  const serial = <T>(fn: () => Promise<T>, onError?: (error: unknown) => Promise<void>): Promise<T> => {
    const run = async () => { try { return await fn(); } catch (error) { await onError?.(error); throw error; } };
    const result = lifecycle.then(run, run);
    lifecycle = result.then(() => {}, () => {});
    return result;
  };
  const native = new NativeMessagingBridge(message => {
    const owner = nativeOwner;
    if (owner?.id === message.id && ['ended', 'cancelled', 'error'].includes(message.type)) {
      void queueNative(async () => {
        if (nativeOwner === owner) await retireNativeOwned();
      }).catch(() => native.failClosed(nativeRecoveryError));
    }
    void chrome.runtime.sendMessage({ channel: READER_CHANNEL, target: 'engine', action: 'native-message', message }).catch(() => {});
  });
  async function publish(next: ReaderSnapshot) {
    const published = { ...next, voiceName: voiceLabel(next.voice), pagePlayerAvailable };
    snapshot = published;
    const tab = ownerTab;
    await chrome.storage.session.set({ readerSnapshot: snapshot, readerOwnerTab: ownerTab ?? null });
    if (snapshot !== published) return; // A delayed publication cannot broadcast an obsolete state.
    const message = { channel: READER_CHANNEL, action: 'state', snapshot: published };
    void chrome.runtime.sendMessage(message).catch(() => {});
    if (tab !== undefined) await chrome.tabs.sendMessage(tab, message).catch(() => {});
  }
  const engine = (action: string, payload: object = {}) => chrome.runtime.sendMessage({ channel: READER_CHANNEL, target: 'engine', action, ...payload });
  async function ensureDocument(ticket: Launch) {
    await step(ticket, () => documentTask);
    if (!(await step(ticket, () => chrome.offscreen.hasDocument()))) {
      check(ticket);
      documentTask = chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run the explicitly requested local speech model in a dedicated disposable worker, with a DOM audio controller.',
      });
      await bounded(documentTask, ticket);
      check(ticket);
    }
  }
  async function releaseDocument() {
    documentTask = documentTask.catch(() => {}).then(async () => {
      if (await bounded(chrome.offscreen.hasDocument())) {
        await bounded(engine('stop'), undefined, 500).catch(() => {});
        const final = await bounded(engine('diagnostics'), undefined, 500).catch(() => undefined);
        if (final?.diagnostics) void chrome.storage.session.set({ readerLastDiagnostics: final.diagnostics }).catch(() => {});
        // Do not timeout this underlying promise: it remains the ownership barrier.
        await chrome.offscreen.closeDocument();
      }
    });
    await bounded(documentTask);
  }
  async function stop() {
    nativeLease++;
    engineSession = undefined;
    pagePlayerAvailable = undefined;
    try {
      // Carry the released tuple so a delayed Stop cannot clear a new source.
      await Promise.all([bounded(publish({ ...idleSnapshot(), sessionId: snapshot.sessionId, sourceId: snapshot.sourceId })), releaseDocument()]);
      await bounded(retireNative(), undefined, 15000);
    } catch (error) {
      if (nativeOwnershipUnknown) native.failClosed(nativeRecoveryError);
      throw error;
    }
  }
  async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id; }
  async function showPlayer(tabId: number, focus = true, ticket?: Launch) {
    try {
      const sessionId = snapshot.sessionId;
      let shown = await bounded(chrome.tabs.sendMessage(tabId, { type: 'reader:show', focus, sessionId }).catch(() => undefined), ticket);
      check(ticket);
      if (!shown?.shown) {
        await bounded(chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/main.js'] }), ticket);
        check(ticket);
        shown = await bounded(chrome.tabs.sendMessage(tabId, { type: 'reader:show', focus, sessionId }), ticket);
      }
      return shown?.shown === true;
    } catch { return false; /* Chrome-owned pages/PDF viewer cannot be injected. */ }
  }
  async function start(ticket: Launch, input: ReaderRequest | ((sessionId: string) => Promise<ReaderRequest>), tabId?: number, requestedAt = Date.now()) {
    check(ticket);
    await stop();
    try {
      check(ticket);
      ownerTab = tabId ?? await step(ticket, activeTab);
      ticket.tabId = ownerTab;
      const sessionId = crypto.randomUUID();
      await step(ticket, () => publish({ ...idleSnapshot(), phase: 'preparing', sessionId, message: 'Preparing your reading…' }));
      // Mount before extraction/validation, so failures also have a visible home.
      pagePlayerAvailable = ownerTab !== undefined && await showPlayer(ownerTab, false, ticket);
      check(ticket);
      const request = validateRequest(typeof input === 'function' ? await step(ticket, () => input(sessionId)) : input);
      await step(ticket, () => publish({ ...snapshot, sourceId: request.sourceId, voice: request.voice, speed: request.speed, speechMode: macVoiceId(request.voice) ? 'system' : undefined, message: 'Preparing the installed voice…' }));
      await ensureDocument(ticket);
      engineSession = sessionId;
      const result = await step(ticket, () => engine('start', { request, sessionId, requestedAt }));
      if (result?.error) throw new Error(result.error);
      if (pagePlayerAvailable && ownerTab !== undefined) pagePlayerAvailable = await showPlayer(ownerTab, true, ticket);
      await step(ticket, () => publish(snapshot));
      return { playerShown: pagePlayerAvailable === true };
    } catch (error) {
      ticket.cancel();
      engineSession = undefined;
      let nativeError: unknown;
      try { await bounded(retireNative(), undefined, 15000); } catch (shutdownError) { nativeError = shutdownError; }
      try { await releaseDocument(); }
      catch (cleanupError) { throw new Error(`${error instanceof Error ? error.message : String(error)} Cleanup has not completed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`); }
      if (nativeError) throw nativeError;
      throw error;
    }
  }
  async function readPage(ticket: Launch, selectionOnly: boolean, tabId?: number, requestedAt = Date.now(), fallbackText?: string) {
    check(ticket);
    const id = tabId ?? await step(ticket, activeTab);
    if (id === undefined) throw new Error('Open a page to read, or paste text in the reader.');
    ticket.tabId = id;
    return start(ticket, async sessionId => {
      const source = await step(ticket, () => chrome.tabs.sendMessage(id, { type: 'reader:extract', selectionOnly, sessionId }).catch(() => undefined));
      const results = source?.text ? undefined : await step(ticket, () => chrome.scripting.executeScript({ target: { tabId: id }, args: [selectionOnly], func: extractReadableText }).catch(error => {
        if (fallbackText) return []; // Context-menu text can still play on non-injectable documents.
        throw error;
      }));
      const settings = await step(ticket, () => chrome.storage.sync.get(['voice', 'speed']));
      return { text: source?.text || results?.[0]?.result || fallbackText || '', sourceId: source?.text ? source.sourceId : undefined, voice: settings.voice, speed: settings.speed };
    }, id, requestedAt);
  }
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'readText', title: 'Read aloud', contexts: ['selection'] }));
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'readText' || !info.selectionText) return;
    const ticket = newLaunch(tab?.id);
    void serial(async () => {
      check(ticket);
      if (info.frameId) {
        // A selection inside another frame has no top-document ranges. Never
        // associate it with a different selection left behind in the main frame.
        const settings = await step(ticket, () => chrome.storage.sync.get(['voice', 'speed']));
        await start(ticket, { text: info.selectionText!, voice: settings.voice, speed: settings.speed }, tab?.id);
        return;
      }
      await readPage(ticket, true, tab?.id, Date.now(), info.selectionText);
    }, reportError).catch(() => {});
  });
  chrome.commands.onCommand.addListener(command => {
    if (command === 'trigger_tts' || command === 'trigger_page_tts') {
      const ticket = newLaunch();
      void serial(() => readPage(ticket, command === 'trigger_tts'), reportError).catch(() => {});
    }
  });
  async function reportError(error: unknown) {
    if (error instanceof CancelledLaunch) return;
    engineSession = undefined;
    try { native.stopActive(); } catch {}
    try {
      await bounded(publish({ ...snapshot, phase: 'error', modelResident: false, error: error instanceof Error ? error.message : String(error) })).catch(() => {});
    } finally {
      let shutdown: unknown;
      try { await bounded(retireNative(), undefined, 15000); } catch (error) { shutdown = error; }
      await releaseDocument().catch(() => {});
      if (shutdown) throw shutdown;
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.channel !== READER_CHANNEL || message.target !== 'background' || sender.id !== chrome.runtime.id) return;
    if (message.action === 'native-list') {
      void native.listVoices().then(respond);
      return true;
    }
    if (message.action === 'native-speak' || message.action === 'native-stop' || message.action === 'native-shutdown') {
      if (sender.url !== chrome.runtime.getURL('offscreen.html')) {
        respond({ error: 'The Mac voice request was rejected.' });
        return;
      }
      void (async()=>{ try {
        if (message.action === 'native-speak') {
          if (!engineSession || typeof message.id !== 'string' || !message.id.startsWith(engineSession + ':')) throw new CancelledLaunch();
          const expectedSession = engineSession;
          const lease = ++nativeLease;
          nativeRequestedId = message.id;
          const current = () => engineSession === expectedSession && lease === nativeLease;
          await bounded(queueNative(async () => {
            if (!current()) throw new CancelledLaunch();
            await retireNativeOwned();
            if (!current()) throw new CancelledLaunch();
            const owner = { id: message.id, lease };
            try {
              await native.speak(message.id, message.text, current, async () => {
                if (!current()) throw new CancelledLaunch();
                nativeOwner = owner;
                nativeOwnershipUnknown = true;
                await persistNativeOwnership(true);
              });
            } catch (error) {
              // Still inside the acquisition queue; no successor can be touched.
              if (!nativeOwner || nativeOwner === owner) await retireNativeOwned();
              if (!current()) throw new CancelledLaunch();
              throw error;
            }
          }), undefined, 15000).catch(error => {
            if (nativeLease === lease) ++nativeLease;
            throw error;
          });
        } else {
          if (!engineSession || typeof message.sessionId !== 'string' || message.sessionId !== engineSession) throw new CancelledLaunch();
          if (message.action === 'native-stop') {
            if (typeof message.id !== 'string' || !message.id.startsWith(engineSession + ':') || message.id !== nativeRequestedId) throw new CancelledLaunch();
            const expectedSession = engineSession;
            ++nativeLease; // Stop must also cancel a not-yet-posted speech request.
            await bounded(queueNative(async () => {
              if (engineSession !== expectedSession) throw new CancelledLaunch();
              if (nativeOwner?.id === message.id) native.stop(message.id);
            }), undefined, 15000);
          } else {
            const expectedSession = engineSession;
            ++nativeLease;
            await bounded(queueNative(async () => {
              if (engineSession !== expectedSession) throw new CancelledLaunch();
              await retireNativeOwned();
            }), undefined, 15000);
          }
        }
        respond({ ok: true });
      } catch (error) {
        respond({ error: error instanceof Error ? error.message : String(error), ...(error instanceof CancelledLaunch ? { cancelled: true } : {}) });
      } })();
      return true;
    }
    if (message.action === 'engine-state') {
      if (sender.url !== chrome.runtime.getURL('offscreen.html')) return;
      if (message.diagnostics && ['complete','error'].includes(message.snapshot?.phase)) void chrome.storage.session.set({ readerLastDiagnostics: message.diagnostics });
      if (message.snapshot?.sessionId === engineSession && message.snapshot?.sessionId === snapshot.sessionId && snapshot.phase !== 'idle' && isCurrentSnapshot(snapshot, message.snapshot)) {
        void publish(message.snapshot);
        if (message.snapshot.phase === 'error' || (message.snapshot.phase === 'complete' && !message.snapshot.replayExpiresAt && message.snapshot.speechMode !== 'system')) void serial(async () => {
          if (snapshot.sessionId === message.snapshot.sessionId && ['complete', 'error'].includes(snapshot.phase)) { engineSession = undefined; await releaseDocument(); }
        }, reportError).catch(() => {});
      }
      return;
    }
    if (message.action === 'get') { void lifecycle.then(() => respond({ snapshot })); return true; }
    const ticket = ['start', 'read-page'].includes(message.action) ? newLaunch(sender.tab?.id) : undefined;
    if (message.action === 'stop') invalidateLaunch();
    void serial(async () => {
      if (['pause', 'resume', 'seek', 'speed', 'voice'].includes(message.action) && message.sessionId && (message.sessionId !== snapshot.sessionId || snapshot.phase === 'idle')) {
        respond({ error: 'This reading session ended.' });
        return;
      }
      let result: { playerShown: boolean } | undefined;
      if (message.action === 'start') result = await start(ticket!, message.request, sender.tab?.id, message.requestedAt);
      else if (message.action === 'read-page') result = await readPage(ticket!, !!message.selectionOnly, sender.tab?.id, message.requestedAt);
      else if (message.action === 'show-player') {
        if (snapshot.phase === 'idle' || ownerTab === undefined) throw new Error('Start a reading to open its player.');
        const tab = await chrome.tabs.update(ownerTab, { active: true });
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        pagePlayerAvailable = await showPlayer(ownerTab);
        await publish(snapshot);
        result = { playerShown: pagePlayerAvailable };
      }
      else if (message.action === 'stop') await stop();
      else if (message.action === 'voice') {
        const { voice, voiceName } = validateRequest({ text: 'Voice preference.', voice: message.voice });
        if (snapshot.phase === 'idle') {
          if (macVoiceId(voice)) {
            const catalog = await native.listVoices();
            if (!catalog.macVoices.some(entry => entry.id === macVoiceId(voice))) throw new Error(catalog.macError || 'That voice is not available.');
          }
          await chrome.storage.sync.set({ voice, voiceName });
          await publish({ ...snapshot, voice, voiceName });
        } else {
          if (!(await chrome.offscreen.hasDocument())) throw new Error('This reading has expired. Start a new reading to change its voice.');
          const changed = await engine('voice', { voice, sessionId: snapshot.sessionId });
          if (changed?.error) throw new Error(changed.error);
          if (!changed?.snapshot || changed.snapshot.sessionId !== snapshot.sessionId || changed.snapshot.voice !== voice) throw new Error('The voice could not be changed. Try again.');
          if (isCurrentSnapshot(snapshot, changed.snapshot)) await publish(changed.snapshot);
          await chrome.storage.sync.set({ voice, voiceName });
        }
      }
      else if (['pause','resume','seek','speed'].includes(message.action)) {
        if (await chrome.offscreen.hasDocument()) {
          const result = await engine(message.action, {seconds:message.seconds,speed:message.speed});
          if(result?.error)throw Error(result.error);
          if (result?.snapshot?.sessionId === snapshot.sessionId && isCurrentSnapshot(snapshot, result.snapshot)) await publish(result.snapshot);
        }
        else throw new Error('The reader session ended. Press Play to start again.');
      } else throw new Error('Unknown reader command.');
      respond({ ok: true, snapshot, ...result });
    }, message.action === 'voice' ? undefined : reportError).catch(error => { respond({ error: error instanceof Error ? error.message : String(error), ...(error instanceof CancelledLaunch ? { cancelled: true } : {}) }); });
    return true;
  });
  function releaseOwner(id: number) {
    if (launch?.tabId === id || (!launch && id === ownerTab)) invalidateLaunch();
    void serial(async () => { if (id === ownerTab) await stop(); }, reportError).catch(() => {});
  }
  chrome.tabs.onRemoved.addListener(releaseOwner);
  chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === 'loading') releaseOwner(id); });
  lifecycle = (async () => {
    const saved = await bounded(chrome.storage.session.get(['readerOwnerTab', 'readerSnapshot', 'nativeOwnershipUnknown']));
    const durable = await bounded(chrome.storage.local.get(['nativeOwnershipUnknown']));
    nativeOwnershipUnknown = durable.nativeOwnershipUnknown === true || saved.nativeOwnershipUnknown === true;
    if (saved.nativeOwnershipUnknown === true) {
      await bounded(chrome.storage.local.set({ nativeOwnershipUnknown: true }));
      await bounded(chrome.storage.session.remove('nativeOwnershipUnknown'));
    }
    if (nativeOwnershipUnknown) native.failClosed(nativeRecoveryError);
    ownerTab = typeof saved.readerOwnerTab === 'number' ? saved.readerOwnerTab : undefined;
    pagePlayerAvailable = saved.readerSnapshot?.pagePlayerAvailable;
    const exists = await bounded(chrome.offscreen.hasDocument());
    if (exists) { const current = await bounded(engine('get')); if (current?.snapshot) { snapshot = { ...current.snapshot, voiceName: voiceLabel(current.snapshot.voice), pagePlayerAvailable }; engineSession = snapshot.sessionId; } }
    else {
      pagePlayerAvailable = undefined;
      await bounded(publish({ ...idleSnapshot(), sessionId: saved.readerSnapshot?.sessionId, sourceId: saved.readerSnapshot?.sourceId }));
      ownerTab = undefined;
      await bounded(chrome.storage.session.set({ readerOwnerTab: null }));
    }
  })().catch(() => {
    snapshot = idleSnapshot(); ownerTab = undefined; engineSession = undefined;
    nativeOwnershipUnknown = true;
    native.failClosed('Native ownership recovery failed. ' + nativeRecoveryError);
  });
});
