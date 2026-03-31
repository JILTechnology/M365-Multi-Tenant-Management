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

// --- Tool Sites (global, not per-tenant) ---

export interface ToolSite {
  id: string;
  label: string;
  url: string;
}

export const TOOL_SITES: ToolSite[] = [
  { id: 'pax8', label: 'Pax8', url: 'https://app.pax8.com/' },
];

// --- Tool Input ---

export interface ToolInput {
  label: string;
  url: string;
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

export type ViewKey = string;

export function makeViewKey(tenantId: string, portalId: PortalId): ViewKey {
  return `${tenantId}:${portalId}`;
}

export function makeToolViewKey(toolId: string): ViewKey {
  return `tool:${toolId}`;
}

// --- IPC Channels ---

export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:get-version',
  TENANT_GET_ALL: 'tenant:get-all',
  TENANT_ADD: 'tenant:add',
  TENANT_UPDATE: 'tenant:update',
  TENANT_REMOVE: 'tenant:remove',
  TENANT_CLEAR_SESSION: 'tenant:clear-session',
  TENANT_SELECT: 'tenant:select',
  TOOL_GET_ALL: 'tool:get-all',
  TOOL_ADD: 'tool:add',
  TOOL_REMOVE: 'tool:remove',
  TOOL_SELECT: 'tool:select',
  LAYOUT_UPDATE: 'layout:update',
  NAV_BACK: 'nav:back',
  NAV_FORWARD: 'nav:forward',
  NAV_RELOAD: 'nav:reload',
  NAV_STATE: 'nav:state',
  CHECK_FOR_UPDATES: 'app:check-updates',
  OPEN_EXTENSION_POPUP: 'ext:open-popup',
} as const;

// --- Navigation State ---

export interface NavState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  url: string;
}

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
  clearTenantSession(id: string): Promise<void>;
  selectTenant(tenantId: string, portalId: PortalId): void;
  getTools(): Promise<ToolSite[]>;
  addTool(input: ToolInput): Promise<ToolSite>;
  removeTool(id: string): Promise<void>;
  selectTool(toolId: string): void;
  updateLayout(contentBounds: ContentBounds): void;
  navBack(): void;
  navForward(): void;
  navReload(): void;
  onNavState(callback: (state: NavState) => void): () => void;
  checkForUpdates(): void;
  openExtensionPopup(): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
