import { App, PluginSettingTab, Setting, Platform } from "obsidian";
import type TTSHighlightPlugin from "./main";
import type { TTSSettings } from "./types";

export class TTSSettingTab extends PluginSettingTab {
	plugin: TTSHighlightPlugin;

	constructor(app: App, plugin: TTSHighlightPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addVoiceSetting(containerEl);
		this.addSliderSetting(containerEl, "Rate", "rate", 0.5, 2.0, 0.1);
		this.addSliderSetting(containerEl, "Pitch", "pitch", 0.5, 2.0, 0.1);
		this.addSliderSetting(containerEl, "Volume", "volume", 0.0, 1.0, 0.1);

		new Setting(containerEl)
			.setName("Highlight color")
			.setDesc("CSS color for the highlighted word. Leave empty to use the accent color.")
			.addText((text) =>
				text
					.setPlaceholder("#ffd700")
					.setValue(this.plugin.settings.highlightColor)
					.onChange(async (value) => {
						this.plugin.settings.highlightColor = value;
						this.applyHighlightColor(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-scroll")
			.setDesc("Automatically scroll to keep the highlighted word visible.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoScroll).onChange(async (value) => {
					this.plugin.settings.autoScroll = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Chunk size")
			.setDesc(
				"Maximum characters per speech chunk. Lower values improve reliability."
			)
			.addSlider((slider) =>
				slider
					.setLimits(1000, 10000, 500)
					.setValue(this.plugin.settings.chunkSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.chunkSize = value;
						await this.plugin.saveSettings();
					})
			);

		this.addHotkeySection(containerEl);
	}

	private addHotkeySection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Hotkeys").setHeading();

		const commands = [
			{ id: "tts-highlight:read-aloud", name: "Read aloud" },
			{ id: "tts-highlight:read-from-cursor", name: "Read from cursor" },
			{ id: "tts-highlight:read-selection-aloud", name: "Read selection aloud" },
			{ id: "tts-highlight:pause-resume", name: "Pause / resume" },
			{ id: "tts-highlight:stop", name: "Stop" },
		];

		for (const cmd of commands) {
			const hotkey = this.getHotkeyDisplay(cmd.id);
			new Setting(containerEl)
				.setName(cmd.name)
				.setDesc(hotkey || "Not set")
				.addButton((btn) =>
					btn.setButtonText("Configure").onClick(() => {
						// Open Obsidian's hotkey settings filtered to this command
						const setting = (this.app as unknown as { setting?: { openTabById(id: string): { setQuery?(q: string): void } | undefined } }).setting;
						const tab = setting?.openTabById("hotkeys");
						if (tab?.setQuery) {
							tab.setQuery("TTS Highlight");
						}
					})
				);
		}
	}

	private getHotkeyDisplay(commandId: string): string {
		// Accessing internal hotkey API
		const manager = (this.app as unknown as { hotkeyManager?: { getHotkeys(id: string): { modifiers: string[]; key: string }[] | undefined; getDefaultHotkeys(id: string): { modifiers: string[]; key: string }[] | undefined } }).hotkeyManager;
		const customKeys: { modifiers: string[]; key: string }[] | undefined =
			manager?.getHotkeys(commandId);
		const defaultKeys: { modifiers: string[]; key: string }[] | undefined =
			manager?.getDefaultHotkeys(commandId);

		const keys = customKeys?.length ? customKeys : defaultKeys;
		if (!keys || keys.length === 0) return "";

		return keys
			.map((k) => {
				const parts = [...k.modifiers.map((m: string) => this.formatModifier(m)), k.key.toUpperCase()];
				return parts.join("+");
			})
			.join(", ");
	}

	private formatModifier(mod: string): string {
		const isMac = Platform.isMacOS;
		switch (mod) {
			case "Mod": return isMac ? "\u2318" : "Ctrl";
			case "Shift": return isMac ? "\u21E7" : "Shift";
			case "Alt": return isMac ? "\u2325" : "Alt";
			case "Ctrl": return isMac ? "\u2303" : "Ctrl";
			default: return mod;
		}
	}

	private addVoiceSetting(containerEl: HTMLElement): void {
		const voices = window.speechSynthesis.getVoices();
		new Setting(containerEl)
			.setName("Voice")
			.setDesc("Select a text-to-speech voice.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "System default");
				for (const voice of voices) {
					dropdown.addOption(voice.voiceURI, `${voice.name} (${voice.lang})`);
				}
				dropdown.setValue(this.plugin.settings.voice);
				dropdown.onChange(async (value) => {
					this.plugin.settings.voice = value;
					await this.plugin.saveSettings();
				});
			});
	}

	private addSliderSetting(
		containerEl: HTMLElement,
		name: string,
		key: keyof Pick<TTSSettings, "rate" | "pitch" | "volume">,
		min: number,
		max: number,
		step: number
	): void {
		new Setting(containerEl)
			.setName(name)
			.addSlider((slider) =>
				slider
					.setLimits(min, max, step)
					.setValue(this.plugin.settings[key])
					.setDynamicTooltip()
					.onChange(async (value) => {
						(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private applyHighlightColor(color: string): void {
		document.body.style.setProperty(
			"--tts-highlight-color",
			color || null
		);
	}
}
