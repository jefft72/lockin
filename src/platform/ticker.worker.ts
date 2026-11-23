// A heartbeat only: it carries no time. Timers in a worker keep firing at full
// rate when the tab is in the background, where the page's own are throttled
// to once a second or worse.
let handle: ReturnType<typeof setInterval> | undefined;

addEventListener("message", (event: MessageEvent<number>) => {
	clearInterval(handle);
	if (event.data > 0) handle = setInterval(() => postMessage(0), event.data);
});
