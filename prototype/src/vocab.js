// Saved words ("vocabulary"): storage, finding a saved word again on a page,
// the subtle highlight, and the hover/tap tooltip with its saved definition.
// Page and user text is only ever set with textContent, never as HTML.
// The storage and matching parts are also used by words.html and the tests.

const VOCAB_LIMITS = { term: 80, definition: 3000, snippet: 240, context: 80, note: 500, entries: 2000 };

const normText = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// The same page with and without a #fragment.
const pageKey = (url) => {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return '';
  }
};

const vocabStore = (() => {
  const KEY = 'vocab';
  const all = async () => (await chrome.storage.local.get(KEY))[KEY] || [];
  // shortcut: read-modify-write of one list; two tabs saving in the same instant can lose one. Move to one key per entry if that ever bites.
  const write = (list) => chrome.storage.local.set({ [KEY]: list });
  const sameEntry = (a, b) =>
    a.url === b.url &&
    normText(a.term) === normText(b.term) &&
    normText(a.before) === normText(b.before) &&
    normText(a.after) === normText(b.after) &&
    a.lang === b.lang &&
    a.style === b.style;

  // Returns { entry, created }. Saving the same word, from the same place, in
  // the same style and language again keeps the existing entry (and its note).
  // A different place or language is a different meaning and gets its own entry.
  async function save(fields) {
    const L = VOCAB_LIMITS;
    const entry = {
      term: fields.term.trim().slice(0, L.term),
      definition: fields.definition.trim().slice(0, L.definition),
      snippet: (fields.snippet || '').slice(0, L.snippet),
      before: (fields.before || '').slice(-L.context),
      after: (fields.after || '').slice(0, L.context),
      url: pageKey(fields.url),
      title: (fields.title || '').slice(0, 200),
      style: fields.style,
      lang: fields.lang,
      source: fields.source, // 'page' (selected on the page) | 'card' (selected inside an Arth card)
    };
    const list = await all();
    const existing = list.find((e) => sameEntry(e, entry));
    if (existing) return { entry: existing, created: false };
    const created = { id: crypto.randomUUID(), createdAt: Date.now(), note: '', ...entry };
    await write([created, ...list].slice(0, L.entries));
    return { entry: created, created: true };
  }
  async function update(id, fields) {
    const list = await all();
    const e = list.find((x) => x.id === id);
    if (!e) return null;
    if (typeof fields.note === 'string') e.note = fields.note.slice(0, VOCAB_LIMITS.note);
    await write(list);
    return e;
  }
  async function remove(id) {
    await write((await all()).filter((e) => e.id !== id));
  }
  return { KEY, all, save, update, remove };
})();

// ---- Finding a saved word in a page's text. Pure apart from reading the DOM.

// Text in these is never matched: code the page runs, form fields, our own UI.
const VOCAB_SKIP = 'script,style,noscript,textarea,input,select,option,template,svg,[contenteditable=""],[contenteditable="true"],[data-ask-ai]';
const VOCAB_BLOCK = 'address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,li,main,nav,ol,p,pre,section,table,td,th,tr,ul';

// All visible-ish text under root as one string. Text nodes inside the same block
// are joined directly, so a word split across <b>clo</b>sure is still one word;
// a line break separates blocks, so words from two paragraphs never merge.
function textIndex(root) {
  const nodes = [];
  const starts = [];
  let text = '';
  let lastBlock;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(VOCAB_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = n.parentElement.closest(VOCAB_BLOCK);
    if (text && block !== lastBlock) text += '\n';
    lastBlock = block;
    nodes.push(n);
    starts.push(text.length);
    text += n.data;
  }
  return { text, nodes, starts };
}

