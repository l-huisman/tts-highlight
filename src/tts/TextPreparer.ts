import type { PositionMapEntry, PreparedText } from "../types";

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

		// Binary search for the largest entry with .plain <= plainIndex
		let lo = 0;
		let hi = map.length - 1;

		if (plainIndex < map[0].plain) return map[0].editor;
		if (plainIndex >= map[hi].plain) {
			// Extrapolate from last entry
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

	private stripMarkdown(
		raw: string,
		editorOffset: number
	): { plainText: string; map: PositionMapEntry[] } {
		const out: string[] = [];
		const map: PositionMapEntry[] = [];
		let plainIndex = 0;
		let i = 0;
		const len = raw.length;

		// Track state
		let lineStart = true;
		let inFrontmatter = false;
		let frontmatterDone = false;

		// Check for frontmatter at start
		if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
			inFrontmatter = true;
			const lineEnd = raw.indexOf("\n");
			i = lineEnd + 1;
		}

		while (i < len) {
			// Frontmatter: skip until closing ---
			if (inFrontmatter) {
				const nlIdx = raw.indexOf("\n", i);
				if (nlIdx === -1) {
					// No closing frontmatter — skip rest
					break;
				}
				const line = raw.substring(i, nlIdx).replace(/\r$/, "");
				i = nlIdx + 1;
				if (line === "---") {
					inFrontmatter = false;
					frontmatterDone = true;
					lineStart = true;
				}
				continue;
			}

			const ch = raw[i];

			// Start of line processing
			if (lineStart) {
				lineStart = false;

				// Table separator row: | --- | --- | or |:---:|
				if (ch === "|") {
					const nlIdx = raw.indexOf("\n", i);
					const lineEnd = nlIdx === -1 ? len : nlIdx;
					const line = raw.substring(i, lineEnd).trim();
					if (/^\|[\s:|-]+\|$/.test(line) && line.includes("-")) {
						// Skip the entire separator row
						i = nlIdx === -1 ? len : nlIdx + 1;
						lineStart = true;
						continue;
					}
				}

				// Fenced code block: ``` or ~~~
				if (
					(ch === "`" && raw[i + 1] === "`" && raw[i + 2] === "`") ||
					(ch === "~" && raw[i + 1] === "~" && raw[i + 2] === "~")
				) {
					const fence = ch;
					// Skip opening fence line
					const nlIdx = raw.indexOf("\n", i);
					if (nlIdx === -1) break;
					i = nlIdx + 1;
					// Skip until closing fence
					while (i < len) {
						const fenceNl = raw.indexOf("\n", i);
						const fenceEnd = fenceNl === -1 ? len : fenceNl;
						const fenceLine = raw.substring(i, fenceEnd).trimStart();
						i = fenceNl === -1 ? len : fenceNl + 1;
						if (
							fenceLine.startsWith(fence + fence + fence) ||
							(fenceLine.length >= 3 &&
								fenceLine[0] === fence &&
								fenceLine[1] === fence &&
								fenceLine[2] === fence)
						) {
							break;
						}
					}
					lineStart = true;
					continue;
				}

				// Heading prefix: # ## ### etc.
				if (ch === "#") {
					let hi = i;
					while (hi < len && raw[hi] === "#") hi++;
					if (hi < len && raw[hi] === " ") {
						i = hi + 1; // skip "# "
						continue;
					}
				}

				// Block quote prefix: >
				if (ch === ">") {
					i++;
					if (i < len && raw[i] === " ") i++;
					continue;
				}

				// Unordered list prefix: - , * , +
				if (
					(ch === "-" || ch === "*" || ch === "+") &&
					i + 1 < len &&
					raw[i + 1] === " "
				) {
					i += 2;
					continue;
				}

				// Ordered list prefix: 1. 2. etc.
				if (ch >= "0" && ch <= "9") {
					let ni = i;
					while (ni < len && raw[ni] >= "0" && raw[ni] <= "9") ni++;
					if (ni < len && raw[ni] === "." && ni + 1 < len && raw[ni + 1] === " ") {
						i = ni + 2;
						continue;
					}
				}

				// Horizontal rule: --- or *** or ___
				if (
					(ch === "-" || ch === "*" || ch === "_") &&
					i + 2 < len &&
					raw[i + 1] === ch &&
					raw[i + 2] === ch
				) {
					const nlIdx = raw.indexOf("\n", i);
					const lineEnd = nlIdx === -1 ? len : nlIdx;
					const hrLine = raw.substring(i, lineEnd).trim();
					if (/^[-*_]{3,}$/.test(hrLine)) {
						i = nlIdx === -1 ? len : nlIdx + 1;
						lineStart = true;
						continue;
					}
				}
			}

			// Newlines
			if (ch === "\n") {
				this.pushChar(out, map, " ", plainIndex, i + editorOffset);
				plainIndex++;
				i++;
				lineStart = true;
				continue;
			}
			if (ch === "\r") {
				i++;
				continue;
			}

			// Inline code: `...`
			if (ch === "`") {
				const end = raw.indexOf("`", i + 1);
				if (end !== -1) {
					// Keep the code content but strip backticks
					i++;
					while (i < end) {
						this.pushChar(out, map, raw[i], plainIndex, i + editorOffset);
						plainIndex++;
						i++;
					}
					i++; // skip closing `
					continue;
				}
			}

			// Image: ![alt](url) — skip entirely (keep alt text)
			if (ch === "!" && i + 1 < len && raw[i + 1] === "[") {
				const closeBracket = raw.indexOf("]", i + 2);
				if (closeBracket !== -1 && raw[closeBracket + 1] === "(") {
					const closeParen = raw.indexOf(")", closeBracket + 2);
					if (closeParen !== -1) {
						// Output alt text
						const altStart = i + 2;
						for (let ai = altStart; ai < closeBracket; ai++) {
							this.pushChar(out, map, raw[ai], plainIndex, ai + editorOffset);
							plainIndex++;
						}
						i = closeParen + 1;
						continue;
					}
				}
			}

			// Link: [text](url) — keep text, strip url
			if (ch === "[") {
				const closeBracket = this.findClosingBracket(raw, i);
				if (closeBracket !== -1 && closeBracket + 1 < len && raw[closeBracket + 1] === "(") {
					const closeParen = raw.indexOf(")", closeBracket + 2);
					if (closeParen !== -1) {
						// Output link text
						i++;
						while (i < closeBracket) {
							this.pushChar(out, map, raw[i], plainIndex, i + editorOffset);
							plainIndex++;
							i++;
						}
						i = closeParen + 1;
						continue;
					}
				}
			}

			// Wikilink: [[target|display]] or [[target]]
			if (ch === "[" && i + 1 < len && raw[i + 1] === "[") {
				const closeWiki = raw.indexOf("]]", i + 2);
				if (closeWiki !== -1) {
					const inner = raw.substring(i + 2, closeWiki);
					const pipeIdx = inner.indexOf("|");
					const display = pipeIdx !== -1 ? inner.substring(pipeIdx + 1) : inner;
					// Map display text — offset within the inner content
					const displayStart = pipeIdx !== -1 ? i + 2 + pipeIdx + 1 : i + 2;
					for (let di = 0; di < display.length; di++) {
						this.pushChar(
							out,
							map,
							display[di],
							plainIndex,
							displayStart + di + editorOffset
						);
						plainIndex++;
					}
					i = closeWiki + 2;
					continue;
				}
			}

			// Bold/italic markers: **, *, ~~
			if (ch === "*" || ch === "_") {
				// Count consecutive markers
				let count = 0;
				const marker = ch;
				let mi = i;
				while (mi < len && raw[mi] === marker) {
					count++;
					mi++;
				}
				if (count <= 3) {
					i = mi; // skip the marker characters
					continue;
				}
			}

			if (ch === "~" && i + 1 < len && raw[i + 1] === "~") {
				i += 2; // skip ~~
				continue;
			}

			if (ch === "=" && i + 1 < len && raw[i + 1] === "=") {
				i += 2; // skip == (highlight)
				continue;
			}

			// Table pipe delimiters: strip | and add space between cells
			if (ch === "|") {
				// Emit a space to separate cell contents (avoid merging words)
				const lastChar = out.length > 0 ? out[out.length - 1] : "";
				if (lastChar !== " " && lastChar !== "") {
					this.pushChar(out, map, " ", plainIndex, i + editorOffset);
					plainIndex++;
				}
				i++;
				// Skip any whitespace after the pipe
				while (i < len && raw[i] === " ") i++;
				continue;
			}

			// HTML tags: <...>
			if (ch === "<") {
				const closeAngle = raw.indexOf(">", i + 1);
				if (closeAngle !== -1) {
					const tagContent = raw.substring(i + 1, closeAngle);
					// Simple check for HTML tag
					if (/^\/?[a-zA-Z][a-zA-Z0-9]*(\s[^>]*)?\/?$/.test(tagContent)) {
						i = closeAngle + 1;
						continue;
					}
				}
			}

			// Regular character — keep it
			this.pushChar(out, map, ch, plainIndex, i + editorOffset);
			plainIndex++;
			i++;
		}

		// Collapse multiple spaces
		let plainText = out.join("");
		// Trim leading/trailing whitespace
		plainText = plainText.trim();

		return { plainText, map };
	}

	private pushChar(
		out: string[],
		map: PositionMapEntry[],
		ch: string,
		plainIndex: number,
		editorIndex: number
	): void {
		out.push(ch);
		// Only add map entries at transition points (when the delta changes)
		if (
			map.length === 0 ||
			editorIndex - map[map.length - 1].editor !==
				plainIndex - map[map.length - 1].plain
		) {
			map.push({ plain: plainIndex, editor: editorIndex });
		}
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

	/**
	 * Split plain text into chunks at paragraph boundaries (double newline
	 * in original, which becomes double space after stripping).
	 * Falls back to sentence boundaries, then hard split.
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
			if (lastSentence > maxSize * 0.5) {
				splitAt = offset + lastSentence + 2;
			}

			// Fall back to last space
			if (splitAt === -1) {
				const lastSpace = searchRegion.lastIndexOf(" ");
				if (lastSpace > maxSize * 0.3) {
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
