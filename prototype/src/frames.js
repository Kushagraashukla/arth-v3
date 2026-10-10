// Runs in the PAGE's own JavaScript world at document_start, and does nothing
// unless this tab is the Ask AI worker/workspace tab.
//
// Why: signed-in ChatGPT renders an answer from requestAnimationFrame callbacks,
// and Chrome never runs those in a hidden tab. Measured in the hidden worker tab:
// 0 callbacks in 2 s, generation finished, answer element empty, forever. So
// while this tab is hidden, frame callbacks are run by this file instead.

(() => {
  // Two ways to know this is the worker tab, both readable before any page
  // script runs: the hash the service worker opens the tab with (first page
  // load), and window.name, which worker.js sets on the first PING and which
  // belongs to the tab, not the page, so it survives every later reload.
  if (window.name !== 'ask-ai-worker-tab' && location.hash !== '#arth-worker') return;

  const FRAME_MS = 8; // while a job runs: at most ~120 frames a second
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const channel = new MessageChannel();
  let waiting = new Map(); // id -> callback, for the next frame
  let scheduled = false;
  let lastFrame = 0;
  let nextId = 0;

  // Chrome throttles timers in a hidden tab to about one a second, which made
  // an answer take 11-13 s. A MessageChannel is not throttled, but it is also
  // not paced, so it is used only while worker.js says a job is running.
  // shortcut: one busy CPU core for the few seconds of a job; pace from a Worker's timer if that ever matters.
  const busy = () => document.documentElement?.hasAttribute('data-arth-busy');
  const schedule = () => (busy() ? channel.port2.postMessage(0) : setTimeout(frame, 16));
  function frame() {
    const now = performance.now();
    if (now - lastFrame < FRAME_MS) return schedule(); // too soon: come back
    lastFrame = now;
    scheduled = false;
    const callbacks = waiting;
    waiting = new Map();
    for (const callback of callbacks.values()) {
      try {
        callback(now);
      } catch (e) {
        setTimeout(() => {
          throw e; // report it like a native frame callback would, and run the rest
        });
      }
    }
  }
  channel.port1.onmessage = frame;

  // Our ids are negative so cancel can tell them from native ones.
  window.requestAnimationFrame = (callback) => {
    if (document.visibilityState !== 'hidden') return nativeRequest(callback);
    const id = -++nextId;
    waiting.set(id, callback);
    if (!scheduled) {
      scheduled = true;
      schedule();
    }
    return id;
  };
  window.cancelAnimationFrame = (id) => (id < 0 ? waiting.delete(id) : nativeCancel(id));
})();
