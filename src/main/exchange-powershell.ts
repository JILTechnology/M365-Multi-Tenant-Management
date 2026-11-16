import fs from 'node:fs';
import path from 'node:path';

/**
 * Per-PC list (in the app's userData folder) of tenants set up for certificate-based
 * Exchange Online PowerShell. Holds no secrets: the private key stays in the Windows
 * certificate store. Written by whoever sets a tenant up; the app only reads it.
 */
export const EXCHANGE_POWERSHELL_FILE = 'exchange-powershell.json';

export interface ExchangePowerShellEntry {
  tenantId: string;
  appId: string;
  certificateThumbprint: string;
  organization: string;
}

const TENANT_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THUMBPRINT = /^[0-9a-f]{40}$/i;
const ORGANIZATION = /^[a-z0-9-]+\.onmicrosoft\.com$/i;

function isEntry(value: unknown): value is ExchangePowerShellEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.tenantId === 'string' && TENANT_ID.test(entry.tenantId) &&
    typeof entry.appId === 'string' && GUID.test(entry.appId) &&
    typeof entry.certificateThumbprint === 'string' && THUMBPRINT.test(entry.certificateThumbprint) &&
    typeof entry.organization === 'string' && ORGANIZATION.test(entry.organization)
  );
}

/** Keeps only well-formed entries, so nothing unexpected reaches the terminal command line. */
export function parseExchangePowerShellEntries(value: unknown): ExchangePowerShellEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isEntry).map(({ tenantId, appId, certificateThumbprint, organization }) => ({
    tenantId,
    appId,
    certificateThumbprint,
    organization,
  }));
}

export function readExchangePowerShellEntries(userDataPath: string): ExchangePowerShellEntry[] {
  try {
    const raw = fs.readFileSync(path.join(userDataPath, EXCHANGE_POWERSHELL_FILE), 'utf8');
    return parseExchangePowerShellEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** PowerShell that signs in to the tenant's Exchange Online with its certificate. */
export function buildExchangeConnectCommand(entry: ExchangePowerShellEntry): string {
  return (
    `Write-Host 'Connecting to Exchange Online (${entry.organization})...'; ` +
    `Connect-ExchangeOnline -AppId ${entry.appId} ` +
    `-CertificateThumbprint ${entry.certificateThumbprint} ` +
    `-Organization ${entry.organization} -ShowBanner:$false; ` +
    `if ($?) { Write-Host 'Connected.' -ForegroundColor Green }`
  );
}
