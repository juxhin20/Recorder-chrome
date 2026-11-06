// Runs inside a hidden iframe from the extension. Extension pages are a secure context,
// so the clipboard works here even when the page around it is plain http://.
// Only our own editor can use it: each copy needs a one-time key that the background handed to the editor.
addEventListener('message', async e => {
  const { id, key, png } = e.data || {};
  if (e.source !== parent || !id || !key || !(png instanceof Blob)) return;
  try {
    const ok = await chrome.runtime.sendMessage({ cmd: 'useCopyKey', key });
    if (!ok) throw new Error('not allowed');
    window.focus();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    parent.postMessage({ id, ok: true }, '*');
  } catch (err) {
    parent.postMessage({ id, ok: false, error: String(err) }, '*');
  }
});
parent.postMessage({ recCopyReady: true }, '*');
