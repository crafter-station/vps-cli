export class AppError extends Error {
	code: string;
	human: string;
	hint?: string;
	exitCode: number;

	constructor(
		code: string,
		opts: { human: string; hint?: string; exitCode?: number },
		cause?: unknown,
	) {
		super(opts.human);
		this.name = "AppError";
		this.code = code;
		this.human = opts.human;
		this.hint = opts.hint;
		this.exitCode = opts.exitCode ?? 1;
		if (cause) this.cause = cause;
	}

	toJSON() {
		return {
			ok: false,
			code: this.code,
			error: this.human,
			hint: this.hint,
		};
	}
}

const STATUS_MAP: Record<number, { code: string; human: string; hint?: string }> = {
	401: {
		code: "UNAUTHORIZED",
		human: "Invalid or expired API key.",
		hint: "Run `vps config set` to update your API key.",
	},
	403: {
		code: "FORBIDDEN",
		human: "Access denied.",
		hint: "Check your API key permissions.",
	},
	404: {
		code: "NOT_FOUND",
		human: "Resource not found.",
	},
	429: {
		code: "RATE_LIMIT",
		human: "Rate limited. Try again shortly.",
		exitCode: 4,
	},
	500: {
		code: "SERVER_ERROR",
		human: "Dokploy server error.",
		hint: "Check server status at the Dokploy dashboard.",
	},
};

export function fromHttpStatus(status: number, body?: string): AppError {
	const entry = STATUS_MAP[status];
	if (entry) {
		return new AppError(entry.code, {
			human: entry.human,
			hint: entry.hint,
			exitCode: entry.code === "RATE_LIMIT" ? 4 : 1,
		});
	}
	return new AppError("HTTP_ERROR", {
		human: `HTTP ${status}: ${body?.slice(0, 200) ?? "Unknown error"}`,
	});
}

export function mapError(error: unknown): AppError {
	if (error instanceof AppError) return error;
	if (error instanceof Error) {
		if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED")) {
			return new AppError("CONNECTION_ERROR", {
				human: "Cannot reach Dokploy server.",
				hint: "Check your domain in `vps config show` and ensure the server is running.",
				exitCode: 5,
			});
		}
		return new AppError("UNKNOWN", { human: error.message }, error);
	}
	return new AppError("UNKNOWN", { human: String(error) });
}
