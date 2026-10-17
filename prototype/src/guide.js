// Guide page: restarts the live tips that reader.js shows on the card.
document.getElementById('restart').addEventListener('click', async () => {
  await chrome.storage.local.set({ tour: 0 });
  document.getElementById('status').textContent = 'Ho gaya: agli baar word select karte hi tips dikhenge.';
});
