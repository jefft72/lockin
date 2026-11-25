import { MINUTE } from "./timer.ts";

/** Splits a whole number of seconds into the characters the clock shows. */
export function clockDigits(totalSeconds: number): { minutes: string; seconds: string } {
	return {
		minutes: String(Math.floor(totalSeconds / 60)).padStart(2, "0"),
		seconds: String(totalSeconds % 60).padStart(2, "0"),
	};
}

export function clockText(totalSeconds: number): string {
	const { minutes, seconds } = clockDigits(totalSeconds);
	return `${minutes}:${seconds}`;
}

/** A span of time for humans: "45m", "1h 05m". Rounds down to whole minutes. */
export function spanText(ms: number): string {
	const totalMinutes = Math.floor(Math.max(0, ms) / MINUTE);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours === 0 ? `${minutes}m` : `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
