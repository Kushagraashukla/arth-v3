// Reader UI, on any web page: next to a text selection it offers "Arth" (explain
// this in context) and "Ask" (type your own question about it). The toolbar icon
// opens the same question box with nothing selected. Answers appear in a small card.
//
// Until the user clicks, nothing is stored: the bar follows the live selection.
// Once they click, the context is captured ("pinned") so that typing in the
// question box, which moves the browser's selection, cannot lose it.
//
// In the card: the explanation style and answer language (saved settings), a
// one-time picker for both, and words inside an answer can themselves be
// selected and explained in a smaller panel, and saved for later (vocab.js).

(() => {
  if (!(document.documentElement instanceof HTMLElement)) return; // XML, SVG documents

  const SETTLE_MS = 150; // let a drag or double-click finish before reacting
  const GAP_PX = 6;
  const CARD_TERM_MAX = 80; // longest selection inside a card that gets the "Arth" chip
  const SUB_DEPTH = 4; // how many words-inside-explanations deep the panel goes
  const RESTYLE_MS = 300; // wait after a style or language change before rewriting
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
    :host {
      inset: auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; width: max-content;
      --fg: light-dark(#1d2129, #e6e8ee);
      --muted: light-dark(#5b6270, #a3a9b6);
      --bg: light-dark(#ffffff, #1e2026);
      --subtle: light-dark(#f4f5f8, #262931);
      --line: light-dark(rgba(20, 24, 33, 0.14), rgba(255, 255, 255, 0.14));
      --line-strong: light-dark(rgba(20, 24, 33, 0.32), rgba(255, 255, 255, 0.32));
      --accent: light-dark(#3451d1, #8fa2ff);
      --on-accent: light-dark(#ffffff, #10131a);
      --danger: light-dark(#b3261e, #f2b8b5);
      --shadow: 0 12px 32px -10px light-dark(rgba(16, 24, 40, 0.28), rgba(0, 0, 0, 0.7)), 0 2px 6px light-dark(rgba(16, 24, 40, 0.08), rgba(0, 0, 0, 0.4));
    }
    /* Sharp, rectangular controls throughout. */
    button, .card, input, select {
      all: initial; color-scheme: inherit; box-sizing: border-box; border-radius: 0;
      font: 500 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--fg); background: var(--bg); border: 1px solid var(--line);
    }
    button { display: inline-block; cursor: pointer; white-space: nowrap; padding: 7px 12px; letter-spacing: 0.01em; transition: background-color 0.15s, border-color 0.15s, color 0.15s; }
    button:hover { background: var(--subtle); border-color: var(--line-strong); }
    button:active { transform: translateY(1px); }
    button:disabled { cursor: default; opacity: 0.55; transform: none; }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .primary, .card .primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
    .primary:hover, .card .primary:hover { background: var(--accent); filter: brightness(1.08); border-color: var(--accent); }

    /* The two buttons next to a selection: one joined, segmented control. */
    .bar { display: flex; box-shadow: var(--shadow); }
    .bar button + button { margin-left: -1px; }

    .card {
      display: block; width: min(360px, calc(100vw - 12px)); max-height: 300px; overflow: hidden auto;
      padding: 0 14px 12px; font-weight: 400; font-size: 14px; line-height: 1.55;
      border-top: 2px solid var(--accent); box-shadow: var(--shadow); /* no perspective here: it would become the box the fixed chip is placed in */
    }
    .card[data-state="error"] { border-top-color: var(--danger); }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .card[data-state="loading"] > .text, .sub[data-state="loading"] .text { color: var(--muted); }
    .question { font-size: 12px; line-height: 1.45; color: var(--muted); margin-bottom: 8px; padding-left: 8px; border-left: 2px solid var(--line-strong); overflow-wrap: anywhere; }
    .retry { display: block; margin-top: 10px; }

    /* Header: wordmark, style, language, save, saved words. Stays in view while the answer scrolls. */
    .tools { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; margin: 0 -14px 12px; padding: 8px 14px; background: var(--subtle); border-bottom: 1px solid var(--line); }
    .brand { font: 700 11px/1 system-ui, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); margin-right: 2px; }
    .tools .gap { flex: 1; }
    select { display: inline-block; font-size: 12px; padding: 4px 6px; cursor: pointer; max-width: 118px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    select:hover { border-color: var(--line-strong); }
    .card .small { padding: 4px 9px; font-size: 12px; }
    .card .small[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }

    form { display: flex; margin: 0; }
    .text:not([hidden]) ~ form, .retry:not([hidden]) ~ form { margin-top: 12px; }
    input { display: block; flex: 1; min-width: 0; padding: 8px 10px; font-weight: 400; cursor: text; }
    input:focus { border-color: var(--accent); }
    input::placeholder { color: var(--muted); }
    form button { margin-left: -1px; }

    .onboard { margin-bottom: 12px; padding: 10px; background: var(--subtle); border: 1px solid var(--line); font-size: 13px; }
    .onboard .q { font-weight: 600; margin: 0 0 8px; }
    .choices { display: flex; flex-wrap: wrap; gap: 4px; }
    .onboard .hint { margin-top: 6px; font-size: 12px; color: var(--muted); }
    .onboard .hint + .q { margin-top: 12px; }
    .onboard .end { display: flex; justify-content: flex-end; gap: 4px; margin-top: 10px; }

    /* A word explained inside the card: part of the same card, never a second floating one. */
    .sub { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--line); border-left: 2px solid var(--accent); background: var(--subtle); font-size: 13px; animation: rise 0.26s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .sub .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .sub .term { flex: 1; font-weight: 600; overflow-wrap: anywhere; }
    .sub[data-state="error"] .text { color: var(--danger); }
    .sub .end { display: flex; justify-content: flex-end; margin-top: 8px; }
    .card .chip { position: fixed; z-index: 2; padding: 5px 10px; font-size: 12px; box-shadow: var(--shadow); }

    /* Motion, each with a job:
       unfold  the card tips open from the side of the selection it belongs to;
       turn    the answer turns over while it is rewritten in a new style or language;
       cube    a square turning in 3D while an answer is on its way;
       flip    Save turns over into Saved, so the change is noticed. */
    .card.enter { animation: unfold 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); transform-origin: var(--origin, 50% 0); }
    .card > .text.turn { animation: turn 0.44s ease-in-out; }
    .card[data-state="loading"] > .text::before, .sub[data-state="loading"] .text::before {
      content: ''; display: inline-block; width: 9px; height: 9px; margin-right: 10px; vertical-align: -1px;
      border: 2px solid var(--accent); animation: cube 1.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
    }
    .flip { animation: flip 0.5s ease; }
    @keyframes unfold { from { opacity: 0; transform: perspective(900px) rotateX(var(--tilt, -12deg)) translateY(-4px); } to { opacity: 1; transform: none; } }
    @keyframes turn { 0% { transform: perspective(900px) rotateY(0); opacity: 1; } 45% { transform: perspective(900px) rotateY(90deg); opacity: 0.15; } 55% { transform: perspective(900px) rotateY(-90deg); opacity: 0.15; } 100% { transform: perspective(900px) rotateY(0); opacity: 1; } }
    @keyframes cube { 0% { transform: perspective(60px) rotateX(0) rotateY(0); } 50% { transform: perspective(60px) rotateX(180deg) rotateY(0); } 100% { transform: perspective(60px) rotateX(180deg) rotateY(180deg); } }
    @keyframes flip { from { transform: perspective(240px) rotateX(0); } to { transform: perspective(240px) rotateX(360deg); } }
    @keyframes rise { from { opacity: 0; transform: perspective(700px) rotateX(-10deg) translateY(-4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { *, .text::before { animation: none !important; transition: none !important; } }

    /* First-time guide: one short tip at a time, next to the part of the card it is about. */
    .coach {
      all: initial; position: fixed; z-index: 3; display: block; box-sizing: border-box; width: 248px; color-scheme: inherit;
      padding: 11px 12px; font: 400 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg);
      background: var(--bg); border: 1px solid var(--accent); border-left-width: 3px; box-shadow: var(--shadow);
      animation: rise 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .coach .count { display: block; margin-bottom: 6px; font: 700 10px/1 system-ui, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
    .coach .title { display: block; margin-bottom: 4px; font-weight: 600; }
    .coach .row { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
    .coach .skip { padding: 0; border: 0; background: none; color: var(--muted); font-size: 12px; text-decoration: underline; }
    .coach .skip:hover { background: none; color: var(--fg); }
    .coach .primary { padding: 5px 12px; font-size: 12px; }
    .coached { outline: 2px solid var(--accent) !important; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .coach { animation: none; } }
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
  const explainButton = make('button', 'Arth', 'primary');
  explainButton.title = 'Explain the selected text in context';
  const askButton = make('button', 'Ask');
  askButton.title = 'Ask your own question about the selected text';
  bar.append(explainButton, askButton);

  const card = make('div', '', 'card');

  // Tools row: style, language, re-explain, save, saved words.
  const tools = make('div', '', 'tools');
  const styleSelect = make('select', '');
  styleSelect.setAttribute('aria-label', 'Explanation style');
  for (const [key, s] of Object.entries(STYLES)) {
    const o = make('option', s.name);
    o.value = key;
    o.title = s.description;
    styleSelect.append(o);
  }
  const langSelect = make('select', '');
  langSelect.setAttribute('aria-label', 'Answer language');
  for (const [key, l] of Object.entries(LANGUAGES)) {
    const o = make('option', l.label);
    o.value = key;
    o.title = l.description;
    langSelect.append(o);
  }
  const saveButton = make('button', 'Save', 'small');
  saveButton.title = 'Save this word with its explanation';
  const wordsButton = make('button', 'Words', 'small');
  wordsButton.title = 'Saved words';
  wordsButton.setAttribute('aria-label', 'Saved words');
  tools.append(make('span', 'Arth', 'brand'), styleSelect, langSelect, make('span', '', 'gap'), saveButton, wordsButton);

  // One-time picker for style and language. Never blocks: the first answer is
  // already being fetched with the defaults while it is open.
  const onboard = make('div', '', 'onboard');
  onboard.setAttribute('role', 'group');
  onboard.setAttribute('aria-label', 'Choose how Arth explains');
  const styleChoices = make('div', '', 'choices');
  const styleHint = make('div', '', 'hint');
  const langChoices = make('div', '', 'choices');
  const choiceButtons = (box, table, label, kind) =>
    Object.entries(table).map(([key, t]) => {
      const b = make('button', label(t), 'small');
      b.dataset.kind = kind;
      b.dataset.value = key;
      b.title = t.description;
      box.append(b);
      return b;
    });
  const pickButtons = [
    ...choiceButtons(styleChoices, STYLES, (s) => s.name, 'style'),
    ...choiceButtons(langChoices, LANGUAGES, (l) => l.label, 'lang'),
  ];
  const onboardEnd = make('div', '', 'end');
  const skipButton = make('button', 'Skip', 'small');
  const doneButton = make('button', 'Done', 'small primary');
  onboardEnd.append(skipButton, doneButton);
  onboard.append(
    make('div', 'How do you prefer to understand things?', 'q'),
    styleChoices,
    styleHint,
    make('div', 'Which language do you prefer?', 'q'),
    langChoices,
    onboardEnd
  );
  onboard.hidden = true;

  const questionLine = make('div', '', 'question');
  const cardText = make('div', '', 'text');
  cardText.setAttribute('role', 'status'); // announces loading and the answer
  const retryButton = make('button', 'Retry', 'retry');

  // Panel for a word selected inside an answer.
  const sub = make('div', '', 'sub');
  sub.setAttribute('role', 'region');
  sub.setAttribute('aria-label', 'Explanation of a selected word');
  const subHead = make('div', '', 'head');
  const subBack = make('button', '', 'small');
  const subTerm = make('div', '', 'term');
  subHead.append(subBack, subTerm);
  const subText = make('div', '', 'text');
  subText.setAttribute('role', 'status');
  const subEnd = make('div', '', 'end');
  const subSave = make('button', 'Save word', 'small');
  subEnd.append(subSave);
  sub.append(subHead, subText, subEnd);
  sub.hidden = true;

  // Appears next to a word selected inside the card, like the bar does on the page.
  const chip = make('button', 'Arth', 'chip primary');
  chip.title = 'Explain this word';
  chip.hidden = true;

  const form = make('form', '');
  const input = make('input', '');
  input.type = 'text';
  input.maxLength = 500;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Your question');
  const sendButton = make('button', 'Ask', 'primary');
  sendButton.type = 'submit';
  form.append(input, sendButton);
  card.append(tools, onboard, questionLine, cardText, retryButton, sub, form, chip);
  // First-time guide (see "the first-time guide" below).
  const coach = make('div', '', 'coach');
  coach.setAttribute('role', 'note');
  coach.setAttribute('aria-live', 'polite');
  const coachCount = make('span', '', 'count');
  const coachTitle = make('span', '', 'title');
  const coachText = make('div', '');
  const coachRow = make('div', '', 'row');
  const coachSkip = make('button', 'Skip guide', 'skip');
  const coachNext = make('button', 'Next', 'primary');
  coachRow.append(coachSkip, coachNext);
  coach.append(coachCount, coachTitle, coachText, coachRow);
  coach.hidden = true;
  shadow.append(bar, card, coach);

  const live = () => card.dataset.state === 'answer' && onboard.hidden;
  const TOUR = [
    { anchor: () => bar, ready: () => !bar.hidden, title: 'Word select ho gaya', text: '"Arth" dabao: is jagah par iska matlab milega. "Ask" se iske baare mein apna sawaal pooch sakte ho.', next: false },
    { anchor: () => styleSelect, ready: live, title: 'Samjhane ka tareeka', text: 'Yahan style chuno: Layman, Simple + Analogy, Exam Notes, Deep Dive… Badalte hi answer isi card mein naye style mein ban jayega.' },
    { anchor: () => langSelect, ready: live, title: 'Bhasha', text: 'English, Hinglish ya हिंदी. Yeh bhi badalte hi answer wahin nayi bhasha mein aa jayega.' },
    { anchor: () => cardText, ready: () => live() && !subs.length, title: 'Answer mein koi word?', text: 'Answer ka koi word samajh na aaye to use select karo, phir "Arth" chip dabao. Uska matlab isi card mein khulega.' },
    { anchor: () => saveButton, ready: () => live() && !saveButton.hidden, title: 'Save karo', text: '"Save" se word yaad rahega. Is page par wapas aaoge to word halka highlight dikhega; us par mouse le jao, matlab dikh jayega.' },
    { anchor: () => wordsButton, ready: live, title: 'Saved words', text: 'Saare saved words, search aur notes "Words" mein. Bas, aap ready ho!', done: true },
  ];
  let tourStep = TOUR.length; // no tips until storage says this is a first-timer
  let coached = null;
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
  //   used      { style, lang } the answer on show was written in
  //   saved     true once this explanation was saved
  let pinned = null;
  // Words explained inside the card, innermost last: { term, context, requestId, state, text, used, saved }.
  let subs = [];
  let readingScroll = 0; // where the main answer was scrolled to before the first panel opened
  const partials = new Map(); // requestId -> called with the answer so far

  // ---- settings: the explanation style and answer language

  let prefs = { ...DEFAULT_PREFS };
  let onboarded = true; // until storage says otherwise, never show the picker
  const syncPrefs = () => {
    styleSelect.value = prefs.style;
    langSelect.value = prefs.lang;
    for (const b of pickButtons) b.setAttribute('aria-pressed', String(prefs[b.dataset.kind] === b.dataset.value));
    styleHint.textContent = STYLES[prefs.style].description;
    updateTools();
  };
  const loadPrefs = (stored) => {
    prefs = resolvePrefs(stored);
    onboarded = !!stored?.onboarded;
    syncPrefs();
  };
  chrome.storage.local
    .get('prefs')
    .then(({ prefs: stored }) => loadPrefs(stored))
    .catch(() => {});
  // Changed in another tab or on the saved-words page.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.prefs) loadPrefs(changes.prefs.newValue);
  });
  function setPref(kind, value) {
    prefs = resolvePrefs({ ...prefs, [kind]: value });
    syncPrefs();
    chrome.storage.local.set({ prefs: { ...prefs, onboarded } }).catch(() => {});
  }
  function finishOnboarding() {
    onboarded = true;
    onboard.hidden = true;
    chrome.storage.local.set({ prefs: { ...prefs, onboarded } }).catch(() => {});
    if (pinned) placePinned();
    restyle(); // rewrite the first answer if other choices were picked
  }

  // ---- views

  // view: 'bar' | 'ask' | 'loading' | 'streaming' (answer still being written) | 'answer' | 'error'
  function show(view, text = '', retryable = true) {
    const entering = card.hidden && view !== 'bar';
    bar.hidden = view !== 'bar';
    card.hidden = view === 'bar';
    if (entering) {
      card.classList.remove('enter');
      void card.offsetWidth; // restart the animation
      card.classList.add('enter');
    }
    card.dataset.state = view;
    cardText.textContent = text; // never innerHTML: the answer is untrusted text
    cardText.hidden = view === 'ask';
    questionLine.textContent = pinned?.question || '';
    questionLine.hidden = view === 'ask' || !pinned?.question;
    retryButton.hidden = view !== 'error' || !retryable;
    form.hidden = view === 'loading' || view === 'streaming';
    input.placeholder = pinned?.context?.selectedText ? 'Ask about the selected text…' : 'Ask a question about this page…';
    if (view === 'bar') onboard.hidden = true;
    updateTools();
    updateCoach();
  }
  // Save only for a finished explanation of a selection.
  function updateTools() {
    const view = card.dataset.state;
    saveButton.hidden = !(view === 'answer' && pinned && !pinned.question && pinned.context?.selectedText);
    saveButton.disabled = !!pinned?.saved;
    saveButton.textContent = pinned?.saved ? 'Saved' : 'Save';
  }
  show('bar');

  const isOpen = () => host.matches(':popover-open');
  const conceal = () => {
    if (isOpen()) host.hidePopover();
  };
  const open = () => {
    if (!isOpen()) host.showPopover();
  };

  // ---- talking to the service worker

  const cancelRequest = (requestId) => {
    partials.delete(requestId);
    try {
      chrome.runtime.sendMessage({ type: 'CANCEL', requestId }).catch(() => {});
    } catch {
      // Extension reloaded under this page: sendMessage throws synchronously.
    }
  };
  // Resolves with the service worker's reply; onPartial gets the answer as it is written.
  async function request(requestId, prompt, onPartial) {
    partials.set(requestId, onPartial);
    try {
      return await chrome.runtime.sendMessage({ type: 'ASK', requestId, prompt });
    } catch {
      // Service worker restarted mid-request, or the extension was reloaded and
      // this content script is orphaned (then chrome.runtime.id is gone).
      return { code: chrome.runtime?.id ? 'CONNECTION' : 'RELOAD_PAGE' };
    } finally {
      partials.delete(requestId);
    }
  }

  function cancelInFlight() {
    if (!pinned?.requestId) return;
    cancelRequest(pinned.requestId);
    pinned.requestId = null;
  }
  function closeSubs() {
    for (const s of subs) if (s.requestId) cancelRequest(s.requestId);
    for (const s of subs) s.requestId = null;
    subs = [];
    renderSub();
  }
  // Back to nothing showing. A request still in flight is cancelled and its reply ignored.
  function dismiss() {
    cancelInFlight();
    closeSubs();
    chip.hidden = true;
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
    // The card unfolds from the edge that faces its selection.
    card.style.setProperty('--origin', below ? '50% 0' : '50% 100%');
    card.style.setProperty('--tilt', below ? '-12deg' : '12deg');
    updateCoach();
  }
  // With nothing selected the card sits in the top-right corner of the page.
  function placePinned() {
    if (pinned.range) return place(pinned.range);
    open();
    card.style.maxHeight = '';
    host.style.left = `${Math.max(GAP_PX, innerWidth - host.offsetWidth - 16)}px`;
    host.style.top = '16px';
    updateCoach();
  }

  function pin(ctx) {
    const { selectionRange, ...context } = ctx; // the live Range is not serialisable
    pinned = { context, range: selectionRange ? selectionRange.cloneRange() : null, requestId: null, question: null, used: null, saved: false };
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
    closeSubs();
    chip.hidden = true;
    const requestId = crypto.randomUUID();
    const used = { ...prefs };
    Object.assign(pinned, { requestId, question: question || null, used, saved: false });
    if (!onboarded && !question) onboard.hidden = false; // the first explanation: offer the picker once
    show('loading', 'Thinking…');
    placePinned();

    const res = await request(requestId, buildPrompt(pinned.context, question, used), (text) => {
      if (pinned?.requestId !== requestId) return;
      show('streaming', text);
      placePinned();
    });
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
    closeSubs();
    const ctx = extractSelectionContext();
    pin(ctx.error ? extractPageContext() : ctx);
    show('ask');
    placePinned();
    input.focus();
  }

  // Rewrites what the card shows in the style and language selected now. Waits a
  // moment, so picking a style and then a language asks once, not twice.
  let restyleTimer;
  function restyle() {
    clearTimeout(restyleTimer);
    restyleTimer = setTimeout(() => {
      const p = pinned;
      if (!p?.used || card.hidden || card.dataset.state === 'ask') return; // nothing explained yet
      if (p.used.style === prefs.style && p.used.lang === prefs.lang) return; // already in these
      cardText.classList.remove('turn');
      void cardText.offsetWidth;
      cardText.classList.add('turn');
      ask(p.question);
    }, RESTYLE_MS);
  }

  // ---- the first-time guide
  // Six tips, each shown next to the real control it is about, the first time
  // it matters. A step ends when the user does the thing, or presses Next;
  // "Skip guide" ends it for good. Progress is kept in storage ("tour").
  chrome.storage.local
    .get('tour')
    .then(({ tour }) => {
      tourStep = Number.isInteger(tour) ? tour : 0;
      updateCoach();
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.tour) return;
    tourStep = Number.isInteger(changes.tour.newValue) ? changes.tour.newValue : 0; // restarted from the guide page
    updateCoach();
  });
  function setTour(n) {
    tourStep = n;
    chrome.storage.local.set({ tour: n }).catch(() => {});
    updateCoach();
  }
  // Moves the guide on when the user has done what the current step is about.
  const doneStep = (n) => tourStep === n && setTour(n + 1);

  function updateCoach() {
    const step = TOUR[tourStep];
    const anchor = step && !isWorkerTab && isOpen() && step.ready() ? step.anchor() : null;
    if (coached !== anchor) coached?.classList.remove('coached');
    coached = anchor;
    coach.hidden = !anchor;
    if (!anchor) return;
    anchor.classList.add('coached');
    coachCount.textContent = `Guide · ${tourStep + 1} / ${TOUR.length}`;
    coachTitle.textContent = step.title;
    coachText.textContent = step.text;
    coachNext.hidden = step.next === false;
    coachNext.textContent = step.done ? 'Done' : 'Next';
    // Beside the card (left, else right), level with the control; else below or above it.
    const box = (card.hidden ? bar : card).getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const w = coach.offsetWidth;
    const h = coach.offsetHeight;
    const clampTop = (t) => Math.max(GAP_PX, Math.min(t, innerHeight - h - GAP_PX));
    let left;
    let top = clampTop(a.top - 8);
    if (box.left - w - 10 >= GAP_PX) left = box.left - w - 10;
    else if (box.right + 10 + w <= innerWidth - GAP_PX) left = box.right + 10;
    else {
      left = Math.max(GAP_PX, Math.min(box.left, innerWidth - w - GAP_PX));
      top = clampTop(box.bottom + 10 + h <= innerHeight ? box.bottom + 10 : box.top - h - 10);
    }
    coach.style.left = `${left}px`;
    coach.style.top = `${top}px`;
  }

  // ---- saving words (stored by vocab.js)

  async function save(button, fields, onSaved) {
    button.disabled = true;
    try {
      await vocabStore.save({ url: location.href, title: document.title, ...fields });
      onSaved();
      button.classList.remove('flip');
      void button.offsetWidth;
      button.classList.add('flip');
    } catch {
      button.disabled = false;
      button.textContent = 'Could not save';
    }
  }
  // About 100 characters either side of the word, from the excerpt that kept the
  // page's own spacing (a double-click selection can swallow the space after it).
  const snippet = (context) => {
    const t = context.sourceMessage.text.replace(/\s+/g, ' ');
    const i = Math.max(0, t.indexOf(context.selectedText));
    return t.slice(Math.max(0, i - 100), i + context.selectedText.length + 100).trim();
  };

  // ---- words selected inside the card

  // The selection, if it lies inside a finished answer in the card and is a
  // usable word or phrase: { range, block, text }. A selection in a shadow
  // tree is read through the shadow root (Chrome's ShadowRoot.getSelection).
  function cardSelection() {
    const sel = shadow.getSelection?.() || getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const top = subs.at(-1);
    const blocks = [card.dataset.state === 'answer' && cardText, top?.state === 'answer' && subs.length < SUB_DEPTH && subText];
    const block = blocks.find((b) => b && b.contains(range.startContainer) && b.contains(range.endContainer));
    if (!block) return null;
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > CARD_TERM_MAX || !/[\p{L}\p{N}]/u.test(text)) return null; // whitespace, punctuation, too long
    return { range, block, text };
  }
  // The selection the chip was shown for. Kept, so that the click still works
  // if the live selection has collapsed by then.
  let chipFor = null;
  function updateChip() {
    const s = cardSelection();
    chipFor = s;
    chip.hidden = !s;
    if (!s) return;
    const r = s.range.getBoundingClientRect();
    chip.style.left = `${Math.max(GAP_PX, Math.min(r.left, innerWidth - 60))}px`;
    chip.style.top = `${Math.min(r.bottom + 4, innerHeight - 30)}px`;
  }

  function explainInCard(s) {
    const top = subs.at(-1);
    // The same word is already being explained: do not ask twice.
    if (top?.requestId && normText(top.term) === normText(s.text)) return;
    const pre = document.createRange();
    pre.selectNodeContents(s.block);
    pre.setEnd(s.range.startContainer, s.range.startOffset);
    const before = pre.toString();
    const raw = s.range.toString(); // with any space the selection swallowed, unlike s.text
    const after = s.block.textContent.slice(before.length + raw.length);
    const parentTerm = s.block === subText ? top.term : pinned.context.selectedText || pinned.question || document.title;
    // A word from the main answer starts a new chain; a word from the panel goes one deeper.
    if (s.block === cardText) closeSubs();
    const L = CONTEXT_LIMITS;
    const context = {
      kind: 'card',
      selectedText: s.text,
      surroundingText: { before: tail(before, L.passageSide), after: head(after, L.passageSide) },
      sourceMessage: {
        role: 'page',
        turn: null,
        text: tail(before, L.messageSide) + raw + head(after, L.messageSide),
        truncatedStart: before.length > L.messageSide,
        truncatedEnd: after.length > L.messageSide,
      },
      nearbyMessages: [],
      metadata: { url: location.href, title: document.title, site: location.hostname, parentTerm },
    };
    const entry = { term: s.text, context, requestId: crypto.randomUUID(), state: 'loading', text: 'Thinking…', used: { ...prefs }, saved: false };
    if (!subs.length) readingScroll = card.scrollTop;
    subs.push(entry);
    chip.hidden = true;
    renderSub();
    request(entry.requestId, buildPrompt(context, null, entry.used), (text) => {
      if (!entry.requestId) return;
      Object.assign(entry, { state: 'streaming', text });
      if (subs.at(-1) === entry) renderSub();
    }).then((res) => {
      if (!entry.requestId) return; // closed while waiting
      entry.requestId = null;
      Object.assign(entry, res?.ok ? { state: 'answer', text: res.answer } : { state: 'error', text: ERROR_TEXT[res?.code] || DEFAULT_ERROR });
      if (subs.at(-1) === entry) renderSub();
    });
  }

  function renderSub() {
    const top = subs.at(-1);
    sub.hidden = !top;
    if (!top) return;
    sub.dataset.state = top.state;
    subBack.textContent = subs.length > 1 ? 'Back' : 'Close';
    subBack.title = subs.length > 1 ? `Back to "${subs.at(-2).term}"` : 'Close';
    subBack.setAttribute('aria-label', subBack.title);
    subTerm.textContent = top.term;
    subText.textContent = top.text; // untrusted text: never innerHTML
    subEnd.hidden = top.state !== 'answer';
    subSave.disabled = top.saved;
    subSave.textContent = top.saved ? 'Saved' : 'Save word';
    if (pinned) placePinned(); // the card changed size; the main answer and its scroll position stay as they are
    sub.scrollIntoView({ block: 'nearest' });
    updateCoach();
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return; // only our own service worker
    if (msg?.type === 'OPEN_ASK') return void openQuestionBox(); // the toolbar icon was clicked
    if (msg?.type === 'PARTIAL') {
      // The answer so far, for a request this tab is waiting on.
      if (typeof msg.text === 'string') partials.get(msg.requestId)?.(msg.text);
      return;
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
  // A selection inside our card also fires this; update() ignores it while a card is pinned.
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
  // A word selected inside the card, by mouse or keyboard (Shift+arrows): show the chip.
  shadow.addEventListener('pointerup', (e) => {
    if (e.target !== chip) setTimeout(updateChip);
  });
  shadow.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') updateChip();
  });
  card.addEventListener('scroll', () => (chip.hidden = true), { passive: true });

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
      if (pinned) return placePinned(); // also moves the guide tip
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
    if (!e.isTrusted) return;
    doneStep(0);
    ask(null);
  });
  askButton.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    doneStep(0);
    openQuestionBox();
  });
  coachNext.addEventListener('click', (e) => e.isTrusted && setTour(tourStep + 1));
  coachSkip.addEventListener('click', (e) => e.isTrusted && setTour(TOUR.length));
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
  // A style or language chosen in the card applies at once: the explanation or
  // answer on show is rewritten in it, in the same card. Changes made elsewhere
  // (another tab, the saved-words page) only apply to the next explanation.
  styleSelect.addEventListener('change', () => {
    doneStep(1);
    setPref('style', styleSelect.value);
    restyle();
  });
  langSelect.addEventListener('change', () => {
    doneStep(2);
    setPref('lang', langSelect.value);
    restyle();
  });
  // In the first-use picker, choices are only marked; Done or Skip applies them,
  // so the card does not change under the pointer between two picks.
  onboard.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]');
    if (b && e.isTrusted) setPref(b.dataset.kind, b.dataset.value);
  });
  skipButton.addEventListener('click', (e) => e.isTrusted && finishOnboarding());
  doneButton.addEventListener('click', (e) => e.isTrusted && finishOnboarding());
  saveButton.addEventListener('click', (e) => {
    if (!e.isTrusted || !pinned || pinned.saved) return;
    doneStep(4);
    const p = pinned;
    const { selectedText: term, surroundingText: s } = p.context;
    const fields = { term, definition: cardText.textContent, before: s.before, after: s.after, snippet: snippet(p.context), ...p.used, source: 'page' };
    save(saveButton, fields, () => {
      p.saved = true;
      if (pinned === p) updateTools();
    });
  });
  subSave.addEventListener('click', (e) => {
    const top = subs.at(-1);
    if (!e.isTrusted || !top || top.saved) return;
    // Selected inside our card, not on the page: no page context to find it by later.
    const fields = { term: top.term, definition: top.text, snippet: snippet(top.context), ...top.used, source: 'card' };
    save(subSave, fields, () => {
      top.saved = true;
      if (subs.at(-1) === top) renderSub();
    });
  });
  subBack.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const top = subs.pop();
    if (top?.requestId) cancelRequest(top.requestId);
    if (top) top.requestId = null;
    renderSub();
    if (!subs.length) card.scrollTop = readingScroll; // back to where the main answer was being read
  });
  chip.addEventListener('click', (e) => {
    const s = e.isTrusted && !chip.hidden && chipFor;
    chip.hidden = true;
    // Still the same text as when the chip appeared (a re-render replaces it).
    if (!(s && s.block.isConnected && !s.range.collapsed && s.range.toString().replace(/\s+/g, ' ').trim() === s.text)) return;
    doneStep(3);
    explainInCard(s);
  });
  wordsButton.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    doneStep(5);
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_WORDS' }).catch(() => {});
    } catch {
      // Extension reloaded under this page.
    }
  });
})();
