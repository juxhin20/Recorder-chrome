import { getSettings, makeT, fmtTime, fileStamp, getFolder, folderState, snipLabels, DOWNLOAD_SUBFOLDER } from './shared.js';

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
    justification: 'Record the selected tab with MediaRecorder'
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

  const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!capturable(tab)) return { ok: false, error: t('cantTab') };
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  await update({ status: settings.countdown ? 'countdown' : 'recording', mode, elapsed: 0, count: 3, tabId: tab.id });
  await ensureOffscreen();
  const r = await toOffscreen({ cmd: 'record', mode, streamId, canAudio: true, settings });
  if (!r?.ok) {
    await update({ status: 'idle' });
    await closeOffscreen();
    return { ok: false, error: r?.error || 'Could not start recording' };
  }
  if (settings.countdown) showCountdown(tab.id);
  return { ok: true };
}

// ---------- screenshots ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_SHOT_PX = 16000;   // tallest full-page image (device px); Chrome canvases stop around 32k
let pendingShot = null;      // full-page image waiting for shot.html
let lastCapture = 0;

// captureVisibleTab is limited to 2 calls a second.
async function captureTab(windowId) {
  await sleep(Math.max(0, 520 - (Date.now() - lastCapture)));
  lastCapture = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function shot(kind, tabId) {
  const settings = await getSettings();
  const t = makeT(settings);
  const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return { ok: false };
  await chrome.storage.session.set({ shotHost: hostOf(tab.url) });
  try {
    if (kind === 'full') {
      if (!capturable(tab)) throw new Error(t('cantTab'));
      return openShotTab(await fullPage(tab));
    }
    await sleep(120);   // let the popup disappear first
    const img = await captureTab(tab.windowId);
    if (!capturable(tab)) return openShotTab(img);
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/snip.js'] });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (img, mode, labels) => window.__recSnip({ img, mode, labels }),
        args: [img, kind, snipLabels(t)]
      });
    } catch {
      return openShotTab(img);   // a page we can't draw on: edit it in our own tab instead
    }
    return { ok: true };
  } catch (e) {
    await chrome.storage.session.set({ lastError: e.message });
    return { ok: false, error: e.message };
  }
}

async function openShotTab(img) {
  pendingShot = img;
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/shot.html') });
  return { ok: true };
}

// Scrolls the page one screen at a time and stitches the captures together.
async function fullPage(tab) {
  const run = (func, args = []) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }).then(r => r[0]?.result);
  // Prepare the page once: no hover effects, lazy images load now, and fixed/sticky bars
  // (headers, WordPress admin menu) are pinned to where they are at the top, so they show once.
  const m = await run(() => {
    const st = document.documentElement.style;
    const s = window.__recShot = { y: scrollY, sb: st.scrollBehavior, moved: [] };
    st.setProperty('scroll-behavior', 'auto', 'important');
    scrollTo(0, 0);
    const css = document.createElement('style');
    css.id = '__rec_shot_css';
    css.textContent = '*, *::before, *::after { pointer-events: none !important; transition: none !important; caret-color: transparent !important; }';
    document.documentElement.append(css);
    for (const img of document.images) if (img.loading === 'lazy') img.loading = 'eager';
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      s.moved.push([el, el.style.cssText]);
      if (pos === 'sticky') { el.style.setProperty('position', 'relative', 'important'); continue; }
      const r = el.getBoundingClientRect();
      el.style.setProperty('position', 'absolute', 'important');
      el.style.setProperty('top', `${r.top}px`, 'important');
      el.style.setProperty('left', `${r.left}px`, 'important');
      el.style.setProperty('bottom', 'auto', 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('width', `${r.width}px`, 'important');
    }
    return { vh: innerHeight, vw: innerWidth, cw: document.documentElement.clientWidth };
  });
  const parts = [];
  try {
    let want = 0;
    for (;;) {
      // Scroll, then wait (max 1.5 s) for the images now on screen to finish loading.
      const { y, total } = await run(async y => {
        scrollTo(0, y);
        const onScreen = [...document.images].filter(img => {
          if (img.complete) return false;
          const r = img.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.width > 0;
        });
        await Promise.race([
          Promise.all(onScreen.map(img => new Promise(res => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }))),
          new Promise(res => setTimeout(res, 1500))
        ]);
        const el = document.scrollingElement || document.documentElement;
        return { y: scrollY, total: Math.max(el.scrollHeight, document.body?.scrollHeight || 0) };
      }, [want]);
      await sleep(120);   // repaint
      const bmp = await createImageBitmap(await (await fetch(await captureTab(tab.windowId))).blob());
      parts.push({ y, bmp });
      const scale = bmp.height / m.vh;
      if (y + m.vh >= total || y < want || (y + m.vh) * scale >= MAX_SHOT_PX) break;
      want = y + m.vh;
    }
  } finally {
    await run(() => {
      const s = window.__recShot;
      if (!s) return;
      s.moved.forEach(([el, css]) => { el.style.cssText = css; });
      document.getElementById('__rec_shot_css')?.remove();
      scrollTo(0, s.y);
      document.documentElement.style.scrollBehavior = s.sb;
      delete window.__recShot;
    }).catch(() => {});
  }

  const scale = parts[0].bmp.height / m.vh;
  const last = parts[parts.length - 1];
  const height = Math.min(Math.round((last.y + m.vh) * scale), MAX_SHOT_PX);
  // Leave out the page's scrollbar on the right.
  const width = m.cw > 0 && m.cw < m.vw ? Math.round(m.cw * scale) : parts[0].bmp.width;
  const canvas = new OffscreenCanvas(width, height);
  const c = canvas.getContext('2d');
  parts.forEach(p => c.drawImage(p.bmp, 0, Math.round(p.y * scale)));
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

