import {
	StateField,
	StateEffect,
	type Extension,
	type Range,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
} from "@codemirror/view";

/** Effect to set the currently highlighted word range, or null to clear */
export const setTTSHighlight = StateEffect.define<{ from: number; to: number } | null>();

/** StateField that manages the current TTS word highlight decoration */
const ttsHighlightField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(decorations, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setTTSHighlight)) {
				if (effect.value === null) {
					return Decoration.none;
				}
				const { from, to } = effect.value;
				// Clamp to document bounds
				const docLen = tr.state.doc.length;
				const clampedFrom = Math.max(0, Math.min(from, docLen));
				const clampedTo = Math.max(clampedFrom, Math.min(to, docLen));
				if (clampedFrom === clampedTo) {
					return Decoration.none;
				}
				const deco = Decoration.mark({ class: "tts-word-current" });
				return Decoration.set([deco.range(clampedFrom, clampedTo)]);
			}
		}
		// Map through document changes (if the doc is edited)
		if (tr.docChanged) {
			return decorations.map(tr.changes);
		}
		return decorations;
	},
	provide(field) {
		return EditorView.decorations.from(field);
	},
});

/** Base theme for the TTS highlight */
const ttsBaseTheme = EditorView.baseTheme({
	".tts-word-current": {
		backgroundColor: "var(--tts-highlight-color, hsla(var(--accent-h), var(--accent-s), var(--accent-l), 0.35))",
		borderRadius: "2px",
	},
});

/** Callback invoked when a document changes while a TTS highlight is active */
let onDocChangeDuringPlayback: (() => void) | null = null;

export function setDocChangeCallback(cb: (() => void) | null): void {
	onDocChangeDuringPlayback = cb;
}

/** Listener that fires the callback when doc changes while highlight is active */
const docChangeListener = EditorView.updateListener.of((update) => {
	if (update.docChanged && onDocChangeDuringPlayback) {
		// Check if there's an active highlight
		const decos = update.state.field(ttsHighlightField);
		if (decos.size > 0) {
			onDocChangeDuringPlayback();
		}
	}
});

/** Complete CM6 extension for TTS highlighting */
export const ttsHighlightExtension: Extension = [
	ttsHighlightField,
	ttsBaseTheme,
	docChangeListener,
];
