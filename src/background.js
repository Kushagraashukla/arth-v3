// Service worker: validates requests from the reader, runs them one at a time
// through the AI provider, and supports cancellation. It has no page knowledge
// and no provider knowledge beyond the three-member interface in provider-*.js.

importScripts('provider-openai.js');
const provider = openaiProvider; // the one place another provider would be plugged in

const MAX_PROMPT_CHARS = 8000;
const MAX_ANSWER_CHARS = 4000;
const MAX_ID_CHARS = 64;
const SETTINGS = ['consent', 'apiKey', 'model'];

let queue = Promise.resolve(); // serialises jobs: one request to the provider at a time
let current = null; // { key, controller } while a request is in flight
const pending = new Set(); // keys of jobs that are queued or running
const cancelled = new Set(); // pending keys cancelled before they started

const fail = (code) => ({ ok: false, code });

async function runJob(key, prompt) {
  if (cancelled.delete(key)) return fail('CANCELLED');
  const settings = await chrome.storage.local.get(SETTINGS);
  // Nothing is sent anywhere until the user has agreed to it and connected a provider.
  if (settings.consent !== true || !provider.isReady(settings)) return fail('SETUP_NEEDED');

  const controller = new AbortController();
  current = { key, controller };
  try {
    const answer = await provider.explain({ prompt, settings, signal: controller.signal });
    return { ok: true, answer: answer.slice(0, MAX_ANSWER_CHARS) };
  } catch (e) {
    return fail(typeof e?.code === 'string' ? e.code : 'INTERNAL');
  } finally {
    current = null;
  }
}

function cancelJob(key) {
  if (current?.key === key) current.controller.abort();
  else if (pending.has(key)) cancelled.add(key);
}

// Accept messages only from this extension's content script running in the top
// frame of a ChatGPT tab. Extension pages and other frames are refused.
function trustedSender(sender) {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab?.id != null &&
    sender.frameId === 0 &&
    (sender.url || '').startsWith('https://chatgpt.com/')
  );
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!trustedSender(sender)) return;
  if (msg?.type === 'OPEN_SETUP') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  const id = msg?.requestId;
  if (typeof id !== 'string' || !id || id.length > MAX_ID_CHARS) return;
  // Ids are chosen by the sender, so they are only meaningful per sending tab:
  // one tab can never cancel, collide with, or receive another tab's request.
  const key = `${sender.tab.id}:${id}`;
  if (msg.type === 'ASK') {
    const { prompt } = msg;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS || pending.has(key)) {
      sendResponse({ ...fail('BAD_REQUEST'), requestId: id });
      return;
    }
    pending.add(key);
    const result = queue.then(() => runJob(key, prompt)).catch(() => fail('INTERNAL'));
    queue = result;
    result.then((res) => {
      pending.delete(key);
      cancelled.delete(key);
      sendResponse({ ...res, requestId: id });
    });
    return true; // async response; also keeps the service worker alive for the job
  }
  if (msg.type === 'CANCEL') {
    cancelJob(key);
    sendResponse({ ok: true });
  }
});

// First install: show what Arth does, what it sends, and how to connect it.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