// Saves into the chosen folder's Screenshots/ or Downloads/Recorder Chrome AppAlbania/Screenshots/.
async function saveShot(dataUrl, ext = 'png') {
  if (typeof dataUrl !== 'string' || !/^data:(image\/png|application\/pdf);base64,/.test(dataUrl)) return { ok: false, error: 'Invalid image' };
  const { shotHost } = await chrome.storage.session.get('shotHost');
  const name = `Screenshot ${shotHost ? `${shotHost} ` : ''}${fileStamp()}.${ext === 'pdf' ? 'pdf' : 'png'}`.replace(/[\\/:*?"<>|]/g, '-');
  const blob = await (await fetch(dataUrl)).blob();
  const folder = await getFolder();
  let saved = false;
  if (folder && (await folderState(folder)) === 'granted') {
    try {
      await writeFile(await folder.getDirectoryHandle('Screenshots', { create: true }), name, blob);
      saved = true;
    } catch (e) {
      console.warn('Folder save failed, using Downloads:', e.message);
    }
  }
  if (!saved) {
    const id = await chrome.downloads.download({ url: dataUrl, filename: `${DOWNLOAD_SUBFOLDER}/Screenshots/${name}`, conflictAction: 'uniquify', saveAs: false });
    // Chrome can't read Downloads back, so the Screenshots page keeps its own copy (like recordings).
    try {
      const root = await navigator.storage.getDirectory();
      await writeFile(await root.getDirectoryHandle('screenshots', { create: true }), name, blob);
    } catch (e) {
      console.warn('Library copy failed:', e.message);
    }
    const { downloadIds = {} } = await chrome.storage.local.get('downloadIds');
    downloadIds[name] = id;
    await chrome.storage.local.set({ downloadIds });
  }
  await saveMeta(name, { kind: 'shot', created: Date.now(), where: saved ? 'folder' : 'library' });
  return { ok: true, name };
}

async function writeFile(dir, name, blob) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(blob);
  await w.close();
}

const capturable = tab => !!tab && !/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || '')
  && !tab.url?.startsWith('https://chromewebstore.google.com');

// Move a running or paused tab recording to another tab; the same video file continues.
async function switchTo(tabId) {
  const state = await getState();
  if (state.mode !== 'tab' || !['recording', 'paused'].includes(state.status)) return { ok: false };
  if (tabId && tabId !== state.tabId) {
    const t = makeT(await getSettings());
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!capturable(tab)) return { ok: false, error: t('cantTab') };
    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const r = await toOffscreen({ cmd: 'switch', streamId });
    if (!r?.ok) return { ok: false, error: r?.error || 'Could not switch tab' };
    await update({ tabId });
  }
  return { ok: true };
}

// Resume a paused tab recording. If the user moved to another tab, continue recording there.
async function resume(tabId) {
  const state = await getState();
  if (state.status !== 'paused') return { ok: false };
  if (state.mode === 'tab') {
    const r = await switchTo(tabId);
    if (!r.ok) return r;
  }
  return toOffscreen({ cmd: 'resume' });
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

// Messages from inside web pages (our injected editor) may only save a screenshot.
const fromExtensionPage = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target === 'offscreen') return;
  if (sender.id !== chrome.runtime.id || (!fromExtensionPage(sender) && msg.cmd !== 'saveShot')) return;
  (async () => {
    switch (msg.cmd || msg.evt) {
      case 'start': return start(msg.mode, msg.tabId);
      case 'resume': return resume(msg.tabId);
      case 'switch': return switchTo(msg.tabId);
      case 'pause': case 'stop': case 'cancel':
        return toOffscreen({ cmd: msg.cmd });
      case 'state': return getState();
      case 'openLibrary': return openLibrary();
      case 'shot': return shot(msg.kind, msg.tabId);
      case 'takeShot': { const img = pendingShot; pendingShot = null; return { img }; }
      case 'saveShot': return saveShot(msg.dataUrl, msg.ext);

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
  if (command === 'take-screenshot') return shot('area', tab?.id);
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
