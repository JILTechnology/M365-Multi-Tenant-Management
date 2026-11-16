import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findIconCandidates, getSiteIcon, isBlankIco, siteIconPages, sniffImageType } from './site-icons';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A 2x1 32-bit .ico with the given BGRA pixel values. */
function ico(...pixels: number[]): Buffer {
  const bytes = Buffer.alloc(6 + 16 + 40 + pixels.length * 4);
  bytes.writeUInt16LE(1, 2);
  bytes.writeUInt16LE(1, 4);
  bytes[6] = 2;
  bytes[7] = 1;
  bytes.writeUInt16LE(32, 12);
  bytes.writeUInt32LE(40 + pixels.length * 4, 14);
  bytes.writeUInt32LE(22, 18);
  bytes.writeUInt32LE(40, 22);
  pixels.forEach((pixel, i) => bytes.writeUInt32LE(pixel, 62 + i * 4));
  return bytes;
}

describe('site icon pages', () => {
  it('reads the domain and its www host, or the tool URL and then its parent domain', () => {
    expect(siteIconPages('contoso.com')).toEqual(['https://contoso.com/', 'https://www.contoso.com/']);
    expect(siteIconPages('www.contoso.com')).toEqual(['https://www.contoso.com/']);
    expect(siteIconPages('https://app.example.com/#/home')).toEqual([
      'https://app.example.com/#/home',
      'https://example.com/',
    ]);
    expect(siteIconPages('https://example.com/login')).toEqual(['https://example.com/login']);
  });

  it('skips domains with no public website and anything that is not HTTPS', () => {
    expect(siteIconPages('contoso.onmicrosoft.com')).toEqual([]);
    expect(siteIconPages('http://contoso.com')).toEqual([]);
    expect(siteIconPages('not a domain')).toEqual([]);
  });
});

describe('icon candidates', () => {
  it('ranks declared icons by size (apple-touch-icon counts as 180px) and ends with /favicon.ico', () => {
    const html = `
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel='apple-touch-icon' href='/apple.png'>
      <link rel="mask-icon" href="/mask.svg">
      <link rel="icon" href="http://insecure.example/x.png" sizes="64x64">
      <link href="//cdn.example.com/big.png" rel="shortcut icon" sizes="96x96">`;
    expect(findIconCandidates(html, 'https://contoso.com/home')).toEqual([
      'https://contoso.com/apple.png',
      'https://cdn.example.com/big.png',
      'https://contoso.com/favicon-16.png',
      'https://contoso.com/favicon.ico',
    ]);
  });
});

describe('image sniffing', () => {
  it('recognizes images by their bytes and rejects everything else', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon');
    expect(sniffImageType(Buffer.from('\0\0\0\x18ftypavif\0\0\0\0', 'latin1'))).toBe('image/avif');
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg xmlns="x"></svg>'))).toBe('image/svg+xml');
    expect(sniffImageType(Buffer.from('<html><body>Not found</body></html>'))).toBeNull();
  });

  it('treats a flat single-color .ico (a site builder placeholder) as no icon', () => {
    expect(isBlankIco(ico(0x01ffffff, 0x01ffffff))).toBe(true);
    expect(isBlankIco(ico(0xff2050a0, 0x01ffffff))).toBe(false);
    expect(sniffImageType(ico(0x01ffffff, 0x01ffffff))).toBe('image/x-icon');
  });
});

describe('getSiteIcon', () => {
  it('downloads the best icon once, then serves it from the cache', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'site-icons-'));
    const requested: string[] = [];
    const fetchIcon = async (url: string) => {
      requested.push(url);
      if (url === 'https://contoso.com/') {
        return new Response('<link rel="apple-touch-icon" href="/apple.png">');
      }
      if (url === 'https://contoso.com/apple.png') return new Response(PNG);
      return new Response('missing', { status: 404 });
    };

    const icon = await getSiteIcon(dir, 'contoso.com', fetchIcon, 1000);
    expect(icon).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
    expect(await getSiteIcon(dir, 'contoso.com', fetchIcon, 2000)).toBe(icon);
    expect(requested).toEqual(['https://contoso.com/', 'https://contoso.com/apple.png']);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'site-icons.json'), 'utf8'))).toEqual({
      'https://contoso.com': { icon, checkedAt: 1000 },
    });
  });

  it('waits a day before retrying a site that had no usable icon', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'site-icons-'));
    let requests = 0;
    const fetchIcon = async () => {
      requests += 1;
      throw new Error('offline');
    };

    expect(await getSiteIcon(dir, 'fabrikam.com', fetchIcon, 0)).toBeNull();
    const firstAttempt = requests;
    expect(await getSiteIcon(dir, 'fabrikam.com', fetchIcon, 60_000)).toBeNull();
    expect(requests).toBe(firstAttempt);
    await getSiteIcon(dir, 'fabrikam.com', fetchIcon, 25 * 60 * 60 * 1000);
    expect(requests).toBeGreaterThan(firstAttempt);
  });
});
