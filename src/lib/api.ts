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
