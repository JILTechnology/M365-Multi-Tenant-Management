import { describe, expect, it } from 'vitest';
import {
  customPortalPartition,
  isHttpsUrl,
  isMicrosoftOwnedUrl,
  normalizeHttpsUrl,
  normalizeTenantDomain,
  tenantPartition,
  toolPartition,
} from './url-policy';

describe('normalizeHttpsUrl', () => {
  it('adds HTTPS when the scheme is omitted', () => {
    expect(normalizeHttpsUrl('admin.example.com/path')).toBe(
      'https://admin.example.com/path',
    );
  });

  it('accepts a hostname with an explicit port and no scheme', () => {
    expect(normalizeHttpsUrl('admin.example.com:8443/path')).toBe(
      'https://admin.example.com:8443/path',
    );
  });

  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'https://user:password@example.com',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => normalizeHttpsUrl(url)).toThrow();
  });

  it('distinguishes absolute HTTPS URLs', () => {
    expect(isHttpsUrl('https://example.com/')).toBe(true);
    expect(isHttpsUrl('example.com')).toBe(false);
    expect(isHttpsUrl('http://example.com/')).toBe(false);
  });
});

describe('normalizeTenantDomain', () => {
  it('normalizes a valid tenant domain', () => {
    expect(normalizeTenantDomain(' Contoso.OnMicrosoft.com. ')).toBe(
      'contoso.onmicrosoft.com',
    );
  });

  it.each([
    'https://contoso.onmicrosoft.com',
    'contoso.onmicrosoft.com/path',
    'contoso.onmicrosoft.com:443',
    'localhost',
    '-contoso.onmicrosoft.com',
  ])('rejects invalid domain %s', (domain) => {
    expect(() => normalizeTenantDomain(domain)).toThrow();
  });
});

describe('persistent partition policy', () => {
  it('preserves the existing tenant and tool partition names', () => {
    expect(tenantPartition('tenant-id')).toBe('persist:tenant-tenant-id');
    expect(toolPartition('tool-id')).toBe('persist:tool-tool-id');
  });

  it('shares Microsoft custom portals with the tenant session', () => {
    expect(
      customPortalPartition(
        'tenant-id',
        'portal-id',
        'https://admin.microsoft.com/',
      ),
    ).toBe('persist:tenant-tenant-id');
  });

  it('isolates non-Microsoft custom portals', () => {
    expect(
      customPortalPartition(
        'tenant-id',
        'portal-id',
        'https://portal.example.com/',
      ),
    ).toBe('persist:custom-portal-id');
  });

  it('does not trust lookalike Microsoft hostnames', () => {
    expect(isMicrosoftOwnedUrl('https://login.microsoftonline.com/')).toBe(true);
    expect(isMicrosoftOwnedUrl('https://microsoft.com.example.org/')).toBe(false);
    expect(isMicrosoftOwnedUrl('https://evilmicrosoft.com/')).toBe(false);
  });
});
