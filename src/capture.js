// Window / screen mode: Chrome only shows the screen picker for a page, not the service worker,
// and the stream it returns only works in that page. So this small window picks the source
// and then records it itself (offscreen.js handles the same messages as the offscreen document).
import { getSettings, makeT, applyT } from './shared.js';
import './offscreen.js';

applyT(makeT(await getSettings()));

chrome.desktopCapture.chooseDesktopMedia(['window', 'screen', 'audio'], (id, opts) => {
  chrome.runtime.sendMessage({ evt: 'picked', id: id || '', canAudio: !!opts?.canRequestAudioTrack }).catch(() => {});
});
