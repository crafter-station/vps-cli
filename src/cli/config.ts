import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CONFIG_DIR, CONFIG_FILE } from "../constants.ts";
import type { Config } from "../types.ts";

export function configExists(): boolean {
	return existsSync(CONFIG_FILE);
}

export function loadConfig(): Config {
	if (!existsSync(CONFIG_FILE)) {
		throw new Error(
			"Config not found. Run `vps config set` to configure domain and API key.",
		);
	}
	const raw = readFileSync(CONFIG_FILE, "utf8");
	const parsed = JSON.parse(raw) as Config;
	if (!parsed.domain || !parsed.apiKey) {
		throw new Error(
			"Invalid config. Run `vps config set` to reconfigure domain and API key.",
		);
	}
	return parsed;
}

export function saveConfig(config: Config): void {
	mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, "\t"), { encoding: "utf8", mode: 0o600 });
}

export function resetConfig(): void {
	if (existsSync(CONFIG_FILE)) {
		const { unlinkSync } = require("node:fs");
		unlinkSync(CONFIG_FILE);
	}
}

export function redactApiKey(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}..${key.slice(-4)}`;
}
