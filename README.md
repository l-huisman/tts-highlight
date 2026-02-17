# TTS Highlight

Read your Obsidian notes aloud with **real-time word-by-word highlighting**. Uses your system's built-in text-to-speech voices via the browser SpeechSynthesis API — no cloud services, no API keys, completely offline.

## Features

- **Word-by-word highlighting** as text is spoken, in all editor modes:
  - Source mode (CM6 decorations)
  - Live Preview (including inside rendered tables)
  - Reading mode (CSS Custom Highlight API with `<mark>` fallback)
- **Read full note, from cursor, or selection only**
- **Pause, resume, and stop** via commands, ribbon icon, or status bar controls
- **Configurable voice, rate, pitch, and volume**
- **Custom highlight color** or use your vault's accent color
- **Auto-scroll** to keep the current word visible
- **Smart markdown stripping** — headings, bold/italic markers, link syntax, code fences, frontmatter, and table formatting are stripped before speaking, with a character-level position map back to the editor
- **Large document support** — text is chunked at sentence boundaries to avoid browser speech cutoffs
- **Edge case handling** — stops on document edit, stops on note switch, handles Safari quirks (missing `charLength`, `end` event not firing after `cancel`)

## Commands

| Command | Description |
|---|---|
| **Read aloud** | Read the entire note from the beginning |
| **Read from cursor** | Read from the current cursor position to the end |
| **Read selection aloud** | Read only the selected text |
| **Pause / Resume** | Toggle pause (starts reading if idle) |
| **Stop** | Stop playback and clear highlighting |

No default hotkeys are assigned to avoid conflicts. Bind them in **Settings > Hotkeys** by searching for "TTS Highlight".

## Settings

| Setting | Description | Default |
|---|---|---|
| Voice | Select from available system voices | System default |
| Rate | Speech speed (0.5x - 2.0x) | 1.0 |
| Pitch | Voice pitch (0.5 - 2.0) | 1.0 |
| Volume | Playback volume (0.0 - 1.0) | 1.0 |
| Highlight color | CSS color for the highlighted word | Accent color at 35% opacity |
| Auto-scroll | Scroll to keep the highlighted word visible | On |
| Chunk size | Max characters per speech chunk | 5000 |

The settings tab also includes a **Hotkeys** section with quick access to configure keyboard shortcuts for each command.

## Installation

### From Community Plugins

1. Open **Settings > Community plugins**
2. Search for "TTS Highlight"
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/l-huisman/tts-highlight/releases/latest)
2. Create a folder `tts-highlight` in your vault's `.obsidian/plugins/` directory
3. Copy the three files into that folder
4. Enable the plugin in **Settings > Community plugins**

## Known Limitations

- **Desktop only.** The `SpeechSynthesisUtterance` `boundary` event (which provides word positions) does not fire on Android. The plugin is marked `isDesktopOnly` in the manifest.
- **Voice availability varies by OS.** macOS includes high-quality voices out of the box. Windows and Linux may have fewer options — install additional voices through your OS settings.
- **Chrome long-utterance cutoff.** Chrome silently stops speaking after ~15 seconds of continuous speech. The plugin mitigates this by splitting text into chunks at sentence boundaries. If you experience cutoffs, try reducing the chunk size in settings.
- **Safari quirks.** Safari does not report `charLength` in boundary events and does not fire the `end` event after `cancel()`. The plugin includes workarounds for both.

## Development

```bash
# Install dependencies
npm install

# Build (watch mode)
npm run dev

# Production build
npm run build
```

## License

[MIT](LICENSE)
