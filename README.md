# CatCut

CatCut is a small, fast video editor for Ubuntu. It trims and combines videos and adds the text, reaction clips, pictures, and sound effects commonly used in YouTube videos.

## Main features

- Open videos without loading the whole file into memory.
- Remove any number of unwanted ranges with simple cut points.
- Add timed text, images, videos, and audio.
- Move and resize visual overlays directly on the preview.
- Insert additional videos with optional transitions, including fades, wipes, slides, zoom, and blur.
- Create landscape videos or cropped 9:16 Shorts.
- Preview images and videos before adding them.
- Adjust overlay timing, opacity, volume, text styling, video audio, and looping.
- Export at high quality using an Intel discrete GPU or iGPU when available, selecting the best supported hardware codec (AV1, HEVC, then H.264) and automatically falling back to another GPU or all CPU cores.
- Use the optional, separately downloaded library of redistributable reaction media.
- Undo and redo edits, including cut points.

CatCut automatically restores the active project after it closes. Choose **Project → Reset project** to forget it and start over. Exported videos are normal files and remain on disk.

## Requirements

- Ubuntu 26.04
- GNOME on Wayland
- 64-bit Intel or AMD computer

Other Linux desktops, X11, Windows, and macOS are not currently supported.

### Intel hardware acceleration

CatCut includes a VAAPI-enabled FFmpeg. On Intel systems, install the media driver and give your user access to GPU render devices:

```bash
sudo apt install intel-media-va-driver-non-free vainfo
sudo usermod --append --groups render,video "$USER"
```

Log out and back in, then confirm that `id` lists `render` and `video` and that `vainfo --display drm --device /dev/dri/renderD128` succeeds. Render-node numbers may differ on multi-GPU systems. CatCut tries an Intel discrete GPU first, then an Intel iGPU, other VAAPI devices, and finally CPU encoding; no separate FFmpeg package is required.

## Install and run

Download the AppImage from the [Releases](https://github.com/mstasenko/catcut/releases) page, make it executable, and open it:

```bash
chmod +x catcut-*.AppImage
./catcut-*.AppImage
```

The first launch adds CatCut to the current user's application menu. It does not need `sudo`.

The optional media-pack ZIP is a separate release download. Extract it beside the AppImage so the layout is:

```text
catcut-*.AppImage
meme/
  image/
  video/
  audio/
```

CatCut still works without the pack; use **New** to add your own media.

## Basic editing

1. Drop a video into CatCut or choose **Open**.
2. Move the playhead and press **Cut point** around an unwanted section.
3. Move the playhead into the highlighted section and press **Cut**.
4. Add text or choose an image, video, or audio item from the left panel.
5. Choose **Export**.

Open and Export start in Videos. New media starts in Downloads. Each remembers its last folder only until CatCut closes. Export blocks editing while it runs and can be cancelled safely.

Useful shortcuts:

| Key | Action |
| --- | --- |
| Space | Play or pause |
| Left / Right | Move five seconds |
| Mouse wheel over timeline | Zoom |
| Delete | Remove the selected item or highlighted range |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |

## Development

Install Node.js 22.22 or newer and npm 11.18, then run:

```bash
npm install
npm run dev
```

FFmpeg is included through npm for development and as a pinned VAAPI-enabled release build in the AppImage; a separate FFmpeg installation is not required. Dependency versions are exact, install scripts are allowlisted, and newly published packages are delayed for seven days.

Build a local AppImage and media-pack ZIP with:

```bash
npm run package
```

Outputs are written to `release/`. There is no deployment script or Docker requirement.

Run every check with:

```bash
npm test
```

This runs strict linting, type checking, unit and integration tests, maintainability checks, a production build, and real Electron GUI tests. GUI tests use a private headless GNOME session, so they do not show windows or steal focus from the desktop. Authored source files are limited to 500 lines and application functions must have a CRAP score of 30 or less.

## Media and license

The optional pack contains only media with documented redistribution terms. Its `manifest.json` records the source, author, license, and any conversion for every file. Media sources are cached in `dist/media-cache`, so unchanged files are not downloaded again during later local builds.

CatCut is licensed under GPL-3.0-only. Media, fonts, and FFmpeg components retain their own licenses.
