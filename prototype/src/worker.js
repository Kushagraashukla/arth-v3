// Content script. Runs in every ChatGPT tab; a tab acts as the worker only
// because the service worker sends it RUN. No ChatGPT DOM knowledge here.

(() => {
  let job = null; // { requestId, controller }

  async function run({ requestId, prompt }) {
    if (job) return { ok: false, requestId, code: 'NOT_READY', message: 'worker busy' };
    const controller = new AbortController();
    job = { requestId, controller };
    document.documentElement.setAttribute('data-arth-busy', ''); // frames.js: full speed while a job runs
    try {
      const st = adapter.status();
      if (st.state !== 'READY') throw new AdapterError(st.state);
      const baseline = await adapter.submit(prompt);
      const answer = await adapter.waitForAnswer(controller.signal, baseline, (text) => {
        chrome.runtime.sendMessage({ type: 'PARTIAL', requestId, text }).catch(() => {});
      });
      return { ok: true, requestId, answer };
    } catch (e) {
      // Never leave a generation running after a cancel/timeout.
      if (controller.signal.aborted) adapter.stop();
      return {
        ok: false,
        requestId,
        code: e.code || 'ADAPTER_BROKEN:unexpected',
        message: e.message,
      };
    } finally {
      document.documentElement.removeAttribute('data-arth-busy');
      job = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only our own service worker (which has no sender.tab) may drive this tab.
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    // A prerendered copy of the page is not the page the user's tab is showing.
    if (document.prerendering) return;
    switch (msg?.type) {
      case 'PING':
        // Only the worker tab is ever PINGed. Mark the tab (window.name survives
        // reloads) so frames.js activates on this tab's next page load.
        window.name = 'ask-ai-worker-tab';
        // doc is unique per page load, so the service worker can tell a freshly
        // loaded document from the one it just asked to reset.
        sendResponse({ ...adapter.status(), doc: performance.timeOrigin });
        return;
      case 'RESET':
        sendResponse({ ok: true });
        adapter.reset();
        return;
      case 'CANCEL':
        if (job?.requestId === msg.requestId) job.controller.abort();
        sendResponse({ ok: true });
        return;
      case 'RUN':
        run(msg).then(sendResponse);
        return true; // async response
    }
  });
})();
