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

export function registerMongo(program: Command): void {
	const cmd = program.command("mongo").description("Manage MongoDB databases");

	// vps mongo create <name>
	cmd
		.command("create <name>")
		.description("Create a ready-to-use MongoDB instance")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("--user <user>", "Database user", "mongo")
		.option("--password <pw>", "Database password (auto-generated if omitted)")
		.option("--port <number>", "External port (auto-assigned if omitted)")
		.option("--image <image>", "Docker image", "mongo:8")
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
			const created = await dokployPost<any>("mongo.create", {
				name,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				dockerImage: image,
				environmentId: opts.environment,
			});
			const mongoId = created.mongoId;

			// 2. Open external port
			log(`Opening port ${port}...`);
			await dokployPost("mongo.saveExternalPort", {
				mongoId,
				externalPort: port,
			});

			// 3. Deploy
			log("Deploying...");
			await dokployPost("mongo.deploy", { mongoId });

			// 4. Get server IP
			const ip = await dokployGet<string>("settings.getIp").catch(() => "localhost");
			const url = `mongodb://${dbUser}:${dbPassword}@${ip}:${port}`;

			const result = {
				ok: true,
				mongoId,
				name,
				databaseUser: dbUser,
				databasePassword: dbPassword,
				port,
				image,
				connectionUrl: url,
			};

			emit(result, flags, () => {
				process.stdout.write("\n");
				ui.success(`MongoDB "${name}" is deploying.`);
				ui.kv("ID", mongoId);
				ui.kv("User", dbUser);
				ui.kv("Password", dbPassword);
				ui.kv("Port", port);
				ui.kv("URL", url);
				process.stdout.write("\n");
			});
		});

	// vps mongo list
	cmd
		.command("list")
		.description("List all MongoDB instances")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("mongo.search", { limit: "100" });
			const dbs = (data?.items ?? []).map((m: any) => ({
				id: m.mongoId,
				name: m.name,
				status: m.applicationStatus,
			}));

			emit(dbs, flags, () => {
				ui.header("MongoDB Instances");
				if (dbs.length === 0) {
					ui.kv("Instances", "none");
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

	// vps mongo info <id>
	cmd
		.command("info <mongoId>")
		.description("Show MongoDB details and connection URL")
		.action(async function (this: Command, mongoId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const [data, ip] = await Promise.all([
				dokployGet<any>("mongo.one", { mongoId }),
				dokployGet<string>("settings.getIp").catch(() => "localhost"),
			]);

			const url = data.externalPort
				? `mongodb://${data.databaseUser}:${data.databasePassword}@${ip}:${data.externalPort}`
				: null;

			const result = { ...data, connectionUrl: url };

			emit(result, flags, () => {
				ui.header(`MongoDB: ${data.name}`);
				ui.kv("ID", data.mongoId);
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

	// vps mongo deploy <id>
	cmd
		.command("deploy <mongoId>")
		.description("Deploy a MongoDB instance")
		.action(async function (this: Command, mongoId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mongo.deploy", { mongoId });
			emit({ ok: true, mongoId }, flags, () => {
				ui.success(`Deployment triggered for ${mongoId}.`);
			});
		});

	// vps mongo start <id>
	cmd
		.command("start <mongoId>")
		.description("Start a MongoDB instance")
		.action(async function (this: Command, mongoId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mongo.start", { mongoId });
			emit({ ok: true, mongoId }, flags, () => {
				ui.success(`MongoDB ${mongoId} started.`);
			});
		});

	// vps mongo stop <id>
	cmd
		.command("stop <mongoId>")
		.description("Stop a MongoDB instance")
		.action(async function (this: Command, mongoId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("mongo.stop", { mongoId });
			emit({ ok: true, mongoId }, flags, () => {
				ui.success(`MongoDB ${mongoId} stopped.`);
			});
		});

	// vps mongo remove <id>
	cmd
		.command("remove <mongoId>")
		.description("Delete a MongoDB instance")
		.action(async function (this: Command, mongoId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete MongoDB ${mongoId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("mongo.remove", { mongoId });
			emit({ ok: true, mongoId }, flags, () => {
				ui.success(`MongoDB ${mongoId} removed.`);
			});
		});
}