// [node, offset] for a position in index.text. An end position on a node
// boundary stays in the earlier node, so a range never starts or ends in a gap.
function indexPoint(index, pos, isEnd) {
  let lo = 0;
  let hi = index.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (isEnd ? index.starts[mid] < pos : index.starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return [index.nodes[lo], pos - index.starts[lo]];
}

function indexRange(index, start, end) {
  const r = document.createRange();
  r.setStart(...indexPoint(index, start, false));
  r.setEnd(...indexPoint(index, end, true));
  return r;
}

const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';
// The term as a whole word (or phrase), any run of whitespace between its words, any case.
function termPattern(term) {
  const body = term
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`, 'giu');
}

const wordsOf = (s) => (s || '').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];

// How well the text around one occurrence agrees with the text saved around the
// word: matching words counted outward from the word count most, shared nearby
// words a little (so an edit next to the word does not lose it entirely).
function contextScore(text, start, end, saved) {
  const before = wordsOf(text.slice(Math.max(0, start - 200), start)).slice(-12);
  const after = wordsOf(text.slice(end, end + 200)).slice(0, 12);
  const sb = wordsOf(saved.before).slice(-12);
  const sa = wordsOf(saved.after).slice(0, 12);
  let edge = 0;
  while (edge < Math.min(before.length, sb.length) && before[before.length - 1 - edge] === sb[sb.length - 1 - edge]) edge++;
  let edgeAfter = 0;
  while (edgeAfter < Math.min(after.length, sa.length) && after[edgeAfter] === sa[edgeAfter]) edgeAfter++;
  const near = new Set([...before, ...after]);
  const shared = new Set([...sb, ...sa].filter((w) => near.has(w))).size;
  return 2 * (edge + edgeAfter) + 0.5 * shared;
}

const MATCH = { minScore: 2, minScoreOnly: 1, margin: 1.5 };

// The one occurrence of a saved word in index.text that is confidently the saved
// one, as { start, end }, or null. Never guesses between look-alikes:
// - with saved context: the best-scoring occurrence, if it scores well enough
//   and clearly better than the next;
// - without context (words saved from inside an Arth card): only if the word
//   occurs exactly once.
function findSaved(index, saved) {
  const hits = [...index.text.matchAll(termPattern(saved.term))].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (!hits.length) return null;
  if (!wordsOf(saved.before).length && !wordsOf(saved.after).length) return hits.length === 1 ? hits[0] : null;
  for (const h of hits) h.score = contextScore(index.text, h.start, h.end, saved);
  hits.sort((a, b) => b.score - a.score);
  const [best, next] = hits;
  if (best.score < (next ? MATCH.minScore : MATCH.minScoreOnly)) return null;
  if (next && best.score - next.score < MATCH.margin) return null;
  return best;
}

// ---- On web pages: highlight saved words and show their definitions.

(() => {
  if (!/^https?:$/.test(location.protocol) || !(document.documentElement instanceof HTMLElement)) return;
  // shortcut: no fallback without the CSS Custom Highlight API; Chrome 123 (the manifest minimum) has it. Saved words stay in the list either way.
  if (!globalThis.CSS?.highlights || !globalThis.Highlight) return;

  const NAME = 'arth-saved';
  const HIDE_MS = 250; // grace period, so moving from the word to the tooltip does not close it
  const RESCAN_MS = 800;

  // A faint tint and a fine dotted underline, readable on light and dark pages
  // and distinct from both the selection colour and links.
  const pageSheet = new CSSStyleSheet();
  pageSheet.replaceSync(`::highlight(${NAME}) { background-color: rgba(214, 158, 46, 0.16); text-decoration: underline dotted rgba(180, 120, 20, 0.85); text-decoration-thickness: 1.5px; text-underline-offset: 3px; }`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];

  const tipHost = document.createElement('div');
  tipHost.setAttribute('data-ask-ai', '');
  tipHost.popover = 'manual';
  const shadow = tipHost.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { inset: auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; }
    /* Same palette and sharp edges as the Arth card (reader.js). */
    .tip {
      all: initial; display: block; box-sizing: border-box; color-scheme: inherit;
      width: max-content; max-width: min(300px, calc(100vw - 12px)); max-height: 220px; overflow: hidden auto;
      padding: 9px 11px; border-radius: 0; font: 400 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: light-dark(#1d2129, #e6e8ee); background: light-dark(#ffffff, #1e2026);
      border: 1px solid light-dark(rgba(20, 24, 33, 0.14), rgba(255, 255, 255, 0.14));
      border-top: 2px solid light-dark(#3451d1, #8fa2ff);
      box-shadow: 0 12px 32px -10px light-dark(rgba(16, 24, 40, 0.28), rgba(0, 0, 0, 0.7)), 0 2px 6px light-dark(rgba(16, 24, 40, 0.08), rgba(0, 0, 0, 0.4));
      animation: tip-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1); transform-origin: 50% 0;
    }
    .item + .item { margin-top: 8px; padding-top: 8px; border-top: 1px solid light-dark(rgba(20, 24, 33, 0.14), rgba(255, 255, 255, 0.14)); }
    .term { font-weight: 600; }
    .def { white-space: pre-wrap; overflow-wrap: anywhere; }
    .note { margin-top: 4px; font-style: italic; color: light-dark(#5b6270, #a3a9b6); white-space: pre-wrap; }
    .meta { margin-top: 6px; font-size: 11px; letter-spacing: 0.02em; color: light-dark(#5b6270, #a3a9b6); }
    /* Tips open from the saved word, like the card does from a selection. */
    @keyframes tip-in { from { opacity: 0; transform: perspective(700px) rotateX(-10deg); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .tip { animation: none; } }
  `);
  shadow.adoptedStyleSheets = [sheet];
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  shadow.append(tip);
  document.documentElement.append(tipHost);

  let entries = []; // saved entries for this page
  let matches = []; // { entry, range } found on the page now
  let observer = null;
  let rescanTimer;
  let hideTimer;
  let shownFor = null; // the matches the tooltip is showing
  let stuck = false; // opened by click/tap or keyboard: stays until dismissed

  function scan() {
    matches = [];
    if (entries.length && document.body) {
      const index = textIndex(document.body);
      for (const entry of entries) {
        const hit = findSaved(index, entry);
        if (hit) matches.push({ entry, range: indexRange(index, hit.start, hit.end) });
      }
    }
    if (matches.length) CSS.highlights.set(NAME, new Highlight(...matches.map((m) => m.range)));
    else CSS.highlights.delete(NAME);
    if (shownFor && !shownFor.every((m) => matches.includes(m))) hide();
  }

  // Pages that render late or re-render: look again after the DOM settles. Only
  // while this page has saved words; ranges whose text was removed collapse and
  // are found again (or dropped) by the next scan.
  function watch() {
    if (!entries.length) {
      observer?.disconnect();
      observer = null;
      return;
    }
    if (observer) return;
    // Our own UI hangs off <html>, outside <body>, so it never triggers this.
    observer = new MutationObserver(() => {
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(scan, RESCAN_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  async function load() {
    try {
      const key = pageKey(location.href);
      entries = (await vocabStore.all()).filter((e) => e.url === key);
    } catch {
      entries = []; // extension reloaded under this page
    }
    scan();
    watch();
  }

  // ---- tooltip

  const rectsOf = (m) => (m.range.collapsed ? [] : [...m.range.getClientRects()]);
  const at = (x, y) => matches.filter((m) => rectsOf(m).some((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1));

  function render(list) {
    const pref = (v, table) => table[v]?.name || table[v]?.label || '';
    tip.replaceChildren(
      ...list.map(({ entry }) => {
        const item = document.createElement('div');
        item.className = 'item';
        const term = document.createElement('div');
        term.className = 'term';
        term.textContent = entry.term;
        const def = document.createElement('div');
        def.className = 'def';
        def.textContent = entry.definition;
        item.append(term, def);
        if (entry.note) {
          const note = document.createElement('div');
          note.className = 'note';
          note.textContent = entry.note;
          item.append(note);
        }
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = ['Saved word', pref(entry.style, STYLES), pref(entry.lang, LANGUAGES)].filter(Boolean).join(' · ');
        item.append(meta);
        return item;
      })
    );
  }

  function show(list, sticky) {
    clearTimeout(hideTimer);
    stuck = stuck || sticky;
    const same = shownFor && shownFor.length === list.length && list.every((m) => shownFor.includes(m));
    if (!same) render(list);
    shownFor = list;
    if (!tipHost.matches(':popover-open')) tipHost.showPopover();
    // Below the word, or above it if there is no room; always inside the viewport.
    const r = list[0].range.getBoundingClientRect();
    const h = tipHost.offsetHeight;
    const below = r.bottom + 6 + h <= innerHeight || r.top - 6 - h < 0;
    tipHost.style.left = `${Math.max(6, Math.min(r.left, innerWidth - tipHost.offsetWidth - 6))}px`;
    tipHost.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`;
  }
  function hide() {
    clearTimeout(hideTimer);
    shownFor = null;
    stuck = false;
    if (tipHost.matches(':popover-open')) tipHost.hidePopover();
  }
  const hideSoon = () => {
    if (stuck || !shownFor) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_MS);
  };

  // True when the pointer is over Arth's own card, bar or guide tip: a saved word
  // underneath them must not open its tooltip on top of them.
  const overArth = (e) => e.composedPath().some((n) => n instanceof Element && n !== tipHost && n.hasAttribute('data-ask-ai'));

  // Mouse: hover shows, leaving the word and the tooltip hides after a grace period.
  let frame;
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!matches.length || e.pointerType === 'touch') return;
      if (overArth(e)) return hideSoon();
      const { clientX: x, clientY: y } = e;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (e.composedPath().includes(tipHost)) return clearTimeout(hideTimer);
        const list = at(x, y);
        if (list.length) show(list, false);
        else hideSoon();
      });
    },
    { passive: true }
  );
  // Click or tap on a saved word: the tooltip stays open. Links and selection
  // still work as normal; nothing is prevented.
  document.addEventListener(
    'pointerup',
    (e) => {
      if (e.composedPath().includes(tipHost) || overArth(e)) return;
      const list = matches.length && getSelection().isCollapsed ? at(e.clientX, e.clientY) : [];
      if (list.length) show(list, true);
      else if (stuck) hide();
    },
    true
  );
  // Keyboard: focusing a link or control that contains a saved word shows it.
  document.addEventListener('focusin', (e) => {
    const list = matches.filter((m) => e.target instanceof Node && e.target.contains(m.range.commonAncestorContainer));
    if (list.length) show(list, true);
  });
  document.addEventListener('focusout', () => stuck && hide());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shownFor) hide();
  });
  addEventListener('scroll', () => shownFor && hide(), { capture: true, passive: true });

  // Saved, edited or deleted in any tab: show the change here too.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[vocabStore.KEY]) load();
  });
  // Single-page sites: a different address may have different saved words.
  window.navigation?.addEventListener('navigatesuccess', load);

  load();
})();
