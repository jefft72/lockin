/**
 * Calls `onTick` roughly every `intervalMs`, including while the tab is
 * hidden. Returns a function that stops it.
 */
export function startTicker(onTick: () => void, intervalMs = 200): () => void {
	try {
		const worker = new Worker(new URL("./ticker.worker.ts", import.meta.url), { type: "module" });
		worker.addEventListener("message", onTick);
		worker.postMessage(intervalMs);
		return () => worker.terminate();
	} catch {
		// No workers here (a locked-down browser): fall back to a page timer,
		// which is still correct, only late to notice the end while hidden.
		const handle = setInterval(onTick, intervalMs);
		return () => clearInterval(handle);
	}
}
