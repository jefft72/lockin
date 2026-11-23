import { spawn } from "node:child_process";

/** Opens a URL in the default browser. Resolves false if that could not be done. */
export function openBrowser(url: string, platform: string = process.platform): Promise<boolean> {
	const [file, ...args] =
		platform === "darwin"
			? ["open", url]
			: platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	return new Promise((resolve) => {
		const child = spawn(file as string, args, { stdio: "ignore", detached: true });
		child.once("error", () => resolve(false));
		child.once("exit", (code) => resolve(code === 0));
		child.unref();
	});
}
