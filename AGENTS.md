# AGENTS.md

Guidance for agents working on this repository. For *using* the CLI, see `README.md`; for
driving a VPS with it, see `skills/vps/SKILL.md`.

## What this is

A Bun + TypeScript CLI wrapping the Dokploy REST API. No build step — `bin/vps.ts` runs
directly through Bun, and `.ts` files import each other with explicit `.ts` extensions.

## Layout

```
bin/vps.ts          Entry point: registers command groups, catches and renders errors
src/constants.ts    VERSION, CLI_NAME, USER_AGENT, config paths
src/types.ts        Config, GlobalFlags, OutputMode
src/cli/            Foundation, no API calls
  config.ts           Read/write ~/.vps/config.json (0600)
  detect.ts           TTY + flags -> "json" | "human"
  error-map.ts        AppError, fromHttpStatus, mapError
  global-flags.ts     Definitions and parsing for --json/--output/-q/-v/-y
src/lib/
  api.ts              dokployGet / dokployPost, plus cross-cutting helpers
  ws-logs.ts          docker-container-logs WebSocket client
src/commands/       One file per command group, each exporting register<Group>(program)
  emit.ts             Dual-mode output helper
  render.ts           header / kv / table / success / warn / error
skills/vps/SKILL.md Agent-facing usage docs — update when commands change
swagger.json        Dokploy OpenAPI dump (gitignored; regenerate from settings.getOpenApiDocument)
```

## The Dokploy API

tRPC-style endpoint names, not REST paths: `project.all`, `application.one`,
`docker.getContainersByAppLabel`.

- Base URL is `<domain>/api/`, auth is the `x-api-key` header (**not** `Authorization: Bearer`).
- GET endpoints take params as a query string; POST endpoints take a JSON body.
- Responses are inconsistent. Some return JSON objects, some bare strings
  (`settings.getDokployVersion` returns `"v0.29.1"`, `application.readLogs` returns one big
  string). `dokployFetch` falls back to the raw text when `JSON.parse` fails, so narrow the
  type at the call site rather than trusting the generic.

`swagger.json` is gitignored but the fastest way to check an endpoint's real parameters:

```sh
KEY=$(jq -r .apiKey ~/.vps/config.json)
curl -s -H "x-api-key: $KEY" https://your-vps.example.com/api/settings.getOpenApiDocument > swagger.json
node -e "const s=require('./swagger.json');
  console.log(JSON.stringify(s.paths['/application.readLogs'], null, 1))"
```

The endpoint returns the spec unwrapped. A copy fetched through some clients arrives inside a
tRPC envelope instead, so reach for `s.result.data.json` if `s.paths` is undefined.

When the docs and the live API disagree, the live API wins. Probing a real endpoint with
`curl` before writing a command has caught several mismatches; read-only endpoints are safe to
call directly.

## Adding a command

1. Write `register<Group>(program)` in `src/commands/<group>.ts`, or add a subcommand to an
   existing group.
2. Import and call it in `bin/vps.ts`.
3. Document it in `skills/vps/SKILL.md`, and in `README.md` if it is more than a variation on
   what is already described there.

Every action follows the same shape:

```ts
cmd
  .command("info <appId>")
  .description("Show application details")
  .action(async function (this: Command, appId: string) {
    const flags = parseGlobalFlags(this.optsWithGlobals());
    const data = await dokployGet<any>("application.one", { applicationId: appId });

    emit(data, flags, () => {
      ui.header(`Application: ${data.name}`);
      ui.kv("ID", data.applicationId);
      process.stdout.write("\n");
    });
  });
```

Four things matter here:

- **`optsWithGlobals()`**, not `opts()`, when reading global flags — otherwise `--json` placed
  before the subcommand is silently ignored.
- **`emit(value, flags, human)`** for every result. The JSON branch is the contract that
  scripts and agents depend on; the human callback runs only in a TTY.
- **Throw `AppError`** for anything the user should read. `bin/vps.ts` catches it and renders
  the right shape for the mode, with the right exit code. Bare `throw new Error` still works
  but loses the code, the hint, and the exit code.
- **Destructive commands check `flags.yes`** before prompting with `@clack/prompts` `confirm`.
  `-y` is implied under CI, so the prompt must never be the only path.

## Conventions

- Biome, tabs, double quotes, 100 columns. `bun run check` must pass.
- `bun run typecheck` has two pre-existing errors (`src/cli/error-map.ts:49`,
  `src/commands/config.ts:32`). Don't add more; fixing them is welcome but out of band.
- `any` is used freely for API responses. That is deliberate — the Dokploy shapes are large and
  under-specified. Type the *outputs* you construct, not the payloads you receive.
- JSON to stdout, diagnostics to stderr. Never `console.log` a progress message.
- Exit codes: `1` general, `4` rate limited, `5` cannot reach the server, `130` cancelled prompt.
- Conventional commits (`feat:`, `chore:`, `fix:`).

## Testing

There is no test suite. Changes are verified against a live VPS, which means reading real
output rather than asserting on mocks:

```sh
bun bin/vps.ts app logs <appId> -n 5 --json      # JSON contract
bun bin/vps.ts app logs <appId> -n 5 --output table   # human rendering
bun bin/vps.ts app logs <appId> -n 99999          # error path and exit code
```

`--output table` forces human rendering when stdout is a pipe, which is how you inspect the TTY
branch from a script. Check both modes and at least one failure path before calling a command
done.

## Gotchas

- **Commander eats leading-dash arguments.** Dokploy IDs can start with `-`, so users need
  `vps pg remove -y -- -6bMBz9xK`. Keep the `--` guard documented for any command taking an ID.
- **`--no-x` flags invert.** `--no-timestamps` sets `opts.timestamps` to `false`; the option is
  named `timestamps`, and its default is `true`.
- **Per-container logs are WebSocket-only.** There is no REST endpoint. `src/lib/ws-logs.ts`
  connects to `<domain>/docker-container-logs`, which accepts the same `x-api-key` header and
  takes only `containerId`, `tail`, and `serverId`. Any other filtering happens client-side.
- **The log socket never signals "backlog done."** It follows forever. `fetchContainerLogs`
  therefore cuts off after 800 ms of silence, with a 15 s ceiling — a heuristic, and the reason
  `--follow` is the honest way to watch a busy container.
- **A half-open WebSocket may never fire `onclose`.** `streamContainerLogs().stop()` resolves
  its `closed` promise directly instead of waiting for the event, so Ctrl-C always returns
  control. Preserve that if you touch the streaming path.
- **Docker log lines are CRLF-terminated** and prefixed with an RFC3339 nano timestamp.
  `parseLogLine` strips both.
- **Applications are Swarm services**, so one app maps to N containers.
  `docker.getContainersByAppLabel` (`type=swarm`) returns live Docker container IDs, which is
  what the log socket wants. `docker.getServiceContainersByAppName` returns Swarm *task* IDs —
  useful as deployment history, but not addressable for logs.
- **Signals don't cross Git Bash on Windows.** `timeout -s INT` cannot interrupt a Bun process
  there; test interrupt handling in a real terminal or by calling `stop()` from a harness.
