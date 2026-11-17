import fs from 'node:fs/promises';
import path from 'node:path';

// Sidebar icons for tenants and tools, taken from each company's own website (never a
// third-party favicon service, which would learn the client list) and cached on disk.

export const SITE_ICONS_FILE = 'site-icons.json';
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_ICON_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 8000;
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000;

export type IconFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

interface CacheEntry {
  icon?: string;
  checkedAt: number;
}

/** Pages to read for a tenant domain or tool URL; empty when there is no public website. */
export function siteIconPages(site: string): string[] {
  if (/^https:\/\//i.test(site)) {
    try {
      // Web apps such as app.ninjarmm.com often have no icon; their company site does.
      const url = new URL(site);
      const labels = url.hostname.split('.');
      return labels.length > 2 ? [url.href, `https://${labels.slice(1).join('.')}/`] : [url.href];
    } catch {
      return [];
    }
  }
  const domain = site.trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain.endsWith('.onmicrosoft.com')) {
    return [];
  }
  return domain.startsWith('www.')
    ? [`https://${domain}/`]
    : [`https://${domain}/`, `https://www.${domain}/`];
}

/** Icon URLs declared by a page, best first, ending with the site's /favicon.ico. */
export function findIconCandidates(html: string, pageUrl: string): string[] {
  const found: { url: string; size: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    const isAppleTouch = rel.some((token) => token.startsWith('apple-touch-icon'));
    const href = attrs.get('href');
    if ((!isAppleTouch && !rel.includes('icon')) || !href) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    const sizes = (attrs.get('sizes') ?? '').toLowerCase();
    const declared = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map((m) => Number(m[1])));
    const isSvg =
      sizes.includes('any') ||
      (attrs.get('type') ?? '').includes('svg') ||
      url.pathname.toLowerCase().endsWith('.svg');
    found.push({ url: url.href, size: declared || (isSvg ? 256 : isAppleTouch ? 180 : 16) });
  }
  found.sort((a, b) => b.size - a.size);
  const urls = [...found.map((item) => item.url), new URL('/favicon.ico', pageUrl).href];
  return [...new Set(urls)].filter((url) => url.startsWith('https:'));
}

/** Image type from the file's own bytes; the server's Content-Type is not trusted. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]) => signature.every((value, i) => bytes[i] === value);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  // Image CDNs often answer Chromium with AVIF even for .png URLs.
  const boxType = String.fromCharCode(...bytes.subarray(4, 12));
  if (boxType === 'ftypavif' || boxType === 'ftypavis') return 'image/avif';
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('utf8').trimStart().toLowerCase();
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && head.includes('<svg')) {
    return 'image/svg+xml';
  }
  return null;
}

/**
 * True for an .ico whose images are each a single flat color, such as the blank favicon
 * site builders (Wix) serve when a site never set one. Images that aren't 32-bit bitmaps
 * (for example PNG inside the .ico) can't be checked cheaply and count as real.
 */
export function isBlankIco(bytes: Buffer): boolean {
  const count = bytes.length >= 6 ? bytes.readUInt16LE(4) : 0;
  if (count === 0) return false;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > bytes.length) return false;
    const pixelCount = (bytes[entry] || 256) * (bytes[entry + 1] || 256);
    const offset = bytes.readUInt32LE(entry + 12);
    const isBitmap32 = bytes.readUInt16LE(entry + 6) === 32 && offset + 44 <= bytes.length && bytes.readUInt32LE(offset) === 40;
    if (!isBitmap32) return false;
    const pixels = bytes.subarray(offset + 40, offset + 40 + pixelCount * 4);
    if (pixels.length < pixelCount * 4) return false;
    for (let p = 4; p < pixels.length; p += 4) {
      if (pixels.readUInt32LE(p) !== pixels.readUInt32LE(0)) return false;
    }
  }
  return true;
}

async function readLimited(
  response: Response,
  maxBytes: number,
  overflow: 'truncate' | 'reject',
): Promise<Buffer | null> {
  if (!response.ok || !response.body) return null;
  if (response.url && !response.url.startsWith('https:')) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      if (overflow === 'reject') return null;
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function downloadIcon(pages: string[], fetchIcon: IconFetch): Promise<string | null> {
  const request = (url: string) => fetchIcon(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  for (const page of pages) {
    let candidates = [new URL('/favicon.ico', page).href];
    try {
      const response = await request(page);
      const html = await readLimited(response, MAX_PAGE_BYTES, 'truncate');
      if (html) candidates = findIconCandidates(html.toString('utf8'), response.url || page);
    } catch {
      // The home page may block automated requests; /favicon.ico can still work.
    }
    for (const candidate of candidates.slice(0, MAX_ICON_ATTEMPTS)) {
      try {
        const bytes = await readLimited(await request(candidate), MAX_ICON_BYTES, 'reject');
        const type = bytes && bytes.length > 0 ? sniffImageType(bytes) : null;
        if (!bytes || !type || (type === 'image/x-icon' && isBlankIco(bytes))) continue;
        return `data:${type};base64,${bytes.toString('base64')}`;
      } catch {
        // Try the next candidate.
      }
    }
  }
  return null;
}

const caches = new Map<string, Promise<Map<string, CacheEntry>>>();
const inFlight = new Map<string, Promise<string | null>>();
let writeQueue: Promise<void> = Promise.resolve();

async function loadCache(file: string): Promise<Map<string, CacheEntry>> {
  const entries = new Map<string, CacheEntry>();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed as Record<string, CacheEntry>)) {
      if (typeof value?.checkedAt !== 'number') continue;
      const icon = typeof value.icon === 'string' && value.icon.startsWith('data:image/') ? value.icon : undefined;
      entries.set(key, { icon, checkedAt: value.checkedAt });
    }
  } catch {
    // Missing or unreadable cache: start empty.
  }
  return entries;
}

/** The site's icon as a data URL, or null when it has none we can use. */
export async function getSiteIcon(
  userDataPath: string,
  site: string,
  fetchIcon: IconFetch,
  now = Date.now(),
): Promise<string | null> {
  const pages = siteIconPages(site);
  if (pages.length === 0) return null;
  const file = path.join(userDataPath, SITE_ICONS_FILE);
  if (!caches.has(file)) caches.set(file, loadCache(file));
  const entries = await caches.get(file)!;

  const key = new URL(pages[0]).origin;
  const cached = entries.get(key);
  if (cached && now - cached.checkedAt < (cached.icon ? REFRESH_AFTER_MS : RETRY_FAILED_AFTER_MS)) {
    return cached.icon ?? null;
  }

  const flightKey = `${file}|${key}`;
  let pending = inFlight.get(flightKey);
  if (!pending) {
    pending = downloadIcon(pages, fetchIcon)
      .then(async (downloaded) => {
        const icon = downloaded ?? cached?.icon;
        entries.set(key, { icon, checkedAt: now });
        const snapshot = JSON.stringify(Object.fromEntries(entries));
        writeQueue = writeQueue.then(() => fs.writeFile(file, snapshot)).catch(() => undefined);
        await writeQueue;
        return icon ?? null;
      })
      .finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, pending);
  }
  return pending;
}
