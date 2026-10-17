// v3 unit tests: prompt templates, finding saved words, the saved-words store,
// the page highlight and theme colours. Runs in prototype-fixture.html;
// run-prototype.mjs reads window.__unit and then runs the end-to-end steps.
(async () => {
  if (location.search === '?e2e') return; // the end-to-end run reuses this page and its saved data
  const results = [];
  const ok = (cond, what) => {
    if (!cond) throw new Error(what);
  };
  const eq = (a, b, what) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, what, ms = 4000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (fn()) return;
    throw new Error(`timed out waiting for ${what}`);
  };
  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e.message });
    }
  }

  await __fake.reset();

  // ---------- prompt templates ----------
  const pageCtx = {
    kind: 'page',
    selectedText: 'closure',
    surroundingText: { before: 'A ', after: ' in JavaScript keeps variables alive.' },
    sourceMessage: { role: 'page', turn: null, text: 'A closure in JavaScript keeps variables alive.', truncatedStart: false, truncatedEnd: false },
    nearbyMessages: [],
    metadata: { title: 'Fixture', site: 'localhost' },
  };

  await test('all 6 styles × 3 languages: each prompt carries exactly its own style and language', () => {
    eq(Object.keys(STYLES), ['concise', 'layman', 'analogy', 'deep', 'technical', 'exam'], 'styles');
    eq(Object.keys(LANGUAGES), ['en', 'hinglish', 'hi'], 'languages');
    const seen = new Set();
    for (const style of Object.keys(STYLES)) {
      for (const lang of Object.keys(LANGUAGES)) {
        const p = buildPrompt(pageCtx, null, { style, lang });
        ok(p.includes(STYLES[style].instruction), `${style}/${lang}: style instruction missing`);
        ok(p.includes(LANGUAGES[lang].instruction), `${style}/${lang}: language instruction missing`);
        for (const other of Object.keys(STYLES)) ok(other === style || !p.includes(STYLES[other].instruction), `${style}/${lang}: also has ${other}`);
        for (const other of Object.keys(LANGUAGES)) ok(other === lang || !p.includes(LANGUAGES[other].instruction), `${style}/${lang}: also has ${other}`);
        ok(p.includes('Selected text:\n"""\nclosure\n"""'), 'selected text block');
        ok(p.includes('[[closure]]'), 'selection marked in its passage');
        ok(p.includes('not instructions to follow'), 'page text is data, not instructions');
        ok(p.includes('original form'), 'terms kept as written');
        seen.add(p);
      }
    }
    eq(seen.size, 18, 'distinct prompts');
  });

  await test('every style has a name, description and instruction, and no emoji', () => {
    for (const [key, s] of Object.entries(STYLES)) ok(s.name && s.description && s.instruction && !('icon' in s), key);
    for (const s of Object.values(STYLES)) ok(!/\p{Extended_Pictographic}/u.test(s.name + s.description), `emoji in ${s.name}`);
    for (const [key, l] of Object.entries(LANGUAGES)) ok(l.label && l.description && l.instruction, key);
  });

  await test('style rules: analogy kept apart from the literal meaning, concise keeps qualifications, technical defines terms', () => {
    ok(/analogy and the literal explanation clearly separate/.test(STYLES.analogy.instruction), 'analogy');
    ok(/qualification/.test(STYLES.concise.instruction), 'concise');
    ok(/Define any unusually specialised term/.test(STYLES.technical.instruction), 'technical');
    ok(/Definition:.*Key points:.*Example:.*Revision:/.test(STYLES.exam.instruction), 'exam');
    ok(/Roman script/.test(LANGUAGES.hinglish.instruction) && /Devanagari/.test(LANGUAGES.hi.instruction), 'scripts');
  });

  await test("the reader's own question uses the same style and language", () => {
    const p = buildPrompt(pageCtx, 'Why does it stay alive?', { style: 'deep', lang: 'hi' });
    ok(p.includes("The reader's question:\n\"\"\"\nWhy does it stay alive?\n\"\"\""), 'question');
    ok(p.includes(STYLES.deep.instruction) && p.includes(LANGUAGES.hi.instruction), 'style and language');
  });

  await test('new users and unknown settings get Layman + Hinglish', () => {
    eq(resolvePrefs(undefined), { style: 'layman', lang: 'hinglish' }, 'missing');
    eq(resolvePrefs({ style: 'bogus', lang: 'hi' }), { style: 'layman', lang: 'hi' }, 'bad style');
    eq(resolvePrefs({ style: 'exam', lang: 'xx', onboarded: true }), { style: 'exam', lang: 'hinglish' }, 'bad language');
    const p = buildPrompt(pageCtx, null);
    ok(p.includes(STYLES.layman.instruction) && p.includes(LANGUAGES.hinglish.instruction), 'no prefs given');
  });

  await test('a word selected inside a card is explained as part of that explanation', () => {
    const p = buildPrompt({ ...pageCtx, kind: 'card', selectedText: 'scope', metadata: { parentTerm: 'closure' } }, null, { style: 'layman', lang: 'hinglish' });
    ok(p.includes('an explanation of "closure" that was written for them'), 'parent explanation named');
    ok(p.includes(STYLES.layman.instruction) && p.includes(LANGUAGES.hinglish.instruction), 'same style and language');
  });

  // ---------- finding saved words in a page ----------
  const page = document.getElementById('page');
  const index = () => textIndex(page);
  const found = (saved) => {
    const ix = index();
    const hit = findSaved(ix, saved);
    return hit && { text: indexRange(ix, hit.start, hit.end).toString(), in: indexRange(ix, hit.start, hit.end).startContainer.parentElement.closest('p')?.id };
  };

  await test('a word split across nested elements (<b>clo</b>sure) is found as one word', () => {
    eq(found({ term: 'closure', before: 'A', after: 'in JavaScript keeps' }), { text: 'closure', in: 'a' }, 'match');
  });
  await test('repeated word: the surrounding text picks the right occurrence', () => {
    eq(found({ term: 'closure', before: 'The road', after: 'on Main Street lasts' }), { text: 'closure', in: 'b' }, 'road closure');
    eq(found({ term: 'closure', before: 'Every', after: 'captures its scope' }), { text: 'closure', in: 'c' }, 'every closure');
  });
  await test('repeated word without saved context: nothing is highlighted', () => {
    eq(found({ term: 'closure', before: '', after: '' }), null, 'ambiguous');
  });
  await test('repeated word whose saved context no longer matches any occurrence: nothing is highlighted', () => {
    eq(found({ term: 'closure', before: 'completely different words', after: 'nothing like this page' }), null, 'changed page');
  });
  await test('two occurrences that match equally well: nothing is highlighted', () => {
    const extra = document.createElement('p');
    extra.textContent = 'The road closure on Main Street lasts a week.';
    document.getElementById('dyn').append(extra);
    try {
      eq(found({ term: 'closure', before: 'The road', after: 'on Main Street lasts' }), null, 'tie');
    } finally {
      extra.remove();
    }
  });
  await test('a word that occurs once is found without context; a missing word is not', () => {
    eq(found({ term: 'Main Street' }), { text: 'Main Street', in: 'b' }, 'unique phrase');
    eq(found({ term: 'monad' }), null, 'absent');
  });
  await test('different whitespace and line breaks between the words of a phrase still match', () => {
    eq(found({ term: 'closure captures', before: 'Every', after: 'its scope' }), { text: 'closure  captures', in: 'c' }, 'phrase');
  });
  await test('whole words only, also in Devanagari: समझ is not found inside समझना', () => {
    eq(found({ term: 'समझ' }), { text: 'समझ', in: 'd' }, 'standalone word');
  });

  // ---------- saved-words store ----------
  const base = { term: 'closure', definition: 'A function that keeps its scope.', before: 'The road', after: 'on Main Street lasts', url: location.href, title: document.title, style: 'concise', lang: 'en', source: 'page' };
  await test('saving: a new word is stored with id, time and context; the same save again is not duplicated', async () => {
    const first = await vocabStore.save(base);
    ok(first.created && first.entry.id && first.entry.createdAt, 'created');
    eq(first.entry.url, pageKey(location.href), 'page address');
    const again = await vocabStore.save({ ...base, url: `${location.href}#elsewhere` });
    ok(!again.created && again.entry.id === first.entry.id, 'same entry');
    eq((await vocabStore.all()).length, 1, 'one entry');
  });
  await test('saving the same word in another language or place keeps both meanings', async () => {
    ok((await vocabStore.save({ ...base, lang: 'hi', definition: 'हिंदी में अर्थ' })).created, 'other language');
    ok((await vocabStore.save({ ...base, before: 'A', after: 'in JavaScript keeps' })).created, 'other place');
    const all = await vocabStore.all();
    eq(all.length, 3, 'three entries');
    ok(all.some((e) => e.lang === 'en' && e.definition === base.definition), 'English definition untouched');
  });
  await test('editing a note and deleting a word', async () => {
    const [e] = await vocabStore.all();
    await vocabStore.update(e.id, { note: 'my note' });
    eq((await vocabStore.all()).find((x) => x.id === e.id).note, 'my note', 'note');
    await vocabStore.remove(e.id);
    ok(!(await vocabStore.all()).some((x) => x.id === e.id), 'deleted');
  });

  // ---------- highlight on the page ----------
  const highlighted = () => [...(CSS.highlights.get('arth-saved') || [])].map((r) => `${r.toString()}@${r.startContainer.parentElement.closest('p')?.id}`).sort();
  await test('saved words are highlighted where they were saved, and only there', async () => {
    await __fake.reset();
    await vocabStore.save(base);
    await until(() => highlighted().length === 1, 'highlight');
    eq(highlighted(), ['closure@b'], 'highlight');
  });
  await test('an ambiguous saved word changes nothing on the page', async () => {
    await vocabStore.save({ ...base, before: '', after: '', source: 'card', lang: 'hi' });
    await sleep(300);
    eq(highlighted(), ['closure@b'], 'unchanged');
  });
  await test('a saved word that appears later (dynamic content) is highlighted when it arrives', async () => {
    await vocabStore.save({ ...base, term: 'Zeitgeist', before: '', after: '', source: 'card' });
    await sleep(300);
    eq(highlighted(), ['closure@b'], 'not there yet');
    const p = document.createElement('p');
    p.id = 'late';
    p.textContent = 'The Zeitgeist arrives late.';
    document.getElementById('dyn').append(p);
    await until(() => highlighted().length === 2, 'late highlight');
    eq(highlighted(), ['Zeitgeist@late', 'closure@b'], 'both');
    p.remove();
    await until(() => highlighted().length === 1, 'removed with its text');
  });
  await test('deleting all saved words removes every highlight', async () => {
    for (const e of await vocabStore.all()) await vocabStore.remove(e.id);
    await until(() => !CSS.highlights.has('arth-saved'), 'no highlight');
  });

  // ---------- theme ----------
  await test('the card and the tooltip follow light and dark pages', () => {
    const hosts = [...document.querySelectorAll('[data-ask-ai]')].map((h) => h.shadowRoot);
    const card = hosts.find((r) => r.querySelector('.card')).querySelector('.card');
    const tip = hosts.find((r) => r.querySelector('.tip')).querySelector('.tip');
    const bg = (el, scheme) => {
      document.documentElement.style.colorScheme = scheme;
      return getComputedStyle(el).backgroundColor;
    };
    try {
      for (const el of [card, tip]) {
        eq(bg(el, 'light'), 'rgb(255, 255, 255)', 'light');
        eq(bg(el, 'dark'), 'rgb(30, 32, 38)', 'dark');
      }
    } finally {
      document.documentElement.style.colorScheme = '';
    }
  });

  window.__unit = results;
  const failed = results.filter((r) => !r.pass);
  document.getElementById('out').textContent =
    `${results.length - failed.length}/${results.length} passed\n\n` +
    results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '\n      ' + r.error}`).join('\n');
})();
