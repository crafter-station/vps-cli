import { loadConfig } from "../cli/config.ts";
import { AppError, fromHttpStatus, mapError } from "../cli/error-map.ts";
import { USER_AGENT } from "../constants.ts";

type ApiResponse<T> = {
	data: T;
	status: number;
};

export async function dokployFetch<T = unknown>(
	path: string,
	init: RequestInit = {},
): Promise<ApiResponse<T>> {
	const config = loadConfig();
	const base = config.domain.replace(/\/+$/, "");
	const url = `${base}/api/${path.replace(/^\/+/, "")}`;

	try {
		const response = await fetch(url, {
			...init,
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "application/json",
				"Content-Type": "application/json",
				"x-api-key": config.apiKey,
				...((init.headers as Record<string, string>) ?? {}),
			},
		});

		const text = await response.text();

		if (!response.ok) {
			throw fromHttpStatus(response.status, text);
		}

		let data: T;
		try {
			data = JSON.parse(text) as T;
		} catch {
			data = text as unknown as T;
		}

		return { data, status: response.status };
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw mapError(error);
	}
}

/** POST helper for Dokploy tRPC-style endpoints */
export async function dokployPost<T = unknown>(
	path: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const resp = await dokployFetch<T>(path, {
		method: "POST",
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	return resp.data;
}

/** GET helper — params become query string: ?key=value&key2=value2 */
export async function dokployGet<T = unknown>(
	path: string,
	params?: Record<string, string>,
): Promise<T> {
	let query = "";
	if (params) {
		const qs = new URLSearchParams(params).toString();
		if (qs) query = `?${qs}`;
	}
	const resp = await dokployFetch<T>(`${path}${query}`, { method: "GET" });
	return resp.data;
}

/** Collect all external ports already in use by any database service. */
export async function getUsedPorts(): Promise<Set<number>> {
	const DB_TYPES = ["postgres", "mysql", "redis", "mongo", "mariadb"] as const;

	const results = await Promise.all(
		DB_TYPES.map((t) =>
			dokployGet<{ items: { [k: string]: any }[] }>(`${t}.search`, { limit: "100" })
				.then((r) => (r?.items ?? []).map((i) => i[`${t}Id`] as string))
				.catch(() => [] as string[]),
		),
	);

	const fetches: Promise<number | null>[] = [];
	for (let i = 0; i < DB_TYPES.length; i++) {
		const type = DB_TYPES[i]!;
		const idKey = `${type}Id`;
		for (const id of results[i]!) {
			fetches.push(
				dokployGet<any>(`${type}.one`, { [idKey]: id })
					.then((d) => (d?.externalPort as number) ?? null)
					.catch(() => null),
			);
		}
	}

	const ports = await Promise.all(fetches);
	return new Set(ports.filter((p): p is number => p !== null && p > 0));
}

const PORT_MIN = 5433;
const PORT_MAX = 5999;

/** Pick a random port in 5433-5999 that is not already used by any DB. */
export async function findAvailablePort(): Promise<number> {
	const used = await getUsedPorts();
	const available: number[] = [];
	for (let p = PORT_MIN; p <= PORT_MAX; p++) {
		if (!used.has(p)) available.push(p);
	}
	if (available.length === 0) {
		throw new AppError("NO_PORT", { human: "No available ports in range 5433-5999." });
	}
	return available[Math.floor(Math.random() * available.length)]!;
}
