import type { Command } from "commander";
import { confirm } from "@clack/prompts";
import pc from "picocolors";
import { detectMode } from "../cli/detect.ts";
import { AppError } from "../cli/error-map.ts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import {
	fetchContainerLogs,
	type LogLine,
	parseLogLine,
	streamContainerLogs,
} from "../lib/ws-logs.ts";
import type { OutputMode } from "../types.ts";
import { type AppContainer, dokployGet, dokployPost, getAppContainers, getAppTasks } from "../lib/api.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerApp(program: Command): void {
	const cmd = program.command("app").description("Manage applications");

	// vps app list
	cmd
		.command("list")
		.description("List all applications")
		.option("--project <projectId>", "Filter by project ID")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();
			const projectFilter = opts.project as string | undefined;

			// Fetch all projects to extract apps
			const projects = await dokployGet<any[]>("project.all");
			const apps: any[] = [];

			for (const proj of projects ?? []) {
				for (const env of proj.environments ?? []) {
					for (const app of env.applications ?? []) {
						if (projectFilter && proj.projectId !== projectFilter) continue;
						apps.push({
							id: app.applicationId,
							name: app.name,
							status: app.applicationStatus,
							project: proj.name,
							environment: env.name ?? "default",
						});
					}
				}
			}

			emit(apps, flags, () => {
				ui.header("Applications");
				if (apps.length === 0) {
					ui.kv("Applications", "none");
					process.stdout.write("\n");
					return;
				}
				ui.table(apps, [
					{ key: "id", label: "ID", width: 28 },
					{ key: "name", label: "Name", width: 20 },
					{ key: "status", label: "Status", width: 10 },
					{ key: "project", label: "Project", width: 18 },
				]);
				process.stdout.write("\n");
			});
		});

	// vps app create <name>
	cmd
		.command("create <name>")
		.description("Create an application")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("-d, --description <text>", "Application description")
		.action(async function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const result = await dokployPost<any>("application.create", {
				name,
				environmentId: opts.environment,
				description: opts.description ?? undefined,
			});

			emit(result, flags, () => {
				ui.success(`Application "${name}" created.`);
				if (result?.applicationId) ui.kv("App ID", result.applicationId);
				if (result?.appName) ui.kv("App Name", result.appName);
			});
		});

	// vps app info <id>
	cmd
		.command("info <appId>")
		.description("Show application details")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("application.one", { applicationId: appId });

			emit(data, flags, () => {
				ui.header(`Application: ${data.name}`);
				ui.kv("ID", data.applicationId);
				ui.kv("App Name", data.appName);
				ui.kv("Status", data.applicationStatus);
				ui.kv("Source", data.sourceType);
				ui.kv("Build Type", data.buildType);
				ui.kv("Replicas", data.replicas);
				ui.kv("Docker Image", data.dockerImage);
				ui.kv("Repository", data.repository);
				ui.kv("Branch", data.branch);
				ui.kv("Created", data.createdAt);
				process.stdout.write("\n");
			});
		});

	// vps app containers <appId>
	cmd
		.command("containers <appId>")
		.description("List the containers backing an application")
		.option("--history", "Also list shut-down Swarm tasks (deployment history)")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();
			const app = await dokployGet<any>("application.one", { applicationId: appId });
			const containers = await getAppContainers(app.appName, app.serverId);

			const tasks = opts.history ? await getAppTasks(app.appName, app.serverId) : [];
			const result = {
				applicationId: appId,
				appName: app.appName,
				containers,
				...(opts.history ? { tasks } : {}),
			};

			emit(result, flags, () => {
				ui.header(`Containers: ${app.name}`);
				if (containers.length === 0) {
					ui.kv("Containers", "none running");
					process.stdout.write("\n");
				} else {
					ui.table(containers, [
						{ key: "containerId", label: "Container", width: 14 },
						{ key: "name", label: "Name", width: 46 },
						{ key: "state", label: "State", width: 10 },
					]);
					process.stdout.write("\n");
				}
				if (opts.history) {
					ui.header("Swarm Tasks");
					ui.table(tasks, [
						{ key: "containerId", label: "Task", width: 26 },
						{ key: "state", label: "State", width: 10 },
						{ key: "currentState", label: "Current", width: 24 },
						{ key: "node", label: "Node", width: 14 },
					]);
					process.stdout.write("\n");
				}
			});
		});

	// vps app logs <appId>
	cmd
		.command("logs <appId>")
		.description("Show logs for each container of an application")
		.option("-n, --tail <n>", "Lines to read per container (1-10000)", "100")
		.option("--container <containerId>", "Read only this container")
		.option("--since <duration>", "Only lines newer than: all | 30s | 5m | 2h | 1d", "all")
		.option("--search <text>", "Only lines containing this text")
		.option("-f, --follow", "Stream logs until interrupted")
		.option("--aggregate", "Whole-service logs (no per-container split)")
		.option("--no-timestamps", "Strip the RFC3339 timestamp prefix")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();
			const mode = detectMode(flags);
			const tail = parseTail(opts.tail);
			const since = parseSince(opts.since);
			const search = (opts.search as string | undefined) || undefined;
			const showTimestamps = opts.timestamps !== false;

			if (opts.aggregate) {
				if (opts.follow) {
					throw new AppError("BAD_FLAGS", {
						human: "--follow cannot be combined with --aggregate.",
						hint: "Drop --aggregate to stream per-container logs.",
					});
				}
				const raw = await dokployGet<string>("application.readLogs", {
					applicationId: appId,
					tail: String(tail),
					since: opts.since,
					...(search ? { search } : {}),
				});
				const lines = toLogLines(typeof raw === "string" ? raw : String(raw ?? ""));
				emit({ applicationId: appId, lines }, flags, () => {
					ui.header("Logs (all containers)");
					printLines(lines, showTimestamps);
					process.stdout.write("\n");
				});
				return;
			}

			const app = await dokployGet<any>("application.one", { applicationId: appId });
			const serverId = app.serverId as string | null;
			const containers: AppContainer[] = opts.container
				? [{ containerId: opts.container, name: opts.container, state: "unknown" }]
				: await getAppContainers(app.appName, serverId);

			if (containers.length === 0) {
				emit({ applicationId: appId, appName: app.appName, containers: [] }, flags, () => {
					ui.warn(`No running containers for "${app.name}".`);
					ui.warn("Try `vps app logs <appId> --aggregate` for the service log.");
				});
				return;
			}

			if (opts.follow) {
				await followContainers(containers, { tail, serverId }, { mode, search, showTimestamps });
				return;
			}

			const results = await Promise.all(
				containers.map(async (c) => ({
					containerId: c.containerId,
					name: c.name,
					state: c.state,
					lines: filterLines(await fetchContainerLogs(c.containerId, { tail, serverId }), {
						since,
						search,
					}),
				})),
			);

			emit({ applicationId: appId, appName: app.appName, containers: results }, flags, () => {
				for (const c of results) {
					ui.header(`${c.containerId} · ${c.state}`);
					printLines(c.lines, showTimestamps);
				}
				process.stdout.write("\n");
			});
		});

	// vps app deploy <id>
	cmd
		.command("deploy <appId>")
		.description("Trigger a deployment")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("application.deploy", { applicationId: appId });

			emit({ ok: true, applicationId: appId }, flags, () => {
				ui.success(`Deployment triggered for ${appId}.`);
			});
		});

	// vps app redeploy <id>
	cmd
		.command("redeploy <appId>")
		.description("Redeploy an application")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("application.redeploy", { applicationId: appId });

			emit({ ok: true, applicationId: appId }, flags, () => {
				ui.success(`Redeployment triggered for ${appId}.`);
			});
		});

	// vps app start <id>
	cmd
		.command("start <appId>")
		.description("Start an application")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("application.start", { applicationId: appId });

			emit({ ok: true, applicationId: appId }, flags, () => {
				ui.success(`Application ${appId} started.`);
			});
		});

	// vps app stop <id>
	cmd
		.command("stop <appId>")
		.description("Stop an application")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("application.stop", { applicationId: appId });

			emit({ ok: true, applicationId: appId }, flags, () => {
				ui.success(`Application ${appId} stopped.`);
			});
		});

	// vps app remove <id>
	cmd
		.command("remove <appId>")
		.description("Delete an application")
		.action(async function (this: Command, appId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete application ${appId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("application.delete", { applicationId: appId });

			emit({ ok: true, applicationId: appId }, flags, () => {
				ui.success(`Application ${appId} removed.`);
			});
		});
}

