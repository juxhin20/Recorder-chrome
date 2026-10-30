// Full-page screenshots (and pages Chrome won't let us draw on) open here in the same editor.
import { getSettings, makeT, snipLabels } from './shared.js';

const t = makeT(await getSettings());
const shot = await chrome.runtime.sendMessage({ cmd: 'takeShot' });
if (shot?.img) {
  document.getElementById('msg').remove();
  window.__recSnip({ img: shot.img, mode: 'page', labels: snipLabels(t) });
} else {
  document.getElementById('msg').textContent = t('shotGone');
}
