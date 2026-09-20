import type { Command } from "commander";
import { confirm, text } from "@clack/prompts";
import {
	activeProfileName,
	getProfile,
	listProfiles,
	profileNames,
	redactApiKey,
	removeProfile,
	renameProfile,
	resetConfig,
	saveProfile,
	useProfile,
} from "../cli/config.ts";
import { AppError } from "../cli/error-map.ts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { CONFIG_FILE, DEFAULT_PROFILE } from "../constants.ts";
import type { Profile } from "../types.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

/** Public view of a profile: API key redacted, name and active flag attached. */
function describe(name: string, profile: Profile, active: string) {
	return {
		name,
		active: name === active,
		domain: profile.domain,
		apiKey: redactApiKey(profile.apiKey),
		baseDomain: profile.baseDomain ?? null,
		dnsCommand: profile.dnsCommand ?? null,
		configPath: CONFIG_FILE,
	};
}

export function registerConfig(program: Command): void {
	const cmd = program
		.command("config")
		.description("Manage VPS profiles (one per Dokploy instance)");

	// vps config set [--profile <name>] --domain <url> --api-key <key>
	cmd
		.command("set")
		.description("Create or update a profile")
		.option("--domain <url>", "Dokploy dashboard URL")
		.option("--api-key <key>", "Dokploy API key")
		.option("--base-domain <domain>", "Apex domain for subdomains, e.g. example.com")
		.option(
			"--dns-command <template>",
			"Command creating a DNS record; {subdomain} {host} {ip} {baseDomain} are substituted",
		)
		.option("--no-use", "Keep the current profile active instead of switching")
		.action(async function (this: Command) {
			const opts = this.optsWithGlobals();
			const flags = parseGlobalFlags(opts);
			const existingNames = profileNames();

			// --profile names the target; without it, update the active profile (or ask).
			let name = flags.profile;
			if (!name) {
				if (existingNames.length === 0) {
					const result = await text({
						message: "Profile name",
						placeholder: DEFAULT_PROFILE,
						defaultValue: DEFAULT_PROFILE,
					});
					if (typeof result !== "string") process.exit(130);
					name = result || DEFAULT_PROFILE;
				} else {
					name = activeProfileName();
				}
			}

			const existing = getProfile(name);
			let domain = opts.domain as string | undefined;
			let apiKey = opts.apiKey as string | undefined;

			// Editing an existing profile with flags stays non-interactive: anything the
			// flags don't mention keeps its stored value. Prompt only for a brand-new
			// profile, or for a bare `vps config set` with nothing to go on.
			const patching =
				Boolean(existing) &&
				Boolean(opts.domain || opts.apiKey || opts.baseDomain || opts.dnsCommand);

			if (!domain) {
				if (patching) {
					domain = existing?.domain;
				} else if (existing) {
					const result = await text({
						message: "Dokploy domain",
						placeholder: existing.domain,
						defaultValue: existing.domain,
					});
					if (typeof result !== "string") process.exit(130);
					domain = result || existing.domain;
				} else {
					const result = await text({
						message: "Dokploy domain (e.g. https://vps.example.com)",
						validate: (v) => {
							if (!v?.startsWith("http")) return "Must start with http:// or https://";
						},
					});
					if (typeof result !== "string") process.exit(130);
					domain = result;
				}
			}

			if (!apiKey) {
				if (patching) {
					apiKey = existing?.apiKey;
				} else {
					const result = await text({ message: "API key" });
					if (typeof result !== "string") process.exit(130);
					apiKey = result || existing?.apiKey;
				}
			}

			if (!domain || !apiKey) {
				throw new AppError("CONFIG_INVALID", {
					human: "Both a domain and an API key are required.",
					hint: "vps config set --profile <name> --domain <url> --api-key <key>",
				});
			}

			const profile: Profile = { domain: domain.replace(/\/+$/, ""), apiKey };
			const baseDomain = (opts.baseDomain as string | undefined) ?? existing?.baseDomain;
			const dnsCommand = (opts.dnsCommand as string | undefined) ?? existing?.dnsCommand;
			if (baseDomain) profile.baseDomain = baseDomain;
			if (dnsCommand) profile.dnsCommand = dnsCommand;

			const file = saveProfile(name, profile, { use: opts.use !== false });
			const result = describe(name, profile, file.current);

			emit(result, flags, () => {
				ui.success(`Profile "${name}" saved to ${CONFIG_FILE}`);
				if (file.current === name) ui.kv("Active", name);
			});
		});

	// vps config list
	cmd
		.command("list")
		.alias("ls")
		.description("List configured profiles")
		.action(function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const active = activeProfileName();
			const rows = listProfiles().map((p) => describe(p.name, p, active));

			emit(rows, flags, () => {
				ui.header("VPS Profiles");
				if (rows.length === 0) {
					ui.kv("Profiles", "none — run `vps config set`");
					process.stdout.write("\n");
					return;
				}
				ui.table(
					rows.map((r) => ({ ...r, marker: r.active ? "*" : " " })),
					[
						{ key: "marker", label: "", width: 2 },
						{ key: "name", label: "Name", width: 20 },
						{ key: "domain", label: "Domain", width: 40 },
						{ key: "apiKey", label: "API Key", width: 12 },
					],
				);
				process.stdout.write("\n");
			});
		});

	// vps config use <profile>
	cmd
		.command("use <profile>")
		.description("Switch the active profile")
		.action(function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			useProfile(name);
			emit({ ok: true, active: name }, flags, () => {
				ui.success(`Active profile is now "${name}".`);
			});
		});

	// vps config show [profile]
	cmd
		.command("show [profile]")
		.description("Show a profile (defaults to the active one)")
		.option("--all", "Show every profile")
		.action(function (this: Command, nameArg: string | undefined) {
			const opts = this.optsWithGlobals();
			const flags = parseGlobalFlags(opts);
			const active = activeProfileName();

			if (opts.all) {
				const rows = listProfiles().map((p) => describe(p.name, p, active));
				emit(rows, flags, () => {
					for (const r of rows) {
						ui.header(`Profile: ${r.name}${r.active ? " (active)" : ""}`);
						ui.kv("Domain", r.domain);
						ui.kv("API Key", r.apiKey);
						if (r.baseDomain) ui.kv("Base Domain", r.baseDomain);
						if (r.dnsCommand) ui.kv("DNS Command", r.dnsCommand);
						process.stdout.write("\n");
					}
				});
				return;
			}

			const name = nameArg ?? flags.profile ?? active;
			const profile = getProfile(name);
			if (!profile) {
				const known = profileNames();
				throw new AppError("PROFILE_NOT_FOUND", {
					human:
						known.length === 0
							? "No VPS profile configured."
							: `Profile "${name}" not found.`,
					hint:
						known.length === 0
							? "Run `vps config set` to add one."
							: `Known profiles: ${known.join(", ")}.`,
				});
			}

			const display = describe(name, profile, active);
			emit(display, flags, () => {
				ui.header(`Profile: ${name}${display.active ? " (active)" : ""}`);
				ui.kv("Domain", display.domain);
				ui.kv("API Key", display.apiKey);
				ui.kv("Base Domain", display.baseDomain ?? "not set");
				ui.kv("DNS Command", display.dnsCommand ?? "not set");
				ui.kv("Config Path", display.configPath);
				process.stdout.write("\n");
			});
		});

	// vps config rename <from> <to>
	cmd
		.command("rename <from> <to>")
		.description("Rename a profile")
		.action(function (this: Command, from: string, to: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			renameProfile(from, to);
			emit({ ok: true, from, to }, flags, () => {
				ui.success(`Profile "${from}" renamed to "${to}".`);
			});
		});

	// vps config remove <profile>
	cmd
		.command("remove <profile>")
		.alias("rm")
		.description("Delete one profile")
		.action(async function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({ message: `Delete profile "${name}"?` });
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			const { current, remaining } = removeProfile(name);
			emit({ ok: true, removed: name, active: current, remaining }, flags, () => {
				ui.success(`Profile "${name}" removed.`);
				if (remaining.length > 0) ui.kv("Active", current);
				else ui.warn("No profiles left. Run `vps config set` to add one.");
			});
		});

	// vps config reset
	cmd
		.command("reset")
		.description("Remove every profile")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const names = profileNames();

			if (names.length > 0 && !flags.yes) {
				const ok = await confirm({
					message: `Delete all ${names.length} profile(s)? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			resetConfig();
			emit({ ok: true, removed: names }, flags, () => {
				ui.success("All profiles removed.");
			});
		});
}
