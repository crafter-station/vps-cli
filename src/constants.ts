import { join } from "node:path";
import { homedir } from "node:os";

export const VERSION = "0.2.0";
export const CLI_NAME = "vps";
export const USER_AGENT = `@crafter/vps-cli/${VERSION}`;

export const CONFIG_DIR = join(homedir(), ".vps");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Profile name used when none is given, and the target of the legacy config migration. */
export const DEFAULT_PROFILE = "default";
