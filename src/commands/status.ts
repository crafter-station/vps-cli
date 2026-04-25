import type { Command } from "commander";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { dokployGet } from "../lib/api.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerStatus(program: Command): void {
	program
		.command("status")
		.description("Check connectivity and server version")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			const [healthRaw, versionRaw] = await Promise.all([
				dokployGet<any>("settings.health").catch(() => "unreachable"),
				dokployGet<any>("settings.getDokployVersion").catch(() => "unknown"),
			]);

			// health returns {"status":"ok"} or just "ok"
			const health =
				typeof healthRaw === "object" && healthRaw?.status
					? healthRaw.status
					: String(healthRaw);

			// version returns "v0.29.1" (plain string)
			const version = typeof versionRaw === "string" ? versionRaw : String(versionRaw);

			const result = {
				ok: health === "ok",
				health,
				version,
			};

			emit(result, flags, () => {
				ui.header("VPS Status");
				ui.kv("Health", result.health === "ok" ? "healthy" : result.health);
				ui.kv("Dokploy Version", result.version);
				process.stdout.write("\n");
			});
		});
}
