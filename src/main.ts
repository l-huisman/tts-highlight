import {
	Plugin,
	MarkdownView,
	Notice,
	type Editor,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { DEFAULT_SETTINGS } from "./types";
import type { TTSSettings } from "./types";
import { TTSSettingTab } from "./settings";
import { PlaybackController } from "./tts/PlaybackController";
import { SpeechEngine } from "./tts/SpeechEngine";
import { ttsHighlightExtension, setDocChangeCallback } from "./editor/highlightExtension";
import { StatusBarControl } from "./ui/StatusBarControl";

export default class TTSHighlightPlugin extends Plugin {
	settings: TTSSettings = DEFAULT_SETTINGS;
	private controller: PlaybackController = new PlaybackController();
	private statusBar: StatusBarControl | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Load voices early
		void SpeechEngine.loadVoices();

		// Register CM6 extension for source/live-preview highlighting
		this.registerEditorExtension(ttsHighlightExtension);

		// Stop playback when document is edited
		setDocChangeCallback(() => {
			if (this.controller.getState() !== "idle") {
				this.controller.stop();
				new Notice("Playback stopped: document was edited.");
			}
		});

		// Setup controller callbacks
		this.controller.setStateChangeCallback((state, chunk, total) => {
			this.statusBar?.update(state, chunk, total);
		});

		this.controller.setEndCallback(() => {
			this.statusBar?.update("idle", 0, 0);
		});

		// Status bar
		this.statusBar = new StatusBarControl(
			this,
			() => this.controller.togglePause(),
			() => this.controller.stop()
		);

		// Commands
		this.addCommand({
			id: "read-aloud",
			name: "Read aloud",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.readAloud(view, "full");
			},
		});

		this.addCommand({
			id: "read-from-cursor",
			name: "Read from cursor",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.readAloud(view, "cursor");
			},
		});

		this.addCommand({
			id: "read-selection-aloud",
			name: "Read selection aloud",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.readAloud(view, "selection");
			},
		});

		this.addCommand({
			id: "pause-resume",
			name: "Pause / resume",
			callback: () => {
				if (this.controller.getState() === "idle") {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) this.readAloud(view, "full");
				} else {
					this.controller.togglePause();
				}
			},
		});

		this.addCommand({
			id: "stop",
			name: "Stop",
			callback: () => {
				this.controller.stop();
			},
		});

		// Ribbon icon
		this.addRibbonIcon("audio-lines", "TTS highlight", () => {
			if (this.controller.getState() !== "idle") {
				this.controller.stop();
			} else {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					this.readAloud(view, "full");
				} else {
					new Notice("Open a note to read aloud.");
				}
			}
		});

		// Stop on note switch
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.controller.getState() !== "idle") {
					this.controller.stop();
				}
			})
		);

		// Settings tab
		this.addSettingTab(new TTSSettingTab(this.app, this));

		// Apply custom highlight color on load
		if (this.settings.highlightColor) {
			document.body.style.setProperty("--tts-highlight-color", this.settings.highlightColor);
		}
	}

	onunload(): void {
		this.controller.stop();
		setDocChangeCallback(null);
		this.statusBar?.destroy();
		document.body.style.removeProperty("--tts-highlight-color");
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<TTSSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private readAloud(view: MarkdownView, mode: "full" | "selection" | "cursor"): void {
		const state = view.getState();
		const isReadingMode = state.mode === "preview";

		let rawText: string;
		let editorOffset = 0;
		let editorView: EditorView | null = null;
		let readingContainer: HTMLElement | null = null;

		if (mode === "selection") {
			const editor = view.editor;
			rawText = editor.getSelection();
			if (!rawText.trim()) {
				new Notice("No text selected.");
				return;
			}
			const from = editor.getCursor("from");
			editorOffset = editor.posToOffset(from);
		} else if (mode === "cursor") {
			const editor = view.editor;
			const cursor = editor.getCursor();
			editorOffset = editor.posToOffset(cursor);
			const fullText = editor.getValue();
			rawText = fullText.substring(editorOffset);
		} else {
			rawText = view.editor.getValue();
		}

		if (!rawText.trim()) {
			new Notice("Nothing to read.");
			return;
		}

		if (isReadingMode) {
			// Reading mode: use the preview container
			readingContainer = view.contentEl.querySelector<HTMLElement>(
				".markdown-preview-view .markdown-preview-sizer"
			);
			if (!readingContainer) {
				readingContainer = view.contentEl.querySelector<HTMLElement>(
					".markdown-preview-view"
				);
			}
		} else {
			// Source/live-preview mode: get the CM6 EditorView
			editorView = this.getEditorView(view);
		}

		this.controller.play(rawText, this.settings, editorView, readingContainer, editorOffset);
	}

	private getEditorView(view: MarkdownView): EditorView | null {
		// Access the CM6 EditorView from Obsidian's editor
		const cmEditor = (view.editor as unknown as { cm?: EditorView })?.cm;
		if (cmEditor instanceof EditorView) {
			return cmEditor;
		}
		return null;
	}
}
