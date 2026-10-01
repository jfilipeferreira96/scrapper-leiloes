// Shared HTTP helpers (axios + standard browser headers) used by all scrapers.

import axios from "axios";
import { config } from "../config/index.js";

/** Standard browser-like headers sent on every request. */
const DEFAULT_HEADERS = {
  "User-Agent": config.userAgent,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
};

export async function fetchPage(url: string, cookieStr?: string): Promise<string> {
  const headers = cookieStr
    ? { ...DEFAULT_HEADERS, Cookie: cookieStr }
    : DEFAULT_HEADERS;
  const response = await axios.get<string>(url, {
    headers,
    timeout: config.requestTimeout,
  });
  return response.data;
}

// Used when a site needs session cookies (avaliberica.pt requires the PHPSESSID from the listing page)
export async function fetchPageWithCookies(
  url: string,
  cookieStr?: string
): Promise<{ html: string; cookies: string }> {
  const headers = cookieStr
    ? { ...DEFAULT_HEADERS, Cookie: cookieStr }
    : DEFAULT_HEADERS;
  const response = await axios.get<string>(url, {
    headers,
    timeout: config.requestTimeout,
  });

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

  const response = await axios.post<string>(url, new URLSearchParams(formData).toString(), {
    headers,
    timeout: config.requestTimeout,
    maxRedirects: 0,
    validateStatus: (status) => status < 400,
  });

  const setCookies = response.headers["set-cookie"];
  const cookies = setCookies
    ? setCookies.map((c: string) => c.split(";")[0]).join("; ")
    : "";

  return { html: response.data, cookies };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}