import type { Command } from "commander";
import { parseGlobalFlags } from "../cli/global-flags.ts";
import { dokployGet, dokployPost } from "../lib/api.ts";
import { emit } from "./emit.ts";
import * as ui from "./render.ts";

export function registerGitHub(program: Command): void {
	const cmd = program.command("github").description("GitHub integration & deploy");

	// vps github list — list connected GitHub accounts/installations
	cmd
		.command("list")
		.description("List connected GitHub accounts")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any[]>("github.githubProviders");
			const accounts = (data ?? []).map((g: any) => ({
				githubId: g.githubId,
				name: g.name ?? g.githubAppName ?? "unnamed",
				appName: g.githubAppName,
			}));

			emit(accounts, flags, () => {
				ui.header("GitHub Accounts");
				if (accounts.length === 0) {
					ui.kv("Accounts", "none — connect GitHub in the Dokploy dashboard first");
					process.stdout.write("\n");
					return;
				}
				ui.table(accounts, [
					{ key: "githubId", label: "ID", width: 28 },
					{ key: "name", label: "Name", width: 24 },
					{ key: "appName", label: "App", width: 24 },
				]);
				process.stdout.write("\n");
			});
		});

	// vps github repos <githubId> — list repos from a connected account
	cmd
		.command("repos <githubId>")
		.description("List repositories from a GitHub account")
		.action(async function (this: Command, githubId: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const data = await dokployGet<any[]>("github.getGithubRepositories", { githubId });
			const repos = (data ?? []).map((r: any) => ({
				name: r.name,
				owner: r.owner?.login ?? r.full_name?.split("/")[0] ?? "",
				fullName: r.full_name,
				private: r.private,
				url: r.html_url,
			}));

			emit(repos, flags, () => {
				ui.header("Repositories");
				if (repos.length === 0) {
					ui.kv("Repos", "none");
					process.stdout.write("\n");
					return;
				}
				ui.table(repos, [
					{ key: "fullName", label: "Repository", width: 40 },
					{ key: "private", label: "Private", width: 8 },
				]);
				process.stdout.write("\n");
			});
		});

	// vps github branches --owner <owner> --repo <repo>
	cmd
		.command("branches")
		.description("List branches of a GitHub repository")
		.requiredOption("--owner <owner>", "Repository owner")
		.requiredOption("--repo <repo>", "Repository name")
		.option("--github-id <id>", "GitHub account ID (auto-detected if only one)")
		.action(async function (this: Command) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const params: Record<string, string> = {
				owner: opts.owner,
				repo: opts.repo,
			};
			if (opts.githubId) params.githubId = opts.githubId;

			const data = await dokployGet<any[]>("github.getGithubBranches", params);
			const branches = (data ?? []).map((b: any) => ({
				name: b.name,
			}));

			emit(branches, flags, () => {
				ui.header(`Branches: ${opts.owner}/${opts.repo}`);
				if (branches.length === 0) {
					ui.kv("Branches", "none");
					process.stdout.write("\n");
					return;
				}
				for (const b of branches) {
					process.stdout.write(`  ${b.name}\n`);
				}
				process.stdout.write("\n");
			});
		});

	// vps github deploy <owner/repo> — one-command deploy from GitHub
	cmd
		.command("deploy <ownerSlashRepo>")
		.description("Deploy a GitHub repo as an app or compose stack")
		.requiredOption("-e, --environment <envId>", "Environment ID")
		.option("--branch <branch>", "Branch to deploy", "main")
		.option("--compose", "Deploy as docker-compose stack instead of app")
		.option("--compose-path <path>", "Path to docker-compose file in repo", "./docker-compose.yaml")
		.option("--build-type <type>", "Build type for apps (nixpacks|dockerfile|heroku_buildpacks|paketo_buildpacks|static|railpack)", "nixpacks")
		.option("--build-path <path>", "Build path within the repo", "/")
		.option("--name <name>", "Name (defaults to repo name)")
		.option("--github-id <id>", "GitHub account ID (auto-detected if only one)")
		.option("--dockerfile <path>", "Dockerfile path (for dockerfile build type)")
		.action(async function (this: Command, ownerSlashRepo: string) {
			const flags = parseGlobalFlags(this.optsWithGlobals());
			const opts = this.opts();

			const parts = ownerSlashRepo.split("/");
			if (parts.length !== 2 || !parts[0] || !parts[1]) {
				process.stderr.write("  Error: use format owner/repo\n");
				process.exit(1);
			}
			const [owner, repo] = parts as [string, string];
			const name = (opts.name as string) ?? repo;
			const branch = opts.branch as string;
			const isCompose = opts.compose as boolean;

			const log = (msg: string) => {
				if (!flags.quiet) process.stderr.write(`  ${msg}\n`);
			};

			// 1. Resolve githubId
			let githubId = opts.githubId as string | undefined;
			if (!githubId) {
				log("Finding GitHub account...");
				const providers = await dokployGet<any[]>("github.githubProviders");
				if (!providers || providers.length === 0) {
					process.stderr.write("  Error: no GitHub accounts connected. Connect one in the Dokploy dashboard first.\n");
					process.exit(1);
				}
				if (providers.length === 1) {
					githubId = providers[0].githubId;
				} else {
					process.stderr.write("  Error: multiple GitHub accounts found. Use --github-id to pick one.\n");
					for (const p of providers) {
						process.stderr.write(`    ${p.githubId}  ${p.name ?? p.githubAppName}\n`);
					}
					process.exit(1);
				}
			}

			if (isCompose) {
				// === Compose flow ===
				const composePath = opts.composePath as string;

				// 2. Create compose
				log(`Creating compose "${name}"...`);
				const created = await dokployPost<any>("compose.create", {
					name,
					environmentId: opts.environment,
					composeType: "docker-compose",
				});
				const composeId = created.composeId;

				// 3. Connect GitHub via update
				log(`Connecting ${owner}/${repo}@${branch}...`);
				await dokployPost("compose.update", {
					composeId,
					sourceType: "github",
					repository: repo,
					owner,
					branch,
					githubId,
					composePath,
					autoDeploy: true,
					enableSubmodules: false,
				});

				// 4. Deploy
				log("Deploying...");
				await dokployPost("compose.deploy", { composeId });

				const result = {
					ok: true,
					type: "compose",
					composeId,
					name,
					repository: `${owner}/${repo}`,
					branch,
					composePath,
				};

				emit(result, flags, () => {
					process.stdout.write("\n");
					ui.success(`Deploying ${owner}/${repo}@${branch} (compose)`);
					ui.kv("Compose ID", composeId);
					ui.kv("Name", name);
					ui.kv("Compose Path", composePath);
					process.stdout.write("\n");
				});
			} else {
				// === App flow ===
				const buildType = opts.buildType as string;
				const buildPath = opts.buildPath as string;

				// 2. Create application
				log(`Creating app "${name}"...`);
				const created = await dokployPost<any>("application.create", {
					name,
					environmentId: opts.environment,
				});
				const applicationId = created.applicationId;

				// 3. Connect GitHub repo
				log(`Connecting ${owner}/${repo}@${branch}...`);
				await dokployPost("application.saveGithubProvider", {
					applicationId,
					repository: repo,
					owner,
					branch,
					buildPath,
					githubId,
					triggerType: "push",
					enableSubmodules: false,
				});

				// 4. Set build type
				log(`Setting build type: ${buildType}...`);
				await dokployPost("application.saveBuildType", {
					applicationId,
					buildType,
					dockerContextPath: buildPath,
					dockerBuildStage: "",
					dockerfile: opts.dockerfile ?? "",
				});

				// 5. Deploy
				log("Deploying...");
				await dokployPost("application.deploy", { applicationId });

				const result = {
					ok: true,
					type: "application",
					applicationId,
					name,
					repository: `${owner}/${repo}`,
					branch,
					buildType,
				};

				emit(result, flags, () => {
					process.stdout.write("\n");
					ui.success(`Deploying ${owner}/${repo}@${branch}`);
					ui.kv("App ID", applicationId);
					ui.kv("App Name", name);
					ui.kv("Build Type", buildType);
					process.stdout.write("\n");
				});
			}
		});
}
