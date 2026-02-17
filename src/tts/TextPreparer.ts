import type { PositionMapEntry, PreparedText } from "../types";

/** Minimum fraction of chunk used before accepting a sentence-boundary split */
const MIN_SENTENCE_SPLIT_RATIO = 0.5;
/** Minimum fraction of chunk used before accepting a word-boundary split */
const MIN_WORD_SPLIT_RATIO = 0.3;

/** Mutable parsing context threaded through helper methods */
interface StripContext {
	raw: string;
	len: number;
	editorOffset: number;
	out: string[];
	map: PositionMapEntry[];
	i: number;
	plainIndex: number;
	lineStart: boolean;
}

/**
 * Single-pass state-machine parser that strips markdown formatting while
 * building a bidirectional character-position map between the plain text
 * output and the original editor text.
 */
export class TextPreparer {
	/**
	 * Prepare text for TTS.
	 * @param raw The raw markdown text from the editor
	 * @param chunkSize Max characters per speech chunk
	 * @param editorOffset Starting editor offset (for selections)
	 */
	prepare(raw: string, chunkSize: number, editorOffset = 0): PreparedText {
		const { plainText, map } = this.stripMarkdown(raw, editorOffset);

		if (plainText.trim().length === 0) {
			return { chunks: [], map: [], chunkOffsets: [] };
		}

		const { chunks, chunkOffsets } = this.splitChunks(plainText, chunkSize);
		return { chunks, map, chunkOffsets };
	}

	/**
	 * Convert a range in plain-text coordinates to editor coordinates.
	 * Uses binary search over the position map.
	 */
	toEditorRange(
		map: PositionMapEntry[],
		plainFrom: number,
		plainTo: number
	): { from: number; to: number } | null {
		if (map.length === 0) return null;
		const from = this.lookupEditorOffset(map, plainFrom);
		const to = this.lookupEditorOffset(map, plainTo - 1);
		if (from === null || to === null) return null;
		return { from, to: to + 1 };
	}

	private lookupEditorOffset(
		map: PositionMapEntry[],
		plainIndex: number
	): number | null {
		if (map.length === 0) return null;

		let lo = 0;
		let hi = map.length - 1;

		if (plainIndex < map[0].plain) return map[0].editor;
		if (plainIndex >= map[hi].plain) {
			const last = map[hi];
			return last.editor + (plainIndex - last.plain);
		}

		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (map[mid].plain <= plainIndex) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}

