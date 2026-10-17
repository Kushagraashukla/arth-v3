# Arth (local build) — not for distribution

This folder is the local build of Arth, version 0.3.0. It is what the "Arth (ChatGPT)" desktop shortcut runs.

## What it does

- On any web page, select text. Two buttons appear under the selection:
  - **Arth** explains the selected text in the context of the page.
  - **Ask** opens a box where you type your own question about the selection.
- After an answer, the box stays in the card so you can ask another question about the same selection.
- Click the Arth icon in Chrome's toolbar to ask a question about the page with nothing selected.
- Escape, or a click anywhere else, closes the card.

### First-time guide

- On install, a welcome page (`src/guide.html`) opens with the six steps in Hinglish and a link to a practice page.
- The same six steps then appear live, one small tip at a time, next to the real control on the card: select a word, Arth/Ask, the style menu, the language menu, selecting a word inside the answer, Save, and Words. A step ends when the user does it, or with Next; "Skip guide" ends the guide. It does not come back once finished.
- "Live tips dobara dikhao" on the welcome page shows the tips again.

### Explanation style and language

- Six styles: Concise, Layman (default), Simple + Analogy, Deep Dive, Technical, Exam Notes.
- Three languages: English, Hinglish (Roman script, default), हिंदी (Devanagari).
- The first explanation offers a one-time picker for both, next to the answer; Done applies the choices (rewriting that first answer if they differ) and Skip keeps the defaults. It does not come back.
- Both can be changed any time from the two menus at the top of the card. A change there rewrites the answer on show straight away, in the same card. A change on the Saved words page applies to the next explanation.
- All prompt wording is in `src/context.js` (`STYLES`, `LANGUAGES`, `buildPrompt`).

### Words inside an explanation, and saved words

- Select a word or short phrase inside an answer: a small "Arth" chip appears; it explains that word in a panel inside the same card. Words in that panel can be explained in turn (up to four levels); Back goes back, Close closes.
- "Save" (main card) and "Save word" (panel) keep the word with its explanation, a short snippet, the page, the style and the language. Saved definitions are never rewritten when the settings change.
- On a page where a word was saved from the page itself, Arth finds the same occurrence again by the text around it and marks it with a faint tint and dotted underline. Hover shows the saved definition; click or tap keeps it open; keyboard focus on a link containing it shows it too. If the word can't be told apart from other occurrences, nothing is marked.
- "Words" in the card, or the extension's Options, opens the Saved words page: search, notes, delete, link back to the page.
- Code: `src/vocab.js` (storage, matching, highlight, tooltip), `src/words.html` / `src/words.js` (the page).

### Look and motion

Sharp rectangular controls, one blue accent, light and dark versions that follow the page. Motion is short and only where it tells you something: the card unfolds from the side of the selection it belongs to, the answer turns over while it is rewritten in a new style or language, a small square turns in 3D while an answer is on its way, and Save turns over into Saved. All of it is switched off when the system asks for reduced motion.

### Tests

`node test/run-prototype.mjs` runs the unit tests and end-to-end steps in headless Chrome (needs Chrome installed; the extension APIs and AI answers are faked).

## How it gets answers

It opens a background `chatgpt.com` tab, types the prompt into the ChatGPT web page and reads the reply from the page. No API key is needed.

OpenAI's Terms of Use do not allow programmatic extraction of output from its services other than through the API. This build is therefore for personal, local use only and must not be published or distributed. The version meant for publication is in the repository root; it uses the OpenAI API and works only on chatgpt.com.

## What it reads

Only when you click one of its buttons: the selected text, some of the text around it, the page's title and site name, and, if you ask with nothing selected, the first 3,000 characters of the page's main text. That is sent to ChatGPT in the background tab. Nothing is read from password fields or form inputs.

Saved words stay in Chrome's local extension storage on this computer: the word, its explanation, about 200 characters of text around it, and the page's address and title. On a page you saved words from, Arth reads the page's visible text locally to find them again; none of that is sent anywhere.

Nothing in this folder is included in the release package.
