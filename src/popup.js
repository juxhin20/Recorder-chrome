import { getSettings, saveSettings, makeT, applyT, ICON, fmtTime, getFolder, folderState, fillMicSelect } from './shared.js';

const $ = id => document.getElementById(id);
let settings = await getSettings();
const t = makeT(settings);
applyT(t);
document.querySelectorAll('[data-icon]').forEach(el => { el.insertAdjacentHTML('afterbegin', ICON[el.dataset.icon]); });
document.querySelectorAll('[data-title]').forEach(el => { el.title = t(el.dataset.title); el.setAttribute('aria-label', el.title); });

const send = msg => chrome.runtime.sendMessage(msg);

// ---------- save location ----------

let folder = await getFolder();
// Footer only appears when Chrome needs the folder permission again.
async function renderWhere() {
  $('foot').classList.toggle('hidden', (await folderState(folder)) !== 'prompt');
}
await renderWhere();

async function ensureFolderAccess() {
  if (folder && (await folderState(folder)) === 'prompt') {
    try { await folder.requestPermission({ mode: 'readwrite' }); } catch {}
    await renderWhere();
  }
}

$('grant').onclick = ensureFolderAccess;
$('openSet').onclick = () => chrome.runtime.openOptionsPage();
$('openLib').onclick = () => send({ cmd: 'openLibrary' });


// ---------- audio ----------

function renderSound() { $('sndBtn').setAttribute('aria-pressed', String(!!settings.tabAudio)); }
renderSound();
$('sndBtn').onclick = async () => { settings = await saveSettings({ tabAudio: !settings.tabAudio }); renderSound(); };

$('micSel').setAttribute('aria-label', t('mic'));
const renderMics = () => fillMicSelect($('micSel'), t, settings.micId);
await renderMics();
navigator.mediaDevices.addEventListener('devicechange', renderMics);
$('micSel').onchange = async () => {
  const v = $('micSel').value;
  if (v === '__allow') {
    // Popups can't show the permission prompt; Settings asks for it once.
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html#mic') });
    window.close();
    return;
  }
  settings = await saveSettings({ micId: v });
};

// ---------- recording ----------

function showError(msg) {
  $('err').textContent = msg;
  $('err').classList.toggle('hidden', !msg);
}

async function start(mode) {
  showError('');
  await ensureFolderAccess();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let res;
  try {
    res = await send({ cmd: 'start', mode, tabId: tab?.id });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (!res?.ok && res?.error !== 'cancelled' && res?.error !== 'busy') showError(res?.error || 'Error');
}

$('recTab').onclick = () => start('tab');

// Screenshot: the editor opens on the page (or in a tab for full page).
for (const [id, kind] of [['shotArea', 'area'], ['shotVisible', 'visible'], ['shotFull', 'full']]) {
  $(id).onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    send({ cmd: 'shot', kind, tabId: tab?.id }).catch(() => {});
    window.close();   // the popup must be gone before the page is captured
  };
}
$('pauseBtn').onclick = async () => {
  showError('');
  const s = await send({ cmd: 'state' });
  if (s.status !== 'paused') return send({ cmd: 'pause' });
  // Resuming from another tab continues the recording on that tab.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await send({ cmd: 'resume', tabId: tab?.id });
  if (res && res.ok === false && res.error) showError(res.error);
};
$('stopBtn').onclick = () => send({ cmd: 'stop' });

// Recording a tab and the popup was opened on another tab: offer to continue the same video here.
const [here] = await chrome.tabs.query({ active: true, currentWindow: true });
$('switchBtn').onclick = async () => {
  showError('');
  const res = await send({ cmd: 'switch', tabId: here?.id });
  if (res && res.ok === false && res.error) showError(res.error);
};
$('cancelBtn').onclick = () => send({ cmd: 'cancel' });

$('stopBtn').innerHTML = ICON.stop;
$('stopBtn').title = t('stop');
let current = { status: 'idle' };
let lastCount = null;

function setPauseIcon(paused) {
  if ($('pauseBtn').dataset.paused === String(paused)) return;   // don't rebuild on every tick (hover flicker)
  $('pauseBtn').dataset.paused = String(paused);
  $('pauseBtn').innerHTML = paused ? ICON.play : ICON.pause;
  $('pauseBtn').title = t(paused ? 'resume' : 'pause');
}

// Timer runs locally between ticks so it counts smoothly instead of jumping.
function liveElapsed() {
  const s = current;
  if (s.status !== 'recording') return s.elapsed || 0;
  return (s.elapsed || 0) + Math.max(0, Date.now() - (s.at || Date.now()));
}
setInterval(() => {
  if (current.status === 'recording' || current.status === 'paused') $('timer').textContent = fmtTime(liveElapsed());
}, 200);

function render(state = { status: 'idle' }) {
  const wasActive = current.status !== 'idle';
  current = state;
  const active = state.status !== 'idle';
  if (active !== wasActive || !$('idle').dataset.ready) {
    $('idle').dataset.ready = '1';
    $('idle').classList.toggle('hidden', active);
    $('active').classList.toggle('hidden', !active);
  }
  if (!active) { lastCount = null; return; }

  const paused = state.status === 'paused';
  const counting = state.status === 'countdown';
  $('active').classList.toggle('paused', paused);
  $('active').classList.toggle('counting', counting);
  $('statusText').textContent = t({ paused: 'paused', saving: 'saving' }[state.status] || 'recording');
  $('recMode').textContent = t('tabShort');
  if (counting && state.count !== lastCount) {
    lastCount = state.count;
    const c = $('count');
    c.textContent = String(state.count ?? 3);
    c.classList.remove('tick'); void c.offsetWidth; c.classList.add('tick');
  }
  if (!counting) $('timer').textContent = fmtTime(liveElapsed());
  setPauseIcon(paused);
  $('switchBtn').classList.toggle('hidden', !(state.mode === 'tab' && here && state.tabId && here.id !== state.tabId
    && (state.status === 'recording' || paused)));
  $('pauseBtn').disabled = state.status !== 'recording' && !paused;
  $('stopBtn').disabled = state.status === 'saving';
  $('cancelBtn').classList.toggle('hidden', state.status === 'saving');
}

render(await send({ cmd: 'state' }));
chrome.storage.session.onChanged.addListener(ch => {
  if (ch.state) render(ch.state.newValue);
  if (ch.lastError?.newValue) showError(ch.lastError.newValue);
});
const { lastError } = await chrome.storage.session.get('lastError');
if (lastError) { showError(lastError); chrome.storage.session.remove('lastError'); }
