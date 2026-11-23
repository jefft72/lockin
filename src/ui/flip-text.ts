import { el } from "./dom.ts";
import { FlipCell, spinPath } from "./flip.ts";

const isDigit = (char: string) => char >= "0" && char <= "9";

/**
 * A line of text whose digits are split-flap cells and whose other characters
 * are plain. Used for figures that should roll when they change.
 */
export class FlipText {
	readonly el = el("span", { class: "flip-text" });
	private cells: FlipCell[] = [];
	private shape = "";

	constructor(text: string) {
		this.set(text);
	}

	set(text: string): void {
		// The shape is the text with its digits blanked: same shape, same cells.
		const shape = text.replace(/\d/g, "0");
		if (shape !== this.shape) {
			this.shape = shape;
			this.cells = [];
			this.el.replaceChildren(
				...[...text].map((char) => {
					if (!isDigit(char)) return el("span", { class: "unit" }, char);
					const cell = new FlipCell(char);
					this.cells.push(cell);
					return cell.el;
				}),
			);
		} else {
			const digits = [...text].filter(isDigit);
			this.cells.forEach((cell, i) => {
				const digit = digits[i] as string;
				cell.set(digit, spinPath(cell.value, digit), i * 60);
			});
		}
		this.el.setAttribute("aria-label", text);
	}
}
