import type { Command } from "commander";
import { text } from "@clack/prompts";
import {
	configExists,
	loadConfig,
	redactApiKey,
	resetConfig,
	saveConfig,
} from "../cli/config.ts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { CONFIG_FILE } from "../constants.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerConfig(program: Command): void {
	const cmd = program.command("config").description("Manage CLI configuration");

	cmd
		.command("set")
		.description("Set domain and API key")
		.option("--domain <url>", "Dokploy dashboard URL")
		.option("--api-key <key>", "Dokploy API key")
		.action(async function (this: Command) {
			const opts = this.optsWithGlobals();
			let domain = opts.domain as string | undefined;
			let apiKey = opts.apiKey as string | undefined;

			if (!domain) {
				const result = await text({
					message: "Dokploy domain (e.g. https://vps.crafter.run)",
					validate: (v) => {
						if (!v.startsWith("http")) return "Must start with http:// or https://";
					},
				});
				if (typeof result !== "string") process.exit(130);
				domain = result;
			}

			if (!apiKey) {
				const result = await text({ message: "API key" });
				if (typeof result !== "string") process.exit(130);
				apiKey = result;
			}

			saveConfig({ domain: domain.replace(/\/+$/, ""), apiKey });
			ui.success(`Config saved to ${CONFIG_FILE}`);
		});

	cmd
		.command("show")
		.description("Show current configuration")
		.action(function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!configExists()) {
				ui.warn("No config found. Run `vps config set` first.");
				process.exit(1);
			}

			const config = loadConfig();
			const display = {
				domain: config.domain,
				apiKey: redactApiKey(config.apiKey),
				configPath: CONFIG_FILE,
			};

			emit(display, flags, () => {
				ui.header("VPS Config");
				ui.kv("Domain", display.domain);
				ui.kv("API Key", display.apiKey);
				ui.kv("Config Path", display.configPath);
				process.stdout.write("\n");
			});
		});

	cmd
		.command("reset")
		.description("Remove stored configuration")
		.action(function () {
			resetConfig();
			ui.success("Config removed.");
		});
}
