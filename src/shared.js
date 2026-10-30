// Shared helpers: settings, translations, folder handle storage.

export const APP_NAME = 'Recorder Chrome AppAlbania';
export const DOWNLOAD_SUBFOLDER = 'Recorder Chrome AppAlbania';

export const DEFAULTS = {
  quality: '1080',     // 720 | 1080 | 2160
  fps: 30,             // 30 | 60
  format: 'mp4',       // mp4 | webm
  tabAudio: true,      // tab sound (tab mode) / PC sound (window & screen mode)
  micId: '',           // '' = no microphone, 'default' = system default, else a deviceId
  countdown: true,
  openLibrary: false,
  lang: 'auto'         // auto | sq | en
};

export const QUALITY = {
  '720':  { w: 1280, h: 720,  bps: 5_000_000 },
  '1080': { w: 1920, h: 1080, bps: 8_000_000 },
  '2160': { w: 3840, h: 2160, bps: 25_000_000 }
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  if (s.mic === true && !s.micId) s.micId = 'default';   // settings from 1.0.0
  delete s.mic;
  return s;
}

export async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: s });
  return s;
}

// ---------- folder handle (IndexedDB, same extension origin everywhere) ----------

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('recorder', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const getFolder = () => kv('readonly', s => s.get('folder')).catch(() => null);
export const setFolder = h => kv('readwrite', s => s.put(h, 'folder'));
export const clearFolder = () => kv('readwrite', s => s.delete('folder'));

// 'granted' | 'prompt' | 'denied' | 'none'
export async function folderState(handle) {
  if (!handle) return 'none';
  try { return await handle.queryPermission({ mode: 'readwrite' }); } catch { return 'denied'; }
}

// ---------- formatting ----------

export function fileStamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

export function fmtSize(b) {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export const isVideo = name => /\.(mp4|webm)$/i.test(name);

// ---------- microphones ----------

// Returns { allowed, devices: [{ id, label }] }. Labels are only available once mic permission is granted.
export async function listMics() {
  let state = 'prompt';
  try { state = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const devices = all
    .filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map(d => ({ id: d.deviceId, label: d.label }));
  return { allowed: state === 'granted', denied: state === 'denied', devices };
}

// Fill a <select> with: no mic, default mic, every device.
export async function fillMicSelect(select, t, current) {
  const { allowed, devices } = await listMics();
  const opts = [['', t('noMic')]];
  if (allowed) {
    opts.push(['default', t('defaultMic')]);
    devices.forEach((d, i) => opts.push([d.id, d.label || `${t('mic')} ${i + 1}`]));
    if (current && current !== 'default' && !devices.some(d => d.id === current)) opts.push([current, t('micMissing')]);
  } else {
    opts.push(['__allow', t('micAllowOpt')]);
  }
  select.replaceChildren(...opts.map(([v, label]) => new Option(label, v)));
  select.value = allowed || !current ? current : '';
  return allowed;
}

// ---------- translations ----------

const T = {
  sq: {
    tab: 'Regjistro tab-in', tabSub: 'Vetëm faqja aktuale, me zë', tabShort: 'Tab-i', tabMini: 'Vetëm faqja', windowMini: 'Ose gjithë ekrani',
    windowShort: 'Dritarja', windowSubShort: 'Dritare Chrome ose ekrani, me zërin e PC',
    window: 'Regjistro dritaren / ekranin', windowSub: 'Dritarja Chrome ose gjithë ekrani, me zërin e PC',
    recording: 'Duke regjistruar', paused: 'Në pauzë', countdown: 'Fillon…', saving: 'Duke ruajtur…',
    pause: 'Pauzë', resume: 'Vazhdo', stop: 'Ndalo', cancel: 'Anulo',
    recordings: 'Regjistrimet', settings: 'Cilësimet',
    savesTo: 'Ruhet te', downloads: 'Shkarkime', needAccess: 'Lejo qasjen te dosja',
    cantTab: 'Kjo faqe nuk mund të regjistrohet (faqe e Chrome). Hap një faqe tjetër.',
    shortcut: 'Shkurtore',
    // library
    libTitle: 'Regjistrimet', empty: 'Ende s’ka regjistrime.', emptySub: 'Kliko ikonën e zgjerimit dhe nis një regjistrim.',
    play: 'Luaj', rename: 'Riemërto', del: 'Fshi', showFolder: 'Hap dosjen', download: 'Shkarko',
    confirmDel: 'Ta fshij këtë video?', newName: 'Emri i ri',
    folderLocked: 'Chrome kërkon leje sërish për dosjen.', grant: 'Lejo qasjen', refresh: 'Rifresko',
    // settings
    setTitle: 'Cilësimet', folder: 'Dosja e ruajtjes', folderHint: 'Videot ruhen këtu, fotot e ekranit te Screenshots/.',
    choose: 'Zgjidh dosjen', changeFolder: 'Ndrysho dosjen', useDownloads: 'Përdor Shkarkime', defaultFolder: 'Shkarkime / Recorder Chrome AppAlbania',
    video: 'Video', quality: 'Cilësia', fps: 'Kuadro për sekondë', format: 'Formati',
    mp4Hint: 'Luhet kudo', webmHint: 'Më i lehtë për Chrome',
    audio: 'Zëri', tabAudio: 'Zëri i kompjuterit / tab-it', mic: 'Mikrofoni', micAllow: 'Lejo mikrofonin', micOk: 'Mikrofoni lejohet',
    tabAudioHint: 'Tab: zëri i faqes. Dritare/ekran: aktivizo “Share system audio” te dritarja e Chrome për muzikën e kompjuterit.',
    noMic: 'Pa mikrofon', defaultMic: 'Mikrofoni i parazgjedhur', micAllowOpt: 'Lejo mikrofonin…', micMissing: 'Mikrofoni (i palidhur)',
    micHint: 'Zgjidh kufjet ose mikrofonin. Lista rifreskohet kur lidh kufje.', sound: 'Zëri i PC',
    micDenied: 'Mikrofoni u refuzua. Lejoje te cilësimet e Chrome.',
    extras: 'Të tjera', countdownOpt: 'Numërim 3-2-1 para fillimit', openLib: 'Hap Regjistrimet pas ndalimit',
    language: 'Gjuha', auto: 'Automatike', changeShortcut: 'Ndrysho shkurtoren', saved: 'U ruajt',
    notSupported: 'Ky format nuk mbështetet këtu, do përdoret WebM.',
    switchHere: 'Vazhdo regjistrimin këtu', captureTitle: 'Regjistrimi i dritares', captureSub: 'Mbaje këtë dritare hapur. Ndalo nga ikona e zgjerimit.',
    shotShort: 'Foto ekrani', shotMini: 'Zonë, faqe, e plotë',
    shotArea: 'Zgjidh zonën', shotVisible: 'Ekrani', shotFull: 'Gjithë faqja',
    shotHint: 'Tërhiq për të zgjedhur zonën · Esc për të dalë',
    pen: 'Laps', line: 'Vijë', arrow: 'Shigjetë', rect: 'Katror', marker: 'Theksues', text: 'Tekst', color: 'Ngjyra', undo: 'Zhbëj (⌘Z)',
    copy: 'Kopjo', save: 'Ruaj', pdf: 'Ruaj si PDF (faqe A4)', copyKey: 'Kopjo (⌘C)', saveKey: 'Ruaj (⌘S)', close: 'Mbyll (Esc)',
    copied: 'U kopjua', saved: 'U ruajt te Screenshots', copyFail: 'Kjo faqe nuk lejon kopjimin. Përdor Ruaj.',
    shotGone: 'Fotoja nuk u gjet. Provo sërish nga ikona e zgjerimit.', shotBusy: 'Ndalo regjistrimin para fotos së gjithë faqes.'
  },
  en: {
    tab: 'Record this tab', tabSub: 'Current page only, with sound', tabShort: 'This tab', tabMini: 'Page only', windowMini: 'Or full screen',
    windowShort: 'Window', windowSubShort: 'Chrome window or screen, with PC sound',
    window: 'Record window / screen', windowSub: 'Chrome window or whole screen, with PC sound',
    recording: 'Recording', paused: 'Paused', countdown: 'Starting…', saving: 'Saving…',
    pause: 'Pause', resume: 'Resume', stop: 'Stop', cancel: 'Cancel',
    recordings: 'Recordings', settings: 'Settings',
    savesTo: 'Saves to', downloads: 'Downloads', needAccess: 'Allow folder access',
    cantTab: 'This page can’t be recorded (Chrome page). Open another page.',
    shortcut: 'Shortcut',
    libTitle: 'Recordings', empty: 'No recordings yet.', emptySub: 'Click the extension icon and start a recording.',
    play: 'Play', rename: 'Rename', del: 'Delete', showFolder: 'Show in folder', download: 'Download',
    confirmDel: 'Delete this video?', newName: 'New name',
    folderLocked: 'Chrome needs permission for the folder again.', grant: 'Allow access', refresh: 'Refresh',
    setTitle: 'Settings', folder: 'Save folder', folderHint: 'Videos are saved here, screenshots in Screenshots/.',
    choose: 'Choose folder', changeFolder: 'Change folder', useDownloads: 'Use Downloads', defaultFolder: 'Downloads / Recorder Chrome AppAlbania',
    video: 'Video', quality: 'Quality', fps: 'Frames per second', format: 'Format',
    mp4Hint: 'Plays everywhere', webmHint: 'Lighter for Chrome',
    audio: 'Audio', tabAudio: 'PC / tab sound', mic: 'Microphone', micAllow: 'Allow microphone', micOk: 'Microphone allowed',
    tabAudioHint: 'Tab: the page’s sound. Window/screen: turn on “Share system audio” in Chrome’s picker for PC music.',
    noMic: 'No microphone', defaultMic: 'Default microphone', micAllowOpt: 'Allow microphone…', micMissing: 'Microphone (not connected)',
    micHint: 'Pick your headphones or microphone. The list updates when you plug headphones in.', sound: 'PC sound',
    micDenied: 'Microphone was blocked. Allow it in Chrome settings.',
    extras: 'Extras', countdownOpt: '3-2-1 countdown before start', openLib: 'Open Recordings after stopping',
    language: 'Language', auto: 'Automatic', changeShortcut: 'Change shortcut', saved: 'Saved',
    notSupported: 'This format isn’t supported here, WebM will be used.',
    switchHere: 'Continue on this tab', captureTitle: 'Window recording', captureSub: 'Keep this window open. Stop from the extension icon.',
    shotShort: 'Screenshot', shotMini: 'Area, page, full',
    shotArea: 'Select area', shotVisible: 'Visible page', shotFull: 'Full page',
    shotHint: 'Drag to select an area · Esc to exit',
    pen: 'Pen', line: 'Line', arrow: 'Arrow', rect: 'Rectangle', marker: 'Marker', text: 'Text', color: 'Color', undo: 'Undo (⌘Z)',
    copy: 'Copy', save: 'Save', pdf: 'Save as PDF (A4 pages)', copyKey: 'Copy (⌘C)', saveKey: 'Save (⌘S)', close: 'Close (Esc)',
    copied: 'Copied', saved: 'Saved to Screenshots', copyFail: 'This page blocks copying. Use Save.',
    shotGone: 'Screenshot not found. Try again from the extension icon.', shotBusy: 'Stop the recording before a full-page screenshot.'
  }
};

// Text the screenshot editor needs (it runs inside web pages, without shared.js).
export function snipLabels(t) {
  const keys = ['pen', 'line', 'arrow', 'rect', 'marker', 'text', 'color', 'undo', 'copy', 'save', 'pdf', 'copyKey', 'saveKey', 'close', 'copied', 'saved', 'copyFail'];
  return { ...Object.fromEntries(keys.map(k => [k, t(k)])), hint: t('shotHint') };
}

export function langOf(s) {
  if (s.lang === 'sq' || s.lang === 'en') return s.lang;
  return (navigator.language || 'en').toLowerCase().startsWith('sq') ? 'sq' : 'en';
}

export function makeT(s) {
  const dict = T[langOf(s)];
  return k => dict[k] ?? T.en[k] ?? k;
}

// Fill [data-t] elements with translated text.
export function applyT(t, root = document) {
  root.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  root.documentElement && (root.documentElement.lang = t('tab') === T.sq.tab ? 'sq' : 'en');
}

// Inline SVG icons (no emojis).
export const ICON = {
  tab: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M2.5 9.5h19M10.5 4.5v5"/><path d="M4.5 6.2h4.2v2" fill="currentColor"/><circle cx="12" cy="14.5" r="2" fill="currentColor" stroke="none"/></svg>',
  screen: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/><path d="M2.5 7.5h19"/></svg>',
  window: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M2.5 8.5h19"/><circle cx="5.5" cy="6.25" r=".6"/><circle cx="7.75" cy="6.25" r=".6"/><circle cx="10" cy="6.25" r=".6"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  crop: '<svg viewBox="0 0 24 24"><path d="M7 3v14h14"/><path d="M3 7h14v14"/></svg>',
  page: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h2.2l1.6-2h5.4l1.6 2h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>'
};
