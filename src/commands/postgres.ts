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


function connectionUrl(
	ip: string,
	port: number,
	user: string,
	password: string,
	db: string,
): string {
	return `postgresql://${user}:${password}@${ip}:${port}/${db}`;
}

export function registerPostgres(program: Command): void {
	const cmd = program.command("pg").description("Manage PostgreSQL databases");

	// vps pg create <name> — full pipeline: create + deploy + open port + return URL
	cmd
		.command("create <name>")
		.description("Create a ready-to-use PostgreSQL database")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("--db <name>", "Database name (default: same as name)")
		.option("--user <user>", "Database user", "postgres")
		.option("--password <pw>", "Database password (auto-generated if omitted)")
		.option("--port <number>", "External port (random 5433-5999 if omitted)")
		.option("--image <image>", "Docker image", "postgres:18")
		.action(async function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const dbName = (opts.db as string) ?? name;
			const dbUser = opts.user as string;
			const dbPassword = (opts.password as string) ?? generatePassword();
			const port = opts.port ? Number(opts.port) : await findAvailablePort();
			const image = opts.image as string;

			const log = (msg: string) => {
				if (!flags.quiet) process.stderr.write(`  ${msg}\n`);
			};
			log(`Creating ${name}...`);

			// 1. Create
			const created = await dokployPost<any>("postgres.create", {
				name,
				databaseName: dbName,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				dockerImage: image,
				environmentId: opts.environment,
			});
			const pgId = created.postgresId;

			// 2. Open external port
			log(`Opening port ${port}...`);
			await dokployPost("postgres.saveExternalPort", {
				postgresId: pgId,
				externalPort: port,
			});

			// 3. Deploy
			log("Deploying...");
			await dokployPost("postgres.deploy", { postgresId: pgId });

			// 4. Get server IP for the URL
			const ip = await dokployGet<string>("settings.getIp").catch(
				() => "localhost",
			);

			const url = connectionUrl(ip, port, dbUser, dbPassword, dbName);

			const result = {
				ok: true,
				postgresId: pgId,
				name,
				databaseName: dbName,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				port,
				image,
				connectionUrl: url,
			};

			emit(result, flags, () => {
				process.stdout.write("\n");
				ui.success(`PostgreSQL "${name}" is deploying.`);
				ui.kv("ID", pgId);
				ui.kv("Database", dbName);
				ui.kv("User", dbUser);
				ui.kv("Password", dbPassword);
				ui.kv("Port", port);
				ui.kv("URL", url);
				process.stdout.write("\n");
			});
		});

	// vps pg list
	cmd
		.command("list")
		.description("List all PostgreSQL databases")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("postgres.search", { limit: "100" });
			const dbs = (data?.items ?? []).map((pg: any) => ({
				id: pg.postgresId,
				name: pg.name,
				status: pg.applicationStatus,
			}));

			emit(dbs, flags, () => {
				ui.header("PostgreSQL Databases");
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

	// vps pg info <id>
	cmd
		.command("info <postgresId>")
		.description("Show database details and connection URL")
		.action(async function (this: Command, postgresId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const [data, ip] = await Promise.all([
				dokployGet<any>("postgres.one", { postgresId }),
				dokployGet<string>("settings.getIp").catch(() => "localhost"),
			]);

			const url =
				data.externalPort
					? connectionUrl(
							ip,
							data.externalPort,
							data.databaseUser,
							data.databasePassword,
							data.databaseName,
						)
					: null;

			const result = { ...data, connectionUrl: url };

			emit(result, flags, () => {
				ui.header(`PostgreSQL: ${data.name}`);
				ui.kv("ID", data.postgresId);
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

	// vps pg deploy <id>
	cmd
		.command("deploy <postgresId>")
		.description("Deploy a PostgreSQL database")
		.action(async function (this: Command, postgresId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("postgres.deploy", { postgresId });
			emit({ ok: true, postgresId }, flags, () => {
				ui.success(`Deployment triggered for ${postgresId}.`);
			});
		});

	// vps pg start <id>
	cmd
		.command("start <postgresId>")
		.description("Start a PostgreSQL database")
		.action(async function (this: Command, postgresId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("postgres.start", { postgresId });
			emit({ ok: true, postgresId }, flags, () => {
				ui.success(`PostgreSQL ${postgresId} started.`);
			});
		});

	// vps pg stop <id>
	cmd
		.command("stop <postgresId>")
		.description("Stop a PostgreSQL database")
		.action(async function (this: Command, postgresId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("postgres.stop", { postgresId });
			emit({ ok: true, postgresId }, flags, () => {
				ui.success(`PostgreSQL ${postgresId} stopped.`);
			});
		});

	// vps pg remove <id>
	cmd
		.command("remove <postgresId>")
		.description("Delete a PostgreSQL database")
		.action(async function (this: Command, postgresId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete PostgreSQL ${postgresId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("postgres.remove", { postgresId });
			emit({ ok: true, postgresId }, flags, () => {
				ui.success(`PostgreSQL ${postgresId} removed.`);
			});
		});
}
