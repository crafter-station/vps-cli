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

export function registerMySQL(program: Command): void {
	const cmd = program.command("mysql").description("Manage MySQL databases");

	// vps mysql create <name>
	cmd
		.command("create <name>")
		.description("Create a ready-to-use MySQL database")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("--db <name>", "Database name (default: same as name)")
		.option("--user <user>", "Database user", "mysql")
		.option("--password <pw>", "Database password (auto-generated if omitted)")
		.option("--root-password <pw>", "Root password (auto-generated if omitted)")
		.option("--port <number>", "External port (auto-assigned if omitted)")
		.option("--image <image>", "Docker image", "mysql:8")
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
			const created = await dokployPost<any>("mysql.create", {
				name,
				databaseName: dbName,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				databaseRootPassword: rootPassword,
				dockerImage: image,
				environmentId: opts.environment,
			});
			const mysqlId = created.mysqlId;

			// 2. Open external port
			log(`Opening port ${port}...`);
			await dokployPost("mysql.saveExternalPort", {
				mysqlId,
				externalPort: port,
			});

			// 3. Deploy
			log("Deploying...");
			await dokployPost("mysql.deploy", { mysqlId });

			// 4. Get server IP
			const ip = await dokployGet<string>("settings.getIp").catch(() => "localhost");
			const url = `mysql://${dbUser}:${dbPassword}@${ip}:${port}/${dbName}`;

			const result = {
				ok: true,
				mysqlId,
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
				ui.success(`MySQL "${name}" is deploying.`);
				ui.kv("ID", mysqlId);
				ui.kv("Database", dbName);
				ui.kv("User", dbUser);
				ui.kv("Password", dbPassword);
				ui.kv("Root Password", rootPassword);
				ui.kv("Port", port);
				ui.kv("URL", url);
				process.stdout.write("\n");
			});
		});

	// vps mysql list
	cmd
		.command("list")
		.description("List all MySQL databases")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("mysql.search", { limit: "100" });
			const dbs = (data?.items ?? []).map((m: any) => ({
				id: m.mysqlId,
				name: m.name,
				status: m.applicationStatus,
			}));

			emit(dbs, flags, () => {
				ui.header("MySQL Databases");
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

	// vps mysql info <id>
	cmd
		.command("info <mysqlId>")
		.description("Show MySQL details and connection URL")
		.action(async function (this: Command, mysqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const [data, ip] = await Promise.all([
				dokployGet<any>("mysql.one", { mysqlId }),
				dokployGet<string>("settings.getIp").catch(() => "localhost"),
			]);

			const url = data.externalPort
				? `mysql://${data.databaseUser}:${data.databasePassword}@${ip}:${data.externalPort}/${data.databaseName}`
				: null;

			const result = { ...data, connectionUrl: url };

			emit(result, flags, () => {
				ui.header(`MySQL: ${data.name}`);
				ui.kv("ID", data.mysqlId);
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

	// vps mysql deploy <id>
	cmd
		.command("deploy <mysqlId>")
		.description("Deploy a MySQL database")
		.action(async function (this: Command, mysqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mysql.deploy", { mysqlId });
			emit({ ok: true, mysqlId }, flags, () => {
				ui.success(`Deployment triggered for ${mysqlId}.`);
			});
		});

	// vps mysql start <id>
	cmd
		.command("start <mysqlId>")
		.description("Start a MySQL database")
		.action(async function (this: Command, mysqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mysql.start", { mysqlId });
			emit({ ok: true, mysqlId }, flags, () => {
				ui.success(`MySQL ${mysqlId} started.`);
			});
		});

	// vps mysql stop <id>
	cmd
		.command("stop <mysqlId>")
		.description("Stop a MySQL database")
		.action(async function (this: Command, mysqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mysql.stop", { mysqlId });
			emit({ ok: true, mysqlId }, flags, () => {
				ui.success(`MySQL ${mysqlId} stopped.`);
			});
		});

	// vps mysql remove <id>
	cmd
		.command("remove <mysqlId>")
		.description("Delete a MySQL database")
		.action(async function (this: Command, mysqlId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete MySQL ${mysqlId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("mysql.remove", { mysqlId });
			emit({ ok: true, mysqlId }, flags, () => {
				ui.success(`MySQL ${mysqlId} removed.`);
			});
		});
}
