type Child = Node | string;

/** Creates an element with attributes and children in one expression. */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Record<string, string> = {},
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
	node.append(...children);
	return node;
}

export function button(label: string, attrs: Record<string, string> = {}): HTMLButtonElement {
	return el("button", { type: "button", ...attrs }, label);
}

export function reducedMotion(): boolean {
	return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
