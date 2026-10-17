// Runs the v3 (prototype/) tests in headless Chrome:
//   1. the in-page unit tests in prototype.test.js;
//   2. end-to-end steps with real mouse and keyboard input. Arth ignores
//      synthetic clicks (isTrusted), so these go through the DevTools protocol.
// The extension APIs are replaced by fake-chrome.js; the AI answers are fixed text.
// Usage: node test/run-prototype.mjs        (CHROME=path to override the browser)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- static files from the repository root
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- headless Chrome and a minimal DevTools protocol client
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arth-test-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let port;
for (let i = 0; i < 100 && !port; i++, await sleep(100)) {
  try {
    port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  } catch {}
}
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
const waiters = [];
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  } else for (const w of waiters.filter((w) => w.method === msg.method)) waiters.splice(waiters.indexOf(w), 1), w.resolve(msg.params);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description || r.exceptionDetails.text} in: ${expression}`);
  return r.result.value;
}
async function until(expression, what, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) if (await evaluate(expression)) return;
  throw new Error(`timed out waiting for ${what}`);
}
async function load(url) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(15000).then(() => Promise.reject(new Error(`page did not load: ${url}`)))]);
  await evaluate(HELPERS);
}

// Page-side helpers: find our UI inside its shadow roots, and screen positions of words.
const HELPERS = `void (window.__ui = {
  root: () => [...document.querySelectorAll('[data-ask-ai]')].map((h) => h.shadowRoot).find((r) => r.querySelector('.card')),
  tip: () => [...document.querySelectorAll('[data-ask-ai]')].find((h) => h.shadowRoot.querySelector('.tip')),
  q: (sel) => __ui.root().querySelector(sel),
  shown: (el) => !!el && el.getClientRects().length > 0,
  button: (text) => [...__ui.root().querySelectorAll('button')].find((b) => b.textContent === text && __ui.shown(b)),
  center: (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
  word(scope, word) {
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.data.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + word.length);
      const b = r.getBoundingClientRect();
      return [b.left + b.width / 2, b.top + b.height / 2];
    }
    throw new Error('word not found: ' + word);
  },
  tipOpen: () => __ui.tip().matches(':popover-open'),
  saved: async () => (await chrome.storage.local.get('vocab')).vocab || [],
  prefs: async () => (await chrome.storage.local.get('prefs')).prefs || {},
  highlighted: () => [...(CSS.highlights.get('arth-saved') || [])].map((r) => r.toString()).sort(),
})`;

// ---- trusted input
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
async function click(x, y) {
  await mouse('mouseMoved', x, y, { button: 'none' });
  await mouse('mousePressed', x, y, { clickCount: 1 });
  await mouse('mouseReleased', x, y, { clickCount: 1 });
}
async function doubleClick(x, y) {
  await click(x, y);
  await mouse('mousePressed', x, y, { clickCount: 2 });
  await mouse('mouseReleased', x, y, { clickCount: 2 });
}
const moveTo = (x, y) => mouse('mouseMoved', x, y, { button: 'none' });
const key = async (k, code, keyCode, modifiers = 0) => {
  // Enter only submits a form when the key event carries its character.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, modifiers, ...(k === 'Enter' && { text: String.fromCharCode(13) }) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, modifiers });
};
// Waits for Arth's short open/turn animations to end, then clicks the element's centre.
const clickEl = async (expr) => {
  await until(`!(__ui.root?.()?.getAnimations?.() || []).some((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)`, 'animations to settle', 2000);
  return click(...(await evaluate(`__ui.center(${expr})`)));
};
const pageWord = async (id, word) => evaluate(`__ui.word(document.getElementById('${id}'), '${word}')`);
const cardWord = async (sel, word) => evaluate(`__ui.word(__ui.q('${sel}'), '${word}')`);

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}
const check = (cond, what) => {
  if (!cond) throw new Error(what);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(root, 'test/fake-chrome.js'), 'utf8') });
  const fixture = `${base}/test/prototype-fixture.html`;

  // 1. unit tests
  await load(fixture);
  await until('Array.isArray(window.__unit)', 'unit tests', 30000);
  for (const r of await evaluate('window.__unit')) results.push({ ...r, name: `unit: ${r.name}` });

  // 2. end to end
  await evaluate('__fake.reset()');
  await evaluate('chrome.storage.local.set({ tour: 6 })'); // the guide has its own steps below
  const e2e = `${fixture}?e2e`;
  await load(e2e);
  const asks = () => evaluate('__fake.asks.length');
  const lastPrompt = () => evaluate('__fake.asks.at(-1).prompt');
  const STYLE = (k) => evaluate(`STYLES.${k}.instruction`);
  const LANG = (k) => evaluate(`LANGUAGES.${k}.instruction`);

  await step('selecting a word on the page shows the Arth bar', async () => {
    await doubleClick(...(await pageWord('a', 'alive')));
    await until(`__ui.shown(__ui.q('.bar'))`, 'bar');
  });
  await step('Arth explains it, streaming first; the first time, the style and language picker shows alongside without blocking', async () => {
    await clickEl(`__ui.button('Arth')`);
    await until(`__ui.shown(__ui.q('.onboard'))`, 'picker');
    await until(`__ui.q('.card').dataset.state === 'streaming'`, 'streaming text', 2000);
    await until(`__ui.q('.card').dataset.state === 'answer'`, 'answer');
    check(await evaluate(`__ui.shown(__ui.q('.onboard'))`), 'picker still offered next to the answer');
    const p = await lastPrompt();
    check(p.includes(await STYLE('layman')) && p.includes(await LANG('hinglish')), 'default Layman + Hinglish');
  });
  await step('picking a style and language in the picker rewrites the answer in them, in the same card', async () => {
    const n = await asks();
    await clickEl(`__ui.button('Simple + Analogy')`);
    await sleep(500); // longer than the rewrite delay: picking alone must not rewrite yet
    check((await asks()) === n, 'no rewrite before Done');
    await clickEl(`__ui.button('English')`);
    await clickEl(`__ui.button('Done')`);
    await until(`__ui.prefs().then((p) => p.onboarded)`, 'saved settings');
    const prefs = await evaluate('__ui.prefs()');
    check(prefs.style === 'analogy' && prefs.lang === 'en', `saved ${JSON.stringify(prefs)}`);
    check(!(await evaluate(`__ui.shown(__ui.q('.onboard'))`)), 'picker closed');
    await until(`__fake.asks.length > ${n} && __ui.q('.card').dataset.state === 'answer'`, 'rewritten answer');
    const p = await lastPrompt();
    check(p.includes(await STYLE('analogy')) && p.includes(await LANG('en')), 'Simple + Analogy, English');
    check(p.includes('Selected text:\n"""\nalive'), 'same selection');
    check(await evaluate(`__ui.shown(__ui.q('.card'))`), 'same card stayed open');
  });
  await step('changing the style in the card menu rewrites the answer at once; the language stays', async () => {
    const n = await asks();
    await evaluate(`(() => { const s = __ui.q('select'); s.value = 'exam'; s.dispatchEvent(new Event('change')); })()`);
    await until(`__ui.prefs().then((p) => p.style === 'exam')`, 'saved style');
    check((await evaluate('__ui.prefs()')).lang === 'en', 'language unchanged');
    await until(`__fake.asks.length === ${n + 1} && __ui.q('.card').dataset.state === 'answer'`, 'rewritten answer');
    const p = await lastPrompt();
    check(p.includes(await STYLE('exam')) && p.includes(await LANG('en')) && p.includes('Selected text:\n"""\nalive'), 'Exam Notes, English, same selection');
  });
  await step('choosing the style that is already in use asks nothing', async () => {
    const n = await asks();
    await evaluate(`(() => { const s = __ui.q('select'); s.value = 'exam'; s.dispatchEvent(new Event('change')); })()`);
    await sleep(600);
    check((await asks()) === n, 'no new request');
  });
  await step('a word selected inside the card gets its own Arth chip; the page bar stays away', async () => {
    await doubleClick(...(await cardWord('.text', 'function')));
    await until(`__ui.shown(__ui.q('.chip'))`, 'chip');
    check(!(await evaluate(`__ui.shown(__ui.q('.bar'))`)), 'page bar hidden');
    check(await evaluate(`__ui.shown(__ui.q('.card'))`), 'card still open');
  });
  await step('the chip explains that word in a panel inside the card; the main answer and its scroll stay', async () => {
    const main = await evaluate(`[__ui.q('.text').textContent, __ui.q('.card').scrollTop]`);
    await clickEl(`__ui.q('.chip')`);
    await until(`__ui.shown(__ui.q('.sub')) && __ui.q('.sub').dataset.state === 'answer'`, 'panel answer');
    check((await evaluate(`__ui.q('.sub .term').textContent`)) === 'function', 'panel term');
    const p = await lastPrompt();
    check(p.includes('an explanation of "alive" that was written for them') && p.includes('Selected text:\n"""\nfunction'), 'word explained within its explanation');
    check(p.includes(await STYLE('exam')) && p.includes(await LANG('en')), 'current style and language');
    check((await evaluate(`__ui.q('.text').textContent`)) === main[0], 'main answer kept');
  });
  await step('the same word asked again while it is still being explained sends no second request', async () => {
    await clickEl(`__ui.q('.sub button')`); // ✕ close the panel
    await evaluate('__fake.delay = 1500');
    const n = await asks();
    await doubleClick(...(await cardWord('.text', 'function')));
    await until(`__ui.shown(__ui.q('.chip'))`, 'chip');
    await clickEl(`__ui.q('.chip')`);
    await doubleClick(...(await cardWord('.text', 'function')));
    await until(`__ui.shown(__ui.q('.chip'))`, 'chip again');
    await clickEl(`__ui.q('.chip')`);
    await sleep(200);
    check((await asks()) === n + 1, `requests: ${(await asks()) - n}`);
    await evaluate('__fake.delay = 60');
    await until(`__ui.q('.sub').dataset.state === 'answer'`, 'panel answer', 4000);
  });
  await step('a word inside the panel goes one level deeper; Back returns to the previous word', async () => {
    await doubleClick(...(await cardWord('.sub .text', 'specific')));
    await until(`__ui.shown(__ui.q('.chip'))`, 'chip in panel');
    await clickEl(`__ui.q('.chip')`);
    await until(`__ui.q('.sub .term').textContent === 'specific' && __ui.q('.sub').dataset.state === 'answer'`, 'deeper answer').catch(async (e) => {
      throw new Error(e.message + ' | ' + (await evaluate(`JSON.stringify([__ui.q('.sub .term').textContent, __ui.q('.sub').dataset.state, __ui.shown(__ui.q('.chip')), __fake.asks.length, __ui.q('.sub .text').textContent, String(__ui.root().getSelection?.())])`)));
    });
    check((await lastPrompt()).includes('an explanation of "function"'), 'explained within the panel text');
    check((await evaluate(`__ui.q('.sub button').textContent`)) === 'Back', 'back button');
    await clickEl(`__ui.q('.sub button')`);
    await until(`__ui.q('.sub .term').textContent === 'function'`, 'back to the first word');
  });
  await step('whitespace, punctuation and over-long selections inside the card get no chip', async () => {
    const chipFor = (start, end, block = '.text') =>
      evaluate(`(async () => {
        const t = __ui.q('${block}').firstChild;
        __ui.q('select').focus();
        getSelection().setBaseAndExtent(t, ${start}, t, ${end});
        return true;
      })()`).then(async () => {
        await key('Shift', 'ShiftLeft', 16);
        await sleep(50);
        return evaluate(`__ui.shown(__ui.q('.chip'))`);
      });
    const text = await evaluate(`__ui.q('.text').textContent`);
    const colon = text.indexOf(':');
    check(!(await chipFor(colon, colon + 1)), 'punctuation');
    check(!(await chipFor(colon + 1, colon + 2)), 'whitespace');
    await evaluate(`__ui.q('.sub .text').firstChild.data = 'x'.repeat(30) + ' ' + 'y'.repeat(60)`);
    check(!(await chipFor(0, 91, '.sub .text')), 'over 80 characters');
    const w = text.indexOf('function');
    check(await chipFor(w, w + 8), 'a real word does get the chip');
    await evaluate(`getSelection().removeAllRanges()`);
  });
  await step('Save word stores the panel word with the style and language it was explained in', async () => {
    await clickEl(`__ui.button('Save word')`);
    await until(`__ui.saved().then((v) => v.length === 1)`, 'saved');
    const [e] = await evaluate('__ui.saved()');
    check(e.term === 'function' && e.source === 'card' && e.style === 'exam' && e.lang === 'en' && e.definition.includes('specific'), JSON.stringify(e));
    check(e.snippet.includes('the function keeps'), `snippet spacing: ${e.snippet}`);
    check(await evaluate(`!!__ui.button('Saved')`), 'saved state shown');
  });
  await step('Save on the main card stores the page word with its context, and the page highlights it', async () => {
    await clickEl(`__ui.button('Save')`);
    await until(`__ui.saved().then((v) => v.length === 2)`, 'saved');
    const e = (await evaluate('__ui.saved()')).find((x) => x.term === 'alive');
    check(e.source === 'page' && e.before.includes('keeps variables') && e.after.includes('after the outer'), JSON.stringify(e));
    check(e.snippet.includes('variables alive after the outer'), `snippet keeps the page's spacing: ${e.snippet}`);
    await until(`__ui.highlighted().includes('alive')`, 'highlight');
  });
  await step('hovering a saved word shows its saved definition without asking the AI; leaving hides it after a short delay', async () => {
    await key('Escape', 'Escape', 27);
    await until(`!__ui.shown(__ui.q('.card'))`, 'card closed');
    const n = await asks();
    await moveTo(...(await pageWord('a', 'alive')));
    await until('__ui.tipOpen()', 'tooltip');
    const text = await evaluate(`__ui.tip().shadowRoot.textContent`);
    check(text.includes('alive') && text.includes('Arth explains alive'), text);
    await moveTo(5, 5);
    await sleep(80);
    check(await evaluate('__ui.tipOpen()'), 'grace period');
    await until('!__ui.tipOpen()', 'hidden after leaving', 1500);
    check((await asks()) === n, 'no AI request');
  });
  await step('clicking or tapping a saved word keeps its definition open until Escape', async () => {
    await click(...(await pageWord('a', 'alive')));
    await until('__ui.tipOpen()', 'tooltip');
    await moveTo(5, 5);
    await sleep(600);
    check(await evaluate('__ui.tipOpen()'), 'stays open');
    await key('Escape', 'Escape', 27);
    await until('!__ui.tipOpen()', 'closed by Escape');
  });
  await step('keyboard: a link containing a saved word shows the definition when focused', async () => {
    await evaluate(`vocabStore.save({ term: 'Idempotence', definition: 'Same result however often.', url: location.href, title: document.title, style: 'concise', lang: 'en', source: 'page' })`);
    await until(`__ui.highlighted().includes('Idempotence')`, 'highlight');
    await evaluate(`document.getElementById('link').focus()`);
    await until('__ui.tipOpen()', 'tooltip on focus');
    check((await evaluate(`__ui.tip().shadowRoot.textContent`)).includes('Same result however often.'), 'definition');
    await evaluate(`document.getElementById('link').blur()`);
    await until('!__ui.tipOpen()', 'hidden on blur');
  });
  await step('after a restart: the chosen style and language, the saved words and their highlights are back', async () => {
    await load(e2e);
    await until(`__ui.q('select').value === 'exam'`, 'style restored');
    check((await evaluate(`__ui.root().querySelectorAll('select')[1].value`)) === 'en', 'language restored');
    await until(`__ui.highlighted().includes('alive')`, 'highlight restored');
  });
  await step('no emoji anywhere in the card or bar; every button has square corners', async () => {
    const r = await evaluate(`(() => {
      const root = __ui.root();
      const text = [...root.querySelectorAll('button, option, .brand')].map((b) => b.textContent).join(' ');
      const round = [...root.querySelectorAll('button, select, input, .card')].filter((el) => getComputedStyle(el).borderRadius !== '0px').length;
      return { emoji: /\\p{Extended_Pictographic}/u.test(text), round };
    })()`);
    check(!r.emoji, 'emoji found');
    check(r.round === 0, `${r.round} rounded controls`);
  });
  await step('the first-use picker does not come back once answered', async () => {
    await doubleClick(...(await pageWord('b', 'buses')));
    await until(`__ui.shown(__ui.q('.bar'))`, 'bar');
    await clickEl(`__ui.button('Arth')`);
    await until(`__ui.q('.card').dataset.state === 'answer'`, 'answer');
    check(!(await evaluate(`__ui.shown(__ui.q('.onboard'))`)), 'no picker');
    check((await lastPrompt()).includes(await STYLE('exam')), 'restored style used');
  });
  await step('Ask: your own question uses the same style and language', async () => {
    await key('Escape', 'Escape', 27);
    await doubleClick(...(await pageWord('b', 'buses')));
    await until(`__ui.shown(__ui.q('.bar'))`, 'bar');
    await clickEl(`__ui.button('Ask')`);
    await until(`__ui.shown(__ui.q('input'))`, 'question box');
    await send('Input.insertText', { text: 'Why do they reroute?' });
    await key('Enter', 'Enter', 13);
    await until(`__ui.q('.card').dataset.state === 'answer'`, 'answer').catch(async (e) => {
      throw new Error(e.message + ' | ' + (await evaluate(`JSON.stringify([__ui.q('input').value, __ui.q('.card').dataset.state, __fake.asks.length, __ui.root().activeElement?.tagName, document.activeElement?.tagName])`)));
    });
    const p = await lastPrompt();
    check(p.includes('Why do they reroute?') && p.includes(await STYLE('exam')) && p.includes(await LANG('en')), 'question with style and language');
  });
  await step('changing the language while your own question is answered re-answers it in the new language', async () => {
    const n = await asks();
    await evaluate(`(() => { const s = __ui.root().querySelectorAll('select')[1]; s.value = 'hi'; s.dispatchEvent(new Event('change')); })()`);
    await until(`__fake.asks.length === ${n + 1} && __ui.q('.card').dataset.state === 'answer'`, 're-answer');
    const p = await lastPrompt();
    check(p.includes('Why do they reroute?') && p.includes(await LANG('hi')) && p.includes(await STYLE('exam')), 'same question, Hindi, same style');
    await evaluate(`(() => { const s = __ui.root().querySelectorAll('select')[1]; s.value = 'en'; s.dispatchEvent(new Event('change')); })()`);
    await until(`__fake.asks.length === ${n + 2} && __ui.q('.card').dataset.state === 'answer'`, 'back to English');
  });

  // Saved-words page, as the extension opens it.
  await load(`${base}/prototype/src/words.html`);
  await step('saved-words page lists the saved words and shows the current settings', async () => {
    await until(`document.querySelectorAll('#list li').length === 3`, 'three entries');
    check((await evaluate(`[document.getElementById('style').value, document.getElementById('lang').value].join()`)) === 'exam,en', 'settings shown');
  });
  await step('search filters by word, meaning and note', async () => {
    await evaluate(`(() => { const s = document.getElementById('search'); s.value = 'idem'; s.dispatchEvent(new Event('input')); })()`);
    check((await evaluate(`[...document.querySelectorAll('#list .term')].map((t) => t.textContent).join()`)) === 'Idempotence', 'one match');
    await evaluate(`(() => { const s = document.getElementById('search'); s.value = 'zzz'; s.dispatchEvent(new Event('input')); })()`);
    check(await evaluate(`!document.getElementById('empty').hidden && document.querySelectorAll('#list li').length === 0`), 'empty state');
    await evaluate(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input')); })()`);
  });
  await step('a note can be added and is saved', async () => {
    await clickEl(`document.querySelector('#list li textarea')`);
    await send('Input.insertText', { text: 'from the JS lesson' });
    await click(5, 5); // blur commits the note
    await until(`__ui.saved().then((v) => v.some((e) => e.note === 'from the JS lesson'))`, 'note saved');
  });
  await step('a word can be deleted, after an inline confirmation', async () => {
    const term = await evaluate(`document.querySelector('#list li .term').textContent`);
    await clickEl(`[...document.querySelectorAll('#list li button')].find((b) => b.textContent === 'Delete')`);
    await clickEl(`[...document.querySelectorAll('#list li button')].find((b) => b.textContent === 'Yes, delete')`);
    await until(`__ui.saved().then((v) => v.length === 2)`, 'deleted');
    check(!(await evaluate(`[...document.querySelectorAll('#list .term')].some((t) => t.textContent === ${JSON.stringify(term)})`)), 'gone from the list');
  });
  await step('changing the language on the saved-words page keeps the style', async () => {
    await evaluate(`(() => { const s = document.getElementById('lang'); s.value = 'hi'; s.dispatchEvent(new Event('change')); })()`);
    await until(`__ui.prefs().then((p) => p.lang === 'hi' && p.style === 'exam' && p.onboarded)`, 'saved');
  });

  // ---- the first-time guide
  const coach = `__ui.root().querySelector('.coach')`;
  const coachText = () => evaluate(`__ui.shown(${coach}) ? ${coach}.textContent : ''`);
  const coachedIs = (sel) => evaluate(`__ui.root().querySelector('.coached') === __ui.root().querySelector('${sel}')`);
  const coachClear = async () => {
    // the tip never sits on top of the card
    const r = await evaluate(`(() => { const a = ${coach}.getBoundingClientRect(), b = __ui.q('.card').getBoundingClientRect();
      return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom; })()`);
    check(r, 'tip overlaps the card');
  };
  await step('guide: a first-timer sees tip 1 of 6 at the Arth | Ask buttons', async () => {
    await evaluate(`chrome.storage.local.set({ vocab: [], tour: 0, prefs: { style: 'layman', lang: 'hinglish', onboarded: true } })`);
    await load(e2e);
    await doubleClick(...(await pageWord('a', 'alive')));
    await until(`__ui.shown(__ui.q('.bar')) && __ui.shown(${coach})`, 'tip');
    check((await coachText()).includes('1 / 6'), await coachText());
    check(await coachedIs('.bar'), 'bar outlined');
  });
  await step('guide: Arth moves it to tip 2 at the style menu, beside the card', async () => {
    await clickEl(`__ui.button('Arth')`);
    await until(`__ui.q('.card').dataset.state === 'answer' && __ui.shown(${coach})`, 'tip 2');
    check((await coachText()).includes('2 / 6'), await coachText());
    check(await coachedIs('select'), 'style menu outlined');
    await coachClear();
  });
  await step('guide: changing the style does the step; tip 3 is the language menu', async () => {
    const n = await asks();
    await evaluate(`(() => { const s = __ui.q('select'); s.value = 'exam'; s.dispatchEvent(new Event('change')); })()`);
    await until(`__fake.asks.length === ${n + 1} && __ui.q('.card').dataset.state === 'answer' && ${coach}.textContent.includes('3 / 6')`, 'tip 3 after the rewrite');
    check(await evaluate(`__ui.root().querySelector('.coached') === __ui.root().querySelectorAll('select')[1]`), 'language menu outlined');
  });
  await step('guide: Next goes on to tip 4, about words inside the answer', async () => {
    await clickEl(`[...${coach}.querySelectorAll('button')].find((b) => b.textContent === 'Next')`);
    await until(`${coach}.textContent.includes('4 / 6')`, 'tip 4');
    check(await coachedIs('.card > .text'), 'answer outlined');
  });
  await step('guide: explaining a word from the answer does step 4; tip 5 is Save', async () => {
    const at = await cardWord('.card > .text', 'function');
    await doubleClick(...at);
    await until(`__ui.shown(__ui.q('.chip'))`, 'chip');
    await clickEl(`__ui.q('.chip')`);
    await until(`__ui.q('.sub').dataset.state === 'answer' && ${coach}.textContent.includes('5 / 6')`, 'tip 5');
    check(await evaluate(`__ui.root().querySelector('.coached')?.textContent === 'Save'`), 'Save outlined');
  });
  await step('guide: saving does step 5; tip 6 is Words, and Done ends the guide for good', async () => {
    await clickEl(`__ui.button('Save')`);
    await until(`${coach}.textContent.includes('6 / 6')`, 'tip 6');
    await clickEl(`[...${coach}.querySelectorAll('button')].find((b) => b.textContent === 'Done')`);
    await until(`!__ui.shown(${coach})`, 'guide closed');
    check((await evaluate(`chrome.storage.local.get('tour').then((r) => r.tour)`)) === 6, 'stored as finished');
    await key('Escape', 'Escape', 27);
    await load(e2e);
    await doubleClick(...(await pageWord('b', 'buses')));
    await until(`__ui.shown(__ui.q('.bar'))`, 'bar');
    await sleep(300);
    check(!(await evaluate(`__ui.shown(${coach})`)), 'no tips after the guide');
  });
  await step('a saved word under the card or a tip does not open its tooltip over them', async () => {
    await evaluate(`chrome.storage.local.set({ tour: 0 })`);
    await load(e2e);
    await until(`__ui.highlighted().includes('alive')`, 'saved word highlighted');
    await doubleClick(...(await pageWord('b', 'buses')));
    await until(`__ui.shown(${coach})`, 'tip');
    // Put the tip right on top of the saved word, then hover and click there.
    const [x, y] = await pageWord('a', 'alive');
    await evaluate(`(() => { const c = ${coach}; c.style.left = '${x - 20}px'; c.style.top = '${y - 20}px'; })()`);
    await moveTo(x, y);
    await sleep(300);
    check(!(await evaluate('__ui.tipOpen()')), 'saved-word tooltip opened over the guide tip');
    await click(x, y);
    await sleep(100);
    check(await evaluate(`__ui.shown(${coach})`), 'card closed by a click on the tip');
    await key('Escape', 'Escape', 27);
  });
  await step('guide: Skip guide ends it at once', async () => {
    await evaluate(`chrome.storage.local.set({ tour: 0 })`);
    await load(e2e);
    await doubleClick(...(await pageWord('b', 'buses')));
    await until(`__ui.shown(${coach})`, 'tip');
    await clickEl(`[...${coach}.querySelectorAll('button')].find((b) => b.textContent === 'Skip guide')`);
    await until(`!__ui.shown(${coach})`, 'closed');
    check((await evaluate(`chrome.storage.local.get('tour').then((r) => r.tour)`)) === 6, 'stored as finished');
    check(await evaluate(`__ui.shown(__ui.q('.bar'))`), 'Arth still usable');
  });
  await step('guide page: six steps, no emoji, and "Live tips dobara dikhao" restarts the tips', async () => {
    await load(`${base}/prototype/src/guide.html`);
    check((await evaluate(`document.querySelectorAll('ol > li').length`)) === 6, 'six steps');
    check(!/\p{Extended_Pictographic}/u.test(await evaluate('document.body.textContent')), 'emoji found');
    await evaluate(`document.getElementById('restart').scrollIntoView({ block: 'center' })`);
    await clickEl(`document.getElementById('restart')`);
    await until(`chrome.storage.local.get('tour').then((r) => r.tour === 0)`, 'restarted');
  });
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `\n      ${r.error}`}`).join('\n'));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  ws.close();
  chrome.kill();
  server.close();
  // The throwaway browser profile: wait for Chrome to let go of it, then delete it.
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300);
    }
  }
  process.exitCode = failed.length || !results.length ? 1 : 0;
}
