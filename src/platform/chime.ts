/** Short square-wave beeps, synthesised so there is no audio file to ship. */
export class Chime {
	enabled = true;
	private ctx: AudioContext | undefined;

	/** Browsers only allow sound after a user gesture: call this from one. */
	unlock(): void {
		try {
			this.ctx ??= new AudioContext();
			if (this.ctx.state === "suspended") void this.ctx.resume();
		} catch {
			// No audio device or no Web Audio. The timer works silently.
		}
	}

	checkpoint(): void {
		this.play([[880, 0.07]]);
	}

	finish(): void {
		this.play([
			[660, 0.12],
			[880, 0.12],
			[1320, 0.3],
		]);
	}

	private play(notes: ReadonlyArray<readonly [frequency: number, seconds: number]>): void {
		const { ctx } = this;
		if (!this.enabled || !ctx || ctx.state !== "running") return;
		let at = ctx.currentTime + 0.02;
		for (const [frequency, seconds] of notes) {
			const oscillator = ctx.createOscillator();
			const gain = ctx.createGain();
			oscillator.type = "square";
			oscillator.frequency.value = frequency;
			// A few milliseconds of ramp at each end keeps the beep from clicking.
			gain.gain.setValueAtTime(0, at);
			gain.gain.linearRampToValueAtTime(0.06, at + 0.005);
			gain.gain.setValueAtTime(0.06, at + seconds - 0.01);
			gain.gain.linearRampToValueAtTime(0, at + seconds);
			oscillator.connect(gain).connect(ctx.destination);
			oscillator.start(at);
			oscillator.stop(at + seconds);
			at += seconds + 0.03;
		}
	}
}
