<p align="center">
  <img src="docs/banner.png" alt="Recorder Chrome AppAlbania" width="100%">
</p>

<h1 align="center">Recorder Chrome AppAlbania</h1>

<p align="center">
  Record a tab, a Chrome window or your whole screen in <b>Full HD</b>, with PC sound and your headphones mic.<br>
  Simple, private, no account, everything stays on your computer.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-ef4444?style=flat-square">
  <img alt="Chrome 116+" src="https://img.shields.io/badge/Chrome-116%2B-0f172a?style=flat-square&logo=googlechrome&logoColor=white">
  <img alt="Full HD" src="https://img.shields.io/badge/Video-1080p%20%C2%B7%2060fps-0f172a?style=flat-square">
  <img alt="MP4" src="https://img.shields.io/badge/Format-MP4%20%2F%20WebM-0f172a?style=flat-square">
  <img alt="Languages" src="https://img.shields.io/badge/Lang-Shqip%20%C2%B7%20English-0f172a?style=flat-square">
</p>

---

## Features

| | |
|---|---|
| **Two ways to record** | **This tab:** only the page, no browser bars. **Window / screen:** a Chrome window or the whole screen. |
| **Full HD** | 720p, **1080p** or 4K at 30 or 60 fps. MP4 (H.264 + AAC) plays everywhere, WebM is optional. |
| **Sound** | Tab sound or **PC sound** (music from other apps via "Share system audio"), plus any **microphone**: AirPods, headphones or the Mac mic. |
| **Simple menu** | Click the icon to get the menu. Start, pause, stop. A big 3-2-1 countdown on the page, and the timer shows right on the icon. No new tabs. |
| **Your folder** | Saves to `Downloads/Recorder Chrome AppAlbania` or **any folder you choose**. |
| **Recordings** | A gallery of your videos: play, rename, download, show in folder, delete. |
| **Shortcut** | <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> starts and stops recording. You can change it. |
| **Light & dark** | Follows your system theme. Albanian and English. |

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/popup-dark.png">
        <img src="docs/popup-light.png" width="340" alt="Menu">
      </picture>
      <br><sub><b>Menu:</b> choose tab or window, PC sound and mic</sub>
    </td>
    <td align="center" width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/popup-rec-dark.png">
        <img src="docs/popup-rec-light.png" width="340" alt="Recording">
      </picture>
      <br><sub><b>Recording:</b> 3-2-1 countdown, timer, pause, stop</sub>
    </td>
  </tr>
</table>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/library-dark.png">
  <img src="docs/library-light.png" alt="Recordings">
</picture>
<p align="center"><sub><b>Recordings:</b> all your videos in one place</sub></p>

<details>
<summary><b>Settings</b></summary>
<br>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/settings-dark.png">
  <img src="docs/settings-light.png" width="600" alt="Settings">
</picture>
</details>

## Install

1. Download this repo (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `Recorder-chrome` folder.
4. Pin **Recorder Chrome AppAlbania** to the toolbar.

## How to use

1. Click the extension icon.
2. Pick **This tab** or **Window / screen**.
3. Turn **PC sound** on or off and choose a microphone (or *No microphone*).
4. Press **Stop** when done. The video is saved and shows up in **Recordings**.

> **PC music on Mac:** choose *Window / screen* and turn on **"Share system audio"** in Chrome's picker (Chrome 141+, macOS 14.2+).
> **Microphone:** the first time you pick one, Settings asks for permission once.

## Privacy

Nothing is uploaded. Recordings are written straight to your disk. There are no analytics, no accounts and no servers.

## Project structure

```
manifest.json
icons/                 extension icons
src/
  background.js        start/stop, badge timer, downloads, shortcut
  offscreen.js         capture + MediaRecorder, writes 1 s chunks to disk
  popup.*              toolbar menu
  library.*            Recordings page
  options.*            Settings page
  shared.js            settings, translations (sq/en), icons
docs/                  screenshots
```

---

<p align="center">Made by <b>AppAlbania</b></p>
