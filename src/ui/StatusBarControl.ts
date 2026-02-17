import { type Plugin, setIcon } from "obsidian";
import type { PlaybackState } from "../types";

export class StatusBarControl {
	private el: HTMLElement;
	private pauseBtn: HTMLElement;
	private progressEl: HTMLElement;
	private stopBtn: HTMLElement;
	private onPause: () => void;
	private onStop: () => void;

	constructor(
		plugin: Plugin,
		onPause: () => void,
		onStop: () => void
	) {
		this.onPause = onPause;
		this.onStop = onStop;

		this.el = plugin.addStatusBarItem();
		this.el.addClass("tts-status-bar");

		this.pauseBtn = this.el.createEl("span", { cls: "tts-btn" });
		setIcon(this.pauseBtn, "pause");
		this.pauseBtn.setAttribute("aria-label", "Pause");
		this.pauseBtn.addEventListener("click", () => this.onPause());

		this.progressEl = this.el.createEl("span", { cls: "tts-progress" });

		this.stopBtn = this.el.createEl("span", { cls: "tts-btn" });
		setIcon(this.stopBtn, "square");
		this.stopBtn.setAttribute("aria-label", "Stop");
		this.stopBtn.addEventListener("click", () => this.onStop());
	}

	update(state: PlaybackState, chunkIndex: number, totalChunks: number): void {
		if (state === "idle") {
			this.el.removeClass("is-active");
			return;
		}

		this.el.addClass("is-active");
		setIcon(this.pauseBtn, state === "paused" ? "play" : "pause");
		this.pauseBtn.setAttribute("aria-label", state === "paused" ? "Resume" : "Pause");

		if (totalChunks > 1) {
			this.progressEl.textContent = `${chunkIndex + 1}/${totalChunks}`;
		} else {
			this.progressEl.textContent = "";
		}
	}

	destroy(): void {
		this.el.remove();
	}
}
