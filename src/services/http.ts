import type {
  HttpAuthConfig,
  HttpKeyValue,
  HttpMethod,
} from "../types/workflows";
import { interpolateTemplate } from "../util/templates";

export type ExecuteHttpRequestParams = {
  method: HttpMethod;
  url: string;
  queryParams: HttpKeyValue[];
  headers: HttpKeyValue[];
  bodyTemplate: string;
  bodyMimeType: "application/json" | "text/plain";
  auth: HttpAuthConfig;
  timeoutMs: number;
  variables: Record<string, string>;
};

export type HttpRequestExecution = {
  requestUrl: string;
  requestHeaders: Array<{ key: string; value: string }>;
  response?: {
    status: number;
    ok: boolean;
    durationMs: number;
    headers: Array<{ key: string; value: string }>;
    bodyText: string;
    bodyJson?: unknown;
  };
  error?: {
    type: "validation" | "timeout" | "network" | "unknown";
    message: string;
  };
};

const interpolateKeyValueList = (
  entries: HttpKeyValue[],
  variables: Record<string, string>,
) =>
  entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      key: interpolateTemplate(entry.key, variables).trim(),
      value: interpolateTemplate(entry.value, variables),
    }))
    .filter((entry) => entry.key.length > 0);

const encodeBase64 = (value: string) => {
  if (typeof btoa === "function") {
    return btoa(value);
  }
  const globalBuffer = (
    globalThis as unknown as {
      Buffer?: {
        from: (
          input: string,
          encoding: string,
        ) => { toString: (encoding: string) => string };
      };
    }
  ).Buffer;
  if (globalBuffer?.from) {
    return globalBuffer.from(value, "utf8").toString("base64");
  }
  throw new Error("Base64 encoding is not supported in this environment");
};

const applyAuth = (
  auth: HttpAuthConfig,
  headers: Map<string, { key: string; value: string }>,
  variables: Record<string, string>,
) => {
  if (auth.type === "basic") {
    const username = interpolateTemplate(auth.username ?? "", variables);
    const password = interpolateTemplate(auth.password ?? "", variables);
    const encoded = encodeBase64(`${username}:${password}`);
    if (!headers.has("authorization")) {
      headers.set("authorization", {
        key: "Authorization",
        value: `Basic ${encoded}`,
      });
    }
  } else if (auth.type === "bearer") {
    const token = interpolateTemplate(auth.token ?? "", variables);
    if (!headers.has("authorization")) {
      headers.set("authorization", {
        key: "Authorization",
        value: `Bearer ${token}`,
      });
    }
  }
};

const tryParseJson = (bodyText: string) => {
  try {
    return { success: true as const, value: JSON.parse(bodyText) as unknown };
  } catch {
    return { success: false as const };
  }
};

export const executeHttpRequest = async (
  params: ExecuteHttpRequestParams,
): Promise<HttpRequestExecution> => {
  const compiledUrl = interpolateTemplate(params.url.trim(), params.variables);

  let url: URL;
  try {
    url = new URL(compiledUrl);
  } catch {
    return {
      requestUrl: compiledUrl,
      requestHeaders: [],
      error: {
        type: "validation",
        message: "Enter a valid absolute URL (https://...)",
      },
    };
  }

  const searchParams = new URLSearchParams(url.search);
  interpolateKeyValueList(params.queryParams, params.variables).forEach(
    ({ key, value }) => {
      searchParams.append(key, value);
    },
  );
  url.search = searchParams.toString();

  const headerMap = new Map<string, { key: string; value: string }>();
  interpolateKeyValueList(params.headers, params.variables).forEach(
    ({ key, value }) => {
      const normalized = key.trim();
      headerMap.set(normalized.toLowerCase(), { key: normalized, value });
    },
  );

  applyAuth(params.auth, headerMap, params.variables);

  const bodyShouldBeSent =
    params.method !== "GET" &&
    params.method !== "HEAD" &&
    params.bodyTemplate.trim().length > 0;
  const body = bodyShouldBeSent
    ? interpolateTemplate(params.bodyTemplate, params.variables)
    : undefined;

  if (bodyShouldBeSent) {
    const contentType = headerMap.get("content-type");
    if (!contentType) {
      headerMap.set("content-type", {
        key: "Content-Type",
        value: params.bodyMimeType,
      });
    }
  }

  const requestHeaders = Array.from(headerMap.values());

  const fetchHeaders = Object.fromEntries(
    requestHeaders.map(({ key, value }) => [key, value]),
  );

  const controller = new AbortController();
  const timeoutId = params.timeoutMs
    ? setTimeout(() => controller.abort(), params.timeoutMs)
    : null;

  const start =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  try {
    const response = await fetch(url.toString(), {
      method: params.method,
      headers: fetchHeaders,
      body,
      signal: controller.signal,
    });

    const end =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const durationMs = Math.max(0, end - start);

    const bodyText = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const parsedBody = contentType.includes("application/json")
      ? tryParseJson(bodyText)
      : { success: false as const };

    return {
      requestUrl: url.toString(),
      requestHeaders,
      response: {
        status: response.status,
        ok: response.ok,
        durationMs,
        headers: Array.from(response.headers.entries()).map(([key, value]) => ({
          key,
          value,
        })),
        bodyText,
        bodyJson: parsedBody.success ? parsedBody.value : undefined,
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        requestUrl: url.toString(),
        requestHeaders,
        error: {
          type: "timeout",
          message: `Request timed out after ${params.timeoutMs}ms`,
        },
      };
    }
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unknown network error";
    return {
      requestUrl: url.toString(),
      requestHeaders,
      error: {
        type: "network",
        message,
      },
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
