/**
 * Shared type definitions used across main, preload, and renderer processes.
 */

// --- Portal Definitions ---

export type PortalId =
  | 'admin'
  | 'entra'
  | 'exchange'
  | 'intune'
  | 'teams'
  | 'sharepoint'
  | 'azure'
  | 'security';

type PortalUrl = string | ((domain: string) => string);

export interface PortalDef {
  label: string;
  url: PortalUrl;
}

export const PORTALS: Record<PortalId, PortalDef> = {
  admin: { label: 'Admin', url: 'https://admin.microsoft.com' },
  entra: { label: 'Entra', url: 'https://entra.microsoft.com' },
  exchange: { label: 'Exchange', url: 'https://admin.exchange.microsoft.com' },
  intune: { label: 'Intune', url: 'https://intune.microsoft.com' },
  teams: { label: 'Teams', url: 'https://admin.teams.microsoft.com' },
  sharepoint: {
    label: 'SharePoint',
    url: (domain: string) => {
      // Extract tenant prefix from onmicrosoft.com domain
      const prefix = domain.replace('.onmicrosoft.com', '').split('.')[0];
      return `https://${prefix}-admin.sharepoint.com`;
    },
  },
  azure: { label: 'Azure', url: 'https://portal.azure.com' },
  security: { label: 'Security', url: 'https://security.microsoft.com' },
};

export const PORTAL_IDS = Object.keys(PORTALS) as PortalId[];

/** Resolve a portal URL — handles both static strings and tenant-specific builders */
export function resolvePortalUrl(portalId: PortalId, domain: string): string {
  const { url } = PORTALS[portalId];
  return typeof url === 'function' ? url(domain) : url;
}

// --- Tenant Definitions ---

export interface Tenant {
  id: string;
  name: string;
  domain: string;
}

export interface TenantInput {
  name: string;
  domain: string;
}

// --- View Key ---

export type ViewKey = `${string}:${PortalId}`;

export function makeViewKey(tenantId: string, portalId: PortalId): ViewKey {
  return `${tenantId}:${portalId}`;
}

// --- IPC Channels ---

export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:get-version',
  TENANT_GET_ALL: 'tenant:get-all',
  TENANT_ADD: 'tenant:add',
  TENANT_UPDATE: 'tenant:update',
  TENANT_REMOVE: 'tenant:remove',
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
  addTenant(input: TenantInput): Promise<Tenant>;
  updateTenant(id: string, input: TenantInput): Promise<Tenant>;
  removeTenant(id: string): Promise<void>;
  selectTenant(tenantId: string, portalId: PortalId): void;
  updateLayout(contentBounds: ContentBounds): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
