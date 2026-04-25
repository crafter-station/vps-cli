---
name: vps
description: CLI to manage a Dokploy-powered VPS.
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