const SINCE_RE = /^(all|\d+[smhd])$/;
const SINCE_UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseTail(raw: unknown): number {
	const n = Number.parseInt(String(raw), 10);
	if (!Number.isFinite(n) || n < 1 || n > 10_000) {
		throw new AppError("BAD_FLAGS", {
			human: `Invalid --tail "${raw}".`,
			hint: "Use an integer between 1 and 10000.",
		});
	}
	return n;
}

/** Turn `--since` into a cutoff timestamp in ms, or null for "all". */
function parseSince(raw: unknown): number | null {
	const value = String(raw ?? "all");
	if (!SINCE_RE.test(value)) {
		throw new AppError("BAD_FLAGS", {
			human: `Invalid --since "${value}".`,
			hint: 'Use "all" or a duration like 30s, 5m, 2h, 1d.',
		});
	}
	if (value === "all") return null;
	const unit = value.slice(-1);
	return Date.now() - Number.parseInt(value.slice(0, -1), 10) * SINCE_UNITS[unit]!;
}

function toLogLines(raw: string): LogLine[] {
	return raw
		.split("\n")
		.filter((line) => line.length > 0)
		.map(parseLogLine);
}

/**
 * The container log socket only accepts `tail`, so `--since` and `--search`
 * are applied here rather than server-side.
 */
