import { execSync } from 'child_process';
import { logger } from './logger.js';

// Uses the system `curl` binary: some sites' WAFs block Node's TLS fingerprint (JA3 hash)
// while curl requests pass, and this avoids the overhead of a headless browser.
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

  static get(url: string, extraArgs: string[] = []): string {
    const args = [...this.DEFAULT_ARGS, ...extraArgs, url];
    // Quote ALL arguments to handle special characters like parentheses, spaces, etc.
    const cmd = `curl ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;

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

  static getJson<T = any>(url: string, extraArgs: string[] = []): T {
    const jsonArgs = ['-H', 'Accept: application/json'];
    const args = [...this.DEFAULT_ARGS, ...jsonArgs, ...extraArgs, url];
    // Quote ALL arguments to handle special characters
    const cmd = `curl ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;

    logger.debug(`[CurlHelper] GET JSON ${url}`);

    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return JSON.parse(result) as T;
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      logger.error(`[CurlHelper] Failed to fetch JSON ${url}: ${stderr}`);
      throw new Error(`Curl failed for ${url}: ${stderr}`);
    }
  }

  static getStatus(url: string): number {
    const args = [
      '--silent',
      '--output', '/dev/null',
      '--write-out', '%{http_code}',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      url,
    ];
    // Quote ALL arguments to handle special characters
    const cmd = `curl ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;

    try {
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
      return parseInt(result.trim(), 10);
    } catch (err: any) {
      logger.error(`[CurlHelper] Failed to get status for ${url}: ${err.message}`);
      return 0;
    }
  }

  static getWithHeaders(url: string, extraArgs: string[] = []): {
    status: number;
    headers: Record<string, string>;
    body: string;
  } {
    const dumpArgs = ['-D', '-', ...extraArgs];
    const args = [...this.DEFAULT_ARGS, ...dumpArgs, url];
    // Quote ALL arguments to handle special characters
    const cmd = `curl ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;

    logger.debug(`[CurlHelper] GET with headers ${url}`);

    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return this.parseHeadersAndBody(result);
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      logger.error(`[CurlHelper] Failed to fetch with headers ${url}: ${stderr}`);
      throw new Error(`Curl failed for ${url}: ${stderr}`);
    }
  }

  private static parseHeadersAndBody(result: string): {
    status: number;
    headers: Record<string, string>;
    body: string;
  } {
    const headerBodySplit = result.split('\r\n\r\n');
    const headerSection = headerBodySplit[0] || '';
    const responseBody = headerBodySplit.slice(1).join('\r\n\r\n');

    const lines = headerSection.split('\r\n');
    const statusMatch = lines[0]?.match(/HTTP\/[\d.]+\s+(\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

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

  static isAvailable(): boolean {
    try {
      execSync('curl --version', { encoding: 'utf-8', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
