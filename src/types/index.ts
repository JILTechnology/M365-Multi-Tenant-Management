/**
 * Shared type definitions used across main, preload, and renderer processes.
 */

// --- Portal Definitions ---

export type PortalId = 'admin' | 'entra' | 'exchange' | 'intune';

export const PORTALS: Record<PortalId, { label: string; url: string }> = {
  admin: { label: 'Admin Center', url: 'https://admin.microsoft.com' },
  entra: { label: 'Entra', url: 'https://entra.microsoft.com' },
  exchange: { label: 'Exchange', url: 'https://admin.exchange.microsoft.com' },
  intune: { label: 'Intune', url: 'https://intune.microsoft.com' },
};

export const PORTAL_IDS = Object.keys(PORTALS) as PortalId[];

// --- Tenant Definitions ---

export interface Tenant {
  id: string;
  name: string;
  domain: string;
}

export const DEFAULT_TENANTS: Tenant[] = [
  { id: 'tenant-1', name: 'Contoso', domain: 'contoso.onmicrosoft.com' },
  { id: 'tenant-2', name: 'Fabrikam', domain: 'fabrikam.onmicrosoft.com' },
];

// --- View Key ---

export type ViewKey = `${string}:${PortalId}`;

export function makeViewKey(tenantId: string, portalId: PortalId): ViewKey {
  return `${tenantId}:${portalId}`;
}

// --- IPC Channels ---

export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:get-version',
  TENANT_GET_ALL: 'tenant:get-all',
  TENANT_SELECT: 'tenant:select',
  LAYOUT_UPDATE: 'layout:update',
} as const;

// --- Content Bounds ---

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Electron API (exposed to renderer via preload) ---

export interface ElectronAPI {
  getAppVersion(): Promise<string>;
  getTenants(): Promise<Tenant[]>;
  selectTenant(tenantId: string, portalId: PortalId): void;
  updateLayout(contentBounds: ContentBounds): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
