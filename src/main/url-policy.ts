import { domainToASCII } from 'node:url';

const MICROSOFT_HOST_SUFFIXES = [
  'azure.com',
  'cloud.microsoft',
  'dynamics.com',
  'dynamics365.com',
  'live.com',
  'microsoft.com',
  'microsoft365.com',
  'microsoft365.us',
  'microsoft.us',
  'microsoftazure.de',
  'microsoftonline.com',
  'microsoftonline-p.com',
  'microsoftonline.us',
  'msauth.net',
  'msftauth.net',
  'office.com',
  'office.net',
  'office365.cn',
  'office365.com',
  'office365.us',
  'partner.microsoftonline.cn',
  'powerapps.com',
  'powerautomate.com',
  'powerbi.com',
  'sharepoint.com',
  'yammer.com',
  'windows.net',
] as const;

function hostnameMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function normalizeHttpsUrl(value: string, label = 'URL'): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  const hasExplicitScheme =
    /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ||
    /^(?:about|data|file|javascript|mailto):/i.test(trimmed);
  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain embedded credentials.`);
  }

  return parsed.toString();
}

export function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function normalizeTenantDomain(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, '');
  if (
    !trimmed ||
    trimmed.includes('://') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('@') ||
    trimmed.includes(':')
  ) {
    throw new Error('Tenant domain must be a DNS hostname.');
  }

  const ascii = domainToASCII(trimmed);
  const labels = ascii.split('.');
  if (
    !ascii ||
    ascii.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new Error('Tenant domain must be a valid DNS hostname.');
  }

  return ascii;
}

export function isMicrosoftOwnedUrl(value: string): boolean {
  if (!isHttpsUrl(value)) return false;
  const hostname = new URL(value).hostname.toLowerCase();
  return MICROSOFT_HOST_SUFFIXES.some((suffix) => hostnameMatchesSuffix(hostname, suffix));
}

export function tenantPartition(tenantId: string): string {
  return `persist:tenant-${tenantId}`;
}

export function customPortalPartition(
  tenantId: string,
  portalId: string,
  url: string,
): string {
  return isMicrosoftOwnedUrl(url)
    ? tenantPartition(tenantId)
    : `persist:custom-${portalId}`;
}

export function toolPartition(toolId: string): string {
  return `persist:tool-${toolId}`;
}
