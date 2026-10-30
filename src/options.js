import { getSettings, saveSettings, makeT, applyT, ICON, getFolder, setFolder, clearFolder, folderState, fillMicSelect, listMics, DOWNLOAD_SUBFOLDER } from './shared.js';

const $ = id => document.getElementById(id);
let settings = await getSettings();
const t = makeT(settings);
applyT(t);
document.title = `${t('setTitle')} · Recorder Chrome AppAlbania`;
document.querySelectorAll('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', ICON[el.dataset.icon]));

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(el);
  setTimeout(() => el.remove(), 1600);
}

async function set(key, value) {
  settings = await saveSettings({ [key]: value });
  render();
  if (key === 'lang') location.reload();
  else toast(t('saved'));
}

// ---------- folder ----------

async function renderFolder() {
  const folder = await getFolder();
  const state = await folderState(folder);
  $('folderName').textContent = folder ? folder.name : t('defaultFolder');
  $('folderNote').textContent = !folder ? '' : state === 'granted' ? '' : t('folderLocked');
  $('grant').classList.toggle('hidden', state !== 'prompt');
  $('useDownloads').classList.toggle('hidden', !folder);
  $('chooseText').textContent = t(folder ? 'changeFolder' : 'choose');
  $('folderRow').title = t(folder ? 'changeFolder' : 'choose');
}

$('folderRow').onclick = e => { if (!e.target.closest('#choose')) $('choose').click(); };
$('choose').onclick = async () => {
  try {
    let handle = await window.showDirectoryPicker({ id: 'recorder-docs', mode: 'readwrite', startIn: 'documents' });
    // Picking Documents (or another home folder) keeps things tidy in Documents/Recorder Chrome AppAlbania.
    if (/^(documents|desktop|downloads|movies|pictures|videos|dokumente|documenti)$/i.test(handle.name)) {
      handle = await handle.getDirectoryHandle(DOWNLOAD_SUBFOLDER, { create: true });
    }
    await setFolder(handle);
    await renderFolder();
    toast(t('saved'));
  } catch { /* picker closed */ }
};
$('grant').onclick = async () => {
  const folder = await getFolder();
  try { await folder?.requestPermission({ mode: 'readwrite' }); } catch {}
  renderFolder();
};
$('useDownloads').onclick = async () => { await clearFolder(); renderFolder(); toast(t('saved')); };

// ---------- controls ----------

document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const key = seg.dataset.key;
    set(key, key === 'fps' ? Number(b.dataset.v) : b.dataset.v);
  });
});
document.querySelectorAll('input[data-key]').forEach(input => {
  input.addEventListener('change', () => set(input.dataset.key, input.checked));
});

async function renderMic() {
  const allowed = await fillMicSelect($('micSel'), t, settings.micId);
  const { denied } = await listMics();
  $('micRow').classList.toggle('hidden', allowed);
  $('micState').textContent = denied ? t('micDenied') : '';
}
async function allowMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(tr => tr.stop());
    if (!settings.micId) settings = await saveSettings({ micId: 'default' });
  } catch {}
  renderMic();
}
$('micAllow').onclick = allowMic;
$('micSel').onchange = async () => {
  const v = $('micSel').value;
  if (v === '__allow') { $('micSel').value = ''; return allowMic(); }
  settings = await saveSettings({ micId: v });
  toast(t('saved'));
};
navigator.mediaDevices.addEventListener('devicechange', renderMic);
// The popup can't show a permission prompt, so it sends people here with #mic.
if (location.hash === '#mic') allowMic();

function render() {
  document.querySelectorAll('.seg').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(String(settings[seg.dataset.key]) === b.dataset.v)));
  });
  document.querySelectorAll('input[data-key]').forEach(i => { i.checked = !!settings[i.dataset.key]; });
  $('fmtNote').classList.toggle('hidden', !(settings.format === 'mp4' && !MediaRecorder.isTypeSupported('video/mp4')));
  renderMic();
}

$('shortcutBtn').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
const cmd = (await chrome.commands.getAll()).find(c => c.name === 'toggle-recording');
if (cmd?.shortcut) $('kbd').textContent = cmd.shortcut;

render();
renderFolder();
