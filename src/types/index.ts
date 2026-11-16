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
  | 'security'
  | 'browse';

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
  browse: { label: 'Browse', url: 'about:blank' },
};

export const PORTAL_IDS = Object.keys(PORTALS) as PortalId[];

/** Resolve a portal URL — handles both static strings and tenant-specific builders */
export function resolvePortalUrl(portalId: PortalId, domain: string): string {
  const { url } = PORTALS[portalId];
  return typeof url === 'function' ? url(domain) : url;
}

// --- Custom Portal Sites (tenant-specific definitions and sessions) ---

export interface CustomPortalSite {
  id: string;
  tenantId: string;
  label: string;
  url: string;
}

export interface CustomPortalInput {
  tenantId: string;
  label: string;
  url: string;
}

export interface CustomPortalUpdateInput {
  label: string;
  url: string;
}

export type CustomPortalMoveDirection = 'left' | 'right';

export const CUSTOM_PORTAL_PREFIX = 'custom:';

export type CustomPortalTabId = `${typeof CUSTOM_PORTAL_PREFIX}${string}`;
export type TenantTabId = PortalId | CustomPortalTabId;

export function makeCustomPortalTabId(id: string): CustomPortalTabId {
  return `${CUSTOM_PORTAL_PREFIX}${id}` as CustomPortalTabId;
}

export function isCustomPortalTabId(tabId: TenantTabId): tabId is CustomPortalTabId {
  return tabId.startsWith(CUSTOM_PORTAL_PREFIX);
}

export function getCustomPortalId(tabId: CustomPortalTabId): string {
  return tabId.slice(CUSTOM_PORTAL_PREFIX.length);
}

export type TenantLastTabs = Record<string, TenantTabId>;

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

// --- Application Preferences ---

export interface AppPreferences {
  contentProtection: boolean;
  hideOnLock: boolean;
  inactiveViewMinutes: number;
  maxLiveViews: number;
  /** Opens a localhost-only browser control port so Claude can drive the app. Applies on restart. */
  claudeControl: boolean;
}

/** Fixed so Claude's browser-control tool can always find the app. */
export const CLAUDE_CONTROL_PORT = 9339;

// --- View Key ---

export type ViewKey = string;

export function makeViewKey(tenantId: string, portalId: PortalId): ViewKey {
  return `${tenantId}:${portalId}`;
}

export function makeTenantTabViewKey(tenantId: string, tabId: TenantTabId): ViewKey {
  return `${tenantId}:${tabId}`;
}

export function makeToolViewKey(toolId: string): ViewKey {
  return `tool:${toolId}`;
}

// --- IPC Channels ---

export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:get-version',
  APP_CLAUDE_CONTROL_ACTIVE: 'app:claude-control-active',
  EXCHANGE_POWERSHELL_TENANTS: 'exchange-powershell:tenants',
  SITE_ICON_GET: 'site-icon:get',
  TERMINAL_OPEN: 'terminal:open',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
  PREFERENCES_GET: 'preferences:get',
  PREFERENCES_UPDATE: 'preferences:update',
  TENANT_GET_ALL: 'tenant:get-all',
  TENANT_ADD: 'tenant:add',
  TENANT_UPDATE: 'tenant:update',
  TENANT_REMOVE: 'tenant:remove',
  TENANT_CLEAR_SESSION: 'tenant:clear-session',
  TENANT_SELECT: 'tenant:select',
  CUSTOM_PORTAL_GET_ALL: 'custom-portal:get-all',
  CUSTOM_PORTAL_ADD: 'custom-portal:add',
  CUSTOM_PORTAL_UPDATE: 'custom-portal:update',
  CUSTOM_PORTAL_MOVE: 'custom-portal:move',
  CUSTOM_PORTAL_REMOVE: 'custom-portal:remove',
  TENANT_LAST_TABS_GET: 'tenant-last-tabs:get',
  TENANT_LAST_TAB_SET: 'tenant-last-tab:set',
  DATA_BACKUP: 'data:backup',
  DATA_RESTORE: 'data:restore',
  DATA_CHANGED: 'data:changed',
  AUDIT_GET_RECENT: 'audit:get-recent',
  AUDIT_EXPORT: 'audit:export',
  AUDIT_CLEAR: 'audit:clear',
  DIAGNOSTICS_EXPORT: 'diagnostics:export',
  TOOL_GET_ALL: 'tool:get-all',
  TOOL_ADD: 'tool:add',
  TOOL_REMOVE: 'tool:remove',
  TOOL_SELECT: 'tool:select',
  LAYOUT_UPDATE: 'layout:update',
  NAV_BACK: 'nav:back',
  NAV_FORWARD: 'nav:forward',
  NAV_RELOAD: 'nav:reload',
  NAV_STATE: 'nav:state',
  NAV_NAVIGATE: 'nav:navigate',
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

