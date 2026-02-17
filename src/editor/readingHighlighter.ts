// Type declarations for CSS Custom Highlight API (not yet in TS lib)
declare class HighlightClass {
	constructor(...ranges: Range[]);
}
declare interface HighlightRegistry {
	set(name: string, highlight: HighlightClass): void;
	delete(name: string): void;
}
declare interface CSSWithHighlights {
	highlights: HighlightRegistry;
}

/** Max chars to backtrack when a sequential word search misses */
const SEARCH_BACKTRACK_CHARS = 20;

interface TextNodeEntry {
	node: Text;
	/** Cumulative character offset where this node starts in the full text */
	start: number;
}

/**
 * Handles word highlighting in rendered DOM content (reading mode and
 * Live Preview widgets) using sequential word search.
 *
 * Instead of mapping editor offsets to DOM positions (which fails because
 * rendered DOM text doesn't include markdown syntax), this walks all text
 * nodes, builds a concatenated text buffer, and finds words sequentially.
 */
export class ReadingHighlighter {
	private useCustomHighlight: boolean;
	private activeMarks: HTMLElement[] = [];
	private highlight: HighlightClass | null = null;

	/** Cursor tracking sequential position through the DOM text */
	private searchOffset = 0;
	/** Cached text node list for the current container */
	private textNodes: TextNodeEntry[] = [];
	/** Cached full text built from text nodes */
	private fullText = "";
	/** The container these caches were built for */
	private cachedContainer: HTMLElement | null = null;

	constructor() {
		this.useCustomHighlight =
			typeof CSS !== "undefined" &&
			"highlights" in CSS &&
			typeof (globalThis as Record<string, unknown>).Highlight !== "undefined";
	}

	/**
	 * Prepare for a new playback session. Builds the text node index
	 * for the given container. Call this once at playback start.
	 */
	prepare(container: HTMLElement): void {
		this.reset();
		this.buildIndex(container);
	}

	/** Reset sequential search state between playback sessions */
	reset(): void {
		this.searchOffset = 0;
		this.textNodes = [];
		this.fullText = "";
		this.cachedContainer = null;
		this.clear();
	}

	/**
	 * Highlight the next occurrence of `word` in the container.
	 * Uses sequential search so repeated words are handled correctly.
	 */
	highlightWord(container: HTMLElement, word: string): void {
		this.clear();

		// Rebuild index if container changed
		if (container !== this.cachedContainer) {
			this.buildIndex(container);
		}

		if (this.fullText.length === 0 || word.length === 0) return;

		// Search for the word starting from our current position
		let idx = this.fullText.indexOf(word, this.searchOffset);

		// If not found ahead, try a case-insensitive scan or small backtrack
		// (handles minor whitespace differences between TTS text and DOM text)
		if (idx === -1) {
			// Try searching from a bit before current position (backtrack up to 20 chars)
			const backtrack = Math.max(0, this.searchOffset - SEARCH_BACKTRACK_CHARS);
			idx = this.fullText.indexOf(word, backtrack);
		}

		if (idx === -1) return;

		// Advance cursor past this word
		this.searchOffset = idx + word.length;

		// Map the found position back to DOM text nodes
		const domRange = this.createDomRange(idx, idx + word.length);
		if (!domRange) return;

		if (this.useCustomHighlight) {
			this.applyHighlightCSS(domRange);
		} else {
			this.applyHighlightMark(domRange);
		}
	}

	clear(): void {
		if (this.useCustomHighlight) {
			try {
				(CSS as unknown as CSSWithHighlights).highlights.delete("tts-current-word");
			} catch (e) {
				console.debug("TTS Highlight: could not clear CSS custom highlight", e);
			}
			this.highlight = null;
		}

		for (const mark of this.activeMarks) {
			const parent = mark.parentNode;
			if (parent) {
				while (mark.firstChild) {
					parent.insertBefore(mark.firstChild, mark);
				}
				parent.removeChild(mark);
				parent.normalize();
			}
		}
		this.activeMarks = [];
	}

	/**
	 * Walk all text nodes in the container and build a flat text buffer
	 * plus a mapping from buffer offsets back to (textNode, localOffset).
	 */
	private buildIndex(container: HTMLElement): void {
		this.cachedContainer = container;
		this.textNodes = [];
		const parts: string[] = [];
		let offset = 0;

		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		let node: Text | null;
		while ((node = walker.nextNode() as Text | null)) {
			const text = node.textContent ?? "";
			if (text.length === 0) continue;
			this.textNodes.push({ node, start: offset });
			parts.push(text);
			offset += text.length;
		}

		this.fullText = parts.join("");
	}

	/**
	 * Create a DOM Range from buffer offsets using the text node index.
	 */
	private createDomRange(from: number, to: number): Range | null {
		let startNode: Text | null = null;
		let startOffset = 0;
		let endNode: Text | null = null;
		let endOffset = 0;

		for (let i = 0; i < this.textNodes.length; i++) {
			const entry = this.textNodes[i];
			const nodeLen = entry.node.textContent?.length ?? 0;
			const nodeEnd = entry.start + nodeLen;

			if (!startNode && from < nodeEnd) {
				startNode = entry.node;
				startOffset = from - entry.start;
			}

			if (to <= nodeEnd) {
				endNode = entry.node;
				endOffset = to - entry.start;
				break;
			}
		}

		if (!startNode || !endNode) return null;

		try {
			const range = document.createRange();
			range.setStart(startNode, startOffset);
			range.setEnd(endNode, endOffset);
			return range;
		} catch (e) {
			console.debug("TTS Highlight: could not create DOM range", e);
			return null;
		}
	}

	private applyHighlightCSS(range: Range): void {
		try {
			const HL = (globalThis as Record<string, unknown>).Highlight as typeof HighlightClass;
			this.highlight = new HL(range);
			(CSS as unknown as CSSWithHighlights).highlights.set("tts-current-word", this.highlight);
		} catch (e) {
			console.debug("TTS Highlight: CSS custom highlight failed, falling back to mark", e);
			this.applyHighlightMark(range);
		}
	}

	private applyHighlightMark(range: Range): void {
		try {
			const mark = document.createElement("mark");
			mark.className = "tts-word-current";
			range.surroundContents(mark);
			this.activeMarks.push(mark);
		} catch (e) {
			// surroundContents can fail if range spans element boundaries —
			// fall back to highlighting just the start node's portion
			console.debug("TTS Highlight: surroundContents failed, using splitText fallback", e);
			try {
				const startContainer = range.startContainer;
				if (startContainer.nodeType === Node.TEXT_NODE) {
					const textNode = startContainer as Text;
					const word = textNode.splitText(range.startOffset);
					const after = word.splitText(range.endOffset - range.startOffset);
					const mark = document.createElement("mark");
					mark.className = "tts-word-current";
					word.parentNode?.replaceChild(mark, word);
					mark.appendChild(word);
					this.activeMarks.push(mark);
				}
			} catch (e2) {
				console.debug("TTS Highlight: splitText fallback also failed", e2);
			}
		}
	}
}
