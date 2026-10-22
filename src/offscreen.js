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

async function capture(mode, streamId, wantSourceAudio, settings) {
  const q = QUALITY[settings.quality] || QUALITY['1080'];
  const source = mode === 'tab' ? 'tab' : 'desktop';
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
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: wantSourceAudio ? audio : false, video });
  } catch (err) {
    if (!wantSourceAudio || mode === 'tab') throw err;
    return navigator.mediaDevices.getUserMedia({ audio: false, video });   // system audio unavailable here
  }
}

// The recorder never sees the captured track directly: frames are copied into one generator
// track, so a paused tab recording can continue on another tab (new capture, same video file).
function attachSource(r, media) {
  const old = r.source;
  const src = { media, audio: null, reader: null };
  r.source = src;

  const [track] = media.getVideoTracks();
  // User pressed Chrome's "Stop sharing" or closed the tab that is being recorded.
  track.addEventListener('ended', () => { if (r.source === src) stop(); });
  src.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  (async () => {
    for (;;) {
      const { value: frame, done } = await src.reader.read().catch(() => ({ done: true }));
      if (done) return;
      if (r.source !== src) { frame.close(); return; }
      await r.frames.write(frame).catch(() => frame.close());
    }
  })();

  if (media.getAudioTracks().length) {
    src.audio = r.ctx.createMediaStreamSource(new MediaStream(media.getAudioTracks()));
    src.audio.connect(r.mixed);
    if (r.mode === 'tab') src.audio.connect(r.ctx.destination);
  }

  if (old) detachSource(old);
}

function detachSource(src) {
  src.reader?.cancel().catch(() => {});
  src.audio?.disconnect();
  src.media.getTracks().forEach(t => t.stop());
}

async function prepare({ mode, streamId, canAudio, settings }) {
  const q = QUALITY[settings.quality] || QUALITY['1080'];
  const wantSourceAudio = settings.tabAudio && canAudio;
  const media = await capture(mode, streamId, wantSourceAudio, settings);

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
  // Tab mode keeps an audio track even when the tab is silent, so a later tab can bring sound.
  const hasAudio = !!(mic || media.getAudioTracks().length || (mode === 'tab' && wantSourceAudio));
  if (mic) ctx.createMediaStreamSource(mic).connect(mixed);

  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const tracks = [generator, ...(hasAudio ? mixed.stream.getAudioTracks() : [])];
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
    mode, name, writer, recorder, mic, ctx, mixed, ext, settings, wantSourceAudio,
    generator, frames: generator.writable.getWriter(), source: null,
    chain: Promise.resolve(), bytes: 0,
    activeMs: 0, lastStart: 0, cancelled: false, timer: null, stopping: false
  };
  attachSource(rec, media);

  recorder.ondataavailable = e => {
    if (!e.data.size || rec.cancelled) return;
    rec.bytes += e.data.size;
    rec.chain = rec.chain.then(() => writer.w.write(e.data));
  };
  recorder.onstop = () => finalize().catch(err => fail(err));
}

// Paused on one tab, resumed on another: capture the new tab and keep writing the same file.
async function switchTab(streamId) {
  const r = rec;
  if (!r || r.mode !== 'tab' || r.stopping) return { ok: false, error: 'not recording' };
  const media = await capture('tab', streamId, r.wantSourceAudio, r.settings);
  if (rec !== r || r.stopping) { media.getTracks().forEach(t => t.stop()); return { ok: false, error: 'stopped' }; }
  attachSource(r, media);
  return { ok: true };
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
  const src = rec.source;
  rec.source = null;
  if (src) detachSource(src);
  rec.generator.stop();
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
    case 'switch':
      switchTab(msg.streamId).then(reply, err => reply({ ok: false, error: String(err?.message || err) }));
      return true;
    case 'pause': pause(); break;
    case 'resume': resume(); break;
    case 'stop': stop(); break;
    case 'cancel': cancel(); break;
  }
  reply({ ok: true });
});