// --- Data Maintenance ---

export interface DataActionResult {
  ok: boolean;
  message: string;
  path?: string;
}

export interface BackupRequest {
  encrypted: boolean;
  passphrase?: string;
}

export interface RestoreRequest {
  passphrase?: string;
}

export interface RestoreActionResult extends DataActionResult {
  requiresPassphrase?: boolean;
}

export type AuditOutcome = 'success' | 'canceled' | 'blocked' | 'failed';

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  outcome: AuditOutcome;
  target?: string;
  detail?: string;
}

export type DataChangeScope =
  | 'tenants'
  | 'customPortals'
  | 'tenantLastTabs'
  | 'tools'
  | 'preferences'
  | 'audit'
  | 'all';

export interface DataChangeNotice {
  scope: DataChangeScope;
  revision: number;
}

// --- Exchange PowerShell terminal ---

export interface TerminalDataEvent {
  tenantId: string;
  data: string;
}

export interface TerminalExitEvent {
  tenantId: string;
}

// --- Electron API (exposed to renderer via preload) ---

export interface ElectronAPI {
  getAppVersion(): Promise<string>;
  isClaudeControlActive(): Promise<boolean>;
  getExchangePowerShellTenantIds(): Promise<string[]>;
  getSiteIcon(kind: 'tenant' | 'tool', id: string): Promise<string | null>;
  openTerminal(tenantId: string, cols: number, rows: number): Promise<void>;
  writeTerminal(tenantId: string, data: string): void;
  resizeTerminal(tenantId: string, cols: number, rows: number): void;
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void;
  getPreferences(): Promise<AppPreferences>;
  updatePreferences(preferences: AppPreferences): Promise<AppPreferences>;
  getTenants(): Promise<Tenant[]>;
  addTenant(input: TenantInput): Promise<Tenant>;
  updateTenant(id: string, input: TenantInput): Promise<Tenant>;
  removeTenant(id: string): Promise<boolean>;
  clearTenantSession(id: string): Promise<boolean>;
  selectTenant(tenantId: string, tabId: TenantTabId): void;
  getCustomPortals(): Promise<CustomPortalSite[]>;
  addCustomPortal(input: CustomPortalInput): Promise<CustomPortalSite>;
  updateCustomPortal(id: string, input: CustomPortalUpdateInput): Promise<CustomPortalSite>;
  moveCustomPortal(id: string, direction: CustomPortalMoveDirection): Promise<CustomPortalSite[]>;
  removeCustomPortal(id: string): Promise<void>;
  getTenantLastTabs(): Promise<TenantLastTabs>;
  setTenantLastTab(tenantId: string, tabId: TenantTabId): Promise<void>;
  getTools(): Promise<ToolSite[]>;
  addTool(input: ToolInput): Promise<ToolSite>;
  removeTool(id: string): Promise<void>;
  selectTool(toolId: string): void;
  updateLayout(contentBounds: ContentBounds): void;
  navBack(): void;
  navForward(): void;
  navReload(): void;
  navigateTo(url: string): Promise<boolean>;
  onNavState(callback: (state: NavState) => void): () => void;
  onDataChanged(callback: (notice: DataChangeNotice) => void): () => void;
  checkForUpdates(): void;
  openExtensionPopup(): void;
  backupData(request: BackupRequest): Promise<DataActionResult>;
  restoreData(request?: RestoreRequest): Promise<RestoreActionResult>;
  getRecentAuditEntries(limit?: number): Promise<AuditEntry[]>;
  exportAuditLog(): Promise<DataActionResult>;
  clearAuditLog(): Promise<DataActionResult>;
  exportDiagnostics(): Promise<DataActionResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
