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

export function registerRedis(program: Command): void {
	const cmd = program.command("redis").description("Manage Redis databases");

	// vps redis create <name>
	cmd
		.command("create <name>")
		.description("Create a ready-to-use Redis instance")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("--password <pw>", "Redis password (auto-generated if omitted)")
		.option("--port <number>", "External port (auto-assigned if omitted)")
		.option("--image <image>", "Docker image", "redis:8")
		.action(async function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const password = (opts.password as string) ?? generatePassword();
			const port = opts.port ? Number(opts.port) : await findAvailablePort();
			const image = opts.image as string;

			const log = (msg: string) => {
				if (!flags.quiet) process.stderr.write(`  ${msg}\n`);
			};
			log(`Creating ${name}...`);

			// 1. Create
			const created = await dokployPost<any>("redis.create", {
				name,
				databasePassword: password,
				dockerImage: image,
				environmentId: opts.environment,
			});
			const redisId = created.redisId;

			// 2. Open external port
			log(`Opening port ${port}...`);
			await dokployPost("redis.saveExternalPort", {
				redisId,
				externalPort: port,
			});

			// 3. Deploy
			log("Deploying...");
			await dokployPost("redis.deploy", { redisId });

			// 4. Get server IP
			const ip = await dokployGet<string>("settings.getIp").catch(() => "localhost");
			const url = `redis://:${password}@${ip}:${port}`;

			const result = {
				ok: true,
				redisId,
				name,
				password,
				port,
				image,
				connectionUrl: url,
			};

			emit(result, flags, () => {
				process.stdout.write("\n");
				ui.success(`Redis "${name}" is deploying.`);
				ui.kv("ID", redisId);
				ui.kv("Password", password);
				ui.kv("Port", port);
				ui.kv("URL", url);
				process.stdout.write("\n");
			});
		});

	// vps redis list
	cmd
		.command("list")
		.description("List all Redis instances")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("redis.search", { limit: "100" });
			const dbs = (data?.items ?? []).map((r: any) => ({
				id: r.redisId,
				name: r.name,
				status: r.applicationStatus,
			}));

			emit(dbs, flags, () => {
				ui.header("Redis Instances");
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

	// vps redis info <id>
	cmd
		.command("info <redisId>")
		.description("Show Redis details and connection URL")
		.action(async function (this: Command, redisId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const [data, ip] = await Promise.all([
				dokployGet<any>("redis.one", { redisId }),
				dokployGet<string>("settings.getIp").catch(() => "localhost"),
			]);

			const url = data.externalPort
				? `redis://:${data.databasePassword}@${ip}:${data.externalPort}`
				: null;

			const result = { ...data, connectionUrl: url };

			emit(result, flags, () => {
				ui.header(`Redis: ${data.name}`);
				ui.kv("ID", data.redisId);
				ui.kv("Status", data.applicationStatus);
				ui.kv("Password", data.databasePassword);
				ui.kv("Image", data.dockerImage);
				ui.kv("External Port", data.externalPort);
				if (url) ui.kv("URL", url);
				ui.kv("Created", data.createdAt);
				process.stdout.write("\n");
			});
		});

	// vps redis deploy <id>
	cmd
		.command("deploy <redisId>")
		.description("Deploy a Redis instance")
		.action(async function (this: Command, redisId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("redis.deploy", { redisId });
			emit({ ok: true, redisId }, flags, () => {
				ui.success(`Deployment triggered for ${redisId}.`);
			});
		});

	// vps redis start <id>
	cmd
		.command("start <redisId>")
		.description("Start a Redis instance")
		.action(async function (this: Command, redisId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("redis.start", { redisId });
			emit({ ok: true, redisId }, flags, () => {
				ui.success(`Redis ${redisId} started.`);
			});
		});

	// vps redis stop <id>
	cmd
		.command("stop <redisId>")
		.description("Stop a Redis instance")
		.action(async function (this: Command, redisId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("redis.stop", { redisId });
			emit({ ok: true, redisId }, flags, () => {
				ui.success(`Redis ${redisId} stopped.`);
			});
		});

	// vps redis remove <id>
	cmd
		.command("remove <redisId>")
		.description("Delete a Redis instance")
		.action(async function (this: Command, redisId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete Redis ${redisId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("redis.remove", { redisId });
			emit({ ok: true, redisId }, flags, () => {
				ui.success(`Redis ${redisId} removed.`);
			});
		});
}
