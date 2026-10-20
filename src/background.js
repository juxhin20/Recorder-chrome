import { getSettings, makeT, fmtTime, DOWNLOAD_SUBFOLDER } from './shared.js';

const OFFSCREEN = 'src/offscreen.html';
const IDLE = { status: 'idle' };

const getState = async () => (await chrome.storage.session.get('state')).state || IDLE;
const setState = state => chrome.storage.session.set({ state });

async function ensureOffscreen() {
  const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (has.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'BLOBS'],
    justification: 'Record the selected tab or window with MediaRecorder'
  });
}

async function closeOffscreen() {
  const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (has.length) await chrome.offscreen.closeDocument().catch(() => {});
}

const toOffscreen = msg => chrome.runtime.sendMessage({ target: 'offscreen', ...msg });

async function setBadge(state) {
  const rec = state.status === 'recording' || state.status === 'countdown';
  const paused = state.status === 'paused';
  await chrome.action.setIcon({
    path: rec || paused
      ? { 16: '/icons/rec16.png', 32: '/icons/rec32.png' }
      : { 16: '/icons/icon16.png', 32: '/icons/icon32.png' }
  });
  let text = '';
  if (state.status === 'countdown') text = String(state.count ?? '');
  else if (rec) text = fmtTime(state.elapsed || 0).replace(/^0(\d:)/, '$1');
  else if (paused) text = 'II';
  else if (state.status === 'saving') text = '…';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: paused ? '#f59e0b' : '#ef4444' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
}

async function update(patch) {
  const state = patch.status === 'idle' ? { ...IDLE } : { ...(await getState()), ...patch };
  await setState(state);
  await setBadge(state);
  return state;
}

// ---------- start ----------

async function start(mode, tabId) {
  const state = await getState();
  if (state.status !== 'idle') return { ok: false, error: 'busy' };
  const settings = await getSettings();
  const t = makeT(settings);

  let streamId, canAudio = false, overlayTab = null;
  if (mode === 'tab') {
    const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab || /^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || '') || tab.url?.startsWith('https://chromewebstore.google.com')) {
      return { ok: false, error: t('cantTab') };
    }
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    canAudio = true;
    overlayTab = tab.id;
  } else {
    const res = await new Promise(resolve => {
      chrome.desktopCapture.chooseDesktopMedia(['window', 'screen', 'audio'], (id, opts) => resolve({ id, opts }));
    });
    if (!res.id) return { ok: false, error: 'cancelled' };
    streamId = res.id;
    canAudio = !!res.opts?.canRequestAudioTrack;
    overlayTab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  }

  await update({ status: settings.countdown ? 'countdown' : 'recording', mode, elapsed: 0, count: 3 });
  await ensureOffscreen();
  const r = await toOffscreen({ cmd: 'record', mode, streamId, canAudio, settings });
  if (!r?.ok) {
    await update({ status: 'idle' });
    await closeOffscreen();
    return { ok: false, error: r?.error || 'Could not start recording' };
  }
  if (settings.countdown && overlayTab) showCountdown(overlayTab);
  return { ok: true };
}

// Big 3-2-1 in the middle of the page. It removes itself just before recording starts,
// so it never ends up in the video. Pages Chrome won't let us script just skip it.
function showCountdown(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        .bg{position:fixed;inset:0;background:rgba(2,6,23,.28);animation:fade .25s ease-out}
        .n{position:fixed;left:50%;top:50%;width:190px;height:190px;margin:-95px 0 0 -95px;border-radius:50%;
           display:grid;place-items:center;background:rgba(15,23,42,.86);color:#fff;border:5px solid #ef4444;
           box-shadow:0 20px 60px rgba(0,0,0,.45);font:800 104px/1 -apple-system,system-ui,sans-serif}
        .a{animation:pop .95s ease-out}
        @keyframes pop{0%{transform:scale(1.5);opacity:0}22%{transform:scale(1);opacity:1}80%{opacity:1}100%{transform:scale(.88);opacity:.35}}
        @keyframes fade{from{opacity:0}}
      </style><div class="bg"></div><div class="n"></div>`;
      document.documentElement.append(host);
      const el = root.querySelector('.n');
      let n = 3;
      const show = () => { el.textContent = n; el.classList.remove('a'); void el.offsetWidth; el.classList.add('a'); };
      show();
      const iv = setInterval(() => { if (--n > 0) show(); }, 1000);
      setTimeout(() => { clearInterval(iv); host.remove(); }, 2900);
    }
  }).catch(e => console.warn('Countdown overlay skipped:', e.message));
}

async function openLibrary() {
  const url = chrome.runtime.getURL('src/library.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    chrome.tabs.reload(existing.id);
  } else {
    await chrome.tabs.create({ url });
  }
}

// ---------- downloads (default folder mode) ----------

async function downloadFile(url, name) {
  const id = await chrome.downloads.download({
    url, filename: `${DOWNLOAD_SUBFOLDER}/${name}`, conflictAction: 'uniquify', saveAs: false
  });
  await chrome.storage.session.set({ pendingDownload: id });
  const { downloadIds = {} } = await chrome.storage.local.get('downloadIds');
  downloadIds[name] = id;
  await chrome.storage.local.set({ downloadIds });
}

chrome.downloads.onChanged.addListener(async d => {
  if (!d.state) return;
  const { pendingDownload } = await chrome.storage.session.get('pendingDownload');
  if (d.id !== pendingDownload) return;
  if (d.state.current === 'complete' || d.state.current === 'interrupted') {
    await chrome.storage.session.remove('pendingDownload');
    await finish();
  }
});

async function saveMeta(name, meta) {
  const { meta: all = {} } = await chrome.storage.local.get('meta');
  all[name] = meta;
  await chrome.storage.local.set({ meta: all });
}

async function finish() {
  const settings = await getSettings();
  await update({ status: 'idle' });
  await closeOffscreen();
  if (settings.openLibrary) await openLibrary();
}

// ---------- messages ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target === 'offscreen') return;
  (async () => {
    switch (msg.cmd || msg.evt) {
      case 'start': return start(msg.mode, msg.tabId);
      case 'pause': case 'resume': case 'stop': case 'cancel':
        return toOffscreen({ cmd: msg.cmd });
      case 'state': return getState();
      case 'openLibrary': return openLibrary();

      // events from offscreen
      case 'tick': return update(msg.patch);
      case 'download': return downloadFile(msg.url, msg.name);
      case 'saved':
        await saveMeta(msg.name, msg.meta);
        if (!msg.viaDownload) await finish();
        return;
      case 'cancelled':
        await update({ status: 'idle' });
        return closeOffscreen();
      case 'error':
        await update({ status: 'idle' });
        await closeOffscreen();
        chrome.storage.session.set({ lastError: msg.message });
        return;
    }
  })().then(reply, e => reply({ ok: false, error: e.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-recording') return;
  const state = await getState();
  if (state.status === 'idle') await start('tab', tab?.id);
  else if (state.status !== 'saving') await toOffscreen({ cmd: 'stop' });
});

// A crashed / reloaded worker must not leave a stale "recording" state.
chrome.runtime.onStartup.addListener(() => update({ status: 'idle' }));
chrome.runtime.onInstalled.addListener(async () => {
  const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!has.length) await update({ status: 'idle' });
});
