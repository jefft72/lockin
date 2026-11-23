import { spawn } from "node:child_process";

/** The command that opens a URL in a browser on this machine. */
export function opener(
	platform: string = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): readonly [string, ...string[]] {
	// The long-standing convention for choosing a browser from the terminal.
	if (env.BROWSER) return [env.BROWSER];
	if (platform === "darwin") return ["open"];
	if (platform === "win32") return ["cmd", "/c", "start", ""];
	return ["xdg-open"];
}

/**
 * Opens a URL in the browser. Resolves once the opener has been launched, or
 * false if it could not be. It does not wait for the opener to finish: some
 * stay alive for as long as the browser does.
 */
export function openBrowser(url: string, command = opener()): Promise<boolean> {
	const [file, ...args] = command;
	return new Promise((resolve) => {
		const child = spawn(file, [...args, url], { stdio: "ignore", detached: true });
		child.once("error", () => resolve(false));
		child.once("spawn", () => {
			// Only now is it safe to stop holding this process open for it.
			child.unref();
			resolve(true);
		});
	});
}
