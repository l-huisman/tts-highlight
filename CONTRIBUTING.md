# Contributing to TTS Highlight

Thank you for your interest in contributing! This document explains how to set up the project for development, the standards we follow, and how to submit changes.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- An Obsidian vault for testing

### Getting Started

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build in watch mode:
   ```bash
   npm run dev
   ```
4. Symlink or copy the plugin folder into your vault's `.obsidian/plugins/tts-highlight/` directory
5. Enable the plugin in **Settings > Community plugins**

### Building

```bash
# Development (watch mode)
npm run dev

# Production build
npm run build
```

The production build runs the TypeScript compiler for type checking, then bundles with esbuild.

## Project Structure

```
src/
  main.ts                      # Plugin entry point, commands, ribbon
  types.ts                     # Shared interfaces and types
  settings.ts                  # Settings tab UI
  tts/
    SpeechEngine.ts            # Web Speech API wrapper
    TextPreparer.ts            # Markdown stripping + position mapping
    PlaybackController.ts      # Playback orchestrator
  editor/
    highlightExtension.ts      # CM6 StateField for source/live-preview
    readingHighlighter.ts      # DOM-based highlighting for reading mode
  ui/
    StatusBarControl.ts        # Status bar play/pause/stop controls
```

## Code Standards

- **TypeScript** — all source files must be TypeScript with strict mode
- **Tabs** for indentation
- **No external runtime dependencies** — only `obsidian` and `@codemirror/*` (provided by Obsidian)
- **Desktop only** — the plugin relies on `SpeechSynthesisUtterance` boundary events which are not available on mobile
- Keep methods focused and under 50 lines where practical
- Use named constants for magic numbers
- Add `console.debug()` in catch blocks rather than swallowing errors silently

## Making Changes

### Branch Naming

Use the following prefixes:

| Prefix | Purpose |
|--------|---------|
| `feature/` | New features |
| `bugfix/` | Bug fixes |
| `chore/` | Refactoring, dependencies, tooling |
| `docs/` | Documentation changes |

Example: `feature/skip-code-blocks`, `bugfix/safari-boundary-fix`

### Commit Messages

Write short, descriptive commit messages in imperative form:

- `Add skip forward/backward commands`
- `Fix highlight not clearing on note switch`
- `Update esbuild to 0.25`

### Pull Requests

1. Create a branch from `main`
2. Make your changes with clear, focused commits
3. Ensure `npm run build` passes with no errors
4. Test in Obsidian across source mode, live preview, and reading mode
5. Open a PR against `main` with:
   - A short description of what changed and why
   - Testing steps if applicable

## Reporting Issues

When reporting a bug, please include:

- Obsidian version and OS
- Steps to reproduce
- Expected vs actual behavior
- Console errors if any (open with Ctrl/Cmd+Shift+I)

## Testing Checklist

Before submitting a PR, test these scenarios:

- [ ] Read a note with mixed formatting (headings, bold, links, code blocks, lists, tables)
- [ ] Verify highlighting in source mode, live preview, and reading mode
- [ ] Pause/resume and stop work correctly
- [ ] Edit during playback stops with a notice
- [ ] Switch notes during playback stops playback
- [ ] Test with a large document (1000+ words)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
