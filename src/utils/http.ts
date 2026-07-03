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
 * @returns Raw HTML string
 */
export async function fetchPage(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    headers: DEFAULT_HEADERS,
    timeout: config.requestTimeout,
  });
  return response.data;
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