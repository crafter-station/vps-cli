# vps-cli

A CLI for driving a [Dokploy](https://dokploy.com)-powered VPS from your terminal or from a
script. Create projects, deploy GitHub repos as apps or compose stacks, provision databases,
attach domains, and read container logs — each in one command.

Every command speaks two dialects: a readable one for humans and JSON for pipelines. It picks
automatically based on whether stdout is a TTY, so `vps app list` prints a table and
`vps app list | jq` gets JSON without a flag.

## Install

Requires [Bun](https://bun.sh) 1.2 or newer.

```sh
bun install
bun link          # puts `vps` on your PATH
```

Without `bun link`, substitute `bun run bin/vps.ts` for `vps` in every example below.

## Configure

```sh
vps config set --domain https://your-vps.example.com --api-key <KEY>
```

Run `vps config set` with no flags to be prompted instead. Credentials land in
`~/.vps/config.json` with `0600` permissions. Generate the API key from your Dokploy
dashboard's API/CLI settings.

Check that it works:

```sh
vps status
```

```
VPS Status
  Health             healthy
  Dokploy Version    v0.29.1
  IP                 203.0.113.10
```

## A first deploy

Dokploy nests services inside an *environment*, which belongs to a *project*. So a deployment
is three steps: make a project, grab its environment ID, deploy into it.

```sh
PROJECT=$(vps project create my-api --json | jq -r '.projectId')
ENV=$(vps project info "$PROJECT" --json | jq -r '.environments[0].environmentId')

vps github deploy myorg/my-api -e "$ENV" --branch main
vps domain add api.example.com --app <appId> --port 3000
```

Add a database to the same environment and it is reachable from the app:

```sh
vps pg create my-db -e "$ENV" --json | jq -r '.connectionUrl'
# postgresql://user:pass@host:5433/mydb
```

## Command groups

| Group | What it does |
| --- | --- |
| `vps config` | Store, show, and clear the domain + API key |
| `vps status` | Health, Dokploy version, and public IP |
| `vps project` | Projects and their environments |
| `vps app` | Application lifecycle, containers, and logs |
| `vps github` | Deploy a repo as an app or a compose stack |
| `vps compose` | docker-compose stacks and their env vars |
| `vps domain` | Attach hostnames to apps and compose services |
| `vps pg` `mysql` `mariadb` `redis` `mongo` `libsql` | Databases |

`vps <group> --help` lists a group's commands; `vps <group> <command> --help` details one.

### Logs

Applications run as Swarm services, so an app can be several containers. `vps app logs` reads
each one separately and labels the output:

```sh
vps app containers <appId>            # what's running, plus --history for past tasks
vps app logs <appId> -n 200           # last 200 lines from every container
vps app logs <appId> --since 15m --search "error"
vps app logs <appId> -f               # stream until Ctrl-C
```

Per-container logs come from Dokploy's `docker-container-logs` WebSocket, which only accepts a
line count — `--since` and `--search` filter the fetched window client-side. `--aggregate`
switches to the REST endpoint, which filters server-side across the whole service but cannot
say which container a line came from.

With `--json`, `-f` emits NDJSON so it stays pipeable:

```sh
vps app logs <appId> -f --json | jq -r 'select(.message | test("ERROR")) | .message'
```

### Databases

All six database commands share a shape. `create` provisions, opens an external port, deploys,
and returns a ready connection URL:

```sh
vps pg create my-db -e "$ENV" --json | jq -r '.connectionUrl'
vps redis create cache -e "$ENV" --json | jq -r '.connectionUrl'
```

Passwords are generated when you don't supply one, and ports are chosen from 5433–5999 after
checking every existing database for collisions.

## Global flags

| Flag | Effect |
| --- | --- |
| `--json` | Force JSON output (also `VPS_JSON=1`) |
| `--output <auto\|json\|table>` | Override the TTY-based mode choice |
| `-y, --yes` | Skip confirmation prompts (implied when `CI` is set) |
| `-q, --quiet` | Suppress non-essential output |
| `-v, --verbose` | Verbose logging |

JSON goes to stdout and diagnostics to stderr, so `2>/dev/null` always leaves you with clean
data. Errors in JSON mode are a single object — `{"ok": false, "code": "...", "error": "..."}` —
and exit codes distinguish causes: `1` general, `4` rate-limited, `5` unreachable.

An ID that begins with `-` needs a `--` guard so Commander doesn't read it as a flag:

```sh
vps pg remove -y -- -6bMBz9xK
```

## Agents

`skills/vps/SKILL.md` is a Claude Code skill covering the full command surface with worked
workflows. `AGENTS.md` documents the codebase itself for agents making changes to this repo.

## Development

```sh
bun run dev        # bun run bin/vps.ts
bun run check      # biome lint + format
bun run typecheck  # tsc --noEmit
```

## License

MIT
