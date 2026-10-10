# Arth (local build) — not for distribution

This folder is the local build of Arth, version 0.3.0. It is what the "Arth (ChatGPT)" desktop shortcut runs.

## What it does

- On any web page, select text. Two buttons appear under the selection:
  - **Arth** explains the selected text in the context of the page.
  - **Ask** opens a box where you type your own question about the selection.
- After an answer, the box stays in the card so you can ask another question about the same selection.
- Click the Arth icon in Chrome's toolbar to ask a question about the page with nothing selected.
- Escape, or a click anywhere else, closes the card.

## How it gets answers

It opens a background `chatgpt.com` tab, types the prompt into the ChatGPT web page and reads the reply from the page. No API key is needed.

OpenAI's Terms of Use do not allow programmatic extraction of output from its services other than through the API. This build is therefore for personal, local use only and must not be published or distributed. The version meant for publication is in the repository root; it uses the OpenAI API and works only on chatgpt.com.

## What it reads

Only when you click one of its buttons: the selected text, some of the text around it, the page's title and site name, and, if you ask with nothing selected, the first 3,000 characters of the page's main text. That is sent to ChatGPT in the background tab. Nothing is read from password fields or form inputs.

Nothing in this folder is included in the release package.
