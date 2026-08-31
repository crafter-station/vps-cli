import { loadConfig } from "../cli/config.ts";
import { AppError } from "../cli/error-map.ts";
import { USER_AGENT } from "../constants.ts";

export type LogLine = {
	timestamp: string | null;
	message: string;
};

export type ContainerLogOptions = {
	tail?: number;
	serverId?: string | null;
};

/** Time with no new data after which a one-shot read considers the backlog complete. */
const IDLE_MS = 800;
/** Hard ceiling for a one-shot read, even if the container keeps talking. */
const MAX_MS = 15_000;

const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s?([\s\S]*)$/;

/** Split a Docker log line into its RFC3339 timestamp prefix and the message. */
export function parseLogLine(input: string): LogLine {
	const raw = input.replace(/\r$/, "");
	const match = TIMESTAMP_RE.exec(raw);
	if (!match) return { timestamp: null, message: raw };
	return { timestamp: match[1]!, message: match[2] ?? "" };
}

/** Build the wss:// URL for Dokploy's container log socket. */
export function containerLogsUrl(containerId: string, opts: ContainerLogOptions = {}): string {
	const config = loadConfig();
	const base = config.domain.replace(/\/+$/, "");
	const url = new URL(`${base}/docker-container-logs`);
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
	url.searchParams.set("containerId", containerId);
	url.searchParams.set("tail", String(opts.tail ?? 100));
	url.searchParams.set("serverId", opts.serverId ?? "");
	return url.toString();
}

function openSocket(containerId: string, opts: ContainerLogOptions): WebSocket {
	const config = loadConfig();
	return new WebSocket(containerLogsUrl(containerId, opts), {
		headers: {
			"User-Agent": USER_AGENT,
			"x-api-key": config.apiKey,
		},
	} as unknown as string[]);
}

function closeError(code: number, reason: string): AppError {
	if (code === 1000 || code === 1005 || code === 1006) {
		return new AppError("LOGS_UNAVAILABLE", {
			human: reason || "Log stream closed before any data arrived.",
			hint: "Check the container is running with `vps app containers <appId>`.",
			exitCode: 5,
		});
	}
	return new AppError("LOGS_UNAVAILABLE", {
		human: `Log stream closed (${code})${reason ? `: ${reason}` : ""}.`,
		exitCode: 5,
	});
}

/**
 * Read a container's log backlog and resolve once the stream goes quiet.
 * The socket follows forever, so there is no "done" signal — we cut off after
 * IDLE_MS without new data, or MAX_MS overall.
 */
export function fetchContainerLogs(
	containerId: string,
	opts: ContainerLogOptions = {},
): Promise<LogLine[]> {
	return new Promise((resolve, reject) => {
		const ws = openSocket(containerId, opts);
		let buffer = "";
		let received = false;
		let settled = false;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;

		const finish = () => {
			if (settled) return;
			settled = true;
			if (idleTimer) clearTimeout(idleTimer);
			clearTimeout(maxTimer);
			try {
				ws.close();
			} catch {
				// already closed
			}
			resolve(toLines(buffer));
		};

		const maxTimer = setTimeout(finish, MAX_MS);

		const bumpIdle = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(finish, IDLE_MS);
		};

		ws.onopen = () => bumpIdle();

		ws.onmessage = (event) => {
			received = true;
			buffer += typeof event.data === "string" ? event.data : String(event.data);
			bumpIdle();
		};

		ws.onerror = () => {
			if (settled) return;
			settled = true;
			if (idleTimer) clearTimeout(idleTimer);
			clearTimeout(maxTimer);
			reject(
				new AppError("LOGS_UNAVAILABLE", {
					human: `Cannot open log stream for container ${containerId}.`,
					hint: "Verify the domain in `vps config show` and that the container exists.",
					exitCode: 5,
				}),
			);
		};

		ws.onclose = (event) => {
			if (settled) return;
			if (received) {
				finish();
				return;
			}
			settled = true;
			if (idleTimer) clearTimeout(idleTimer);
			clearTimeout(maxTimer);
			reject(closeError(event.code, event.reason));
		};
	});
}

/**
 * Follow a container's logs, invoking `onLine` for each line until the returned
 * stop function is called or the socket closes.
 */
export function streamContainerLogs(
	containerId: string,
	opts: ContainerLogOptions,
	onLine: (line: LogLine) => void,
): { stop: () => void; closed: Promise<void> } {
	const ws = openSocket(containerId, opts);
	let pending = "";
	let settled = false;
	let resolveClosed!: () => void;
	let rejectClosed!: (err: unknown) => void;

	const closed = new Promise<void>((resolve, reject) => {
		resolveClosed = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		rejectClosed = (err) => {
			if (settled) return;
			settled = true;
			reject(err);
		};
	});

	const flush = () => {
		if (pending.length === 0) return;
		onLine(parseLogLine(pending));
		pending = "";
	};

	ws.onmessage = (event) => {
		pending += typeof event.data === "string" ? event.data : String(event.data);
		const chunks = pending.split("\n");
		pending = chunks.pop() ?? "";
		for (const chunk of chunks) {
			if (chunk.length > 0) onLine(parseLogLine(chunk));
		}
	};

	ws.onerror = () => {
		rejectClosed(
			new AppError("LOGS_UNAVAILABLE", {
				human: `Cannot open log stream for container ${containerId}.`,
				hint: "Verify the domain in `vps config show` and that the container exists.",
				exitCode: 5,
			}),
		);
	};

	ws.onclose = () => {
		flush();
		resolveClosed();
	};

	return {
		// Resolve here rather than waiting on `onclose`, which a half-open
		// socket may never deliver — a Ctrl-C must always return control.
		stop: () => {
			try {
				ws.close();
			} catch {
				// already closed
			}
			flush();
			resolveClosed();
		},
		closed,
	};
}

function toLines(buffer: string): LogLine[] {
	return buffer
		.split("\n")
		.filter((line) => line.length > 0)
		.map(parseLogLine);
}
