// Shared HTTP helpers (axios + standard browser headers) used by all scrapers.

import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** Standard browser-like headers sent on every request. */
const DEFAULT_HEADERS = {
  "User-Agent": config.userAgent,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;
const RETRYABLE_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
]);
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function parseRetryAfterSeconds(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value > 0 ? value : undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds : undefined;
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, (dateMs - Date.now()) / 1000);
}

function retryDelayMs(error: unknown, attempt: number): number {
  const retryAfter = axios.isAxiosError(error)
    ? error.response?.headers?.["retry-after"]
    : undefined;
  const seconds = parseRetryAfterSeconds(retryAfter);
  if (seconds !== undefined) {
    return Math.min(seconds * 1000, RETRY_MAX_DELAY_MS);
  }
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
}

function isRetryableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  if (error.response) {
    return RETRYABLE_STATUS_CODES.has(error.response.status);
  }
  return error.code !== undefined && RETRYABLE_ERROR_CODES.has(error.code);
}

function buildHeaders(
  cookieStr?: string,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...extraHeaders };
  if (cookieStr) {
    headers.Cookie = cookieStr;
  }
  return headers;
}

async function requestWithRetry<T>(
  requestConfig: AxiosRequestConfig,
  url: string
): Promise<AxiosResponse<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.request<T>(requestConfig);
    } catch (error) {
      if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }
      const waitMs = retryDelayMs(error, attempt);
      logger.warn(
        `Retrying ${url} (attempt ${attempt + 1}/${MAX_RETRIES}) in ${Math.round(waitMs)}ms after error:`,
        error instanceof Error ? error.message : error
      );
      await delay(waitMs);
    }
  }
}

export async function fetchPage(
  url: string,
  cookieStr?: string,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const headers = buildHeaders(cookieStr, extraHeaders);
  const response = await requestWithRetry<string>(
    {
      url,
      method: "GET",
      headers,
      timeout: config.requestTimeout,
    },
    url
  );
  return response.data;
}

// Used when a site needs session cookies (avaliberica.pt requires the PHPSESSID from the listing page)
export async function fetchPageWithCookies(
  url: string,
  cookieStr?: string,
  extraHeaders?: Record<string, string>
): Promise<{ html: string; cookies: string }> {
  const headers = buildHeaders(cookieStr, extraHeaders);
  const response = await requestWithRetry<string>(
    {
      url,
      method: "GET",
      headers,
      timeout: config.requestTimeout,
    },
    url
  );

  const setCookies = response.headers["set-cookie"];
  const cookies = setCookies
    ? setCookies.map((c: string) => c.split(";")[0]).join("; ")
    : "";

  return { html: response.data, cookies };
}

// Used when a site initialises its listing session via POST and tracks it via cookie (leiloeiradolena.com)
export async function fetchPagePost(
  url: string,
  formData: Record<string, string>,
  cookieStr?: string
): Promise<{ html: string; cookies: string }> {
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cookieStr) {
    headers.Cookie = cookieStr;
  }

  const response = await requestWithRetry<string>(
    {
      url,
      method: "POST",
      data: new URLSearchParams(formData).toString(),
      headers,
      timeout: config.requestTimeout,
      maxRedirects: 0,
      validateStatus: (status) => status < 400,
    },
    url
  );

  const setCookies = response.headers["set-cookie"];
  const cookies = setCookies
    ? setCookies.map((c: string) => c.split(";")[0]).join("; ")
    : "";

  return { html: response.data, cookies };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
