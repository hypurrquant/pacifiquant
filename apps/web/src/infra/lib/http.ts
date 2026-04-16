import type { ZodSchema } from "zod";
import { createLogger } from "@hq/core/logging";
import { ApiError, resolveApiErrorMessage, isApiErrorBody, isRetryableNetworkError } from '@hq/core/lib/error';

const BASE_URL = 'https://api.hypurrquant.com';

const logger = createLogger("API");

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_DELAY = 500;

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface HttpOptions<T = unknown> extends RequestInit {
    headers?: Record<string, string>;
    retries?: number;
    schema?: ZodSchema<T>;
}

export async function http<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    path: string,
    options: HttpOptions<T> = {}
): Promise<T> {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
    const maxRetries = options.retries ?? MAX_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);
            logger.info(`API retry attempt ${attempt}/${maxRetries} after ${delay}ms for ${url}`);
            await sleep(delay);
        }

        logger.debug(`HTTP ${options.method ?? "GET"} - ${url}`);

        try {
            const res = await fetch(url, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    "ngrok-skip-browser-warning": "true",
                    ...(options.headers ?? {}),
                },
            });
            const ct = res.headers.get("content-type")?.toLowerCase() ?? "";
            const isJson = ct.includes("application/json");
            const data = isJson ? await res.json() : await res.text();

            logger.debug(`HTTP ${options.method ?? "GET"} / ${url} / ${res.status} ${isJson ? JSON.stringify(data) : data}`);

            if (!res.ok) {
                const hasBeCode = isApiErrorBody(data);
                const beCode = hasBeCode ? data.code : null;
                const kind = hasBeCode ? 'BACKEND' as const : 'HTTP' as const;
                const rawMessage = hasBeCode
                    ? data.error_message ?? data.detail ?? `HTTP ${res.status}`
                    : `HTTP ${res.status}`;

                const userMessage = resolveApiErrorMessage(beCode, { error_message: hasBeCode ? data.error_message : undefined, detail: hasBeCode ? data.detail : undefined }, rawMessage);
                throw new ApiError(userMessage, res.status, kind, beCode, rawMessage, hasBeCode ? data.data : undefined);
            }

            if (isApiErrorBody(data) && data.code !== 200) {
                const beCode = data.code;
                const rawMessage = data.error_message ?? `Error code: ${beCode}`;
                const userMessage = resolveApiErrorMessage(beCode, { error_message: data.error_message, detail: data.detail }, rawMessage);
                throw new ApiError(userMessage, 200, 'BACKEND', beCode, rawMessage, data.data);
            }

            if (options.schema) {
                return options.schema.parse(data);
            }
            return data as T; // @ci-exception(type-assertion-count)
        } catch (e: unknown) {
            lastError = e;

            if (!isRetryableNetworkError(e)) {
                logger.error(`HTTP ${options.method ?? "GET"} - ${url} failed (non-retryable)`, e);
                throw e;
            }

            if (attempt === maxRetries) {
                logger.error(`HTTP ${options.method ?? "GET"} - ${url} failed after ${maxRetries + 1} attempts`, e);
            }
        }
    }

    throw lastError;
}

export async function httpText(
    path: string,
    options: RequestInit & { headers?: Record<string, string> } = {} // @ci-exception(no-optional-without-default) — boundary config param (rule 4-iv)
): Promise<string> {
    const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`} `;
    const res = await fetch(url, {
        ...options,
        headers: {
            "ngrok-skip-browser-warning": "true",
            ...(options.headers ?? {}),
        },
    });
    const text = await res.text();
    logger.debug(`HTTP ${options.method ?? "GET"} / ${url} / ${res.status} ${text}`,);
    if (!res.ok) throw new ApiError(text || `HTTP ${res.status}`, res.status, 'HTTP', null, text || `HTTP ${res.status}`);
    return text;
}
