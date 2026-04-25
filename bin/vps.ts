#!/usr/bin/env bun
import { Command } from "commander";
import { VERSION, CLI_NAME } from "../src/constants.ts";
import { getGlobalFlagDefs, parseGlobalFlags } from "../src/cli/global-flags.ts";
import { mapError } from "../src/cli/error-map.ts";
import { detectMode } from "../src/cli/detect.ts";
import { registerConfig } from "../src/commands/config.ts";
import { registerStatus } from "../src/commands/status.ts";
import { registerProject } from "../src/commands/project.ts";
import { registerApp } from "../src/commands/app.ts";
import { registerPostgres } from "../src/commands/postgres.ts";
import { registerRedis } from "../src/commands/redis.ts";
import { registerMongo } from "../src/commands/mongo.ts";
import { registerMySQL } from "../src/commands/mysql.ts";

const program = new Command();

program
	.name(CLI_NAME)
	.description("CLI to manage a Dokploy-powered VPS")
	.version(VERSION);

// Register global flags
for (const def of getGlobalFlagDefs()) {
	program.option(def.flag, def.description);
}

// Register commands
registerConfig(program);
registerStatus(program);
registerProject(program);
registerApp(program);
registerPostgres(program);
registerRedis(program);
registerMongo(program);
registerMySQL(program);

// Default action: show help
program.action(() => {
	program.help();
});

// Parse
try {
	await program.parseAsync(process.argv);
} catch (error) {
	const mapped = mapError(error);
	const flags = parseGlobalFlags(program.opts());
	const mode = detectMode(flags);

	if (mode === "json") {
		process.stderr.write(`${JSON.stringify(mapped.toJSON())}\n`);
	} else {
		process.stderr.write(`\x1b[31m✗\x1b[0m ${mapped.human}\n`);
		if (mapped.hint) process.stderr.write(`  ${mapped.hint}\n`);
	}
	process.exit(mapped.exitCode);
}
