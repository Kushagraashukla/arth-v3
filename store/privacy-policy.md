# Arth Privacy Policy

Effective date: [date]

Arth is a browser extension that explains a word or phrase you select in a ChatGPT conversation. This policy describes what Arth reads, where that goes, and what Arth does not do. It reflects what the extension's code does in version 0.2.0.

## Summary

- Arth reads text from the conversation you are viewing only when you click the Arth button.
- That text is sent from your browser directly to the OpenAI API, using an OpenAI API key that you provide. It is not sent to Arth's developer or to anyone else.
- Arth has no server. Its developer receives no data from the extension.
- Arth saves three things in your browser: your API key, your choice of model, and the fact that you agreed to the data use. It does not save your selections, the text it reads, or the explanations.
- Arth has no analytics, no tracking, no ads and no account.

## Where Arth runs

Arth's reading features run only on `https://chatgpt.com`. It does nothing on any other website.

On chatgpt.com, Arth watches for a text selection so it can show its button next to it. Checking whether a selection is inside a conversation message happens inside your browser; nothing is sent anywhere at that point.

Arth only reads the page. It does not click, type into, or otherwise operate the ChatGPT website.

## Consent

Arth sends nothing until you have completed its setup page, where you connect your own OpenAI API key and tick a box confirming you understand what is sent. Until then, clicking the Arth button only shows a prompt to finish setup.

## What Arth reads, and when

When you click the Arth button, and only then, Arth reads the following from the conversation on your screen:

- the text you selected (up to 300 characters);
- the text just before and after it in the same message (up to 300 characters on each side, and a longer excerpt of up to 600 characters on each side);
- up to three neighbouring messages from the same conversation (up to 500 characters each).

At the same moment the extension's code also notes the page's address and title in memory. These are not sent anywhere and are discarded.

Apart from that, Arth reads only the text of conversation messages. It does not read your ChatGPT account details, your list of other conversations, what you type into the message box, passwords, cookies, or anything on other websites.

A conversation can contain whatever you or the assistant wrote in it, so the text Arth reads may include personal information if the conversation does.

## Where that text is sent

Arth combines the text above with a short instruction into one request and sends it over HTTPS to the OpenAI API (`https://api.openai.com`), authenticated with your API key. OpenAI returns the explanation, which Arth shows next to your selection.

This means:

- The text does leave your browser: it is sent to OpenAI, a third party.
- OpenAI processes the request under its own API terms and privacy policy, as an API request made by your OpenAI account. Arth has no control over how OpenAI handles or retains it. Arth sets the API's `store: false` option, which asks OpenAI not to keep the request for later retrieval through the API; OpenAI's own retention rules still apply.
- OpenAI may charge your API account for each request.

Arth sends this text nowhere else. The extension contacts no host other than `api.openai.com`. Your browser's cookies are not sent with these requests.

## Your API key

You enter your OpenAI API key on Arth's setup page. It is stored in your browser's local extension storage, on your device, and is sent only to `api.openai.com` as the credential for your requests. It is never sent to Arth's developer. Pages you visit cannot read it. Anyone with access to your browser profile on your device could, so treat it like a password saved in the browser.

## What Arth stores

In your browser's local extension storage:

- your OpenAI API key;
- the model you chose;
- a flag recording that you ticked the consent box.

Arth does not store your selections, the conversation text it reads, the requests it sends, or the explanations it shows. They exist only in memory while a request is in progress and while the explanation card is open. Arth writes no logs.

## Sharing, selling and advertising

Arth's developer receives no data from the extension. Arth does not sell, rent or share your data with anyone other than sending the request to OpenAI as described. It does not use your data for advertising, profiling or any purpose other than producing the explanation you asked for.

## Analytics and tracking

None. Arth contains no analytics, telemetry, crash reporting or tracking code.

## Your control

- Nothing is read or sent until you finish setup and click the Arth button.
- Press Escape or click elsewhere to dismiss an explanation; a request still in progress is cancelled.
- "Remove key and settings" on the setup page deletes everything Arth has saved.
- You can revoke the API key in your OpenAI account at any time.
- You can disable or remove Arth from `chrome://extensions`. Removing it deletes its saved data.
- Requests Arth made with your key are held by OpenAI, not by Arth. Use your OpenAI account's settings and OpenAI's privacy controls to manage them.

## Permissions

- **Access to chatgpt.com**: to show the button and read the selected passage when you click.
- **Access to api.openai.com**: to send the request to the OpenAI API.
- **Storage**: to keep your API key, model choice and consent in your browser.

## Children

Arth is not directed at children and does not knowingly collect information from anyone.

## Changes to this policy

If Arth's behaviour changes in a way that affects this policy, this page will be updated and the effective date changed.

## Contact

[Your name or publisher name]
[Your contact email]

Arth is an independent project and is not affiliated with or endorsed by OpenAI.
