import type { Command } from "commander";
import { confirm } from "@clack/prompts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { dokployGet, dokployPost } from "../lib/api.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerDomain(program: Command): void {
	const cmd = program.command("domain").description("Manage domains");

	// vps domain list --app <appId> | --compose <composeId>
	cmd
		.command("list")
		.description("List domains for an app or compose stack")
		.option("--app <appId>", "Application ID")
		.option("--compose <composeId>", "Compose ID")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			if (!opts.app && !opts.compose) {
				process.stderr.write("  Error: provide --app <appId> or --compose <composeId>\n");
				process.exit(1);
			}

			let data: any[];
			if (opts.app) {
				data = await dokployGet<any[]>("domain.byApplicationId", {
					applicationId: opts.app,
				});
			} else {
				data = await dokployGet<any[]>("domain.byComposeId", {
					composeId: opts.compose,
				});
			}

			const domains = (data ?? []).map((d: any) => ({
				id: d.domainId,
				host: d.host,
				https: d.https,
				port: d.port,
				path: d.path ?? "/",
				certificate: d.certificateType,
			}));

			emit(domains, flags, () => {
				ui.header("Domains");
				if (domains.length === 0) {
					ui.kv("Domains", "none");
					process.stdout.write("\n");
					return;
				}
				ui.table(domains, [
					{ key: "id", label: "ID", width: 28 },
					{ key: "host", label: "Host", width: 32 },
					{ key: "https", label: "HTTPS", width: 6 },
					{ key: "port", label: "Port", width: 6 },
				]);
				process.stdout.write("\n");
			});
		});

	// vps domain add <host> --app <appId> | --compose <composeId>
	cmd
		.command("add <host>")
		.description("Add a domain to an app or compose service")
		.option("--app <appId>", "Application ID")
		.option("--compose <composeId>", "Compose ID")
		.option("--service <name>", "Service name (required for compose)")
		.option("--port <number>", "Container port (default: 3000)")
		.option("--https", "Enable HTTPS", true)
		.option("--no-https", "Disable HTTPS")
		.option("--cert <type>", "Certificate type (letsencrypt|none|custom)", "letsencrypt")
		.option("--path <path>", "Path-based routing (e.g. /api)")
		.option("--strip-path", "Strip path prefix when forwarding", false)
		.action(async function (this: Command, host: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			if (!opts.app && !opts.compose) {
				process.stderr.write("  Error: provide --app <appId> or --compose <composeId>\n");
				process.exit(1);
			}

			const payload: Record<string, unknown> = {
				host,
				https: opts.https as boolean,
				certificateType: opts.cert as string,
				stripPath: opts.stripPath as boolean,
			};

			if (opts.port) payload.port = Number(opts.port);
			if (opts.path) payload.path = opts.path;

			if (opts.app) {
				payload.applicationId = opts.app;
				payload.domainType = "application";
			} else {
				payload.composeId = opts.compose;
				payload.domainType = "compose";

				// Auto-detect or validate service name
				const services = await dokployGet<string[]>("compose.loadServices", {
					composeId: opts.compose,
				});

				let serviceName = opts.service as string | undefined;
				if (!serviceName) {
					if (services && services.length === 1) {
						serviceName = services[0];
						if (!flags.quiet) process.stderr.write(`  Auto-detected service: ${serviceName}\n`);
					} else if (services && services.length > 1) {
						process.stderr.write("  Error: multiple services found. Use --service to pick one:\n");
						for (const s of services) process.stderr.write(`    ${s}\n`);
						process.exit(1);
					}
				} else if (services && services.length > 0 && !services.includes(serviceName)) {
					process.stderr.write(`  Error: service "${serviceName}" not found in compose. Available:\n`);
					for (const s of services) process.stderr.write(`    ${s}\n`);
					process.exit(1);
				}

				if (serviceName) payload.serviceName = serviceName;
			}

			const result = await dokployPost<any>("domain.create", payload);

			emit(result, flags, () => {
				const proto = opts.https ? "https" : "http";
				ui.success(`Domain added: ${proto}://${host}`);
				if (result?.domainId) ui.kv("Domain ID", result.domainId);
			});
		});

	// vps domain info <domainId>
	cmd
		.command("info <domainId>")
		.description("Show domain details")
		.action(async function (this: Command, domainId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("domain.one", { domainId });

			emit(data, flags, () => {
				ui.header(`Domain: ${data.host}`);
				ui.kv("ID", data.domainId);
				ui.kv("Host", data.host);
				ui.kv("HTTPS", data.https);
				ui.kv("Certificate", data.certificateType);
				ui.kv("Port", data.port);
				ui.kv("Path", data.path);
				ui.kv("Strip Path", data.stripPath);
				ui.kv("Service", data.serviceName);
				ui.kv("Created", data.createdAt);
				process.stdout.write("\n");
			});
		});

	// vps domain remove <domainId>
	cmd
		.command("remove <domainId>")
		.description("Delete a domain")
		.action(async function (this: Command, domainId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete domain ${domainId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("domain.delete", { domainId });
			emit({ ok: true, domainId }, flags, () => {
				ui.success(`Domain ${domainId} removed.`);
			});
		});
}
