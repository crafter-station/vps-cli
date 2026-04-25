import type { Command } from "commander";
import { confirm } from "@clack/prompts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { dokployGet, dokployPost } from "../lib/api.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerProject(program: Command): void {
	const cmd = program.command("project").description("Manage projects");

	// vps project list
	cmd
		.command("list")
		.description("List all projects")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any[]>("project.all");

			emit(data, flags, () => {
				ui.header("Projects");
				if (!data || data.length === 0) {
					ui.kv("Projects", "none");
					return;
				}
				ui.table(
					data.map((p: any) => ({
						id: p.projectId,
						name: p.name,
						description: p.description ?? "",
						environments: p.environments?.length ?? p.environmentCount ?? 0,
					})),
					[
						{ key: "id", label: "ID", width: 28 },
						{ key: "name", label: "Name", width: 24 },
						{ key: "description", label: "Description", width: 30 },
						{ key: "environments", label: "Envs", width: 6 },
					],
				);
				process.stdout.write("\n");
			});
		});

	// vps project create <name>
	cmd
		.command("create <name>")
		.description("Create a new project")
		.option("-d, --description <text>", "Project description")
		.action(async function (this: Command, name: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const result = await dokployPost<any>("project.create", {
				name,
				description: opts.description ?? null,
			});

			emit(result, flags, () => {
				ui.success(`Project "${name}" created.`);
				if (result?.projectId) ui.kv("Project ID", result.projectId);
			});
		});

	// vps project info <id>
	cmd
		.command("info <projectId>")
		.description("Show project details")
		.action(async function (this: Command, projectId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("project.one", { projectId });

			emit(data, flags, () => {
				ui.header(`Project: ${data.name}`);
				ui.kv("ID", data.projectId);
				ui.kv("Name", data.name);
				ui.kv("Description", data.description);
				ui.kv("Created", data.createdAt);

				if (data.environments?.length) {
					for (const env of data.environments) {
						ui.header(`  Environment: ${env.name ?? "default"}`);
						ui.kv("  Env ID", env.environmentId);

						const services = [
							...(env.applications ?? []).map((a: any) => ({
								name: a.name,
								type: "app",
								status: a.applicationStatus,
							})),
							...(env.postgres ?? []).map((d: any) => ({
								name: d.name,
								type: "postgres",
								status: d.applicationStatus,
							})),
							...(env.mysql ?? []).map((d: any) => ({
								name: d.name,
								type: "mysql",
								status: d.applicationStatus,
							})),
							...(env.redis ?? []).map((d: any) => ({
								name: d.name,
								type: "redis",
								status: d.applicationStatus,
							})),
							...(env.mongo ?? []).map((d: any) => ({
								name: d.name,
								type: "mongo",
								status: d.applicationStatus,
							})),
							...(env.compose ?? []).map((c: any) => ({
								name: c.name,
								type: "compose",
								status: c.composeStatus,
							})),
						];

						if (services.length > 0) {
							ui.table(services, [
								{ key: "name", label: "Service", width: 24 },
								{ key: "type", label: "Type", width: 12 },
								{ key: "status", label: "Status", width: 12 },
							]);
						}
					}
				}
				process.stdout.write("\n");
			});
		});

	// vps project remove <id>
	cmd
		.command("remove <projectId>")
		.description("Delete a project")
		.action(async function (this: Command, projectId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete project ${projectId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("project.remove", { projectId });

			emit({ ok: true, projectId }, flags, () => {
				ui.success(`Project ${projectId} removed.`);
			});
		});
}
