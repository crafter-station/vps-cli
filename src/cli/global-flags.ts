import type { GlobalFlags } from "../types.ts";

export function getGlobalFlagDefs() {
	return [
		{ flag: "--json", description: "Emit JSON output (agent-friendly)" },
		{
			flag: "--output <mode>",
			description: 'Output mode: "auto", "json", "table"',
		},
		{ flag: "-q, --quiet", description: "Suppress non-essential output" },
		{ flag: "-v, --verbose", description: "Verbose logging" },
		{ flag: "-y, --yes", description: "Skip confirmation prompts" },
	];
}

export function parseGlobalFlags(raw: Record<string, unknown>): GlobalFlags {
	const isCi = Boolean(
		process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI,
	);
	return {
		json: raw.json === true || process.env.VPS_JSON === "1",
		output: (raw.output as GlobalFlags["output"]) ?? "auto",
		quiet: raw.quiet === true,
		verbose: raw.verbose === true,
		yes: raw.yes === true || isCi,
	};
}
