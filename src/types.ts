export interface TTSSettings {
	voice: string;
	rate: number;
	pitch: number;
	volume: number;
	highlightColor: string;
	autoScroll: boolean;
	chunkSize: number;
}

export const DEFAULT_SETTINGS: TTSSettings = {
	voice: "",
	rate: 1.0,
	pitch: 1.0,
	volume: 1.0,
	highlightColor: "",
	autoScroll: true,
	chunkSize: 5000,
};

export type PlaybackState = "idle" | "playing" | "paused";

/** A single entry mapping plain-text offset → editor offset */
export interface PositionMapEntry {
	/** Character index in stripped plain text */
	plain: number;
	/** Corresponding character index in the original editor text */
	editor: number;
}

/** Result of preparing text for TTS */
export interface PreparedText {
	/** Chunks of plain text to speak */
	chunks: string[];
	/** Position map entries (sorted by .plain ascending) */
	map: PositionMapEntry[];
	/** The plain-text offset where each chunk starts */
	chunkOffsets: number[];
}

/** Range in editor coordinates */
export interface EditorRange {
	from: number;
	to: number;
}

/** Events emitted by PlaybackController */
export interface PlaybackEvent {
	type: "highlight";
	range: EditorRange;
}

export interface PlaybackEndEvent {
	type: "end";
}

export interface PlaybackStopEvent {
	type: "stop";
}

export type PlaybackEventType = PlaybackEvent | PlaybackEndEvent | PlaybackStopEvent;
