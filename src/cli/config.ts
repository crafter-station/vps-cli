import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_PROFILE } from "../constants.ts";
import { AppError } from "./error-map.ts";
import type { ConfigFile, LegacyConfig, Profile, ResolvedProfile } from "../types.ts";

/** Set by the --profile global flag; overrides VPS_PROFILE and the stored current. */
let profileOverride: string | undefined;

export function setProfileOverride(name: string | undefined): void {
	profileOverride = name || undefined;
}

export function configExists(): boolean {
	return existsSync(CONFIG_FILE);
}

function isLegacy(parsed: unknown): parsed is LegacyConfig {
	const o = parsed as Record<string, unknown>;
	return Boolean(o && typeof o === "object" && !o.profiles && typeof o.domain === "string");
}

function emptyFile(): ConfigFile {
	return { version: 2, current: DEFAULT_PROFILE, profiles: {} };
}

/**
 * Read ~/.vps/config.json, upgrading the legacy `{domain, apiKey}` shape into a
 * single profile named "default". The migration is written back so it happens once.
 */
export function readConfigFile(): ConfigFile {
	if (!existsSync(CONFIG_FILE)) return emptyFile();

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
	} catch {
		throw new AppError("CONFIG_INVALID", {
			human: `Config at ${CONFIG_FILE} is not valid JSON.`,
			hint: "Run `vps config reset` and reconfigure, or fix the file by hand.",
		});
	}

	if (isLegacy(parsed)) {
		const migrated: ConfigFile = {
			version: 2,
			current: DEFAULT_PROFILE,
			profiles: { [DEFAULT_PROFILE]: { domain: parsed.domain, apiKey: parsed.apiKey } },
		};
		writeConfigFile(migrated);
		return migrated;
	}

	const file = parsed as ConfigFile;
	if (!file || typeof file !== "object" || !file.profiles) return emptyFile();
	return { version: 2, current: file.current ?? DEFAULT_PROFILE, profiles: file.profiles };
}

export function writeConfigFile(file: ConfigFile): void {
	mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o755 });
	writeFileSync(CONFIG_FILE, JSON.stringify(file, null, "\t"), {
		encoding: "utf8",
		mode: 0o600,
	});
}

export function listProfiles(): ResolvedProfile[] {
	const file = readConfigFile();
	return Object.entries(file.profiles).map(([name, p]) => ({ name, ...p }));
}

export function profileNames(): string[] {
	return Object.keys(readConfigFile().profiles);
}

/** Name of the profile commands act on: --profile, then VPS_PROFILE, then stored current. */
export function activeProfileName(): string {
	return profileOverride ?? process.env.VPS_PROFILE ?? readConfigFile().current;
}

export function getProfile(name: string): ResolvedProfile | null {
	const p = readConfigFile().profiles[name];
	return p ? { name, ...p } : null;
}

/** Resolve the profile every API call runs against, or throw a readable error. */
export function loadConfig(): ResolvedProfile {
	const file = readConfigFile();
	const names = Object.keys(file.profiles);

	if (names.length === 0) {
		throw new AppError("CONFIG_MISSING", {
			human: "No VPS profile configured.",
			hint: "Run `vps config set` to add one.",
		});
	}

	const wanted = profileOverride ?? process.env.VPS_PROFILE ?? file.current;
	const profile = file.profiles[wanted];

	if (!profile) {
		throw new AppError("PROFILE_NOT_FOUND", {
			human: `Profile "${wanted}" not found.`,
			hint: `Known profiles: ${names.join(", ")}. Run \`vps config list\`.`,
		});
	}

	if (!profile.domain || !profile.apiKey) {
		throw new AppError("CONFIG_INVALID", {
			human: `Profile "${wanted}" is missing a domain or API key.`,
			hint: `Run \`vps config set --profile ${wanted}\` to reconfigure it.`,
		});
	}

	return { name: wanted, ...profile };
}

/** Create or update a profile. Returns the resulting file. */
export function saveProfile(
	name: string,
	profile: Profile,
	opts: { use?: boolean } = {},
): ConfigFile {
	const file = readConfigFile();
	const hadNone = Object.keys(file.profiles).length === 0;
	file.profiles[name] = profile;
	if (opts.use !== false || hadNone) file.current = name;
	writeConfigFile(file);
	return file;
}

export function useProfile(name: string): void {
	const file = readConfigFile();
	if (!file.profiles[name]) {
		throw new AppError("PROFILE_NOT_FOUND", {
			human: `Profile "${name}" not found.`,
			hint: `Known profiles: ${Object.keys(file.profiles).join(", ") || "none"}.`,
		});
	}
	file.current = name;
	writeConfigFile(file);
}

export function removeProfile(name: string): { current: string; remaining: string[] } {
	const file = readConfigFile();
	if (!file.profiles[name]) {
		throw new AppError("PROFILE_NOT_FOUND", {
			human: `Profile "${name}" not found.`,
			hint: `Known profiles: ${Object.keys(file.profiles).join(", ") || "none"}.`,
		});
	}
	delete file.profiles[name];
	const remaining = Object.keys(file.profiles);
	if (file.current === name) file.current = remaining[0] ?? DEFAULT_PROFILE;
	writeConfigFile(file);
	return { current: file.current, remaining };
}

export function renameProfile(from: string, to: string): void {
	const file = readConfigFile();
	const profile = file.profiles[from];
	if (!profile) {
		throw new AppError("PROFILE_NOT_FOUND", {
			human: `Profile "${from}" not found.`,
			hint: `Known profiles: ${Object.keys(file.profiles).join(", ") || "none"}.`,
		});
	}
	if (file.profiles[to]) {
		throw new AppError("PROFILE_EXISTS", { human: `Profile "${to}" already exists.` });
	}
	delete file.profiles[from];
	file.profiles[to] = profile;
	if (file.current === from) file.current = to;
	writeConfigFile(file);
}

/** Remove every profile by deleting the config file. */
export function resetConfig(): void {
	if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
}

export function redactApiKey(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}..${key.slice(-4)}`;
}
