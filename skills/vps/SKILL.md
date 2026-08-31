---
name: vps
description: Manage a Dokploy-powered VPS — deploy GitHub repos, create projects, apps, compose stacks, and databases (PostgreSQL, MySQL, MariaDB, Redis, MongoDB, LibSQL) with one command. Use when the user needs to deploy infrastructure, create databases, deploy from GitHub, or manage services on the VPS.
---

# VPS CLI — Agent Skill

CLI to manage a Dokploy-powered VPS. All commands support `--json` for machine-readable output and `-y` / `--yes` to skip confirmations.

**Always use `--json -y`** when running commands programmatically.

## Setup

```bash
vps config set --domain https://vps.crafter.run --api-key <KEY>
```

## Quick Reference

### Status

```bash
vps status --json
```

### Projects

```bash
vps project list --json
vps project create <name> --json
vps project create <name> -d "description" --json
vps project info <projectId> --json        # shows environments + services
vps project remove <projectId> -y --json
```

### Applications

```bash
vps app list --json
vps app list --project <projectId> --json
vps app create <name> -e <environmentId> --json
vps app info <appId> --json
vps app deploy <appId> --json
vps app redeploy <appId> --json
vps app start <appId> --json
vps app stop <appId> --json
vps app remove <appId> -y --json
```

### Logs

```bash
# Containers backing an app (running Docker containers)
vps app containers <appId> --json
vps app containers <appId> --history --json   # + shut-down Swarm tasks

# Logs per container (default: every running container)
vps app logs <appId> --json
vps app logs <appId> -n 500 --json            # lines per container, 1-10000
vps app logs <appId> --container <id> --json  # one container only
vps app logs <appId> --since 15m --json       # all | 30s | 5m | 2h | 1d
vps app logs <appId> --search "error" --json
vps app logs <appId> --no-timestamps --json

# Whole-service log, no per-container split (single REST call, faster)
vps app logs <appId> --aggregate --json

# Stream until Ctrl-C; --json emits NDJSON, one object per line
vps app logs <appId> -f
vps app logs <appId> -f --json | jq -r '.message'
```

Per-container logs come from Dokploy's `docker-container-logs` WebSocket, so
`--since` and `--search` are applied client-side to the `--tail` window.
`--aggregate` filters server-side but cannot attribute lines to a container.

### Domains

```bash
# List domains for an app or compose
vps domain list --app <appId> --json
vps domain list --compose <composeId> --json

# Add a domain to an app (HTTPS + Let's Encrypt by default)
vps domain add <host> --app <appId> --json
vps domain add <host> --app <appId> --port 3000 --json

# Add a domain to a compose service (auto-detects service if only one exists)
vps domain add <host> --compose <composeId> --port 3000 --json
vps domain add <host> --compose <composeId> --service <serviceName> --port 3000 --json

# Add with options
vps domain add <host> --app <appId> --no-https --cert none --json
vps domain add <host> --app <appId> --path /api --strip-path --port 8080 --json

# Info and remove
vps domain info <domainId> --json
vps domain remove <domainId> -y --json
```

### Compose (docker-compose stacks)

```bash
vps compose list --json
vps compose info <composeId> --json
vps compose deploy <composeId> --json
vps compose redeploy <composeId> --json
vps compose start <composeId> --json
vps compose stop <composeId> --json
vps compose env <composeId> --set "KEY=value
KEY2=value2" --json
vps compose remove <composeId> -y --json
vps compose remove <composeId> -y --delete-volumes --json
vps compose services <composeId> --json       # list service names in the compose
```

When adding domains to compose stacks, use `compose services` first to discover valid service names. The `domain add` command auto-detects the service if only one exists.

### GitHub (deploy repos)

