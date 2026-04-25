import { detectMode } from "../cli/detect.ts";
import type { GlobalFlags } from "../types.ts";

type EmitFlags = Pick<GlobalFlags, "json" | "output" | "quiet">;

/** Emit a result: JSON to stdout if agent mode, otherwise run the human renderer. */
export function emit<T>(value: T, flags: EmitFlags, human: (v: T) => void): void {
	const mode = detectMode(flags);
	if (mode === "json") {
		process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
	} else {
		human(value);
	}
}
