import type { GlobalFlags, OutputMode } from "../types.ts";

export function detectMode(flags: Pick<GlobalFlags, "json" | "output">): OutputMode {
	if (flags.json) return "json";
	if (flags.output === "json") return "json";
	if (flags.output === "table") return "human";
	if (process.env.NO_JSON === "1") return "human";
	if (!process.stdout.isTTY) return "json";
	return "human";
}

export function shouldColor(): boolean {
	if (process.env.NO_COLOR) return false;
	if (process.env.FORCE_COLOR) return true;
	return Boolean(process.stdout.isTTY);
}
