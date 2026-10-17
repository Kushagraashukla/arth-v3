// Stands in for the extension APIs so v3's content scripts and saved-words page
// can run on a plain test page. Injected by run-prototype.mjs before any page
// script. Storage is kept in sessionStorage, so it survives a reload of the tab
// the way chrome.storage.local survives a browser restart.
(() => {
  const KEY = 'fake-chrome-storage';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  const data = JSON.parse(sessionStorage.getItem(KEY) || '{}');
  const persist = () => sessionStorage.setItem(KEY, JSON.stringify(data));
  const storageListeners = [];
  const messageListeners = [];
  const cancelled = new Set();

  function notify(changes) {
    if (Object.keys(changes).length) setTimeout(() => storageListeners.forEach((f) => f(changes, 'local')));
  }
  const local = {
    async get(keys) {
      const list = keys == null ? Object.keys(data) : [].concat(keys);
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, clone(data[k])]));
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      persist();
      notify(changes);
    },
  };

  // A fixed answer per kind of question, so tests can select words in it.
  const termOf = (prompt) => /Selected text:\n"""\n([^\n]*)\n"""/.exec(prompt)?.[1] || 'this page';
  const fake = {
    asks: [], // every ASK message, in order
    sent: [], // every other message
    delay: 150, // ms before the final answer (long enough to see the streaming state)
    answer(prompt) {
      const term = termOf(prompt);
      if (prompt.includes('that was written for them')) return `"${term}" here means something small and specific.`;
      if (prompt.includes("The reader's question")) return `About ${term}: yes, that is how it works.`;
      return `Arth explains ${term}: the function keeps its variables alive between calls.`;
    },
    async reset() {
      for (const k of Object.keys(data)) delete data[k];
      persist();
    },
    data,
  };

  const chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: (f) => messageListeners.push(f) },
      async sendMessage(msg) {
        if (msg?.type === 'CANCEL') {
          cancelled.add(msg.requestId);
          return { ok: true };
        }
        if (msg?.type !== 'ASK') {
          fake.sent.push(msg);
          return { ok: true };
        }
        fake.asks.push(msg);
        const answer = fake.answer(msg.prompt);
        await sleep(20);
        const sender = { id: 'test-extension' }; // like the service worker: no tab
        messageListeners.forEach((f) => f({ type: 'PARTIAL', requestId: msg.requestId, text: answer.slice(0, 12) }, sender));
        await sleep(fake.delay);
        return cancelled.has(msg.requestId) ? { ok: false, code: 'CANCELLED' } : { ok: true, answer };
      },
    },
    storage: { local, onChanged: { addListener: (f) => storageListeners.push(f) } },
  };
  Object.defineProperty(window, 'chrome', { value: chrome, configurable: true, writable: true });
  window.__fake = fake;
})();
