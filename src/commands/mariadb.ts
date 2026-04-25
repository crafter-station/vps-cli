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

export function registerMariaDB(program: Command): void {
	const cmd = program.command("mariadb").description("Manage MariaDB databases");

	// vps mariadb create <name>
	cmd
		.command("create <name>")
		.description("Create a ready-to-use MariaDB database")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("--db <name>", "Database name (default: same as name)")
		.option("--user <user>", "Database user", "mariadb")
		.option("--password <pw>", "Database password (auto-generated if omitted)")
		.option("--root-password <pw>", "Root password (auto-generated if omitted)")
		.option("--port <number>", "External port (auto-assigned if omitted)")
		.option("--image <image>", "Docker image", "mariadb:11")
		.action(async function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const dbName = (opts.db as string) ?? name;
			const dbUser = opts.user as string;
			const dbPassword = (opts.password as string) ?? generatePassword();
			const rootPassword = (opts.rootPassword as string) ?? generatePassword();
			const port = opts.port ? Number(opts.port) : await findAvailablePort();
			const image = opts.image as string;

			const log = (msg: string) => {
				if (!flags.quiet) process.stderr.write(`  ${msg}\n`);
			};
			log(`Creating ${name}...`);

			// 1. Create
			const created = await dokployPost<any>("mariadb.create", {
				name,
				databaseName: dbName,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				databaseRootPassword: rootPassword,
				dockerImage: image,
				environmentId: opts.environment,
			});
			const mariadbId = created.mariadbId;

			// 2. Open external port
			log(`Opening port ${port}...`);
			await dokployPost("mariadb.saveExternalPort", {
				mariadbId,
				externalPort: port,
			});

			// 3. Deploy
			log("Deploying...");
			await dokployPost("mariadb.deploy", { mariadbId });

			// 4. Get server IP
			const ip = await dokployGet<string>("settings.getIp").catch(() => "localhost");
			const url = `mariadb://${dbUser}:${dbPassword}@${ip}:${port}/${dbName}`;

			const result = {
				ok: true,
				mariadbId,
				name,
				databaseName: dbName,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				databaseRootPassword: rootPassword,
				port,
				image,
				connectionUrl: url,
			};

			emit(result, flags, () => {
				process.stdout.write("\n");
				ui.success(`MariaDB "${name}" is deploying.`);
				ui.kv("ID", mariadbId);
				ui.kv("Database", dbName);
				ui.kv("User", dbUser);
				ui.kv("Password", dbPassword);
				ui.kv("Root Password", rootPassword);
				ui.kv("Port", port);
				ui.kv("URL", url);
				process.stdout.write("\n");
			});
		});

	// vps mariadb list
	cmd
		.command("list")
		.description("List all MariaDB databases")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("mariadb.search", { limit: "100" });
			const dbs = (data?.items ?? []).map((m: any) => ({
				id: m.mariadbId,
				name: m.name,
				status: m.applicationStatus,
			}));

			emit(dbs, flags, () => {
				ui.header("MariaDB Databases");
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

	// vps mariadb info <id>
	cmd
		.command("info <mariadbId>")
		.description("Show MariaDB details and connection URL")
		.action(async function (this: Command, mariadbId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const [data, ip] = await Promise.all([
				dokployGet<any>("mariadb.one", { mariadbId }),
				dokployGet<string>("settings.getIp").catch(() => "localhost"),
			]);

			const url = data.externalPort
				? `mariadb://${data.databaseUser}:${data.databasePassword}@${ip}:${data.externalPort}/${data.databaseName}`
				: null;

			const result = { ...data, connectionUrl: url };

			emit(result, flags, () => {
				ui.header(`MariaDB: ${data.name}`);
				ui.kv("ID", data.mariadbId);
				ui.kv("Status", data.applicationStatus);
				ui.kv("Database", data.databaseName);
				ui.kv("User", data.databaseUser);
				ui.kv("Password", data.databasePassword);
				ui.kv("Image", data.dockerImage);
				ui.kv("External Port", data.externalPort);
				if (url) ui.kv("URL", url);
				ui.kv("Created", data.createdAt);
				process.stdout.write("\n");
			});
		});

	// vps mariadb deploy <id>
	cmd
		.command("deploy <mariadbId>")
		.description("Deploy a MariaDB database")
		.action(async function (this: Command, mariadbId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mariadb.deploy", { mariadbId });
			emit({ ok: true, mariadbId }, flags, () => {
				ui.success(`Deployment triggered for ${mariadbId}.`);
			});
		});

	// vps mariadb start <id>
	cmd
		.command("start <mariadbId>")
		.description("Start a MariaDB database")
		.action(async function (this: Command, mariadbId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mariadb.start", { mariadbId });
			emit({ ok: true, mariadbId }, flags, () => {
				ui.success(`MariaDB ${mariadbId} started.`);
			});
		});

	// vps mariadb stop <id>
	cmd
		.command("stop <mariadbId>")
		.description("Stop a MariaDB database")
		.action(async function (this: Command, mariadbId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mariadb.stop", { mariadbId });
			emit({ ok: true, mariadbId }, flags, () => {
				ui.success(`MariaDB ${mariadbId} stopped.`);
			});
		});

	// vps mariadb remove <id>
	cmd
		.command("remove <mariadbId>")
		.description("Delete a MariaDB database")
		.action(async function (this: Command, mariadbId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete MariaDB ${mariadbId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("mariadb.remove", { mariadbId });
			emit({ ok: true, mariadbId }, flags, () => {
				ui.success(`MariaDB ${mariadbId} removed.`);
			});
		});
}
