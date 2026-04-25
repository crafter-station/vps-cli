import type { Command } from "commander";
import { confirm } from "@clack/prompts";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { dokployGet, dokployPost } from "../lib/api.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerCompose(program: Command): void {
	const cmd = program.command("compose").description("Manage docker-compose stacks");

	// vps compose list
	cmd
		.command("list")
		.description("List all compose stacks")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("compose.search", { limit: "100" });
			const stacks = (data?.items ?? []).map((c: any) => ({
				id: c.composeId,
				name: c.name,
				status: c.composeStatus,
				sourceType: c.sourceType,
			}));

			emit(stacks, flags, () => {
				ui.header("Compose Stacks");
				if (stacks.length === 0) {
					ui.kv("Stacks", "none");
					process.stdout.write("\n");
					return;
				}
				ui.table(stacks, [
					{ key: "id", label: "ID", width: 28 },
					{ key: "name", label: "Name", width: 20 },
					{ key: "status", label: "Status", width: 10 },
					{ key: "sourceType", label: "Source", width: 10 },
				]);
				process.stdout.write("\n");
			});
		});

	// vps compose info <id>
	cmd
		.command("info <composeId>")
		.description("Show compose stack details")
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any>("compose.one", { composeId });

			emit(data, flags, () => {
				ui.header(`Compose: ${data.name}`);
				ui.kv("ID", data.composeId);
				ui.kv("Status", data.composeStatus);
				ui.kv("Source", data.sourceType);
				ui.kv("Repository", data.repository ? `${data.owner}/${data.repository}` : "-");
				ui.kv("Branch", data.branch);
				ui.kv("Compose Path", data.composePath);
				ui.kv("Created", data.createdAt);
				process.stdout.write("\n");
			});
		});

	// vps compose deploy <id>
	cmd
		.command("deploy <composeId>")
		.description("Deploy a compose stack")
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("compose.deploy", { composeId });
			emit({ ok: true, composeId }, flags, () => {
				ui.success(`Deployment triggered for ${composeId}.`);
			});
		});

	// vps compose redeploy <id>
	cmd
		.command("redeploy <composeId>")
		.description("Redeploy a compose stack")
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("compose.redeploy", { composeId });
			emit({ ok: true, composeId }, flags, () => {
				ui.success(`Redeployment triggered for ${composeId}.`);
			});
		});

	// vps compose start <id>
	cmd
		.command("start <composeId>")
		.description("Start a compose stack")
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("compose.start", { composeId });
			emit({ ok: true, composeId }, flags, () => {
				ui.success(`Compose ${composeId} started.`);
			});
		});

	// vps compose stop <id>
	cmd
		.command("stop <composeId>")
		.description("Stop a compose stack")
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			await dokployPost("compose.stop", { composeId });
			emit({ ok: true, composeId }, flags, () => {
				ui.success(`Compose ${composeId} stopped.`);
			});
		});

	// vps compose env <id>
	cmd
		.command("env <composeId>")
		.description("Set environment variables for a compose stack")
		.requiredOption("--set <env>", "Environment variables (KEY=VAL\\nKEY2=VAL2)")
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();
			await dokployPost("compose.saveEnvironment", {
				composeId,
				env: opts.set,
			});
			emit({ ok: true, composeId }, flags, () => {
				ui.success(`Environment updated for ${composeId}.`);
			});
		});

	// vps compose services <id>
	cmd
		.command("services <composeId>")
		.description("List service names defined in a compose stack")
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<string[]>("compose.loadServices", { composeId });
			const services = (data ?? []).map((name: string) => ({ name }));

			emit(services, flags, () => {
				ui.header("Compose Services");
				if (services.length === 0) {
					ui.kv("Services", "none — deploy the compose stack first");
					process.stdout.write("\n");
					return;
				}
				for (const s of services) {
					process.stdout.write(`  ${s.name}\n`);
				}
				process.stdout.write("\n");
			});
		});

	// vps compose remove <id>
	cmd
		.command("remove <composeId>")
		.description("Delete a compose stack")
		.option("--delete-volumes", "Also delete volumes", false)
		.action(async function (this: Command, composeId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			if (!flags.yes) {
				const ok = await confirm({
					message: `Delete compose ${composeId}? This cannot be undone.`,
				});
				if (ok !== true) {
					ui.warn("Cancelled.");
					return;
				}
			}

			await dokployPost("compose.delete", {
				composeId,
				deleteVolumes: opts.deleteVolumes ?? false,
			});
			emit({ ok: true, composeId }, flags, () => {
				ui.success(`Compose ${composeId} removed.`);
			});
		});
}
