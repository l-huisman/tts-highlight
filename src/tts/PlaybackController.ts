import { EditorView } from "@codemirror/view";
import type { TTSSettings, PreparedText, PlaybackState, EditorRange } from "../types";
import { SpeechEngine } from "./SpeechEngine";
import { TextPreparer } from "./TextPreparer";
import { setTTSHighlight } from "../editor/highlightExtension";
import { ReadingHighlighter } from "../editor/readingHighlighter";

export type HighlightCallback = (range: EditorRange) => void;
export type StateChangeCallback = (state: PlaybackState, chunkIndex: number, totalChunks: number) => void;
export type EndCallback = () => void;

export class PlaybackController {
	private engine: SpeechEngine;
	private preparer: TextPreparer;
	private readingHighlighter: ReadingHighlighter;
	/** Separate highlighter for Live Preview widget content (tables etc.) */
	private widgetHighlighter: ReadingHighlighter;
	private prepared: PreparedText | null = null;
	private currentChunk = 0;
	private state: PlaybackState = "idle";
	private editorView: EditorView | null = null;
	private readingContainer: HTMLElement | null = null;
	private lastHighlightFrame: number | null = null;
	private settings: TTSSettings | null = null;
	/** Whether the current playback target is reading mode */
	private isReadingMode = false;

	// Callbacks
	private onStateChange: StateChangeCallback | null = null;
	private onHighlight: HighlightCallback | null = null;
	private onEnd: EndCallback | null = null;

	constructor() {
		this.engine = new SpeechEngine();
		this.preparer = new TextPreparer();
		this.readingHighlighter = new ReadingHighlighter();
		this.widgetHighlighter = new ReadingHighlighter();

		this.engine.setBoundaryCallback(this.handleBoundary.bind(this));
		this.engine.setEndCallback(this.handleChunkEnd.bind(this));
		this.engine.setErrorCallback(this.handleError.bind(this));
	}

	setStateChangeCallback(cb: StateChangeCallback): void {
		this.onStateChange = cb;
	}

	setHighlightCallback(cb: HighlightCallback): void {
		this.onHighlight = cb;
	}

	setEndCallback(cb: EndCallback): void {
		this.onEnd = cb;
	}

	getState(): PlaybackState {
		return this.state;
	}

	getCurrentChunk(): number {
		return this.currentChunk;
	}

	getTotalChunks(): number {
		return this.prepared?.chunks.length ?? 0;
	}

	play(
		rawText: string,
		settings: TTSSettings,
		editorView: EditorView | null,
		readingContainer: HTMLElement | null,
		editorOffset = 0
	): void {
		this.stop();
		this.settings = settings;
		this.editorView = editorView;
		this.readingContainer = readingContainer;
		this.isReadingMode = readingContainer !== null;

		this.prepared = this.preparer.prepare(rawText, settings.chunkSize, editorOffset);

		if (this.prepared.chunks.length === 0) {
			return;
		}

		// Prepare the DOM-based highlighters
		if (this.readingContainer) {
			this.readingHighlighter.prepare(this.readingContainer);
		}
		if (this.editorView) {
			this.widgetHighlighter.reset();
		}

		this.currentChunk = 0;
		this.setState("playing");
		this.speakCurrentChunk();
	}

	pause(): void {
		if (this.state !== "playing") return;
		this.engine.pause();
		this.setState("paused");
	}

	resume(): void {
		if (this.state !== "paused") return;
		this.engine.resume();
		this.setState("playing");
	}

	togglePause(): void {
		if (this.state === "playing") {
			this.pause();
		} else if (this.state === "paused") {
			this.resume();
		}
	}

	stop(): void {
		if (this.state === "idle") return;
		this.engine.cancel();
		this.clearHighlight();
		this.readingHighlighter.reset();
		this.widgetHighlighter.reset();
		this.setState("idle");
		this.prepared = null;
		this.onEnd?.();
	}

	notifyDocumentChanged(): void {
		if (this.state !== "idle") {
			this.stop();
		}
	}

	private speakCurrentChunk(): void {
		if (!this.prepared || !this.settings) return;
		if (this.currentChunk >= this.prepared.chunks.length) {
			this.clearHighlight();
			this.setState("idle");
			this.onEnd?.();
			return;
		}

		this.engine.speak(this.prepared.chunks[this.currentChunk], this.settings);
	}

	private handleBoundary(charIndex: number, charLength: number): void {
		if (!this.prepared || this.state !== "playing") return;

		// Convert chunk-local charIndex to global plain-text index
		const chunkOffset = this.prepared.chunkOffsets[this.currentChunk] ?? 0;
		const globalPlainFrom = chunkOffset + charIndex;
		const globalPlainTo = globalPlainFrom + charLength;

		const editorRange = this.preparer.toEditorRange(
			this.prepared.map,
			globalPlainFrom,
			globalPlainTo
		);

		if (!editorRange) return;

		// Extract the actual word text from the chunk for DOM-based search
		const chunk = this.prepared.chunks[this.currentChunk];
		const wordText = chunk.substring(charIndex, charIndex + charLength);

		// Throttle highlight updates with requestAnimationFrame
		if (this.lastHighlightFrame !== null) {
			cancelAnimationFrame(this.lastHighlightFrame);
		}

		this.lastHighlightFrame = requestAnimationFrame(() => {
			this.lastHighlightFrame = null;
			this.applyHighlight(editorRange, wordText);
		});
	}

