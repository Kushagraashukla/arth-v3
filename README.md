# Arth

Understand what you're reading.

Arth is a Chrome extension. Select a word or phrase in a ChatGPT conversation, click the small "Arth" button next to it, and get a short explanation of what it means in that passage.

Arth is an independent project. It is not affiliated with or endorsed by OpenAI.

## How it works

1. A content script on `chatgpt.com` notices a text selection inside a conversation message and shows the Arth button. It only reads the page; it never clicks, types or navigates.
2. On click, it builds a bounded prompt from the selection, the surrounding passage and up to three nearby messages.
3. The service worker sends that prompt to the OpenAI API with the user's own API key and returns the answer.
4. The answer is shown in a small card next to the selection.

Nothing is sent until the user has completed the setup page (API key and consent) and clicked the button. Arth has no server, no analytics and no account. See `store/privacy-policy.md`.

## Install for development

1. Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and select this folder.
2. The setup page opens. Paste an OpenAI API key, click "Check key", tick the box, click "Save".
3. Open a conversation on chatgpt.com and select some text.

Requires Chrome 123 or later.

## Layout

| Path | Purpose |
|---|---|
| `manifest.json` | Manifest V3 |
| `src/reader.js` | The button and answer card (Shadow DOM), selection handling |
| `src/context.js` | Selection to bounded context, and the prompt builder |
| `src/adapter.js` | The only file that knows the page's markup; read-only |
| `src/background.js` | Service worker: validation, queue, cancellation |
| `src/provider-openai.js` | The AI provider (OpenAI API). The only file that talks to an AI service |
| `src/options.html`, `src/options.js` | Setup page: disclosure, API key, consent |
| `test/` | Browser fixture tests for context extraction and prompt building |
| `store/` | Chrome Web Store listing draft, privacy policy draft, images |
| `prototype/` | The 0.1 prototype, kept for reference. Not for distribution; see its README |

To support another AI service, add a `src/provider-*.js` exposing `isReady`, `explain` and `listModels`, and point `provider` in `src/background.js` at it. The reader and context code do not change.

## Tests

Open `test/context-fixture.html` in Chrome. Results render on the page.

## Release package

Only `manifest.json`, `src/` and `icons/` ship.
