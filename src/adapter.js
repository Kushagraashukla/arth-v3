// Page knowledge for the READER: which conversation message a text selection is
// in, and where that message's own text lives. Read-only. Arth does not operate
// the ChatGPT interface in any way; this file never clicks, types or navigates.
// Selectors are ordered fallbacks: first match wins. (anon) = the signed-out UI,
// (logged-in) = the signed-in UI; the two are different apps.

const adapter = (() => {
  const SELECTORS = {
    message: [
      'li[data-message-role]', // (anon)
      '[data-message-author-role]', // (logged-in)
    ],
    answerText: ['[data-assistant-markdown]', '.markdown'], // (anon), (logged-in)
    userText: ['[data-user-message-copy]', '.whitespace-pre-wrap'], // (anon), (logged-in)
    // Wrapper whose data-testid ends in the turn's absolute number. (logged-in)
    turn: ['[data-testid^="conversation-turn-"]'],
  };
  const ROLE_ATTRS = ['data-message-role', 'data-message-author-role']; // (anon), (logged-in)

  const q = (key, root) => {
    for (const sel of SELECTORS[key]) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

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
  // the UI does not expose one. The page unmounts off-screen turns, so a gap in
  // turn numbers is the only evidence that a neighbour exists but is not in the DOM.
  function messageInfo(el) {
    const raw = ROLE_ATTRS.map((a) => el.getAttribute(a)).find(Boolean);
    const role = raw === 'user' || raw === 'assistant' ? raw : 'unknown';
    const body = q(role === 'user' ? 'userText' : 'answerText', el) || el;
    const n = parseInt(el.closest(SELECTORS.turn[0])?.getAttribute('data-testid').match(/\d+$/)?.[0], 10);
    return { role, body, turn: Number.isNaN(n) ? null : n };
  }

  // Messages currently mounted in the DOM, in document order. NOT the whole conversation.
  function messages() {
    for (const sel of SELECTORS.message) {
      const els = document.querySelectorAll(sel);
      if (els.length) return [...els];
    }
    return [];
  }

  return { messageAt, messageInfo, messages };
})();
