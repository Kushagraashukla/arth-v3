// Reader UI: an "Ask AI" action next to a valid text selection, and a small
// card that shows the answer. Selections are never stored: every show, move and
// click re-reads the live selection, so a stale Range can never be acted on.

(() => {
  const SETTLE_MS = 150; // let a drag or double-click finish before reacting
  const GAP_PX = 6;
  // Shown to the user as-is: no internal codes or component names.
  const ERROR_TEXT = {
    SETUP_NEEDED: 'Arth needs a one-time setup before it can explain text.',
    INVALID_KEY: 'OpenAI did not accept the saved API key.',
    NO_CREDIT: 'Your OpenAI account has no credit left for API requests.',
    MODEL_UNAVAILABLE: 'The selected model is not available to your OpenAI account.',
    NOT_ALLOWED: 'OpenAI refused the request for your account.',
    RATE_LIMITED: 'OpenAI is limiting requests right now. Try again in a moment.',
    TIMEOUT: 'OpenAI took too long to answer.',
    NETWORK: 'Could not reach OpenAI. Check your connection.',
    PROVIDER_DOWN: 'OpenAI is having problems right now.',
    PROVIDER_REFUSED: 'OpenAI could not process this request.',
    EMPTY_ANSWER: 'OpenAI returned an empty answer.',
    CONNECTION: 'The request was interrupted.',
    RELOAD_PAGE: 'Arth was updated. Reload this page to keep using it.',
  };
  const DEFAULT_ERROR = 'Could not get an answer.';
  // What the button under an error does: open Arth's settings, nothing, or (default) retry.
  const ERROR_ACTION = { SETUP_NEEDED: 'setup', INVALID_KEY: 'setup', NO_CREDIT: 'setup', MODEL_UNAVAILABLE: 'setup', NOT_ALLOWED: 'setup', RELOAD_PAGE: 'none' };
  const ACTION_LABEL = { retry: 'Retry', setup: 'Open Arth settings' };

  const host = document.createElement('div');
  host.setAttribute('data-ask-ai', '');
  host.popover = 'manual'; // top layer: no z-index fights with ChatGPT's own UI
  const shadow = host.attachShadow({ mode: 'open' });
  // Constructable stylesheet: not subject to the page's CSP, unlike a <style> tag.
  const sheet = new CSSStyleSheet();
  // Colours follow the page's own colour scheme (inherited from <html>) through
  // light-dark(), so the UI is a light surface on light ChatGPT and a raised
  // dark one on dark ChatGPT without any theme detection in script.
  sheet.replaceSync(`
    /* width: a popover is shrink-to-fit by default, which squeezed the card into
       a narrow column near the right edge instead of letting place() move it. */
    :host { inset: auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; width: max-content; }
    button, .card {
      all: initial; color-scheme: inherit; box-sizing: border-box;
      font: 500 13px/1 system-ui, sans-serif; border-radius: 8px;
      color: light-dark(#1f1f1f, #ececec); background: light-dark(#fff, #2b2b2b);
      border: 1px solid light-dark(rgba(0, 0, 0, 0.14), rgba(255, 255, 255, 0.16));
      box-shadow: 0 4px 14px light-dark(rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0.5));
    }
    button { display: inline-block; cursor: pointer; white-space: nowrap; padding: 7px 11px; }
    button:hover { background: light-dark(#f3f3f3, #383838); }
    button:active { background: light-dark(#e7e7e7, #444); }
    button:focus-visible { outline: 2px solid light-dark(#0b57d0, #8ab4f8); outline-offset: 2px; }
    .card {
      display: block; width: max-content; max-width: min(340px, calc(100vw - 12px)); max-height: 240px;
      overflow: hidden auto; padding: 10px 12px; font-weight: 400; font-size: 14px; line-height: 1.5;
      white-space: pre-wrap; overflow-wrap: anywhere; user-select: none;
    }
    .card[data-state="loading"] { color: light-dark(#5d5d5d, #b4b4b4); animation: thinking 1.4s ease-in-out infinite; }
    .card[data-state="error"] { border-left: 3px solid light-dark(#b3261e, #f2b8b5); }
    .card button { display: block; margin-top: 8px; box-shadow: none; background: light-dark(#f3f3f3, #383838); }
    .card button:hover { background: light-dark(#e7e7e7, #444); }
    @keyframes thinking { 50% { opacity: 0.55; } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none !important; } }
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
  const askButton = make('button', 'Arth');
  askButton.title = 'Explain the selected text in context';
  const card = make('div', '', 'card');
  card.setAttribute('role', 'status'); // announces loading and the answer
  const cardText = make('div', '');
  const retryButton = make('button', 'Retry');
  card.append(cardText, retryButton);
  shadow.append(askButton, card);
  document.documentElement.append(host);

  let pressed = false; // a pointer is down somewhere outside our UI
  let settleTimer;
  let frame;
  // What the card shows: null (only the Ask AI button), or the selection it
  // belongs to plus the id of the request still in flight (null once settled).
  let shown = null;

  // view: 'button' | 'loading' | 'answer' | 'error'
  function show(view, text = '', action = 'retry') {
    askButton.hidden = view !== 'button';
    card.hidden = view === 'button';
    card.dataset.state = view;
    cardText.textContent = text; // never innerHTML: the answer is untrusted text
    retryButton.hidden = view !== 'error' || action === 'none';
    retryButton.dataset.action = action;
    retryButton.textContent = ACTION_LABEL[action] || '';
  }
  show('button');

  const isOpen = () => host.matches(':popover-open');
  const conceal = () => {
    if (isOpen()) host.hidePopover();
  };
  // Back to a bare button. A request still in flight is cancelled in the
  // service worker, and its reply will be ignored.
  function reset() {
    if (shown?.requestId) {
      try {
        chrome.runtime.sendMessage({ type: 'CANCEL', requestId: shown.requestId }).catch(() => {});
      } catch {
        // Extension reloaded under this page: sendMessage throws synchronously.
      }
    }
    shown = null;
    show('button');
  }
  const dismiss = () => {
    reset();
    conceal();
  };

  // Below the selection, left-aligned. If it does not fit there, it goes on
  // whichever side has more room and the card shrinks (and scrolls) to fit, so
  // it never covers the selected text. Horizontally it is kept on screen.
  function place(range) {
    const rect = range.getBoundingClientRect();
    const offScreen = rect.bottom < 0 || rect.top > innerHeight;
    if ((!rect.width && !rect.height) || offScreen) return conceal(); // scrolled away, not dismissed
    if (!isOpen()) host.showPopover();
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

  // The single source of truth for "should our UI be visible".
  function update() {
    const ctx = extractSelectionContext();
    if (ctx.error) return dismiss();
    if (shown && shown.selectedText !== ctx.selectedText) reset(); // the card was for another selection
    place(ctx.selectionRange);
  }
  const settle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(update, SETTLE_MS);
  };

  async function ask() {
    const ctx = extractSelectionContext();
    if (ctx.error) return dismiss();
    const { selectionRange, ...context } = ctx; // the live Range is not serialisable
    reset();
    const requestId = crypto.randomUUID();
    shown = { requestId, selectedText: context.selectedText };
    show('loading', 'Thinking…');
    place(selectionRange);

    let res = null;
    try {
      res = await chrome.runtime.sendMessage({ type: 'ASK', requestId, prompt: buildPrompt(context) });
    } catch {
      // Service worker restarted mid-request, or the extension was reloaded and
      // this content script is orphaned (then chrome.runtime.id is gone).
      res = { code: chrome.runtime?.id ? 'CONNECTION' : 'RELOAD_PAGE' };
    }
    // Superseded, cancelled, dismissed or navigated away while waiting: drop the reply.
    if (shown?.requestId !== requestId) return;
    shown.requestId = null;
    if (res?.ok) show('answer', res.answer);
    else show('error', ERROR_TEXT[res?.code] || DEFAULT_ERROR, ERROR_ACTION[res?.code] || 'retry');
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed) place(sel.getRangeAt(0)); // the card changed size
  }

  // Keyboard selection, programmatic changes, and the collapse that happens when
  // ChatGPT re-renders or navigates (removed nodes collapse the selection).
  document.addEventListener('selectionchange', () => {
    if (!pressed) settle();
  });
  // Mouse selection: stay hidden while the button is down, decide on release.
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

  // SPA navigation: ChatGPT keeps the old conversation on screen (and the browser
  // keeps the old selection) for a second or more after the URL has changed.
  // Drop the selection the moment a navigation starts, so the action cannot be
  // used against the wrong URL and only a new selection can bring it back.
  // Later DOM replacement also collapses the selection; this just closes the gap.
  window.navigation?.addEventListener('navigate', (e) => {
    if (e.hashChange || e.destination.url === location.href) return;
    getSelection().removeAllRanges();
    clearTimeout(settleTimer);
    dismiss();
  });

  // ChatGPT scrolls an inner container, so listen in the capture phase.
  const follow = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!isOpen()) return settle();
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) dismiss();
      else place(sel.getRangeAt(0));
    });
  };
  document.addEventListener('scroll', follow, { capture: true, passive: true });
  window.addEventListener('resize', follow);

  shadow.addEventListener('mousedown', (e) => e.preventDefault()); // keep the page selection
  // Only a real user click counts, never one dispatched by a page script.
  askButton.addEventListener('click', (e) => {
    if (e.isTrusted) ask();
  });
  retryButton.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    if (retryButton.dataset.action !== 'setup') return ask();
    dismiss();
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_SETUP' }).catch(() => {});
    } catch {
      // Extension reloaded under this page.
    }
  });
})();