```bash
# List connected GitHub accounts
vps github list --json

# List repos from a connected account
vps github repos <githubId> --json

# List branches
vps github branches --owner <owner> --repo <repo> --json

# Deploy as app (default): creates app + connects GitHub + sets build type + deploys
vps github deploy <owner/repo> -e <environmentId> --json
vps github deploy <owner/repo> -e <envId> --branch main --build-type nixpacks --json
vps github deploy <owner/repo> -e <envId> --build-type dockerfile --dockerfile ./Dockerfile --json

# Deploy as docker-compose: creates compose + connects GitHub + deploys
vps github deploy <owner/repo> -e <environmentId> --compose --json
vps github deploy <owner/repo> -e <envId> --compose --compose-path ./docker-compose.yaml --branch main --json
```

JSON output from `github deploy` (app): `applicationId`, `name`, `repository`, `branch`, `buildType`.
JSON output from `github deploy --compose`: `composeId`, `name`, `repository`, `branch`, `composePath`.

Options for `--build-type` (app only): `nixpacks` (default), `dockerfile`, `heroku_buildpacks`, `paketo_buildpacks`, `static`, `railpack`.

If only one GitHub account is connected, `--github-id` is auto-detected. If multiple, pass `--github-id <id>`.

### PostgreSQL

```bash
# One-command create: creates, opens port, deploys, returns connection URL
vps pg create <name> -e <environmentId> --json
vps pg create <name> -e <envId> --db mydb --user myuser --password mypass --port 5433 --image postgres:18 --json

vps pg list --json
vps pg info <postgresId> --json
vps pg deploy <postgresId> --json
vps pg start <postgresId> --json
vps pg stop <postgresId> --json
vps pg remove <postgresId> -y --json
```

JSON output from `pg create` includes: `postgresId`, `databaseName`, `databaseUser`, `databasePassword`, `port`, `connectionUrl` (`postgresql://user:pass@host:port/db`).

### MySQL

```bash
vps mysql create <name> -e <environmentId> --json
vps mysql create <name> -e <envId> --db mydb --user myuser --password mypass --root-password rootpw --port 3306 --image mysql:8 --json

vps mysql list --json
vps mysql info <mysqlId> --json
vps mysql deploy <mysqlId> --json
vps mysql start <mysqlId> --json
vps mysql stop <mysqlId> --json
vps mysql remove <mysqlId> -y --json
```

JSON output from `mysql create` includes: `mysqlId`, `databaseName`, `databaseUser`, `databasePassword`, `databaseRootPassword`, `port`, `connectionUrl` (`mysql://user:pass@host:port/db`).

### MariaDB

```bash
vps mariadb create <name> -e <environmentId> --json
vps mariadb create <name> -e <envId> --db mydb --user myuser --password mypass --root-password rootpw --port 3307 --image mariadb:11 --json

vps mariadb list --json
vps mariadb info <mariadbId> --json
vps mariadb deploy <mariadbId> --json
vps mariadb start <mariadbId> --json
vps mariadb stop <mariadbId> --json
vps mariadb remove <mariadbId> -y --json
```

JSON output from `mariadb create` includes: `mariadbId`, `databaseName`, `databaseUser`, `databasePassword`, `databaseRootPassword`, `port`, `connectionUrl` (`mariadb://user:pass@host:port/db`).

### Redis

```bash
vps redis create <name> -e <environmentId> --json
vps redis create <name> -e <envId> --password mypass --port 6379 --image redis:8 --json

vps redis list --json
vps redis info <redisId> --json
vps redis deploy <redisId> --json
vps redis start <redisId> --json
vps redis stop <redisId> --json
vps redis remove <redisId> -y --json
```

JSON output from `redis create` includes: `redisId`, `password`, `port`, `connectionUrl` (`redis://:pass@host:port`).

### MongoDB

```bash
vps mongo create <name> -e <environmentId> --json
vps mongo create <name> -e <envId> --user myuser --password mypass --port 27017 --image mongo:8 --json

vps mongo list --json
vps mongo info <mongoId> --json
vps mongo deploy <mongoId> --json
vps mongo start <mongoId> --json
vps mongo stop <mongoId> --json
vps mongo remove <mongoId> -y --json
```

