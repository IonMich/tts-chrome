import { READER_CHANNEL, idleSnapshot, validateRequest, isCurrentSnapshot, type ReaderSnapshot, type ReaderRequest } from '@/lib/readerProtocol';
import { extractReadableText } from '@/lib/pageText';
import { NativeMessagingBridge } from '@/lib/nativeMessaging';
export default defineBackground(() => {
  let snapshot = idleSnapshot();
  let ownerTab: number | undefined;
  let pagePlayerAvailable: boolean | undefined;
  let lifecycle = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = lifecycle.then(fn, fn);
    lifecycle = result.then(() => {}, () => {});
    return result;
  };
  const native = new NativeMessagingBridge(message => {
    void chrome.runtime.sendMessage({ channel: READER_CHANNEL, target: 'engine', action: 'native-message', message }).catch(() => {});
  });
  async function publish(next: ReaderSnapshot) {
    snapshot = { ...next, pagePlayerAvailable };
    await chrome.storage.session.set({ readerSnapshot: snapshot, readerOwnerTab: ownerTab ?? null });
    const message = { channel: READER_CHANNEL, action: 'state', snapshot };
    void chrome.runtime.sendMessage(message).catch(() => {});
    if (ownerTab !== undefined) void chrome.tabs.sendMessage(ownerTab, message).catch(() => {});
  }
  const engine = (action: string, payload: object = {}) => chrome.runtime.sendMessage({ channel: READER_CHANNEL, target: 'engine', action, ...payload });
  async function ensureDocument() {
    if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run the explicitly requested local speech model in a dedicated disposable worker, with a DOM audio controller.',
    });
  }
  async function stop() {
    pagePlayerAvailable = undefined;
    try {
      await publish(idleSnapshot());
      if (await chrome.offscreen.hasDocument()) {
        await engine('stop').catch(() => {});
        const final = await engine('diagnostics').catch(() => undefined);
        if (final?.diagnostics) await chrome.storage.session.set({ readerLastDiagnostics: final.diagnostics });
        await chrome.offscreen.closeDocument();
      }
    } finally {
      native.close();
    }
  }
  async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id; }
  async function showPlayer(tabId: number, focus = true) {
    try {
      let shown = await chrome.tabs.sendMessage(tabId, { type: 'reader:show', focus }).catch(() => undefined);
      if (!shown?.shown) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/main.js'] });
        shown = await chrome.tabs.sendMessage(tabId, { type: 'reader:show', focus });
      }
      return shown?.shown === true;
    } catch { return false; /* Chrome-owned pages/PDF viewer cannot be injected. */ }
  }
  async function start(input: ReaderRequest | (() => Promise<ReaderRequest>), tabId?: number, requestedAt = Date.now()) {
    await stop();
    try {
      ownerTab = tabId ?? await activeTab();
      const sessionId = crypto.randomUUID();
      await publish({ ...idleSnapshot(), phase: 'preparing', sessionId, message: 'Preparing your reading…' });
      // Mount before extraction/validation, so failures also have a visible home.
      pagePlayerAvailable = ownerTab !== undefined && await showPlayer(ownerTab, false);
      const request = validateRequest(typeof input === 'function' ? await input() : input);
      await publish({ ...snapshot, voice: request.voice, speed: request.speed, message: 'Preparing the installed voice…' });
      await ensureDocument();
      const result = await engine('start', { request, sessionId, requestedAt });
      if (result?.error) throw new Error(result.error);
      if (pagePlayerAvailable && ownerTab !== undefined) pagePlayerAvailable = await showPlayer(ownerTab);
      await publish(snapshot);
      return { playerShown: pagePlayerAvailable === true };
    } catch (error) {
      native.close();
      if (await chrome.offscreen.hasDocument().catch(() => false)) await chrome.offscreen.closeDocument().catch(() => {});
      throw error;
    }
  }
  async function readPage(selectionOnly: boolean, tabId?: number, requestedAt = Date.now()) {
    const id = tabId ?? await activeTab();
    if (id === undefined) throw new Error('Open a page to read, or paste text in the reader.');
    return start(async () => {
      const results = await chrome.scripting.executeScript({ target: { tabId: id }, args: [selectionOnly], func: extractReadableText });
      const settings = await chrome.storage.sync.get(['voice', 'voiceName', 'speed']);
      return { text: results[0]?.result ?? '', voice: settings.voice, voiceName: settings.voiceName, speed: settings.speed };
    }, id, requestedAt);
  }
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'readText', title: 'Read aloud', contexts: ['selection'] }));
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'readText' && info.selectionText) void serial(async () => {
      const settings = await chrome.storage.sync.get(['voice', 'voiceName', 'speed']);
      await start({ text: info.selectionText!, voice: settings.voice, voiceName: settings.voiceName, speed: settings.speed }, tab?.id);
    }).catch(reportError);
  });
  chrome.commands.onCommand.addListener(command => {
    if (command === 'trigger_tts' || command === 'trigger_page_tts') void serial(() => readPage(command === 'trigger_tts')).catch(reportError);
  });
  async function reportError(error: unknown) {
    try { native.stopActive(); } catch {}
    try {
      await publish({ ...snapshot, phase: 'error', modelResident: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      native.close();
      if (await chrome.offscreen.hasDocument().catch(() => false)) await chrome.offscreen.closeDocument().catch(() => {});
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.channel !== READER_CHANNEL || message.target !== 'background' || sender.id !== chrome.runtime.id) return;
    if (message.action === 'native-list') {
      void native.listVoices().then(respond);
      return true;
    }
    if (message.action === 'native-speak' || message.action === 'native-stop') {
      if (sender.url !== chrome.runtime.getURL('offscreen.html')) {
        respond({ error: 'The Mac voice request was rejected.' });
        return;
      }
      try {
        if (message.action === 'native-speak') native.speak(message.id, message.text);
        else native.stop(message.id);
        respond({ ok: true });
      } catch (error) {
        respond({ error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (message.action === 'engine-state') {
      if (sender.url !== chrome.runtime.getURL('offscreen.html')) return;
      if (message.diagnostics && ['complete','error'].includes(message.snapshot?.phase)) void chrome.storage.session.set({ readerLastDiagnostics: message.diagnostics });
      if (message.snapshot?.sessionId === snapshot.sessionId && snapshot.phase !== 'idle' && isCurrentSnapshot(snapshot, message.snapshot)) {
        void publish(message.snapshot);
        if (message.snapshot.phase === 'error' || (message.snapshot.phase === 'complete' && !message.snapshot.replayExpiresAt && message.snapshot.speechMode !== 'system')) void serial(async () => {
          if (snapshot.sessionId === message.snapshot.sessionId && ['complete', 'error'].includes(snapshot.phase) && await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
        });
      }
      return;
    }
    if (message.action === 'get') { void lifecycle.then(() => respond({ snapshot })); return true; }
    void serial(async () => {
      if (['pause', 'resume', 'seek', 'speed'].includes(message.action) && message.sessionId && message.sessionId !== snapshot.sessionId) {
        respond({ error: 'This reading session ended.' });
        return;
      }
      let result: { playerShown: boolean } | undefined;
      if (message.action === 'start') result = await start(message.request, sender.tab?.id, message.requestedAt);
      else if (message.action === 'read-page') result = await readPage(!!message.selectionOnly, sender.tab?.id, message.requestedAt);
      else if (message.action === 'show-player') {
        if (snapshot.phase === 'idle' || ownerTab === undefined) throw new Error('Start a reading to open its player.');
        const tab = await chrome.tabs.update(ownerTab, { active: true });
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        pagePlayerAvailable = await showPlayer(ownerTab);
        await publish(snapshot);
        result = { playerShown: pagePlayerAvailable };
      }
      else if (message.action === 'stop') await stop();
      else if (['pause','resume','seek','speed'].includes(message.action)) {
        if (await chrome.offscreen.hasDocument()) {
          const result = await engine(message.action, {seconds:message.seconds,speed:message.speed});
          if(result?.error)throw Error(result.error);
          if (result?.snapshot?.sessionId === snapshot.sessionId && isCurrentSnapshot(snapshot, result.snapshot)) await publish(result.snapshot);
        }
        else throw new Error('The reader session ended. Press Play to start again.');
      } else throw new Error('Unknown reader command.');
      respond({ ok: true, snapshot, ...result });
    }).catch(async error => { await reportError(error); respond({ error: error instanceof Error ? error.message : String(error) }); });
    return true;
  });
  chrome.tabs.onRemoved.addListener(id => { void serial(async () => { if (id === ownerTab) await stop(); }); });
  chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === 'loading') void serial(async () => { if (id === ownerTab) await stop(); }); });
  lifecycle = (async () => {
    const saved = await chrome.storage.session.get(['readerOwnerTab', 'readerSnapshot']);
    ownerTab = typeof saved.readerOwnerTab === 'number' ? saved.readerOwnerTab : undefined;
    pagePlayerAvailable = saved.readerSnapshot?.pagePlayerAvailable;
    const exists = await chrome.offscreen.hasDocument();
    if (exists) { const current = await engine('get'); if (current?.snapshot) snapshot = { ...current.snapshot, pagePlayerAvailable }; }
    else { ownerTab = undefined; pagePlayerAvailable = undefined; await publish(idleSnapshot()); }
  })().catch(() => { snapshot = idleSnapshot(); ownerTab = undefined; });
});
