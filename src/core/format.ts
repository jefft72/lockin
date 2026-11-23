import { MINUTE, SECOND } from "./timer.ts";

/**
 * Splits a remaining time into the characters the clock shows. Rounds up, so
 * the display reads the full duration at the start and hits zero exactly when
 * the run ends, never a second early.
 */
export function clockDigits(remainingMs: number): { minutes: string; seconds: string } {
	const totalSeconds = Math.ceil(Math.max(0, remainingMs) / SECOND);
	const minutes = Math.floor(totalSeconds / 60);
	return {
		minutes: String(minutes).padStart(2, "0"),
		seconds: String(totalSeconds % 60).padStart(2, "0"),
	};
}

export function clockText(remainingMs: number): string {
	const { minutes, seconds } = clockDigits(remainingMs);
	return `${minutes}:${seconds}`;
}

/** A span of time for humans: "45m", "1h 05m". Rounds down to whole minutes. */
export function spanText(ms: number): string {
	const totalMinutes = Math.floor(Math.max(0, ms) / MINUTE);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours === 0 ? `${minutes}m` : `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
