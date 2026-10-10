# Arth — Chrome Web Store listing draft (version 0.2.0)

Everything below is ready to paste into the developer dashboard. Items in [square brackets] are yours to fill in.

**Scope: ChatGPT conversations only.** Arth's reader runs on chatgpt.com and nowhere else.

**How it gets answers: the OpenAI API, with the user's own API key.** Arth does not operate the ChatGPT website. Nothing in this listing should suggest that it uses the user's ChatGPT subscription.

---

## Store listing tab

**Name**

Arth

**Summary** (the manifest `description`; 111 of 132 characters; already in the package)

Select a word or phrase in a ChatGPT conversation and get a short explanation of what it means in that context.

**Detailed description**

Understand what you're reading.

Arth is a companion for reading ChatGPT conversations: it explains a word or phrase in the context where it appears. Select any word or short phrase in a conversation on chatgpt.com and click the small "Arth" button that appears next to it. A short explanation appears beside your selection, written for that passage, not a generic dictionary definition.

How it works
• Select a word or phrase (up to 300 characters) inside a message in a ChatGPT conversation.
• Click "Arth".
• Arth sends your selection and a little of the surrounding conversation to the OpenAI API and shows the answer in a small card next to your selection.
• Press Escape or click elsewhere to close it.

What it is good for
• Technical terms, acronyms and jargon in a long answer
• A phrase whose meaning depends on the sentence around it
• Code identifiers and snippets
• Words in another language

What you need
• An OpenAI API key. Arth uses the OpenAI API, which is separate from a ChatGPT subscription and is billed by OpenAI to your own API account. A typical explanation costs a small fraction of a cent.
• Arth's setup page opens when you install it. It explains what is sent, and asks you to paste your key and confirm.

Things to know before you install
• Arth works only on chatgpt.com, and only on text inside conversation messages. It does nothing on other websites.
• Your selected text and nearby conversation text are sent to OpenAI when you click Arth. Nothing is sent before you finish setup and click.
• Your API key is stored only in your browser and is sent only to api.openai.com.
• Arth has no server, no account, no analytics and no ads. Its developer receives nothing.
• Arth only reads the page. It does not click, type into or otherwise operate ChatGPT.

Arth is an independent project. It is not affiliated with, endorsed by, or produced by OpenAI. "ChatGPT" and "OpenAI" are trademarks of OpenAI and are used here only to describe the services Arth works with.

**Feature bullets**

• Explains a selected word or phrase in the context where it appears
• One click, next to your selection; no pop-up window, no side panel
• Uses the surrounding passage and nearby messages, so the answer fits the conversation
• Works with terms, phrases, code and other languages
• Uses your own OpenAI API key; no Arth account or server
• No analytics, no ads
• Light and dark themes follow the page

**Category**

Tools (under Productivity). Alternative: Education.

**Language**

English

**Search keywords**

The Chrome Web Store has no keyword field; search uses the name, summary and description. Do not add a keyword list.

**Support**

Support email: [your support email]
Support URL (optional): [a page or issue tracker, if you have one]

Suggested support text:

> If an explanation does not appear:
> 1. Click the Arth icon in Chrome's toolbar to open its setup page and check that a key is saved and the box is ticked.
> 2. Use "Check key" there. It tells you whether OpenAI accepts the key and which models it can use.
> 3. If Arth says your OpenAI account has no credit, add credit to your OpenAI API account.
> 4. If Arth says it was updated, reload the page you are reading.
> For anything else, write to [your support email] and include your Chrome version.

---

## Privacy practices tab

**Single purpose**

Arth explains a word or phrase that the user selects in a ChatGPT conversation, in the context of that conversation.

**Permission justifications**

| Item | Justification |
|---|---|
| `storage` | Stores, in the browser only, the user's OpenAI API key, their choice of model, and a flag that they agreed to the data use. No conversation text, selections or answers are stored. |
| Host permission `https://api.openai.com/*` | The extension's service worker sends the explanation request to the OpenAI API and receives the answer. This is the only host the extension contacts. |
| Content scripts on `https://chatgpt.com/*` | Arth's reader runs on this site only. It detects a text selection inside a conversation message, shows the Arth button, and, when the user clicks, reads the selected text and a bounded amount of nearby conversation text. It does not click, type into or otherwise operate the page. |

**Remote code**

No. All code is in the package. Arth does not load or evaluate any remote script. Its only network requests are JSON API calls to api.openai.com.

**Data usage** (suggested answers; please confirm they match your own reading of the categories)

