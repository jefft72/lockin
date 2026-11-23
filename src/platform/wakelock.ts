/**
 * Keeps the screen awake while a run is counting down. The browser drops the
 * lock whenever the tab is hidden, so it is taken again each time the tab
 * comes back.
 */
export class ScreenAwake {
	private wanted = false;
	private sentinel: WakeLockSentinel | undefined;

	constructor() {
		document.addEventListener("visibilitychange", () => void this.sync());
	}

	set(wanted: boolean): void {
		if (wanted === this.wanted) return;
		this.wanted = wanted;
		void this.sync();
	}

	private async sync(): Promise<void> {
		if (!this.wanted) {
			const held = this.sentinel;
			this.sentinel = undefined;
			await held?.release().catch(() => {});
			return;
		}
		if (document.visibilityState !== "visible" || (this.sentinel && !this.sentinel.released))
			return;
		try {
			this.sentinel = await navigator.wakeLock?.request("screen");
		} catch {
			// Refused (low battery, no permission). Not worth bothering anyone about.
		}
	}
}
