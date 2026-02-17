import type { TTSSettings } from "../types";

export type BoundaryCallback = (charIndex: number, charLength: number) => void;
export type EndCallback = () => void;
export type ErrorCallback = (error: string) => void;

export class SpeechEngine {
	private utterance: SpeechSynthesisUtterance | null = null;
	private currentText = "";
	private onBoundary: BoundaryCallback | null = null;
	private onEnd: EndCallback | null = null;
	private onError: ErrorCallback | null = null;
	private cancelled = false;
	private endFired = false;

	/** Load voices, returning a promise that resolves once voices are available. */
	static loadVoices(): Promise<SpeechSynthesisVoice[]> {
		return new Promise((resolve) => {
			const voices = window.speechSynthesis.getVoices();
			if (voices.length > 0) {
				resolve(voices);
				return;
			}
			const handler = () => {
				window.speechSynthesis.removeEventListener("voiceschanged", handler);
				resolve(window.speechSynthesis.getVoices());
			};
			window.speechSynthesis.addEventListener("voiceschanged", handler);
			// Timeout fallback in case event never fires
			setTimeout(() => {
				window.speechSynthesis.removeEventListener("voiceschanged", handler);
				resolve(window.speechSynthesis.getVoices());
			}, 3000);
		});
	}

	setBoundaryCallback(cb: BoundaryCallback): void {
		this.onBoundary = cb;
	}

	setEndCallback(cb: EndCallback): void {
		this.onEnd = cb;
	}

	setErrorCallback(cb: ErrorCallback): void {
		this.onError = cb;
	}

	speak(text: string, settings: TTSSettings): void {
		this.cancel();
		this.currentText = text;
		this.cancelled = false;
		this.endFired = false;

		const utterance = new SpeechSynthesisUtterance(text);
		this.utterance = utterance;

		// Apply settings
		utterance.rate = settings.rate;
		utterance.pitch = settings.pitch;
		utterance.volume = settings.volume;

		if (settings.voice) {
			const voices = window.speechSynthesis.getVoices();
			const match = voices.find((v) => v.voiceURI === settings.voice);
			if (match) utterance.voice = match;
		}

		utterance.onboundary = (event: SpeechSynthesisEvent) => {
			if (event.name !== "word") return;
			let length = event.charLength;
			// Safari quirk: charLength may be 0 or undefined
			if (!length || length === 0) {
				length = this.inferWordLength(text, event.charIndex);
			}
			this.onBoundary?.(event.charIndex, length);
		};

		utterance.onend = () => {
			if (this.endFired) return;
			this.endFired = true;
			this.onEnd?.();
		};

		utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
			// "interrupted" and "canceled" are expected when we call cancel()
			if (event.error === "interrupted" || event.error === "canceled") return;
			this.onError?.(event.error);
		};

		window.speechSynthesis.speak(utterance);
	}

	pause(): void {
		window.speechSynthesis.pause();
	}

	resume(): void {
		window.speechSynthesis.resume();
	}

	cancel(): void {
		this.cancelled = true;
		window.speechSynthesis.cancel();
		// Safari quirk: end event doesn't fire after cancel()
		// Fire synthetic end after a short delay
		if (this.utterance && !this.endFired) {
			this.endFired = true;
			// Don't fire onEnd for cancellation — the controller manages stop state
		}
		this.utterance = null;
	}

	get isSpeaking(): boolean {
		return window.speechSynthesis.speaking;
	}

	get isPaused(): boolean {
		return window.speechSynthesis.paused;
	}

	/**
	 * When charLength is missing (Safari), find the end of the current word
	 * by scanning forward from charIndex for whitespace or end of text.
	 */
	private inferWordLength(text: string, charIndex: number): number {
		let end = charIndex;
		while (end < text.length && !/\s/.test(text[end])) {
			end++;
		}
		return Math.max(1, end - charIndex);
	}
}
