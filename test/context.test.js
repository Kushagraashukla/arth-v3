// Runs in context-fixture.html. No framework: each test throws on failure.
const root = document.getElementById('root');
const results = [];

function mount(id) {
  root.replaceChildren(document.getElementById(id).content.cloneNode(true));
  const long = root.querySelector('#long');
  // 40 numbered sentences, ~2000 chars, with one unique word in the middle.
  if (long) long.textContent = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about ${i === 20 ? 'zygomorphic' : 'ordinary'} things.`).join(' ');
}

// [textNode, offset] of the first occurrence of `str` under `scope`.
function find(scope, str, atEnd = false) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.data.indexOf(str);
    if (i >= 0) return [n, atEnd ? i + str.length : i];
  }
  throw new Error(`fixture text not found: ${str}`);
}

function setSelection(startNode, startOffset, endNode, endOffset) {
  const r = document.createRange();
  r.setStart(startNode, startOffset);
  r.setEnd(endNode, endOffset);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
// Select from the start of `from` to the end of `to` (may be in different text nodes).
const select = (scope, from, to = from) => setSelection(...find(scope, from), ...find(scope, to, true));

const turn = (n) => root.querySelector(`[data-testid="conversation-turn-${n}"]`);
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (cond, what) => {
  if (!cond) throw new Error(what);
};
const nearbyShape = (ctx) => ctx.nearbyMessages.map((m) => `${m.offset}:${m.available ? m.role : 'UNAVAILABLE'}`);

function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}

// ---------- logged-in UI ----------
mount('logged-in');

test('one word in an assistant message', () => {
  select(turn(4), 'remembers');
  const c = extractSelectionContext();
  eq(c.selectedText, 'remembers', 'selectedText');
  eq([c.sourceMessage.role, c.sourceMessage.turn], ['assistant', 4], 'source');
  ok(c.surroundingText.before.endsWith('when a function '), 'before: ' + c.surroundingText.before);
  ok(c.surroundingText.after.startsWith(' variables from its outer scope'), 'after: ' + c.surroundingText.after);
  eq(c.metadata.inCode, false, 'inCode');
  eq(c.metadata.title, 'Fixture conversation title', 'title');
  ok(c.selectionRange instanceof Range, 'selectionRange is a live Range');
});

test('phrase spanning several text nodes (plain → bold)', () => {
  select(turn(4), 'A ', 'closure');
  const c = extractSelectionContext();
  eq(c.selectedText, 'A JavaScript closure', 'selectedText');
  eq(c.surroundingText.before, '', 'before');
  ok(c.surroundingText.after.startsWith(' is created'), 'after');
});

test('text inside a markdown link', () => {
  select(turn(4), 'MDN: Closures');
  const c = extractSelectionContext();
  eq(c.selectedText, 'MDN: Closures', 'selectedText');
  ok(c.surroundingText.before.endsWith('See '), 'before');
});

test('text inside a list item keeps the paragraph before it as context', () => {
  select(turn(4), 'data private');
  const c = extractSelectionContext();
  eq(c.selectedText, 'data private', 'selectedText');
  ok(c.surroundingText.before.includes('for details.') && c.surroundingText.before.endsWith('closures keep '), 'before: ' + c.surroundingText.before);
});

test('text inside a code block', () => {
  select(turn(4), 'let', ' count =');
  const c = extractSelectionContext();
  eq(c.selectedText, 'let count =', 'selectedText');
  eq(c.metadata.inCode, true, 'inCode');
  ok(c.surroundingText.before.includes('counter() {'), 'before keeps code');
});

test('table cell: neighbouring cells stay separated in the context', () => {
  select(turn(4).querySelector('table'), 'Hoisting');
  const c = extractSelectionContext();
  eq(c.selectedText, 'Hoisting', 'selectedText');
  ok(/Concept\s+Main idea\s+$/.test(c.surroundingText.before), 'before: ' + JSON.stringify(c.surroundingText.before.slice(-40)));
  ok(/^\s+Declarations move up/.test(c.surroundingText.after), 'after: ' + JSON.stringify(c.surroundingText.after.slice(0, 40)));
});

test('user message: role, turn, and unmounted earlier turn is reported, not invented', () => {
  select(turn(3), 'closure');
  const c = extractSelectionContext();
  eq([c.sourceMessage.role, c.sourceMessage.turn], ['user', 3], 'source');
  eq(c.sourceMessage.text, 'What is a closure in JavaScript?', 'user text excludes the "You said:" heading');
  eq(nearbyShape(c), ['-1:UNAVAILABLE', '1:assistant'], 'nearby');
});

test('gap in turn numbers on both sides is reported as unavailable', () => {
  select(turn(4), 'remembers');
  eq(nearbyShape(extractSelectionContext()), ['-2:UNAVAILABLE', '-1:user', '1:UNAVAILABLE'], 'nearby');
});

test('last message: no later neighbour is claimed; gap before is reported', () => {
  select(turn(7), 'zygomorphic');
  eq(nearbyShape(extractSelectionContext()), ['-2:UNAVAILABLE', '-1:user'], 'nearby');
});

test('limits: long message is clipped deterministically around the selection', () => {
  select(turn(7), 'zygomorphic');
  const c = extractSelectionContext();
  const L = CONTEXT_LIMITS;
  eq([c.surroundingText.before.length, c.surroundingText.after.length], [L.passageSide, L.passageSide], 'passage sides');
  eq([c.sourceMessage.truncatedStart, c.sourceMessage.truncatedEnd], [true, true], 'truncation flags');
  eq(c.sourceMessage.text.length, 2 * L.messageSide + 'zygomorphic'.length, 'message excerpt length');
  ok(c.sourceMessage.text.includes('about zygomorphic things'), 'excerpt is centred on the selection');
});

test('limits: long neighbour is cut to nearbyText and flagged', () => {
  select(turn(6), 'hoisting');
  const next = extractSelectionContext().nearbyMessages.find((m) => m.offset === 1);
  eq([next.text.length, next.truncated], [CONTEXT_LIMITS.nearbyText, true], 'neighbour');
});

test('triple-click style selection ending just outside the body is accepted', () => {
  const [start, so] = find(turn(4), 'Closures power');
  setSelection(start, so, turn(6).parentElement, 0); // end sits in the next turn at offset 0
  const c = extractSelectionContext();
  eq(c.selectedText, 'Closures power many patterns.', 'selectedText');
  eq(c.sourceMessage.turn, 4, 'turn');
});

test('collapsed, absent and whitespace-only selections → EMPTY', () => {
  const [n, o] = find(turn(4), 'remembers');
  setSelection(n, o, n, o);
  eq(extractSelectionContext(), { error: 'EMPTY' }, 'collapsed');
  getSelection().removeAllRanges();
  eq(extractSelectionContext(), { error: 'EMPTY' }, 'no range');
  const ws = turn(4).querySelector('ul').firstChild; // the "\n" text node before the first <li>
  setSelection(ws, 0, ws, ws.length);
  eq(extractSelectionContext(), { error: 'EMPTY' }, 'whitespace only');
});

test('selection outside any message → NOT_IN_MESSAGE', () => {
  select(document.getElementById('side'), 'someone@example.com');
  eq(extractSelectionContext(), { error: 'NOT_IN_MESSAGE' }, 'sidebar');
  select(turn(4).querySelector('h4'), 'ChatGPT said:');
  eq(extractSelectionContext(), { error: 'NOT_IN_MESSAGE' }, 'turn heading');
});

test('selection longer than the limit → TOO_LONG', () => {
  select(turn(7), 'Sentence number 0', 'Sentence number 12');
  eq(extractSelectionContext(), { error: 'TOO_LONG' }, 'long');
});

test('selection spanning two messages → NOT_WITHIN_ONE_MESSAGE', () => {
  setSelection(...find(turn(3), 'closure'), ...find(turn(4), 'remembers', true));
  eq(extractSelectionContext(), { error: 'NOT_WITHIN_ONE_MESSAGE' }, 'cross-message');
});

test('privacy: nothing outside message bodies is collected', () => {
  select(turn(4), 'remembers');
  const json = JSON.stringify(extractSelectionContext());
  ok(!json.includes('someone@example.com') && !json.includes('secret-input-value'), 'leaked sidebar/input text');
  ok(!json.includes('ChatGPT said') && !json.includes('You said'), 'leaked headings');
});

test('after the conversation DOM is replaced (SPA navigation) nothing stale is returned', () => {
  select(turn(4), 'remembers');
  const old = extractSelectionContext();
  mount('logged-in'); // new nodes, same content
  // A live Range whose nodes were removed collapses onto the surviving ancestor.
  eq(old.selectionRange.collapsed, true, 'old range is detectably stale');
  eq(extractSelectionContext(), { error: 'EMPTY' }, 'fresh call after navigation');
});

// ---------- prompt builder ----------
const promptFor = (scope, from, to) => {
  select(scope, from, to);
  const { selectionRange, ...context } = extractSelectionContext();
  return buildPrompt(context);
};

test('prompt: marks the selection in its passage and states the task', () => {
  const p = promptFor(turn(4), 'remembers');
  ok(p.includes('Selected text:\n"""\nremembers\n"""'), 'selected text block');
  ok(p.includes('when a function [[remembers]] variables from its outer scope'), 'marked passage');
  ok(p.includes('written by the assistant'), 'source role');
  ok(/specifically in this passage/.test(p) && /generic dictionary definition/.test(p) && /explanation only/.test(p), 'task wording');
});

test('prompt: nearby messages in order, unavailable ones labelled, nothing invented', () => {
  const p = promptFor(turn(4), 'remembers');
  const block = p.slice(p.indexOf('Nearby messages'));
  const order = ['[a message here exists but is not available]', 'User: What is a closure in JavaScript?', '[the message containing the passage]', '[a message here exists but is not available]'];
  let at = -1;
  for (const piece of order) {
    const next = block.indexOf(piece, at + 1);
    ok(next > at, 'missing or out of order: ' + piece);
    at = next;
  }
  ok(!p.includes('Now explain hoisting'), 'turn 6 lies beyond a gap and must not appear');
});

test('prompt: long neighbour is marked as cut; worst case fits the 8000-char worker limit', () => {
  const p = promptFor(turn(6), 'hoisting');
  ok(p.includes(' […]'), 'truncation marker');
  const worst = promptFor(turn(7), 'Sentence number 20', 'Sentence number 24'); // near the selection limit, long message
  ok(worst.includes('A longer excerpt of the same message'), 'wider excerpt included when it adds text');
  ok(worst.length < 8000, 'prompt length ' + worst.length);
});

test('prompt: no wider excerpt when it would only repeat the passage', () => {
  ok(!promptFor(turn(3), 'closure').includes('A longer excerpt'), 'short user message');
});

// ---------- logged-out UI (no turn numbers) ----------
mount('anon');

test('logged-out UI: roles work, turn is null, no unavailable neighbours are claimed', () => {
  select(root, 'idempotent operation');
  const c = extractSelectionContext();
  eq([c.sourceMessage.role, c.sourceMessage.turn], ['assistant', null], 'source');
  eq(c.nearbyMessages.map((m) => [m.offset, m.available, m.role, m.text]), [[-1, true, 'user', 'What does idempotent mean?']], 'nearby');
});

test('logged-out UI: selection in the user message', () => {
  select(root, 'idempotent mean');
  const c = extractSelectionContext();
  eq(c.sourceMessage.role, 'user', 'role');
  eq(nearbyShape(c), ['1:assistant'], 'nearby');
});

getSelection().removeAllRanges();
window.__results = results;
const failed = results.filter((r) => !r.pass);
document.getElementById('out').textContent =
  `${results.length - failed.length}/${results.length} passed\n\n` +
  results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '\n      ' + r.error}`).join('\n');
