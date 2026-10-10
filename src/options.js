// Setup page: explains what Arth sends, stores the user's API key and consent.
// The key is written only to chrome.storage.local (this browser, this extension).

(() => {
  const $ = (id) => document.getElementById(id);
  const key = $('key');
  const model = $('model');
  const consent = $('consent');
  const status = $('status');
  const ERRORS = {
    INVALID_KEY: 'OpenAI did not accept this key. Check that you copied all of it.',
    NO_CREDIT: 'OpenAI accepted the key, but the account has no API credit.',
    RATE_LIMITED: 'OpenAI is limiting requests right now. Try again in a moment.',
    NOT_ALLOWED: 'OpenAI refused this key for your account or region.',
    NETWORK: 'Could not reach OpenAI. Check your connection.',
    TIMEOUT: 'OpenAI took too long to answer.',
  };

  const say = (text, kind = '') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };
  function setModels(ids, selected) {
    const list = [...new Set([selected, ...ids].filter(Boolean))];
    model.replaceChildren(...list.map((id) => Object.assign(document.createElement('option'), { value: id, textContent: id })));
    model.value = selected;
  }

  async function load() {
    const s = await chrome.storage.local.get(['consent', 'apiKey', 'model']);
    key.value = s.apiKey || '';
    consent.checked = s.consent === true;
    setModels([], s.model || openaiProvider.DEFAULT_MODEL);
    if (s.apiKey && s.consent === true) say('Arth is set up. Select text in a ChatGPT conversation to use it.', 'ok');
  }

  // Asks OpenAI which models this key can use. Sends the key and nothing else.
  async function check() {
    const value = key.value.trim();
    if (!value) return say('Paste your API key first.', 'error'), false;
    $('check').disabled = true;
    say('Checking…');
    try {
      const ids = await openaiProvider.listModels(value);
      const wanted = model.value || openaiProvider.DEFAULT_MODEL;
      setModels(ids, ids.includes(wanted) ? wanted : ids.includes(openaiProvider.DEFAULT_MODEL) ? openaiProvider.DEFAULT_MODEL : wanted);
      if (!ids.includes(model.value)) say(`The key works, but “${model.value}” is not in its model list. Choose another model.`, 'error');
      else say('The key works.', 'ok');
      return true;
    } catch (e) {
      say(ERRORS[e.code] || 'Could not check the key.', 'error');
      return false;
    } finally {
      $('check').disabled = false;
    }
  }

  $('check').addEventListener('click', check);
  $('save').addEventListener('click', async () => {
    if (!key.value.trim()) return say('Paste your API key first.', 'error');
    if (!consent.checked) return say('Tick the box to confirm you understand what is sent.', 'error');
    await chrome.storage.local.set({ apiKey: key.value.trim(), model: model.value || openaiProvider.DEFAULT_MODEL, consent: true });
    say('Saved. Select text in a ChatGPT conversation to use Arth.', 'ok');
  });
  $('remove').addEventListener('click', async () => {
    await chrome.storage.local.clear();
    key.value = '';
    consent.checked = false;
    setModels([], openaiProvider.DEFAULT_MODEL);
    say('Removed. Arth has no saved key or settings.', 'ok');
  });

  load();
})();
