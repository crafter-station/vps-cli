/** A single VPS target: one Dokploy instance plus optional DNS helpers. */
export type Profile = {
	domain: string;
	apiKey: string;
	/** Apex domain subdomains are created under, e.g. "crafter.run". Optional. */
	baseDomain?: string;
	/**
	 * Shell command template that creates a DNS record for this VPS.
	 * Placeholders: {subdomain}, {host}, {ip}, {baseDomain}. Optional.
	 */
	dnsCommand?: string;
};

/** On-disk shape of ~/.vps/config.json. */
export type ConfigFile = {
	version: 2;
	current: string;
	profiles: Record<string, Profile>;
};

/** Legacy single-VPS shape, migrated on read. */
export type LegacyConfig = {
	domain: string;
	apiKey: string;
};

/** A profile paired with the name it is stored under. */
export type ResolvedProfile = Profile & { name: string };

export type GlobalFlags = {
	json: boolean;
	output: "auto" | "json" | "table";
	quiet: boolean;
	verbose: boolean;
	yes: boolean;
	profile?: string;
};

export type OutputMode = "json" | "human";