JSON output from `mongo create` includes: `mongoId`, `databaseUser`, `databasePassword`, `port`, `connectionUrl` (`mongodb://user:pass@host:port`).

### LibSQL

```bash
vps libsql create <name> -e <environmentId> --json
vps libsql create <name> -e <envId> --user myuser --password mypass --port 8080 --image ghcr.io/tursodatabase/libsql-server:v0.24.32 --json

vps libsql list --json
vps libsql info <libsqlId> --json
vps libsql deploy <libsqlId> --json
vps libsql start <libsqlId> --json
vps libsql stop <libsqlId> --json
vps libsql remove <libsqlId> -y --json
```

JSON output from `libsql create` includes: `libsqlId`, `databaseUser`, `databasePassword`, `port`, `connectionUrl` (`http://host:port`).

## Common Workflows

### Create a project with a Postgres database

```bash
PROJECT=$(vps project create my-project --json | jq -r '.projectId')
ENV_ID=$(vps project info "$PROJECT" --json | jq -r '.environments[0].environmentId')
vps pg create my-db -e "$ENV_ID" --json
```

### Deploy a GitHub repo (app)

```bash
PROJECT=$(vps project create my-app --json | jq -r '.projectId')
ENV_ID=$(vps project info "$PROJECT" --json | jq -r '.environments[0].environmentId')
vps github deploy myorg/my-repo -e "$ENV_ID" --branch main --json
```

### Deploy a GitHub repo (docker-compose)

```bash
PROJECT=$(vps project create my-app --json | jq -r '.projectId')
ENV_ID=$(vps project info "$PROJECT" --json | jq -r '.environments[0].environmentId')
vps github deploy myorg/my-repo -e "$ENV_ID" --compose --json
```

### Deploy a GitHub repo with a database

```bash
PROJECT=$(vps project create my-stack --json | jq -r '.projectId')
ENV_ID=$(vps project info "$PROJECT" --json | jq -r '.environments[0].environmentId')
DB=$(vps pg create my-db -e "$ENV_ID" --json)
vps github deploy myorg/my-api -e "$ENV_ID" --json
echo "$DB" | jq -r '.connectionUrl'
```

### Create a full stack (app + database)

```bash
PROJECT=$(vps project create my-stack --json | jq -r '.projectId')
ENV_ID=$(vps project info "$PROJECT" --json | jq -r '.environments[0].environmentId')
DB=$(vps pg create my-db -e "$ENV_ID" --json)
APP=$(vps app create my-app -e "$ENV_ID" --json)
echo "$DB" | jq -r '.connectionUrl'
```

## Notes

- All `create` database commands auto-generate passwords and pick available ports if not specified.
- Port range is 5433-5999. The CLI checks all existing databases to avoid collisions.
- IDs that start with `-` need `--` before them: `vps pg remove -y --json -- -6bMBz...`
- `--json` output goes to stdout, progress logs go to stderr.
- Domains default to HTTPS with Let's Encrypt. Use `--no-https --cert none` for plain HTTP.
- **Next.js / Node apps in docker-compose** must bind to `0.0.0.0`, not `localhost`. Always include these env vars in the service:
  ```yaml
  environment:
    HOSTNAME: "0.0.0.0"
    PORT: "3000"
  ```
  Without `HOSTNAME: "0.0.0.0"` the app only listens on 127.0.0.1 inside the container and Traefik will return 404.
- **To add a subdomain on `crafter.run`**, first create the DNS record, then add the domain in Dokploy:
  ```bash
  # 1. Create DNS record (separate CLI)
  crafters domain add <subdomain> --ip $(vps status --json | jq -r '.ip')
  # 2. Add domain to the app/compose in Dokploy
  vps domain add <subdomain>.crafter.run --app <appId> --port 3000 --json
  ```