- Website content: **Yes.** Text of the conversation the user is reading (the selection and nearby text), only when the user clicks Arth.
- Personal communications: **Yes, to be conservative.** A ChatGPT conversation can be regarded as a chat message history.
- Authentication information: **Yes.** The user's own OpenAI API key, which they enter. It is stored locally and sent only to api.openai.com.
- Personally identifiable information, health, financial and payment, location, web history, user activity: **No.** Note that conversation text can incidentally contain anything the user wrote there.

Certifications to tick:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

The one transfer that does happen, and should be stated plainly: the selected text and nearby conversation text are sent to the OpenAI API to produce the explanation, authenticated with the user's own key. That is the extension's single purpose, it happens only on the user's click, and only after the user has agreed on the setup page.

**Privacy policy URL**

[URL where you host the text in `privacy-policy.md`]

---

## Third-party service disclosure

Arth relies on one third-party service: the OpenAI API (api.openai.com), operated by OpenAI. Requests are made from the user's browser with the user's own API key and are billed to the user's OpenAI account. Content sent this way is handled by OpenAI under its API terms and privacy policy. Arth has no server of its own.

---

## Test instructions for reviewers

Arth needs an OpenAI API key to produce an explanation. [Provide a test key here, with a small spending limit, or state that reviewers may use their own.]

1. Install. The setup page opens. Paste the key, click "Check key", tick the box, click "Save".
2. Open https://chatgpt.com (no sign-in needed) and send any question, for example "Explain inflation in 100 words."
3. In the reply, double-click a word. A small "Arth" button appears just below it. Click it.
4. "Thinking…" is shown, then a short explanation.
5. Press Escape or click elsewhere to dismiss.

Without a saved key, step 3 shows "Arth needs a one-time setup before it can explain text." and sends nothing.

---

## Screenshot plan

In `store/screenshots/`, 1280 × 800, 24-bit PNG.

| Order | File | Shows | Status |
|---|---|---|---|
| 1 | `3-contextual-answer.png` | The explanation card beside the selected word | **Re-capture.** Taken with the 0.1 prototype. The card looks the same in 0.2, but capture a fresh one once a real API key has been used. |
| 2 | `1-select-text.png` | The Arth button under a selection | Current |
| 3 | `0-setup.png` | The setup page: what is sent, key, consent | Current (0.2) |
| 4 | `2-thinking.png` | The loading state | Current |
| 5 | `4-dark-theme.png` | The card on a dark page | **Re-capture**, same reason as 1 |

---

## Store asset checklist

| Asset | Requirement | Status |
|---|---|---|
| Extension package (ZIP) | Required | Ready: `dist/arth-0.2.0.zip` |
| Store icon, 128 × 128 PNG | Required | Ready: `icons/icon128.png` |
| Screenshots, 1280 × 800 (1 to 5) | At least one required | Three current, two to re-capture (see plan) |
| Small promo tile, 440 × 280 | Listed as required in the image guidelines | Ready: `store/promo-small-440x280.png` |
| Marquee promo tile, 1400 × 560 | Optional | Not made |
| Summary and detailed description | Required | Drafted above |
| Single purpose, justifications, remote code, data usage | Required | Drafted above |
| Privacy policy URL | Required | Text ready in `privacy-policy.md`; needs hosting by you |
| Reviewer test key | Needed for review | [yours] |
| Developer account, fee, 2-step verification, verified email | Required | Yours to do |

---

## Submission steps (in order)

Steps 1 to 3 and step 10 need your own account, payment and approval. Nothing here has been done on your behalf.

1. **Verify with a real key first.** Install the unpacked extension, complete setup with your own OpenAI API key, and confirm an explanation appears. This has not been tested against the real OpenAI API.
2. **Developer account.** Sign in at https://chrome.google.com/webstore/devconsole, accept the developer agreement and pay the one-time registration fee.
3. **Account settings.** Turn on 2-step verification; set the publisher name; verify the contact email.
4. **Privacy policy.** Host the text of `privacy-policy.md` on a public page, with the three placeholders filled in.
5. **Upload** `dist/arth-0.2.0.zip` as a new item.
6. **Store listing tab.** Paste the description, choose category and language, upload the icon, screenshots and promo tile, enter the support email.
7. **Privacy practices tab.** Paste the single purpose, justifications and remote-code answer; tick the data-usage boxes and certifications; enter the privacy policy URL.
8. **Distribution tab.** Free. "Unlisted" or "Private" lets you try a real store install before going public.
9. **Test instructions tab.** Paste the reviewer instructions, including a test key.
10. **Submit for review.** Untick automatic publishing if you want to choose the release moment.