	private applyHighlight(editorRange: EditorRange, wordText: string): void {
		// --- Reading mode: use sequential DOM word search ---
		if (this.readingContainer) {
			this.readingHighlighter.highlightWord(this.readingContainer, wordText);

			if (this.settings?.autoScroll) {
				this.scrollToMark(this.readingContainer);
			}

			this.onHighlight?.(editorRange);
			return;
		}

		// --- Source / Live Preview mode ---
		if (this.editorView) {
			try {
				// Clear previous widget highlight
				this.widgetHighlighter.clear();

				// Apply CM6 decoration (works for regular text in both modes)
				this.editorView.dispatch({
					effects: setTTSHighlight.of(editorRange),
				});

				// Check if the CM6 decoration is actually visible in the DOM.
				// In Live Preview, content inside widgets (tables, embeds) is
				// replaced by widget DOM — the CM6 mark decoration exists at the
				// right document positions but is invisible.
				const markedSpan = this.editorView.dom.querySelector(".tts-word-current");
				if (!markedSpan) {
					// Decoration not rendered → position is inside a widget.
					// Search for the word in widget elements using sequential DOM search.
					this.highlightInWidgets(wordText);
				}

				// Auto-scroll
				if (this.settings?.autoScroll) {
					// Prefer scrolling to a widget mark if one exists
					const widgetMark = this.editorView.dom.querySelector("mark.tts-word-current");
					if (widgetMark instanceof HTMLElement) {
						const rect = widgetMark.getBoundingClientRect();
						const viewRect = this.editorView.dom.getBoundingClientRect();
						if (rect.top < viewRect.top + 50 || rect.bottom > viewRect.bottom - 50) {
							widgetMark.scrollIntoView({ block: "center", behavior: "smooth" });
						}
					} else {
						const coords = this.editorView.coordsAtPos(editorRange.from);
						if (coords) {
							const viewRect = this.editorView.dom.getBoundingClientRect();
							if (coords.top < viewRect.top + 50 || coords.bottom > viewRect.bottom - 50) {
								this.editorView.dispatch({
									effects: EditorView.scrollIntoView(editorRange.from, { y: "center" }),
								});
							}
						}
					}
				}
			} catch {
				// Editor may have been destroyed
			}
		}

		this.onHighlight?.(editorRange);
	}

	/**
	 * Search for and highlight a word inside Live Preview widget elements
	 * (tables, embeds, etc.) using the widgetHighlighter.
	 */
	private highlightInWidgets(word: string): void {
		if (!this.editorView) return;

		// Collect all widget containers in the editor
		const widgetEls = this.editorView.contentDOM.querySelectorAll(
			".cm-embed-block, .cm-widget, .cm-table-widget"
		);

		if (widgetEls.length === 0) return;

		// Build a temporary wrapper containing all widget content for the search.
		// The widgetHighlighter maintains its own search cursor so it handles
		// sequential highlighting across multiple widgets correctly.
		//
		// We use the editor's contentDOM as the search container but the
		// widgetHighlighter's sequential search + the fact that the word only
		// appears in widget text means it finds the right occurrence.

		// Use the editor's contentDOM — the widgetHighlighter will search
		// all text nodes, but since the CM6 decoration already covers regular
		// text, we only call this when the word is NOT in regular text.
		this.widgetHighlighter.highlightWord(
			this.editorView.contentDOM as HTMLElement,
			word
		);
	}

	private scrollToMark(container: HTMLElement): void {
		const mark = container.querySelector("mark.tts-word-current");
		if (mark instanceof HTMLElement) {
			const rect = mark.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			if (rect.top < containerRect.top + 50 || rect.bottom > containerRect.bottom - 50) {
				mark.scrollIntoView({ block: "center", behavior: "smooth" });
			}
		}
	}

	private clearHighlight(): void {
		if (this.lastHighlightFrame !== null) {
			cancelAnimationFrame(this.lastHighlightFrame);
			this.lastHighlightFrame = null;
		}

		this.widgetHighlighter.clear();
		this.readingHighlighter.clear();

		if (this.editorView) {
			try {
				this.editorView.dispatch({
					effects: setTTSHighlight.of(null),
				});
			} catch {
				// Editor may have been destroyed
			}
		}
	}

	private handleChunkEnd(): void {
		if (this.state !== "playing" || !this.prepared) return;

		this.currentChunk++;
		if (this.currentChunk < this.prepared.chunks.length) {
			this.emitStateChange();
			this.speakCurrentChunk();
		} else {
			this.clearHighlight();
			this.setState("idle");
			this.onEnd?.();
		}
	}

	private handleError(error: string): void {
		console.error("TTS Error:", error);
		this.stop();
	}

	private setState(state: PlaybackState): void {
		this.state = state;
		this.emitStateChange();
	}

	private emitStateChange(): void {
		this.onStateChange?.(
			this.state,
			this.currentChunk,
			this.prepared?.chunks.length ?? 0
		);
	}
}