		const entry = map[lo];
		return entry.editor + (plainIndex - entry.plain);
	}

	// ── Main strip loop ────────────────────────────────────────────────

	private stripMarkdown(
		raw: string,
		editorOffset: number
	): { plainText: string; map: PositionMapEntry[] } {
		const ctx: StripContext = {
			raw,
			len: raw.length,
			editorOffset,
			out: [],
			map: [],
			i: 0,
			plainIndex: 0,
			lineStart: true,
		};

		// Skip frontmatter opening
		if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
			const lineEnd = raw.indexOf("\n");
			ctx.i = lineEnd + 1;
			// Skip until closing ---
			this.skipFrontmatter(ctx);
		}

		while (ctx.i < ctx.len) {
			const ch = ctx.raw[ctx.i];

			// Line-start block-level syntax
			if (ctx.lineStart) {
				ctx.lineStart = false;
				if (this.tryLineStart(ctx, ch)) continue;
			}

			// Newlines
			if (ch === "\n") {
				this.pushChar(ctx, " ");
				ctx.i++;
				ctx.lineStart = true;
				continue;
			}
			if (ch === "\r") {
				ctx.i++;
				continue;
			}

			// Inline syntax
			if (this.tryInline(ctx, ch)) continue;

			// Regular character — keep it
			this.pushChar(ctx, ch);
			ctx.i++;
		}

		let plainText = ctx.out.join("").trim();
		return { plainText, map: ctx.map };
	}

	// ── Frontmatter ────────────────────────────────────────────────────

	private skipFrontmatter(ctx: StripContext): void {
		while (ctx.i < ctx.len) {
			const nlIdx = ctx.raw.indexOf("\n", ctx.i);
			if (nlIdx === -1) {
				ctx.i = ctx.len;
				return;
			}
			const line = ctx.raw.substring(ctx.i, nlIdx).replace(/\r$/, "");
			ctx.i = nlIdx + 1;
			if (line === "---") {
				ctx.lineStart = true;
				return;
			}
		}
	}

	// ── Line-start block elements ──────────────────────────────────────

	/**
	 * Try to consume a block-level prefix at the start of a line.
	 * Returns true if something was consumed and the main loop should continue.
	 */
	private tryLineStart(ctx: StripContext, ch: string): boolean {
		return (
			this.tryTableSeparator(ctx, ch) ||
			this.tryCodeFence(ctx, ch) ||
			this.tryHeading(ctx, ch) ||
			this.tryBlockquote(ctx, ch) ||
			this.tryUnorderedList(ctx, ch) ||
			this.tryOrderedList(ctx, ch) ||
			this.tryHorizontalRule(ctx, ch)
		);
	}

	/** Skip table separator rows like | --- | --- | */
	private tryTableSeparator(ctx: StripContext, ch: string): boolean {
		if (ch !== "|") return false;

		const nlIdx = ctx.raw.indexOf("\n", ctx.i);
		const lineEnd = nlIdx === -1 ? ctx.len : nlIdx;
		const line = ctx.raw.substring(ctx.i, lineEnd).trim();

		if (/^\|[\s:|-]+\|$/.test(line) && line.includes("-")) {
			ctx.i = nlIdx === -1 ? ctx.len : nlIdx + 1;
			ctx.lineStart = true;
			return true;
		}
		return false;
	}

	/** Skip fenced code blocks (``` or ~~~) */
	private tryCodeFence(ctx: StripContext, ch: string): boolean {
		const { raw, len } = ctx;
		if (
			!(ch === "`" && raw[ctx.i + 1] === "`" && raw[ctx.i + 2] === "`") &&
			!(ch === "~" && raw[ctx.i + 1] === "~" && raw[ctx.i + 2] === "~")
		) {
			return false;
		}

		const fence = ch;
		// Skip opening fence line
		const nlIdx = raw.indexOf("\n", ctx.i);
		if (nlIdx === -1) {
			ctx.i = len;
			return true;
		}
		ctx.i = nlIdx + 1;

		// Skip until closing fence
		while (ctx.i < len) {
			const fenceNl = raw.indexOf("\n", ctx.i);
			const fenceEnd = fenceNl === -1 ? len : fenceNl;
			const fenceLine = raw.substring(ctx.i, fenceEnd).trimStart();
			ctx.i = fenceNl === -1 ? len : fenceNl + 1;
			if (
				fenceLine.length >= 3 &&
				fenceLine[0] === fence &&
				fenceLine[1] === fence &&
				fenceLine[2] === fence
			) {
				break;
			}
		}
		ctx.lineStart = true;
		return true;
	}

	/** Strip heading prefix (# ## ### etc.) */
	private tryHeading(ctx: StripContext, ch: string): boolean {
		if (ch !== "#") return false;

		let hi = ctx.i;
		while (hi < ctx.len && ctx.raw[hi] === "#") hi++;
		if (hi < ctx.len && ctx.raw[hi] === " ") {
			ctx.i = hi + 1;
			return true;
		}
		return false;
	}

	/** Strip blockquote prefix (>) */
	private tryBlockquote(ctx: StripContext, ch: string): boolean {
		if (ch !== ">") return false;
		ctx.i++;
		if (ctx.i < ctx.len && ctx.raw[ctx.i] === " ") ctx.i++;
		return true;
	}

	/** Strip unordered list prefix (- , * , +) */
	private tryUnorderedList(ctx: StripContext, ch: string): boolean {
		if (
			(ch === "-" || ch === "*" || ch === "+") &&
			ctx.i + 1 < ctx.len &&
			ctx.raw[ctx.i + 1] === " "
		) {
			ctx.i += 2;
			return true;
		}
		return false;
	}

	/** Strip ordered list prefix (1. 2. etc.) */
	private tryOrderedList(ctx: StripContext, ch: string): boolean {
		if (ch < "0" || ch > "9") return false;

		let ni = ctx.i;
		while (ni < ctx.len && ctx.raw[ni] >= "0" && ctx.raw[ni] <= "9") ni++;
		if (ni < ctx.len && ctx.raw[ni] === "." && ni + 1 < ctx.len && ctx.raw[ni + 1] === " ") {
			ctx.i = ni + 2;
			return true;
		}
		return false;
	}

	/** Skip horizontal rules (---, ***, ___) */
	private tryHorizontalRule(ctx: StripContext, ch: string): boolean {
		if (
			!(ch === "-" || ch === "*" || ch === "_") ||
			ctx.i + 2 >= ctx.len ||
			ctx.raw[ctx.i + 1] !== ch ||
			ctx.raw[ctx.i + 2] !== ch
		) {
			return false;
		}

		const nlIdx = ctx.raw.indexOf("\n", ctx.i);
		const lineEnd = nlIdx === -1 ? ctx.len : nlIdx;
		const hrLine = ctx.raw.substring(ctx.i, lineEnd).trim();

		if (/^[-*_]{3,}$/.test(hrLine)) {
			ctx.i = nlIdx === -1 ? ctx.len : nlIdx + 1;
			ctx.lineStart = true;
			return true;
		}
		return false;
	}

	// ── Inline syntax ──────────────────────────────────────────────────

	/**
	 * Try to consume inline markdown syntax at the current position.
	 * Returns true if something was consumed and the main loop should continue.
	 */
	private tryInline(ctx: StripContext, ch: string): boolean {
		return (
			this.tryInlineCode(ctx, ch) ||
			this.tryImage(ctx, ch) ||
			this.tryWikilink(ctx, ch) ||
			this.tryLink(ctx, ch) ||
			this.tryBoldItalic(ctx, ch) ||
			this.tryStrikethrough(ctx, ch) ||
			this.tryHighlightMarker(ctx, ch) ||
			this.tryTablePipe(ctx, ch) ||
			this.tryHtmlTag(ctx, ch)
		);
	}

	/** Strip backticks, keep code content */
	private tryInlineCode(ctx: StripContext, ch: string): boolean {
		if (ch !== "`") return false;

		const end = ctx.raw.indexOf("`", ctx.i + 1);
		if (end === -1) return false;

		ctx.i++;
		while (ctx.i < end) {
			this.pushChar(ctx, ctx.raw[ctx.i]);
			ctx.i++;
		}
		ctx.i++; // skip closing `
		return true;
	}

	/** Handle ![alt](url) — keep alt text, strip URL */
	private tryImage(ctx: StripContext, ch: string): boolean {
		if (ch !== "!" || ctx.i + 1 >= ctx.len || ctx.raw[ctx.i + 1] !== "[") return false;

		const closeBracket = ctx.raw.indexOf("]", ctx.i + 2);
		if (closeBracket === -1 || ctx.raw[closeBracket + 1] !== "(") return false;

		const closeParen = ctx.raw.indexOf(")", closeBracket + 2);
		if (closeParen === -1) return false;

		const altStart = ctx.i + 2;
		for (let ai = altStart; ai < closeBracket; ai++) {
			this.pushCharAt(ctx, ctx.raw[ai], ai);
		}
		ctx.i = closeParen + 1;
		return true;
	}

	/** Handle [[target|display]] or [[target]] — keep display text */
	private tryWikilink(ctx: StripContext, ch: string): boolean {
		if (ch !== "[" || ctx.i + 1 >= ctx.len || ctx.raw[ctx.i + 1] !== "[") return false;

		const closeWiki = ctx.raw.indexOf("]]", ctx.i + 2);
		if (closeWiki === -1) return false;

		const inner = ctx.raw.substring(ctx.i + 2, closeWiki);
		const pipeIdx = inner.indexOf("|");
		const display = pipeIdx !== -1 ? inner.substring(pipeIdx + 1) : inner;
		const displayStart = pipeIdx !== -1 ? ctx.i + 2 + pipeIdx + 1 : ctx.i + 2;

		for (let di = 0; di < display.length; di++) {
			this.pushCharAt(ctx, display[di], displayStart + di);
		}
		ctx.i = closeWiki + 2;
		return true;
	}

	/** Handle [text](url) — keep link text, strip URL */
	private tryLink(ctx: StripContext, ch: string): boolean {
		if (ch !== "[") return false;

		const closeBracket = this.findClosingBracket(ctx.raw, ctx.i);
		if (closeBracket === -1 || closeBracket + 1 >= ctx.len || ctx.raw[closeBracket + 1] !== "(") {
			return false;
		}

		const closeParen = ctx.raw.indexOf(")", closeBracket + 2);
		if (closeParen === -1) return false;

		ctx.i++;
		while (ctx.i < closeBracket) {
			this.pushChar(ctx, ctx.raw[ctx.i]);
			ctx.i++;
		}
		ctx.i = closeParen + 1;
		return true;
	}

	/** Skip bold/italic markers (*, _) up to 3 characters */
	private tryBoldItalic(ctx: StripContext, ch: string): boolean {
		if (ch !== "*" && ch !== "_") return false;

		let count = 0;
		let mi = ctx.i;
		while (mi < ctx.len && ctx.raw[mi] === ch) {
			count++;
			mi++;
		}
		if (count <= 3) {
			ctx.i = mi;
			return true;
		}
		return false;
	}

	/** Skip ~~ strikethrough markers */
	private tryStrikethrough(ctx: StripContext, ch: string): boolean {
		if (ch !== "~" || ctx.i + 1 >= ctx.len || ctx.raw[ctx.i + 1] !== "~") return false;
		ctx.i += 2;
		return true;
	}

	/** Skip == highlight markers */
	private tryHighlightMarker(ctx: StripContext, ch: string): boolean {
		if (ch !== "=" || ctx.i + 1 >= ctx.len || ctx.raw[ctx.i + 1] !== "=") return false;
		ctx.i += 2;
		return true;
	}

	/** Strip table pipe delimiters, add space between cells */
	private tryTablePipe(ctx: StripContext, ch: string): boolean {
		if (ch !== "|") return false;

		const lastChar = ctx.out.length > 0 ? ctx.out[ctx.out.length - 1] : "";
		if (lastChar !== " " && lastChar !== "") {
			this.pushChar(ctx, " ");
		}
		ctx.i++;
		// Skip whitespace after the pipe
		while (ctx.i < ctx.len && ctx.raw[ctx.i] === " ") ctx.i++;
		return true;
	}

	/** Skip HTML tags like <div>, </span>, <br/> */
	private tryHtmlTag(ctx: StripContext, ch: string): boolean {
		if (ch !== "<") return false;

		const closeAngle = ctx.raw.indexOf(">", ctx.i + 1);
		if (closeAngle === -1) return false;

		const tagContent = ctx.raw.substring(ctx.i + 1, closeAngle);
		if (/^\/?[a-zA-Z][a-zA-Z0-9]*(\s[^>]*)?\/?$/.test(tagContent)) {
			ctx.i = closeAngle + 1;
			return true;
		}
		return false;
	}

	// ── Helpers ─────────────────────────────────────────────────────────

	/** Push a character at the current position and advance plainIndex */
	private pushChar(ctx: StripContext, ch: string): void {
		ctx.out.push(ch);
		if (
			ctx.map.length === 0 ||
			(ctx.i + ctx.editorOffset) - ctx.map[ctx.map.length - 1].editor !==
				ctx.plainIndex - ctx.map[ctx.map.length - 1].plain
		) {
			ctx.map.push({ plain: ctx.plainIndex, editor: ctx.i + ctx.editorOffset });
		}
		ctx.plainIndex++;
	}

	/** Push a character with an explicit editor position (for content extracted out-of-order) */
	private pushCharAt(ctx: StripContext, ch: string, editorIndex: number): void {
		ctx.out.push(ch);
		if (
			ctx.map.length === 0 ||
			(editorIndex + ctx.editorOffset) - ctx.map[ctx.map.length - 1].editor !==
				ctx.plainIndex - ctx.map[ctx.map.length - 1].plain
		) {
			ctx.map.push({ plain: ctx.plainIndex, editor: editorIndex + ctx.editorOffset });
		}
		ctx.plainIndex++;
	}

	private findClosingBracket(text: string, openPos: number): number {
		let depth = 0;
		for (let i = openPos; i < text.length; i++) {
			if (text[i] === "[") depth++;
			else if (text[i] === "]") {
				depth--;
				if (depth === 0) return i;
			}
		}
		return -1;
	}

	// ── Chunking ────────────────────────────────────────────────────────

	/**
	 * Split plain text into chunks at sentence boundaries.
	 * Falls back to word boundaries, then hard split.
	 */
	private splitChunks(
		text: string,
		maxSize: number
	): { chunks: string[]; chunkOffsets: number[] } {
		if (text.length <= maxSize) {
			return { chunks: [text], chunkOffsets: [0] };
		}

		const chunks: string[] = [];
		const chunkOffsets: number[] = [];
		let offset = 0;

		while (offset < text.length) {
			if (offset + maxSize >= text.length) {
				chunks.push(text.substring(offset));
				chunkOffsets.push(offset);
				break;
			}

			let splitAt = -1;
			const searchEnd = Math.min(offset + maxSize, text.length);
			const searchRegion = text.substring(offset, searchEnd);

			// Try to split at a period followed by space (sentence boundary)
			const lastSentence = searchRegion.lastIndexOf(". ");
			if (lastSentence > maxSize * MIN_SENTENCE_SPLIT_RATIO) {
				splitAt = offset + lastSentence + 2;
			}

			// Fall back to last space
			if (splitAt === -1) {
				const lastSpace = searchRegion.lastIndexOf(" ");
				if (lastSpace > maxSize * MIN_WORD_SPLIT_RATIO) {
					splitAt = offset + lastSpace + 1;
				}
			}

			// Hard split as last resort
			if (splitAt === -1) {
				splitAt = offset + maxSize;
			}

			chunks.push(text.substring(offset, splitAt));
			chunkOffsets.push(offset);
			offset = splitAt;
		}

		return { chunks, chunkOffsets };
	}
}
