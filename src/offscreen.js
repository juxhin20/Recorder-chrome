// Runs in the offscreen document: owns the MediaStream, MediaRecorder and file writer.
import { QUALITY, getFolder, folderState, fileStamp } from './shared.js';

let rec = null;      // current session

const send = msg => chrome.runtime.sendMessage(msg).catch(() => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickMime(format, withAudio) {
  const mp4 = withAudio
    ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
    : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4'];
  const webm = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const list = format === 'mp4' ? [...mp4, ...webm] : [...webm, ...mp4];
  return list.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

async function openWriter(name) {
  const folder = await getFolder();
  if (folder && (await folderState(folder)) === 'granted') {
    const fh = await folder.getFileHandle(name, { create: true });
    return { where: 'folder', fh, w: await fh.createWritable() };
  }
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('recordings', { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  return { where: 'library', dir, fh, w: await fh.createWritable() };
}

async function prepare({ mode, streamId, canAudio, settings }) {
  const q = QUALITY[settings.quality] || QUALITY['1080'];
  const source = mode === 'tab' ? 'tab' : 'desktop';
  const wantSourceAudio = settings.tabAudio && canAudio;

  const video = {
    mandatory: {
      chromeMediaSource: source,
      chromeMediaSourceId: streamId,
      maxWidth: q.w, maxHeight: q.h,
      minWidth: Math.min(q.w, 640), minHeight: Math.min(q.h, 360),
      maxFrameRate: settings.fps
    }
  };
  const audio = { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId } };
  let media;
  try {
    media = await navigator.mediaDevices.getUserMedia({ audio: wantSourceAudio ? audio : false, video });
  } catch (err) {
    if (!wantSourceAudio || mode === 'tab') throw err;
    media = await navigator.mediaDevices.getUserMedia({ audio: false, video });   // system audio unavailable here
  }

  let mic = null;
  if (settings.micId) {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const pick = settings.micId === 'default' ? base : { ...base, deviceId: { exact: settings.micId } };
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: pick });
    } catch {
      // chosen headphones unplugged: fall back to the default mic; no permission: record without mic
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: base }); } catch { mic = null; }
    }
  }

  // Mix audio. Tab capture mutes the tab, so play its sound back to the speakers.
  const ctx = new AudioContext();
  const mixed = ctx.createMediaStreamDestination();
  let hasAudio = false;
  if (media.getAudioTracks().length) {
    const src = ctx.createMediaStreamSource(new MediaStream(media.getAudioTracks()));
    src.connect(mixed);
    if (mode === 'tab') src.connect(ctx.destination);
    hasAudio = true;
  }
  if (mic) {
    ctx.createMediaStreamSource(mic).connect(mixed);
    hasAudio = true;
  }

  const tracks = [...media.getVideoTracks(), ...(hasAudio ? mixed.stream.getAudioTracks() : [])];
  const stream = new MediaStream(tracks);
  const mimeType = pickMime(settings.format, hasAudio);
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const name = `Recorder ${fileStamp()}.${ext}`;
  const writer = await openWriter(name);

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(q.bps * (settings.fps >= 60 ? 1.5 : 1)),
    audioBitsPerSecond: 160_000
  });

  rec = {
    mode, name, writer, recorder, media, mic, ctx, ext,
    chain: Promise.resolve(), bytes: 0,
    activeMs: 0, lastStart: 0, cancelled: false, timer: null, stopping: false
  };

  recorder.ondataavailable = e => {
    if (!e.data.size || rec.cancelled) return;
    rec.bytes += e.data.size;
    rec.chain = rec.chain.then(() => writer.w.write(e.data));
  };
  recorder.onstop = () => finalize().catch(err => fail(err));

  // User pressed Chrome's "Stop sharing" or closed the tab.
  media.getVideoTracks()[0].addEventListener('ended', () => stop());
}

async function begin(settings) {
  const r = rec;
  if (settings.countdown) {
    for (let n = 3; n > 0; n--) {
      if (r.stopping) return;
      send({ evt: 'tick', patch: { status: 'countdown', count: n } });
      await sleep(1000);
    }
    await sleep(150);         // let the page overlay disappear before the first frame
    if (r.stopping) return;   // stop()/cancel() during countdown already finalized
  }

  r.recorder.start(1000);
  r.lastStart = performance.now();
  r.timer = setInterval(tick, 500);
  tick();
}

function elapsed() {
  if (!rec) return 0;
  return rec.activeMs + (rec.recorder.state === 'recording' ? performance.now() - rec.lastStart : 0);
}

function tick() {
  if (!rec) return;
  const status = rec.recorder.state === 'paused' ? 'paused' : 'recording';
  send({ evt: 'tick', patch: { status, elapsed: elapsed(), at: Date.now() } });
}

function pause() {
  if (rec?.recorder.state !== 'recording') return;
  rec.recorder.pause();
  rec.activeMs += performance.now() - rec.lastStart;
  tick();
}

function resume() {
  if (rec?.recorder.state !== 'paused') return;
  rec.recorder.resume();
  rec.lastStart = performance.now();
  tick();
}

function stop() {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  if (rec.recorder.state === 'inactive') { finalize().catch(fail); return; }   // stopped during countdown
  if (rec.recorder.state === 'recording') rec.activeMs += performance.now() - rec.lastStart;
  rec.recorder.stop();
}

function cancel() {
  if (!rec) return;
  rec.cancelled = true;
  stop();
}

function release() {
  clearInterval(rec.timer);
  rec.media.getTracks().forEach(t => t.stop());
  rec.mic?.getTracks().forEach(t => t.stop());
  rec.ctx.close().catch(() => {});
}

async function finalize() {
  const r = rec;
  release();
  send({ evt: 'tick', patch: { status: 'saving' } });
  await r.chain;
  await r.writer.w.close();

  if (r.cancelled || !r.bytes) {
    await (r.writer.where === 'folder'
      ? (await getFolder()).removeEntry(r.name)
      : r.writer.dir.removeEntry(r.name)).catch(() => {});
    rec = null;
    send({ evt: 'cancelled' });
    return;
  }

  const meta = { duration: Math.round(r.activeMs), mode: r.mode, created: Date.now(), where: r.writer.where };
  if (r.writer.where === 'library') {
    // Default mode: keep the library copy and also save into Downloads.
    const file = await r.writer.fh.getFile();
    const url = URL.createObjectURL(file);
    await send({ evt: 'saved', name: r.name, meta, viaDownload: true });
    await send({ evt: 'download', url, name: r.name });
  } else {
    await send({ evt: 'saved', name: r.name, meta });
  }
  rec = null;
}

function fail(err) {
  const r = rec;
  try { r && release(); } catch {}
  if (r) r.writer.w.abort().catch(() => {}).then(() =>
    (r.writer.where === 'folder' ? getFolder() : r.writer.dir).then(d => d?.removeEntry(r.name)).catch(() => {}));
  rec = null;
  send({ evt: 'error', message: String(err?.message || err) });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'offscreen') return;
  switch (msg.cmd) {
    case 'record':
      // Reply as soon as capture has started (or failed); countdown continues afterwards.
      (async () => {
        try {
          await prepare(msg);
        } catch (err) {
          rec = null;
          reply({ ok: false, error: String(err?.message || err) });
          return;
        }
        reply({ ok: true });
        begin(msg.settings).catch(fail);
      })();
      return true;
    case 'pause': pause(); break;
    case 'resume': resume(); break;
    case 'stop': stop(); break;
    case 'cancel': cancel(); break;
  }
  reply({ ok: true });
});
