import { getSettings, makeT, applyT, ICON, getFolder, folderState, fmtTime, fmtSize, isVideo, langOf } from './shared.js';

const $ = id => document.getElementById(id);
const settings = await getSettings();
const t = makeT(settings);
applyT(t);
document.querySelectorAll('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.icon]));
$('q').placeholder = t('search');

// One gallery for videos and screenshots, with a filter (All / Recordings / Screenshots) and search.
const isShot = name => /\.(png|pdf)$/i.test(name);
let kind = location.hash === '#shots' ? 'shot' : 'all';
document.title = `${t('gallery')} · Recorder Chrome AppAlbania`;
document.querySelectorAll('#kinds button').forEach(b => {
  b.onclick = () => { kind = b.dataset.kind; filter(); };
});

const dateFmt = new Intl.DateTimeFormat(langOf(settings) === 'sq' ? 'sq-AL' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
let urls = [];

async function collect() {
  const items = [];
  const folder = await getFolder();
  const state = await folderState(folder);
  $('locked').classList.toggle('hidden', state !== 'prompt');
  const add = async (dir, source, want) => {
    if (!dir) return;
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file' && want(name)) items.push({ name, fh: h, dir, source });
    }
  };

  if (folder && state === 'granted') {
    await add(folder, 'folder', isVideo);
    await add(await folder.getDirectoryHandle('Screenshots').catch(() => null), 'folder', isShot);
  }
  // Files saved in default (Downloads) mode keep a copy here, since Chrome can't read Downloads.
  const root = await navigator.storage.getDirectory();
  await add(await root.getDirectoryHandle('recordings', { create: true }), 'library', isVideo);
  await add(await root.getDirectoryHandle('screenshots', { create: true }), 'library', isShot);
  // The same file can exist in the folder and as the extension's copy: show it once, from the folder.
  const inFolder = new Set(items.filter(i => i.source === 'folder').map(i => i.name));
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].source === 'library' && inFolder.has(items[i].name)) items.splice(i, 1);
  }
  for (const it of items) it.file = await it.fh.getFile();
  return items.filter(i => i.file.size > 0).sort((a, b) => b.file.lastModified - a.file.lastModified);
}

function button(icon, label, onClick, cls = '') {
  const b = document.createElement('button');
  b.className = `icon-btn ${cls}`;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = ICON[icon];
  b.onclick = onClick;
  return b;
}

async function render() {
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  const [items, { meta = {} }, { downloadIds = {} }] = await Promise.all([
    collect(), chrome.storage.local.get('meta'), chrome.storage.local.get('downloadIds')
  ]);

  const grid = $('grid');
  grid.replaceChildren();

  for (const it of items) {
    const url = URL.createObjectURL(it.file);
    urls.push(url);
    const m = meta[it.name] || {};

    const card = document.createElement('article');
    card.className = 'item';
    card.dataset.q = `${it.name} ${dateFmt.format(it.file.lastModified)}`.toLowerCase();
    card.dataset.kind = isShot(it.name) ? 'shot' : 'video';
    card.dataset.size = it.file.size;

    const thumb = document.createElement('button');
    thumb.className = 'thumb';
    thumb.setAttribute('aria-label', `${t('play')}: ${it.name}`);
    const pdf = /\.pdf$/i.test(it.name);
    if (isShot(it.name)) {
      thumb.classList.add('shot');
      if (pdf) thumb.insertAdjacentHTML('beforeend', `<span class="pdf">${ICON.page}<b>PDF</b></span>`);
      else thumb.append(Object.assign(document.createElement('img'), { src: url, alt: '', loading: 'lazy' }));
      thumb.onclick = () => openShot(it.name, url, pdf);
      grid.append(card);
      card.append(thumb, ...details(it, url, meta, downloadIds, () => openShot(it.name, url, pdf)));
      continue;
    }
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = `${url}#t=0.5`;
    const dur = document.createElement('span');
    dur.className = 'dur';
    if (m.duration) dur.textContent = fmtTime(m.duration);
    else {
      v.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(v.duration)) dur.textContent = fmtTime(v.duration * 1000);
      }, { once: true });
    }
    const play = document.createElement('span');
    play.className = 'play';
    play.innerHTML = ICON.play;
    thumb.append(v, play, dur);
    thumb.onclick = () => openPlayer(it.name, url);

    card.append(thumb, ...details(it, url, meta, downloadIds, () => openPlayer(it.name, url)));
    grid.append(card);
  }
  filter();
}

// Title, date/size line and the tool buttons, same for videos and screenshots.
function details(it, url, meta, downloadIds, open) {
  const info = document.createElement('div');
  info.className = 'meta';
  const title = document.createElement('b');
  title.textContent = it.name.replace(/\.(mp4|webm|png|pdf)$/i, '');
  title.title = it.name;
  const sub = document.createElement('small');
  sub.textContent = `${dateFmt.format(it.file.lastModified)} · ${fmtSize(it.file.size)} · ${it.name.split('.').pop().toUpperCase()}`;
  info.append(title, sub);

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.append(button(isShot(it.name) ? 'eye' : 'play', t(isShot(it.name) ? 'view' : 'play'), open));
  if (it.source === 'folder') tools.append(button('pencil', t('rename'), () => rename(it, meta)));
  const dlId = downloadIds[it.name];
  if (it.source === 'library') tools.append(button('folder', t('showFolder'), () => reveal(it.name, dlId)));
  tools.append(button('download', t('download'), () => {
    const a = Object.assign(document.createElement('a'), { href: url, download: it.name });
    a.click();
  }));
  tools.append(button('trash', t('del'), () => remove(it, dlId), 'danger'));
  return [info, tools];
}

