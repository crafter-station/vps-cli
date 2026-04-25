import { join } from "node:path";
import { homedir } from "node:os";

export const VERSION = "0.1.0";
export const CLI_NAME = "vps";
export const USER_AGENT = `@crafter/vps-cli/${VERSION}`;

export const CONFIG_DIR = join(homedir(), ".vps");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
