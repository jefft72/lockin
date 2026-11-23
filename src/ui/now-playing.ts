import type { Command, NowPlaying } from "../core/now-playing.ts";
import { button, el, setText } from "./dom.ts";

/** The strip at the foot of the stage showing what Spotify is playing. */
export class NowPlayingView {
	readonly el = el("div", { class: "now-playing" });
	private readonly text = el("p", { class: "song" });
	private readonly toggle = button("pause");
	private readonly controls: HTMLElement;
	private readonly bar = el("i");
	private sample: { nowPlaying: NowPlaying; at: number } | undefined;

	constructor(send: (command: Command) => void) {
		const previous = button("prev", { "aria-label": "previous track" });
		const next = button("next", { "aria-label": "next track" });
		previous.addEventListener("click", () => send("previous"));
		this.toggle.addEventListener("click", () => send("playpause"));
		next.addEventListener("click", () => send("next"));
		this.controls = el("div", { class: "row" }, previous, this.toggle, next);
		this.el.append(
			el("div", { class: "song-row" }, this.text, this.controls),
			el("div", { class: "song-progress", "aria-hidden": "true" }, this.bar),
		);
		this.el.hidden = true;
	}

	update(nowPlaying: NowPlaying, sampledAt: number): void {
		this.sample = { nowPlaying, at: sampledAt };
		this.el.hidden = nowPlaying.state === "unsupported";
		const hasTrack = nowPlaying.state === "playing" || nowPlaying.state === "paused";
		this.el.dataset.state = nowPlaying.state;
		this.controls.hidden = !hasTrack;
		if (hasTrack) {
			const { name, artist } = nowPlaying.track;
			const title = `${name} - ${artist}`;
			// Most polls find the same song: leave the DOM alone when they do.
			if (this.text.title !== title) {
				this.text.replaceChildren("spotify ", el("b", {}, name), ` ${artist}`);
				this.text.title = title;
			}
			setText(this.toggle, nowPlaying.state === "playing" ? "pause" : "play");
		} else {
			setText(this.text, nowPlaying.state === "closed" ? "spotify closed" : "spotify idle");
			this.text.removeAttribute("title");
		}
		this.tick(sampledAt);
	}

	/** Advances the progress line between samples, so it moves smoothly. */
	tick(now: number): void {
		const sample = this.sample;
		let done = 0;
		if (sample && (sample.nowPlaying.state === "playing" || sample.nowPlaying.state === "paused")) {
			const { positionMs, durationMs } = sample.nowPlaying.track;
			const drift = sample.nowPlaying.state === "playing" ? now - sample.at : 0;
			done = durationMs > 0 ? Math.min(1, Math.max(0, (positionMs + drift) / durationMs)) : 0;
		}
		const fill = done.toFixed(4);
		if (this.bar.style.getPropertyValue("--fill") !== fill)
			this.bar.style.setProperty("--fill", fill);
	}
}