// Kind filter + search by name, site or date, without reloading the files.
function filter() {
  document.querySelectorAll('#kinds button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  const q = $('q').value.trim().toLowerCase();
  const cards = [...$('grid').children];
  let shown = 0, bytes = 0, ofKind = 0;
  for (const card of cards) {
    const right = kind === 'all' || card.dataset.kind === kind;
    const hit = right && (!q || q.split(/\s+/).every(w => card.dataset.q.includes(w)));
    card.classList.toggle('hidden', !hit);
    if (right) ofKind++;
    if (hit) { shown++; bytes += +card.dataset.size; }
  }
  $('summary').textContent = shown ? `${shown} · ${fmtSize(bytes)}` : '';
  const shots = kind === 'shot';
  $('emptyTitle').textContent = t(shots ? 'emptyShots' : 'empty');
  $('emptySub').textContent = t(shots ? 'emptyShotsSub' : 'emptySub');
  $('empty').classList.toggle('hidden', ofKind > 0);
  $('noHits').classList.toggle('hidden', !(ofKind > 0 && shown === 0));
}
$('q').addEventListener('input', filter);

function openShot(name, url, pdf) {
  if (pdf) return window.open(url, '_blank');
  $('playerName').textContent = name;
  $('playerVideo').classList.add('hidden');
  $('playerImg').classList.remove('hidden');
  $('playerImg').src = url;
  $('player').showModal();
}

// Selects the video in Finder / Explorer. Falls back to a filename search, then to the Downloads folder.
async function reveal(name, dlId) {
  const found = (dlId && await chrome.downloads.search({ id: dlId })) || [];
  let item = found.find(d => d.exists && d.state === 'complete');
  if (!item) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const all = await chrome.downloads.search({ filenameRegex: `${esc}$`, state: 'complete', exists: true });
    item = all[0];
  }
  if (item) chrome.downloads.show(item.id);
  else chrome.downloads.showDefaultFolder();
}

function openPlayer(name, url) {
  $('playerName').textContent = name;
  $('playerImg').classList.add('hidden');
  $('playerVideo').classList.remove('hidden');
  $('playerVideo').src = url;
  $('player').showModal();
}
$('closePlayer').onclick = () => $('player').close();
$('player').addEventListener('close', () => { $('playerVideo').pause(); $('playerVideo').removeAttribute('src'); $('playerVideo').load(); });
$('player').addEventListener('click', e => { if (e.target === $('player')) $('player').close(); });

async function rename(it, meta) {
  const ext = it.name.slice(it.name.lastIndexOf('.'));
  const base = prompt(t('newName'), it.name.slice(0, -ext.length));
  if (!base || !base.trim()) return;
  const clean = base.trim().replace(/[\\/:*?"<>|]/g, '-') + ext;
  if (clean === it.name) return;
  try {
    if (it.fh.move) await it.fh.move(clean);
    else {
      const nh = await it.dir.getFileHandle(clean, { create: true });
      const w = await nh.createWritable();
      await w.write(it.file);
      await w.close();
      await it.dir.removeEntry(it.name);
    }
    if (meta[it.name]) {
      meta[clean] = meta[it.name];
      delete meta[it.name];
      await chrome.storage.local.set({ meta });
    }
  } catch (e) { alert(e.message); }
  rerender();
}

async function remove(it, dlId) {
  if (!confirm(`${t('confirmDel')}\n\n${it.name}`)) return;
  await it.dir.removeEntry(it.name).catch(() => {});
  if (it.source === 'library' && dlId) {
    await chrome.downloads.removeFile(dlId).catch(() => {});
    await chrome.downloads.erase({ id: dlId }).catch(() => {});
  }
  const { meta = {}, downloadIds = {} } = await chrome.storage.local.get(['meta', 'downloadIds']);
  delete meta[it.name];
  delete downloadIds[it.name];
  await chrome.storage.local.set({ meta, downloadIds });
  rerender();
}

$('grant').onclick = async () => {
  const folder = await getFolder();
  try { await folder?.requestPermission({ mode: 'readwrite' }); } catch {}
  rerender();
};
// Serialize renders so a storage change during a render can't duplicate cards.
let queue = Promise.resolve();
const rerender = () => (queue = queue.then(render, render));
$('refresh').onclick = rerender;
chrome.storage.local.onChanged.addListener(ch => { if (ch.meta) rerender(); });
addEventListener('hashchange', () => { kind = location.hash === '#shots' ? 'shot' : 'all'; filter(); });

rerender();
