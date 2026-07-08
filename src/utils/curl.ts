import { execSync } from 'child_process';
import { logger } from './logger.js';

/**
 * Lightweight HTTP client that uses the system's `curl` binary.
 *
 * Some sites use WAFs (Web Application Firewalls) that block requests based on
 * the TLS fingerprint (JA3 hash) of the HTTP client library. Node.js's TLS
 * implementation differs from curl's, so Node.js requests get blocked while
 * curl requests succeed.
 *
 * This utility wraps `curl` to bypass such WAFs. It's lightweight (no browser
 * needed) and works on any system with curl installed (Linux, macOS, Windows).
 *
 * Usage:
 * ```typescript
 * const html = CurlHelper.get('https://example.com');
 * const json = CurlHelper.getJson('https://api.example.com/data');
 * ```
 */
export class CurlHelper {
  /**
   * Default curl options to mimic a real browser.
   */
  private static readonly DEFAULT_ARGS = [
    '--silent',
    '--show-error',
    '--compressed',
    '--max-time', '30',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    '-H', 'Accept-Encoding: gzip, deflate, br',
    '-H', 'Connection: keep-alive',
    '-H', 'Upgrade-Insecure-Requests: 1',
    '-H', 'Sec-Fetch-Dest: document',
    '-H', 'Sec-Fetch-Mode: navigate',
    '-H', 'Sec-Fetch-Site: none',
    '-H', 'Sec-Fetch-User: ?1',
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  /**
   * Fetch a URL and return the response body as a string.
   *
   * @param url - URL to fetch
   * @param extraArgs - Additional curl arguments
   * @returns Response body as string
   * @throws Error if curl fails or returns non-200 status
   */
  static get(url: string, extraArgs: string[] = []): string {
    const args = [...this.DEFAULT_ARGS, ...extraArgs, url];
    const cmd = `curl ${args.map(a => a.includes(' ') ? `'${a}'` : a).join(' ')}`;

    logger.debug(`[CurlHelper] GET ${url}`);

    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return result;
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      logger.error(`[CurlHelper] Failed to fetch ${url}: ${stderr}`);
      throw new Error(`Curl failed for ${url}: ${stderr}`);
    }
  }

  /**
   * Fetch a URL and return the response body as a JSON object.
   *
   * @param url - URL to fetch
   * @param extraArgs - Additional curl arguments
   * @returns Parsed JSON object
   */
  static getJson<T = any>(url: string, extraArgs: string[] = []): T {
    const jsonArgs = ['-H', 'Accept: application/json'];
    const body = this.get(url, [...jsonArgs, ...extraArgs]);
    return JSON.parse(body) as T;
  }

  /**
   * Fetch a URL and return the HTTP status code.
   *
   * @param url - URL to fetch
   * @returns HTTP status code
   */
  static getStatus(url: string): number {
    const args = [
      '--silent',
      '--output', '/dev/null',
      '--write-out', '%{http_code}',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      url,
    ];
    const cmd = `curl ${args.map(a => a.includes(' ') ? `'${a}'` : a).join(' ')}`;

    try {
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
      return parseInt(result.trim(), 10);
    } catch (err: any) {
      logger.error(`[CurlHelper] Failed to get status for ${url}: ${err.message}`);
      return 0;
    }
  }

  /**
   * Fetch a URL and return both headers and body.
   *
   * @param url - URL to fetch
   * @param extraArgs - Additional curl arguments
   * @returns Object with status, headers, and body
   */
  static getWithHeaders(url: string, extraArgs: string[] = []): {
    status: number;
    headers: Record<string, string>;
    body: string;
  } {
    const dumpArgs = ['-D', '-', ...extraArgs];
    const body = this.get(url, dumpArgs);

    // Split headers from body
    const headerBodySplit = body.split('\r\n\r\n');
    const headerSection = headerBodySplit[0] || '';
    const responseBody = headerBodySplit.slice(1).join('\r\n\r\n');

    // Parse status line
    const lines = headerSection.split('\r\n');
    const statusMatch = lines[0]?.match(/HTTP\/[\d.]+\s+(\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

    // Parse headers
    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const colonIdx = lines[i].indexOf(':');
      if (colonIdx > 0) {
        const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
        const value = lines[i].substring(colonIdx + 1).trim();
        headers[key] = value;
      }
    }

    return { status, headers, body: responseBody };
  }

  /**
   * Check if curl is available on the system.
   *
   * @returns True if curl is installed
   */
  static isAvailable(): boolean {
    try {
      execSync('curl --version', { encoding: 'utf-8', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
