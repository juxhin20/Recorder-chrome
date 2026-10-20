import { getSettings, makeT, applyT, ICON, getFolder, folderState, fmtTime, fmtSize, isVideo, langOf } from './shared.js';

const $ = id => document.getElementById(id);
const settings = await getSettings();
const t = makeT(settings);
applyT(t);
document.title = `${t('libTitle')} · Recorder Chrome AppAlbania`;
document.querySelectorAll('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.icon]));

const dateFmt = new Intl.DateTimeFormat(langOf(settings) === 'sq' ? 'sq-AL' : undefined, { dateStyle: 'medium', timeStyle: 'short' });
let urls = [];

async function collect() {
  const items = [];
  const folder = await getFolder();
  const state = await folderState(folder);
  $('locked').classList.toggle('hidden', state !== 'prompt');

  if (folder && state === 'granted') {
    for await (const [name, h] of folder.entries()) {
      if (h.kind === 'file' && isVideo(name)) items.push({ name, fh: h, dir: folder, source: 'folder' });
    }
  }
  // Recordings saved in default (Downloads) mode keep a playable copy here.
  const root = await navigator.storage.getDirectory();
  const lib = await root.getDirectoryHandle('recordings', { create: true });
  for await (const [name, h] of lib.entries()) {
    if (h.kind === 'file' && isVideo(name)) items.push({ name, fh: h, dir: lib, source: 'library' });
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
  $('empty').classList.toggle('hidden', items.length > 0);
  const total = items.reduce((s, i) => s + i.file.size, 0);
  $('summary').textContent = items.length ? `${items.length} · ${fmtSize(total)}` : '';

  for (const it of items) {
    const url = URL.createObjectURL(it.file);
    urls.push(url);
    const m = meta[it.name] || {};

    const card = document.createElement('article');
    card.className = 'item';

    const thumb = document.createElement('button');
    thumb.className = 'thumb';
    thumb.setAttribute('aria-label', `${t('play')}: ${it.name}`);
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

    const info = document.createElement('div');
    info.className = 'meta';
    const title = document.createElement('b');
    title.textContent = it.name.replace(/\.(mp4|webm)$/i, '');
    title.title = it.name;
    const sub = document.createElement('small');
    sub.textContent = `${dateFmt.format(it.file.lastModified)} · ${fmtSize(it.file.size)} · ${it.name.split('.').pop().toUpperCase()}`;
    info.append(title, sub);

    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.append(button('play', t('play'), () => openPlayer(it.name, url)));
    if (it.source === 'folder') tools.append(button('pencil', t('rename'), () => rename(it, meta)));
    const dlId = downloadIds[it.name];
    if (it.source === 'library' && dlId) {
      tools.append(button('folder', t('showFolder'), () => chrome.downloads.show(dlId)));
    }
    tools.append(button('download', t('download'), () => {
      const a = Object.assign(document.createElement('a'), { href: url, download: it.name });
      a.click();
    }));
    tools.append(button('trash', t('del'), () => remove(it, dlId), 'danger'));

    card.append(thumb, info, tools);
    grid.append(card);
  }
}

function openPlayer(name, url) {
  $('playerName').textContent = name;
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

rerender();
