// Reader UI, on any web page: next to a text selection it offers "Arth" (explain
// this in context) and "Ask" (type your own question about it). The toolbar icon
// opens the same question box with nothing selected. Answers appear in a small card.
//
// Until the user clicks, nothing is stored: the bar follows the live selection.
// Once they click, the context is captured ("pinned") so that typing in the
// question box, which moves the browser's selection, cannot lose it.

(() => {
  if (!(document.documentElement instanceof HTMLElement)) return; // XML, SVG documents

  const SETTLE_MS = 150; // let a drag or double-click finish before reacting
  const GAP_PX = 6;
  // Shown to the user as-is: no internal codes or component names.
  const ERROR_TEXT = {
    NEEDS_LOGIN: 'Sign in to ChatGPT in the background tab Arth opened, then try again.',
    CHALLENGE: 'ChatGPT wants a quick check in the background tab Arth opened. Complete it there, then try again.',
    TIMEOUT: 'ChatGPT took too long to answer.',
    CHATGPT_ERROR: 'ChatGPT could not answer just now.',
    NOT_READY: 'ChatGPT did not load in time.',
    WORKER_TAB: 'Arth uses this tab to get its answers. Use Arth from another tab.',
    WORKER_CLOSED: 'The background ChatGPT tab was closed. Try again to reopen it.',
    CONNECTION: 'The request was interrupted.',
    RELOAD_PAGE: 'Arth was updated. Reload this page to keep using it.',
  };
  const DEFAULT_ERROR = 'Could not get an answer.';
  const NO_RETRY = new Set(['WORKER_TAB', 'RELOAD_PAGE']); // trying again here cannot help

  const host = document.createElement('div');
  host.setAttribute('data-ask-ai', '');
  host.popover = 'manual'; // top layer: no z-index fights with the page's own UI
  const shadow = host.attachShadow({ mode: 'open' });
  // Constructable stylesheet: not subject to the page's CSP, unlike a <style> tag.
  // Colours follow the page's own colour scheme through light-dark().
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { inset: auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; width: max-content; }
    button, .card, input {
      all: initial; color-scheme: inherit; box-sizing: border-box;
      font: 500 13px/1 system-ui, sans-serif; border-radius: 8px;
      color: light-dark(#1f1f1f, #ececec); background: light-dark(#fff, #2b2b2b);
      border: 1px solid light-dark(rgba(0, 0, 0, 0.14), rgba(255, 255, 255, 0.16));
    }
    button, .card { box-shadow: 0 4px 14px light-dark(rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.5)); }
    button { display: inline-block; cursor: pointer; white-space: nowrap; padding: 7px 11px; }
    button:hover { background: light-dark(#f3f3f3, #383838); }
    button:active { background: light-dark(#e7e7e7, #444); }
    button:focus-visible, input:focus-visible { outline: 2px solid light-dark(#0b57d0, #8ab4f8); outline-offset: 2px; }
    .bar { display: flex; gap: 4px; }
    .card {
      display: block; width: min(340px, calc(100vw - 12px)); max-height: 280px; overflow: hidden auto;
      padding: 10px 12px; font-weight: 400; font-size: 14px; line-height: 1.5;
    }
    .card[data-state="loading"] { width: max-content; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .card[data-state="loading"] .text { color: light-dark(#5d5d5d, #b4b4b4); animation: thinking 1.4s ease-in-out infinite; }
    .card[data-state="error"] { border-left: 3px solid light-dark(#b3261e, #f2b8b5); }
    .question { font-size: 12px; line-height: 1.4; color: light-dark(#5d5d5d, #b4b4b4); margin-bottom: 6px; overflow-wrap: anywhere; }
    .card button { box-shadow: none; background: light-dark(#f3f3f3, #383838); }
    .card button:hover { background: light-dark(#e7e7e7, #444); }
    .retry { display: block; margin-top: 8px; }
    form { display: flex; gap: 6px; margin: 0; }
    .text:not([hidden]) ~ form, .retry:not([hidden]) ~ form { margin-top: 10px; }
    input { display: block; flex: 1; min-width: 0; padding: 7px 9px; font-weight: 400; cursor: text; }
    input::placeholder { color: light-dark(#767676, #9a9a9a); }
    @keyframes thinking { 50% { opacity: 0.55; } }
    @media (prefers-reduced-motion: reduce) { .text { animation: none !important; } }
    [hidden] { display: none !important; }
  `);
  shadow.adoptedStyleSheets = [sheet];

  const make = (tag, text, className) => {
    const el = document.createElement(tag);
    if (tag === 'button') el.type = 'button';
    if (className) el.className = className;
    el.textContent = text;
    return el;
  };
  const bar = make('div', '', 'bar');
  const explainButton = make('button', 'Arth');
  explainButton.title = 'Explain the selected text in context';
  const askButton = make('button', 'Ask');
  askButton.title = 'Ask your own question about the selected text';
  bar.append(explainButton, askButton);

  const card = make('div', '', 'card');
  const questionLine = make('div', '', 'question');
  const cardText = make('div', '', 'text');
  cardText.setAttribute('role', 'status'); // announces loading and the answer
  const retryButton = make('button', 'Retry', 'retry');
  const form = make('form', '');
  const input = make('input', '');
  input.type = 'text';
  input.maxLength = 500;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Your question');
  const sendButton = make('button', 'Ask');
  sendButton.type = 'submit';
  form.append(input, sendButton);
  card.append(questionLine, cardText, retryButton, form);
  shadow.append(bar, card);
  document.documentElement.append(host);

  let pressed = false; // a pointer is down somewhere outside our UI
  let settleTimer;
  let frame;
  let isWorkerTab = false;
  // null while only the bar is showing. After a click:
  //   context   what was captured at that moment (serialisable)
  //   range     a copy of the selection's Range for positioning, or null (no selection)
  //   requestId the request still in flight, or null
  //   question  the question last asked, or null for "explain"
  let pinned = null;

  // view: 'bar' | 'ask' | 'loading' | 'streaming' (answer still being written) | 'answer' | 'error'
  function show(view, text = '', retryable = true) {
    bar.hidden = view !== 'bar';
    card.hidden = view === 'bar';
    card.dataset.state = view;
    cardText.textContent = text; // never innerHTML: the answer is untrusted text
    cardText.hidden = view === 'ask';
    questionLine.textContent = pinned?.question || '';
    questionLine.hidden = view === 'ask' || !pinned?.question;
    retryButton.hidden = view !== 'error' || !retryable;
    form.hidden = view === 'loading' || view === 'streaming';
    input.placeholder = pinned?.context?.selectedText ? 'Ask about the selected text…' : 'Ask a question about this page…';
  }
  show('bar');

  const isOpen = () => host.matches(':popover-open');
  const conceal = () => {
    if (isOpen()) host.hidePopover();
  };
  const open = () => {
    if (!isOpen()) host.showPopover();
  };
  function cancelInFlight() {
    if (!pinned?.requestId) return;
    try {
      chrome.runtime.sendMessage({ type: 'CANCEL', requestId: pinned.requestId }).catch(() => {});
    } catch {
      // Extension reloaded under this page: sendMessage throws synchronously.
    }
    pinned.requestId = null;
  }
  // Back to nothing showing. A request still in flight is cancelled and its reply ignored.
  function dismiss() {
    cancelInFlight();
    pinned = null;
    input.value = '';
    show('bar');
    conceal();
  }

  // Below the selection, left-aligned. If it does not fit there, it goes on
  // whichever side has more room and the card shrinks (and scrolls) to fit, so
  // it never covers the selected text. Horizontally it is kept on screen.
  function place(range) {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return open(); // its text was re-rendered: stay where we are
    if (rect.bottom < 0 || rect.top > innerHeight) return conceal(); // scrolled away, not dismissed
    open();
    card.style.maxHeight = ''; // back to the stylesheet's limit before measuring
    let h = host.offsetHeight;
    const roomBelow = innerHeight - rect.bottom - 2 * GAP_PX;
    const roomAbove = rect.top - 2 * GAP_PX;
    const below = h <= roomBelow || roomBelow >= roomAbove;
    const room = below ? roomBelow : roomAbove;
    if (h > room) {
      card.style.maxHeight = `${Math.max(room, 48)}px`;
      h = host.offsetHeight;
    }
    const left = Math.max(GAP_PX, Math.min(rect.left, innerWidth - host.offsetWidth - GAP_PX));
    host.style.left = `${left}px`;
    host.style.top = `${below ? rect.bottom + GAP_PX : rect.top - GAP_PX - h}px`;
  }
  // With nothing selected the card sits in the top-right corner of the page.
  function placePinned() {
    if (pinned.range) return place(pinned.range);
    open();
    card.style.maxHeight = '';
    host.style.left = `${Math.max(GAP_PX, innerWidth - host.offsetWidth - 16)}px`;
    host.style.top = '16px';
  }

  function pin(ctx) {
    const { selectionRange, ...context } = ctx; // the live Range is not serialisable
    pinned = { context, range: selectionRange ? selectionRange.cloneRange() : null, requestId: null, question: null };
  }

  // question: the reader's own question, or null to explain the selection.
  async function ask(question) {
    if (isWorkerTab) return;
    if (!pinned) {
      const ctx = extractSelectionContext();
      if (ctx.error) return dismiss();
      pin(ctx);
    }
    cancelInFlight();
    const requestId = crypto.randomUUID();
    pinned.requestId = requestId;
    pinned.question = question || null;
    show('loading', 'Thinking…');
    placePinned();

    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: 'ASK', requestId, prompt: buildPrompt(pinned.context, question) });
    } catch {
      // Service worker restarted mid-request, or the extension was reloaded and
      // this content script is orphaned (then chrome.runtime.id is gone).
      res = { code: chrome.runtime?.id ? 'CONNECTION' : 'RELOAD_PAGE' };
    }
    // Superseded, cancelled, dismissed or navigated away while waiting: drop the reply.
    if (pinned?.requestId !== requestId) return;
    pinned.requestId = null;
    if (res?.ok) show('answer', res.answer);
    else show('error', ERROR_TEXT[res?.code] || DEFAULT_ERROR, !NO_RETRY.has(res?.code));
    placePinned(); // the card changed size
  }

  // Opens the question box: about the current selection if there is a usable
  // one, otherwise about the page.
  function openQuestionBox() {
    if (isWorkerTab) return;
    cancelInFlight();
    const ctx = extractSelectionContext();
    pin(ctx.error ? extractPageContext() : ctx);
    show('ask');
    placePinned();
    input.focus();
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return; // only our own service worker
    if (msg?.type === 'OPEN_ASK') return void openQuestionBox(); // the toolbar icon was clicked
    if (msg?.type === 'PARTIAL') {
      // The answer so far, for the request this card is waiting on.
      if (!pinned?.requestId || pinned.requestId !== msg.requestId || typeof msg.text !== 'string') return;
      show('streaming', msg.text);
      return void placePinned();
    }
    // The service worker sends these only to its worker tab, and always PINGs
    // before giving it a job. A tab that receives one is not a reading tab.
    if (!['PING', 'RUN', 'RESET', 'CANCEL'].includes(msg?.type)) return;
    isWorkerTab = true;
    dismiss();
  });

  // Follows the live selection while nothing is pinned.
  function update() {
    if (pinned) return;
    const ctx = isWorkerTab ? { error: 'WORKER_TAB' } : extractSelectionContext();
    if (ctx.error) return conceal();
    show('bar');
    place(ctx.selectionRange);
  }
  const settle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(update, SETTLE_MS);
  };

  // Keyboard selection, programmatic changes, and the collapse that happens when
  // a page re-renders or navigates (removed nodes collapse the selection).
  document.addEventListener('selectionchange', () => {
    if (!pressed) settle();
  });
  // Mouse: a press anywhere outside our UI closes it; a new selection is judged on release.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target === host) return;
      pressed = true;
      clearTimeout(settleTimer);
      dismiss();
    },
    true
  );
  const released = () => {
    pressed = false;
    settle();
  };
  document.addEventListener('pointerup', released, true);
  document.addEventListener('pointercancel', released, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) dismiss();
  });
  // Typing in the question box must not trigger the page's own keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    host.addEventListener(type, (e) => {
      if (e.key === 'Escape') {
        if (type === 'keydown') dismiss();
        return;
      }
      e.stopPropagation();
    });
  }

  // In-page navigation to a different address: what is on screen is about to be
  // replaced, so drop the selection and anything we are showing. (Changes to
  // only the query or hash are ignored; many sites make those while you read.)
  window.navigation?.addEventListener('navigate', (e) => {
    if (e.hashChange || new URL(e.destination.url).pathname === location.pathname) return;
    getSelection().removeAllRanges();
    clearTimeout(settleTimer);
    dismiss();
  });

  // Pages often scroll an inner container, so listen in the capture phase.
  const follow = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (pinned) return placePinned();
      if (!isOpen()) return settle();
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) conceal();
      else place(sel.getRangeAt(0));
    });
  };
  document.addEventListener('scroll', follow, { capture: true, passive: true });
  window.addEventListener('resize', follow);

  // Pressing one of our buttons must not take the selection away from the page.
  shadow.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  // Only a real user action counts, never one dispatched by a page script.
  explainButton.addEventListener('click', (e) => {
    if (e.isTrusted) ask(null);
  });
  askButton.addEventListener('click', (e) => {
    if (e.isTrusted) openQuestionBox();
  });
  retryButton.addEventListener('click', (e) => {
    if (e.isTrusted && pinned) ask(pinned.question);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!e.isTrusted || !pinned || !question) return;
    input.value = '';
    ask(question);
  });
})();
