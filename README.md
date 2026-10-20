# Recorder Chrome AppAlbania

Chrome extension (Manifest V3) that records a tab or the whole Chrome window in Full HD (MP4 H.264/AAC, WebM fallback).

## Install (unpacked)
1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose this folder.
3. Pin the extension and click the icon.

## Where videos go
- Default: `Downloads/Recorder Chrome AppAlbania/` (a playable copy is also kept for the Recordings page).
- Settings → **Choose folder**: videos are written straight into that folder while recording and the Recordings page lists that folder. After a Chrome restart, Chrome may ask once to allow folder access again.

## Files
- `src/background.js` – service worker: start/stop, badge timer, downloads, shortcut (Alt+Shift+R)
- `src/offscreen.js` – capture + MediaRecorder, writes 1s chunks to disk
- `src/popup.*`, `src/library.*`, `src/options.*` – UI
- `src/shared.js` – settings, translations (sq/en), folder handle, icons
