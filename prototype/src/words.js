// Saved-words page: the style and language settings, and the list of saved
// words with search, notes and delete. Text is only ever set with textContent.

(() => {
  const $ = (id) => document.getElementById(id);
  const styleSelect = $('style');
  const langSelect = $('lang');
  const search = $('search');
  const list = $('list');
  const empty = $('empty');
  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };

  for (const [key, s] of Object.entries(STYLES)) styleSelect.append(new Option(s.name, key));
  for (const [key, l] of Object.entries(LANGUAGES)) langSelect.append(new Option(l.label, key));

  let stored = {};
  async function loadPrefs() {
    stored = (await chrome.storage.local.get('prefs')).prefs || {};
    const p = resolvePrefs(stored);
    styleSelect.value = p.style;
    langSelect.value = p.lang;
  }
  const savePrefs = () => chrome.storage.local.set({ prefs: { ...stored, style: styleSelect.value, lang: langSelect.value } });
  styleSelect.addEventListener('change', savePrefs);
  langSelect.addEventListener('change', savePrefs);

  let entries = [];
  const matches = (e, q) => !q || [e.term, e.definition, e.note, e.title].some((v) => normText(v).includes(q));

  function item(e) {
    const li = el('li', 'entry');
    li.append(el('div', 'term', e.term), el('div', 'def', e.definition));
    if (e.snippet) li.append(el('div', 'snippet', `“${e.snippet}”`));

    const meta = el('div', 'meta');
    const parts = [STYLES[e.style]?.name, LANGUAGES[e.lang]?.label, new Date(e.createdAt).toLocaleDateString()].filter(Boolean);
    meta.append(parts.join(' · '));
    if (/^https?:/.test(e.url)) {
      meta.append(' · ');
      const a = el('a', '', e.title || e.url);
      a.href = e.url; // only http(s) addresses are linked
      a.target = '_blank';
      a.rel = 'noopener';
      meta.append(a);
    }
    li.append(meta);

    const note = el('textarea');
    note.value = e.note || '';
    note.placeholder = 'Your note…';
    note.maxLength = VOCAB_LIMITS.note;
    note.setAttribute('aria-label', `Note for ${e.term}`);
    const status = el('span', '', '');
    note.addEventListener('change', async () => {
      await vocabStore.update(e.id, { note: note.value });
      status.textContent = 'Note saved';
    });

    // Delete asks once, inline: no browser dialogs.
    const del = el('button', 'danger', 'Delete');
    const confirmBox = el('span');
    const yes = el('button', 'danger', 'Yes, delete');
    const no = el('button', '', 'Keep');
    confirmBox.append('Delete this word? ', yes, ' ', no);
    confirmBox.hidden = true;
    del.addEventListener('click', () => {
      del.hidden = true;
      confirmBox.hidden = false;
      no.focus();
    });
    no.addEventListener('click', () => {
      confirmBox.hidden = true;
      del.hidden = false;
      del.focus();
    });
    yes.addEventListener('click', async () => {
      await vocabStore.remove(e.id);
      loadEntries();
      search.focus();
    });

    const row = el('div', 'row');
    row.append(status, el('span', 'gap'), del, confirmBox);
    li.append(note, row);
    return li;
  }

  function render() {
    const q = normText(search.value);
    const shown = entries.filter((e) => matches(e, q));
    list.replaceChildren(...shown.map(item));
    empty.hidden = shown.length > 0;
    empty.textContent = entries.length
      ? 'No saved words match your search.'
      : 'No saved words yet. Select a word on any page, click Arth, then “Save” in the card.';
  }
  async function loadEntries() {
    entries = await vocabStore.all();
    render();
  }

  search.addEventListener('input', render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[vocabStore.KEY] && !list.contains(document.activeElement)) loadEntries(); // never re-render under someone typing a note
    if (changes.prefs) loadPrefs();
  });
  loadPrefs();
  loadEntries();
})();
