export type Config = {
	domain: string;
	apiKey: string;
};

export type GlobalFlags = {
	json: boolean;
	output: "auto" | "json" | "table";
	quiet: boolean;
	verbose: boolean;
	yes: boolean;
};

export type OutputMode = "json" | "human";