function filterLines(
	lines: LogLine[],
	opts: { since: number | null; search?: string },
): LogLine[] {
	const needle = opts.search?.toLowerCase();
	return lines.filter((line) => {
		if (opts.since !== null) {
			const at = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;
			if (Number.isFinite(at) && at < opts.since) return false;
		}
		if (needle && !line.message.toLowerCase().includes(needle)) return false;
		return true;
	});
}

function printLines(lines: LogLine[], showTimestamps: boolean): void {
	if (lines.length === 0) {
		process.stdout.write(pc.dim("  (no matching log lines)\n"));
		return;
	}
	for (const line of lines) {
		const prefix = showTimestamps && line.timestamp ? `${pc.dim(line.timestamp)} ` : "";
		process.stdout.write(`  ${prefix}${line.message}\n`);
	}
}

/** Stream every container at once, prefixing lines when more than one is followed. */
async function followContainers(
	containers: AppContainer[],
	wsOpts: { tail: number; serverId: string | null },
	render: { mode: OutputMode; search?: string; showTimestamps: boolean },
): Promise<void> {
	const needle = render.search?.toLowerCase();
	const showPrefix = containers.length > 1;

	const streams = containers.map((container) =>
		streamContainerLogs(container.containerId, wsOpts, (line) => {
			if (needle && !line.message.toLowerCase().includes(needle)) return;
			if (render.mode === "json") {
				process.stdout.write(
					`${JSON.stringify({ container: container.containerId, ...line })}\n`,
				);
				return;
			}
			const prefix = showPrefix ? `${pc.cyan(container.containerId)} ` : "";
			const time = render.showTimestamps && line.timestamp ? `${pc.dim(line.timestamp)} ` : "";
			process.stdout.write(`${prefix}${time}${line.message}\n`);
		}),
	);

	const stopAll = () => {
		for (const s of streams) s.stop();
	};
	process.once("SIGINT", stopAll);
	try {
		await Promise.all(streams.map((s) => s.closed));
	} finally {
		process.removeListener("SIGINT", stopAll);
		stopAll();
	}
}
