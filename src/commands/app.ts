import type { Command } from "commander";
import { confirm } from "@clack/prompts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { dokployGet, dokployPost } from "../lib/api.ts";
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
