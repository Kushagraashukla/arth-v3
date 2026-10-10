// The ONLY file that knows ChatGPT's DOM. Everything else talks to `adapter`.
// Selectors are ordered fallbacks: first match wins. Entries marked (anon) were
// verified live on the logged-out UI and entries marked (legacy) or (logged-in)
// on a signed-in Free account, both on 2026-10-05. Entries marked (thread) are
// from a signed-in workspace account on 2026-10-07. They are three different apps.

class AdapterError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const adapter = (() => {
  // The same page as WORKER_URL in background.js, without its hash: with one, reset() would not reload.
  const START_URL = 'https://chatgpt.com/?temporary-chat=true';

  const SELECTORS = {
    composer: [
      'form textarea[name="prompt"]', // (anon)
      '#prompt-textarea', // (legacy) ProseMirror contenteditable
      'form [contenteditable="true"]',
    ],
    // One button toggles between send and stop; `stop` matches only while generating.
    send: [
      'form button[data-composer-submit]:not([data-stop-generating])', // (anon)
      'button[data-testid="send-button"]', // (legacy)
      'form button[type="submit"]',
    ],
    stop: [
      'form button[data-stop-generating]', // (anon)
      'button[data-testid="stop-button"]', // (legacy)
    ],
    // (thread): the attribute value ends in the role, e.g. "fallback-turn-0:1:assistant".
    message: [
      'li[data-message-role]', // (anon)
      '[data-message-author-role]', // (legacy)
      '[data-content-search-unit-key]', // (thread)
    ],
    assistant: [
      'li[data-message-role="assistant"]', // (anon)
      '[data-message-author-role="assistant"]', // (legacy)
      '[data-content-search-unit-key$=":assistant"]', // (thread)
    ],
    // Matched against / inside an assistant message element.
    streaming: [
      '[data-message-streaming]', // (anon)
      '[data-markdown-talvt-render-state="pending"]', // (logged-in)
    ],
    complete: [
      '[data-message-complete]', // (anon)
      '[data-markdown-talvt-render-state="ready"]', // (logged-in)
    ],
    answerText: ['[data-assistant-markdown]', '.markdown', '[data-markdown-text-style="assistant-message"]'], // (anon), (legacy), (thread)
    // (thread): generation state lives on a wrapper AROUND the message, not on it.
    turnState: ['[data-talvt-turn-state]'],
    // ChatGPT's own "Unable to connect / Retry" bubble, rendered as an assistant message.
    failed: ['[data-conversation-recovery-status="failed"]'], // (anon)
    loggedOut: [
      'form[data-logged-out]', // (anon)
      '[data-login-button]', // (anon)
      '[data-testid="login-button"]', // (legacy)
    ],
    // Reader side: where a user message's own text lives (skips "You said:" headings).
    userText: ['[data-user-message-copy]', '.whitespace-pre-wrap', '[data-markdown-text-tone="user-message"]'], // (anon), (logged-in), (thread)
    // Wrapper whose data-testid ends in the turn's absolute number. (logged-in)
    turn: ['[data-testid^="conversation-turn-"]'],
    challenge: ['iframe[src*="challenges.cloudflare.com"]', '#challenge-form'],
    // First-run "Temporary chat" explainer. While open it traps focus, so text
    // insertion into the composer silently fails. (logged-in)
    onboardingClose: ['[data-testid="modal-temporary-chat-onboarding"] [data-testid="close-button"]'],
  };

  const SUBMIT_ACK_MS = 8000;
  const QUIET_MS = 1500; // no explicit completion flag: require this much DOM silence
  const QUIET_FLAGGED_MS = 250; // completion flag present: just let the last render settle
  const PARTIAL_MS = 120; // how often the text so far is read: innerText forces a layout

  const q = (key, root = document) => {
    for (const sel of SELECTORS[key]) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };
  const all = (key) => {
    for (const sel of SELECTORS[key]) {
      const els = document.querySelectorAll(sel);
      if (els.length) return [...els];
    }
    return [];
  };
  const matches = (el, key) => SELECTORS[key].some((sel) => el.matches(sel));
  // 'complete' | 'streaming' | null (this UI does not say) for an assistant message.
  function flagOf(el) {
    const turn = el.closest(SELECTORS.turnState[0])?.getAttribute('data-talvt-turn-state');
    if (turn) return turn === 'complete' ? 'complete' : 'streaming';
    return matches(el, 'streaming') ? 'streaming' : matches(el, 'complete') ? 'complete' : null;
  }
  const need = (key) => {
    const el = q(key);
    if (!el) throw new AdapterError(`ADAPTER_BROKEN:${key}`);
    return el;
  };

  // Resolves with test()'s first truthy value, re-evaluated on every DOM mutation.
  function until(test, ms, brokenKey) {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => {
        observer.disconnect();
        clearTimeout(timer);
        fn(v);
      };
      const check = () => {
        const v = test();
        if (v) done(resolve, v);
      };
      const observer = new MutationObserver(check);
      const timer = setTimeout(
        () => done(reject, new AdapterError(`ADAPTER_BROKEN:${brokenKey}`)),
        ms
      );
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      check();
    });
  }

  function insertText(el, text) {
    if (el instanceof HTMLTextAreaElement) {
      // Framework-controlled textarea: assigning .value directly is swallowed, so
      // go through the native setter and announce it with an input event.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // contenteditable (logged-in ProseMirror composer). Fails silently while a
    // modal traps focus, which is why submit() closes the onboarding modal first.
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }

  const composerText = (el) => (el instanceof HTMLTextAreaElement ? el.value : el.innerText);

  // Only the answer body counts. Never fall back to the whole message element:
  // that would return headings and error bubbles as if they were the answer.
  function answerOf(messageEl) {
    const body = q('answerText', messageEl);
    return body ? (body.innerText || body.textContent || '').trim() : '';
  }

  function status() {
    const loggedIn = !q('loggedOut');
    let state = 'READY';
    if (q('challenge')) state = 'CHALLENGE';
    else if (!q('composer')) state = loggedIn ? 'NOT_READY' : 'NEEDS_LOGIN';
    return { state, loggedIn, messages: all('message').length, generating: !!q('stop') };
  }

  // Types and sends the prompt. Returns the assistant-message count from before
  // sending, which waitForAnswer() needs as its baseline.
  async function submit(text) {
    q('onboardingClose')?.click();
    const composer = need('composer');
    const baseline = all('assistant').length;
    const before = all('message').length;
    insertText(composer, text);
    if (!composerText(composer).trim()) throw new AdapterError('ADAPTER_BROKEN:insert');

    const send = await until(
      () => {
        const b = q('send');
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b;
      },
      SUBMIT_ACK_MS,
      'send'
    );
    send.click();

    // Proof the click was accepted: generation started or a new message appeared
    // (the prompt itself counts: (thread) has no stop button we know of).
    await until(
      () => q('stop') || all('message').length > before,
      SUBMIT_ACK_MS,
      'send-not-accepted'
    );
    return baseline;
  }

  // Resolves with the final answer text. Done means ALL of: a new assistant
  // message exists, nothing reports "generating", the message has text, and the
  // DOM has been quiet. The send/stop button flickers back to "send" before the
  // first token, so its state alone is not trusted.
  // onPartial, if given, is called with the text written so far as it grows.
  function waitForAnswer(signal, baseline, onPartial) {
    return new Promise((resolve, reject) => {
      let timer;
      let sent = '';
      let sentAt = 0;
      const finish = (fn, v) => {
        observer.disconnect();
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        fn(v);
      };
      const onAbort = () => finish(reject, new AdapterError('CANCELLED'));

      const last = () => {
        const msgs = all('assistant');
        return msgs.length > baseline ? msgs[msgs.length - 1] : null;
      };
      const check = () => {
        const el = last();
        if (!el || q('stop') || flagOf(el) === 'streaming') return;
        const failed = q('failed', el);
        if (failed) return finish(reject, new AdapterError('CHATGPT_ERROR', failed.innerText.trim()));
        const text = answerOf(el);
        if (text) finish(resolve, text);
      };
      const arm = () => {
        clearTimeout(timer);
        const el = last();
        if (el && onPartial && performance.now() - sentAt > PARTIAL_MS) {
          sentAt = performance.now();
          const text = answerOf(el);
          if (text && text !== sent) onPartial((sent = text));
        }
        timer = setTimeout(check, el && flagOf(el) === 'complete' ? QUIET_FLAGGED_MS : QUIET_MS);
      };

      const observer = new MutationObserver(arm);
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      arm();
    });
  }

  function stop() {
    q('stop')?.click();
  }

  // Isolation between jobs: a full navigation to the start URL gives an empty
  // transcript. The content script dies with the page; the caller re-PINGs.
  function reset() {
    location.replace(START_URL);
  }

  // ---- Reader side (used by context.js). Read-only; never touches the worker flow.

  const ROLE_ATTRS = ['data-message-role', 'data-message-author-role']; // (anon), (logged-in)

  // The message element containing `node`, or null.
  function messageAt(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return null;
    for (const sel of SELECTORS.message) {
      const m = el.closest(sel);
      if (m) return m;
    }
    return null;
  }

  // role: 'user' | 'assistant' | 'unknown'. body: element holding only the
  // message's text. turn: absolute position in the conversation, or null when
  // the UI does not expose one. ChatGPT unmounts off-screen turns, so a gap in
  // turn numbers is the only evidence that a neighbour exists but is not in the DOM.
  function messageInfo(el) {
    const raw = ROLE_ATTRS.map((a) => el.getAttribute(a)).find(Boolean) || el.getAttribute('data-content-search-unit-key')?.split(':').pop(); // (thread)
    const role = raw === 'user' || raw === 'assistant' ? raw : 'unknown';
    const body = q(role === 'user' ? 'userText' : 'answerText', el) || el;
    const n = parseInt(el.closest(SELECTORS.turn[0])?.getAttribute('data-testid').match(/\d+$/)?.[0], 10);
    return { role, body, turn: Number.isNaN(n) ? null : n };
  }

  // Messages currently mounted in the DOM, in document order. NOT the whole conversation.
  const messages = () => all('message');

  return { status, submit, waitForAnswer, stop, reset, messageAt, messageInfo, messages };
})();
