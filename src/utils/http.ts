/**
 * Shared HTTP utilities for all scrapers.
 *
 * Centralizes the fetch logic (axios + standard browser headers) and the
 * delay helper so that every scraper behaves identically and changes only
 * need to be made in one place.
 */

import axios from "axios";
import { config } from "../config/index.js";

/** Standard browser-like headers sent on every request. */
const DEFAULT_HEADERS = {
  "User-Agent": config.userAgent,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
};

/**
 * Fetches a page and returns its raw HTML content.
 *
 * Uses the global User-Agent and request timeout from config, so all
 * scrapers share the same behavior.
 *
 * @param url - URL to fetch
 * @param cookieStr - Optional Cookie header value (e.g., "PHPSESSID=abc123")
 * @returns Raw HTML string
 */
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

/**
 * Fetches a page and returns both HTML and Set-Cookie headers.
 *
 * Used by scrapers that need session cookies (e.g., avaliberica.pt requires
 * PHPSESSID from the listing page to access detail pages).
 *
 * @param url - URL to fetch
 * @param cookieStr - Optional Cookie header value for sending existing cookies
 * @returns Object with HTML content and cookie string extracted from Set-Cookie
 */
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

  // Extract cookie pairs from Set-Cookie headers
  const setCookies = response.headers["set-cookie"];
  const cookies = setCookies
    ? setCookies.map((c: string) => c.split(";")[0]).join("; ")
    : "";

  return { html: response.data, cookies };
}

/**
 * POST form data to a page and return HTML + Set-Cookie headers.
 *
 * Used by scrapers that need to submit filter forms and capture a session
 * cookie (e.g., leiloeiradolena.com uses POST to initialise the listing
 * session, then GET for pagination).
 *
 * @param url - URL to POST to
 * @param formData - Object of form field name → value pairs
 * @param cookieStr - Optional Cookie header value for sending existing cookies
 * @returns Object with HTML content and cookie string extracted from Set-Cookie
 */
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

  // Extract cookie pairs from Set-Cookie headers
  const setCookies = response.headers["set-cookie"];
  const cookies = setCookies
    ? setCookies.map((c: string) => c.split(";")[0]).join("; ")
    : "";

  return { html: response.data, cookies };
}

/**
 * Returns a promise that resolves after the given number of milliseconds.
 * Used to throttle detail-page requests and avoid rate limiting.
 *
 * @param ms - Milliseconds to wait
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}