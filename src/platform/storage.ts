export interface JsonStore<T> {
	load(): T | null;
	save(value: T): void;
	/** Fires when another tab writes the key. */
	subscribe(listener: (value: T | null) => void): () => void;
}

/**
 * A typed localStorage slot. Stored JSON is untrusted (older versions, manual
 * edits), so everything read back goes through `parse`.
 */
export function jsonStore<T>(key: string, parse: (value: unknown) => T | null): JsonStore<T> {
	const decode = (raw: string | null): T | null => {
		if (raw === null) return null;
		try {
			return parse(JSON.parse(raw));
		} catch {
			return null;
		}
	};
	return {
		load() {
			try {
				return decode(localStorage.getItem(key));
			} catch {
				return null;
			}
		},
		save(value) {
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch {
				// Storage is full or blocked. The app keeps working from memory.
			}
		},
		subscribe(listener) {
			const onStorage = (event: StorageEvent) => {
				if (event.storageArea === localStorage && event.key === key)
					listener(decode(event.newValue));
			};
			addEventListener("storage", onStorage);
			return () => removeEventListener("storage", onStorage);
		},
	};
}
