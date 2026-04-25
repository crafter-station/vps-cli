import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import { confirm } from "@clack/prompts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { dokployGet, dokployPost, findAvailablePort } from "../lib/api.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

function generatePassword(len = 16): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = randomBytes(len);
	return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function registerLibSQL(program: Command): void {
	const cmd = program.command("libsql").description("Manage LibSQL databases");

	// vps libsql create <name>
	cmd
		.command("create <name>")
		.description("Create a ready-to-use LibSQL database")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("--user <user>", "Database user", "libsql")
		.option("--password <pw>", "Database password (auto-generated if omitted)")
		.option("--port <number>", "External port (auto-assigned if omitted)")
		.option(
			"--image <image>",
			"Docker image",
			"ghcr.io/tursodatabase/libsql-server:v0.24.32",
		)
		.action(async function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const dbUser = opts.user as string;
			const dbPassword = (opts.password as string) ?? generatePassword();
			const port = opts.port ? Number(opts.port) : await findAvailablePort();
			const image = opts.image as string;

			const log = (msg: string) => {
				if (!flags.quiet) process.stderr.write(`  ${msg}\n`);
			};
			log(`Creating ${name}...`);

			// 1. Create
			const created = await dokployPost<any>("libsql.create", {
				name,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				dockerImage: image,
				environmentId: opts.environment,
			});
			const libsqlId = created.libsqlId;

			// 2. Open external port
			log(`Opening port ${port}...`);
			await dokployPost("libsql.saveExternalPorts", {
				libsqlId,
				externalPort: port,
			});

			// 3. Deploy
			log("Deploying...");
			await dokployPost("libsql.deploy", { libsqlId });

			// 4. Get server IP
			const ip = await dokployGet<string>("settings.getIp").catch(() => "localhost");
			const url = `http://${ip}:${port}`;

			const result = {
				ok: true,
				libsqlId,
				name,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				port,
				image,
				connectionUrl: url,
			};

			emit(result, flags, () => {
				process.stdout.write("\n");
				ui.success(`LibSQL "${name}" is deploying.`);
				ui.kv("ID", libsqlId);
				ui.kv("User", dbUser);
				ui.kv("Password", dbPassword);
				ui.kv("Port", port);
				ui.kv("URL", url);
				process.stdout.write("\n");
			});
		});

	// vps libsql list
	cmd
		.command("list")
		.description("List all LibSQL databases")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("libsql.search", { limit: "100" });
			const dbs = (data?.items ?? []).map((l: any) => ({
				id: l.libsqlId,
				name: l.name,
				status: l.applicationStatus,
			}));

			emit(dbs, flags, () => {
				ui.header("LibSQL Databases");
				if (dbs.length === 0) {
					ui.kv("Databases", "none");
					process.stdout.write("\n");
					return;
				}
				ui.table(dbs, [
					{ key: "id", label: "ID", width: 28 },
					{ key: "name", label: "Name", width: 20 },
					{ key: "status", label: "Status", width: 10 },
				]);
				process.stdout.write("\n");
			});
		});

	// vps libsql info <id>
	cmd
		.command("info <libsqlId>")
		.description("Show LibSQL details and connection URL")
		.action(async function (this: Command, libsqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const [data, ip] = await Promise.all([
				dokployGet<any>("libsql.one", { libsqlId }),
				dokployGet<string>("settings.getIp").catch(() => "localhost"),
			]);

			const url = data.externalPort ? `http://${ip}:${data.externalPort}` : null;

			const result = { ...data, connectionUrl: url };

			emit(result, flags, () => {
				ui.header(`LibSQL: ${data.name}`);
				ui.kv("ID", data.libsqlId);
				ui.kv("Status", data.applicationStatus);
				ui.kv("User", data.databaseUser);
				ui.kv("Password", data.databasePassword);
				ui.kv("Image", data.dockerImage);
				ui.kv("External Port", data.externalPort);
				if (url) ui.kv("URL", url);
				ui.kv("Created", data.createdAt);
				process.stdout.write("\n");
			});
		});

	// vps libsql deploy <id>
	cmd
		.command("deploy <libsqlId>")
		.description("Deploy a LibSQL database")
		.action(async function (this: Command, libsqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("libsql.deploy", { libsqlId });
			emit({ ok: true, libsqlId }, flags, () => {
				ui.success(`Deployment triggered for ${libsqlId}.`);
			});
		});

	// vps libsql start <id>
	cmd
		.command("start <libsqlId>")
		.description("Start a LibSQL database")
		.action(async function (this: Command, libsqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("libsql.start", { libsqlId });
			emit({ ok: true, libsqlId }, flags, () => {
				ui.success(`LibSQL ${libsqlId} started.`);
			});
		});

	// vps libsql stop <id>
	cmd
		.command("stop <libsqlId>")
		.description("Stop a LibSQL database")
		.action(async function (this: Command, libsqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("libsql.stop", { libsqlId });
			emit({ ok: true, libsqlId }, flags, () => {
				ui.success(`LibSQL ${libsqlId} stopped.`);
			});
		});

	// vps libsql remove <id>
	cmd
		.command("remove <libsqlId>")
		.description("Delete a LibSQL database")
		.action(async function (this: Command, libsqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete LibSQL ${libsqlId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("libsql.remove", { libsqlId });
			emit({ ok: true, libsqlId }, flags, () => {
				ui.success(`LibSQL ${libsqlId} removed.`);
			});
		});
}
