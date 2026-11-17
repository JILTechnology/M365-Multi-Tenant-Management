import Store from 'electron-store';
import crypto from 'node:crypto';
import type { PersistedConfiguration, WindowState } from './configuration-backup';
import {
  CONFIGURATION_SCHEMA_VERSION,
  DEFAULT_APP_PREFERENCES,
  migrateConfiguration,
  validateAppPreferences,
  validateConfiguration,
  validateWindowState,
} from './configuration-backup';
import { normalizeHttpsUrl, normalizeTenantDomain } from './url-policy';
import type {
  AppPreferences,
  CustomPortalMoveDirection,
  CustomPortalInput,
  CustomPortalSite,
  CustomPortalUpdateInput,
  Tenant,
  TenantLastTabs,
  TenantInput,
  TenantTabId,
  ToolInput,
  ToolSite,
} from '../types/index';
import { PORTALS, TOOL_SITES, getCustomPortalId, isCustomPortalTabId } from '../types/index';

type StoreSchema = PersistedConfiguration;

const store = new Store<StoreSchema>({
  name: 'tenants',
  defaults: {
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    tenants: [],
    customPortals: [],
    tenantLastTabs: {},
    tools: TOOL_SITES,
    windowState: { width: 1200, height: 800, isMaximized: false },
    preferences: { ...DEFAULT_APP_PREFERENCES },
  },
});

const startupConfiguration = migrateConfiguration(store.store);
if (JSON.stringify(startupConfiguration) !== JSON.stringify(store.store)) {
  store.store = structuredClone(startupConfiguration);
}

function isValidTenantTab(tenantId: string, tabId: TenantTabId): boolean {
  if (isCustomPortalTabId(tabId)) {
    const customPortalId = getCustomPortalId(tabId);
    return getCustomPortals().some(
      (portal) => portal.id === customPortalId && portal.tenantId === tenantId
    );
  }

  return Object.prototype.hasOwnProperty.call(PORTALS, tabId);
}

function migrateCustomPortals(): CustomPortalSite[] {
  const tenants = getTenants();
  const fallbackTenantId = tenants[0]?.id;
  const portals = store.get('customPortals');
  let changed = false;

  const migrated = portals
    .map((portal) => {
      if (portal.tenantId || !fallbackTenantId) {
        return portal;
      }

      changed = true;
      return { ...portal, tenantId: fallbackTenantId };
    })
    .filter((portal) => tenants.some((tenant) => tenant.id === portal.tenantId));

  if (changed || migrated.length !== portals.length) {
    store.set('customPortals', migrated);
  }

  return migrated;
}

function cleanTenantLastTabs(): TenantLastTabs {
  const tenants = getTenants();
  const tenantIds = new Set(tenants.map((tenant) => tenant.id));
  const lastTabs = store.get('tenantLastTabs');
  const cleaned: TenantLastTabs = {};
  let changed = false;

  for (const [tenantId, tabId] of Object.entries(lastTabs)) {
    if (!tenantIds.has(tenantId)) {
      changed = true;
      continue;
    }

    if (isValidTenantTab(tenantId, tabId)) {
      cleaned[tenantId] = tabId;
    } else {
      cleaned[tenantId] = 'admin';
      changed = true;
    }
  }

  if (changed) {
    store.set('tenantLastTabs', cleaned);
  }

  return cleaned;
}

function normalizeLabel(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error(`${label} must be between 1 and 200 characters.`);
  }
  return normalized;
}

export function getTenants(): Tenant[] {
  return store.get('tenants');
}

export function addTenant(input: TenantInput): Tenant {
  const tenant: Tenant = {
    id: crypto.randomUUID(),
    name: normalizeLabel(input.name, 'Tenant name'),
    domain: normalizeTenantDomain(input.domain),
  };
  const tenants = getTenants();
  tenants.push(tenant);
  store.set('tenants', tenants);
  return tenant;
}

export function updateTenant(id: string, input: TenantInput): Tenant {
  const tenants = getTenants();
  const index = tenants.findIndex((t) => t.id === id);
  if (index === -1) {
    throw new Error(`Tenant not found: ${id}`);
  }
  tenants[index] = {
    ...tenants[index],
    name: normalizeLabel(input.name, 'Tenant name'),
    domain: normalizeTenantDomain(input.domain),
  };
  store.set('tenants', tenants);
  return tenants[index];
}

export function removeTenant(id: string): void {
  const tenants = getTenants();
  const filtered = tenants.filter((t) => t.id !== id);
  store.set('tenants', filtered);

  const portals = migrateCustomPortals();
  store.set('customPortals', portals.filter((portal) => portal.tenantId !== id));

  const lastTabs = store.get('tenantLastTabs');
  delete lastTabs[id];
  store.set('tenantLastTabs', lastTabs);
}

// --- Custom Portal Sites ---

export function getCustomPortals(): CustomPortalSite[] {
  return migrateCustomPortals();
}

export function addCustomPortal(input: CustomPortalInput): CustomPortalSite {
  const tenant = getTenants().find((item) => item.id === input.tenantId);
  if (!tenant) {
    throw new Error(`Tenant not found: ${input.tenantId}`);
  }

  const label = normalizeLabel(input.label, 'Custom portal label');
  const url = normalizeHttpsUrl(input.url, 'Custom portal URL');

  const portal: CustomPortalSite = {
    id: crypto.randomUUID(),
    tenantId: tenant.id,
    label,
    url,
  };
  const portals = getCustomPortals();
  portals.push(portal);
  store.set('customPortals', portals);
  return portal;
}

export function updateCustomPortal(id: string, input: CustomPortalUpdateInput): CustomPortalSite {
  const portals = getCustomPortals();
  const index = portals.findIndex((portal) => portal.id === id);
  if (index === -1) {
    throw new Error(`Custom portal not found: ${id}`);
  }

  const label = normalizeLabel(input.label, 'Custom portal label');
  const url = normalizeHttpsUrl(input.url, 'Custom portal URL');

  portals[index] = {
    ...portals[index],
    label,
    url,
  };
  store.set('customPortals', portals);
  return portals[index];
}

export function moveCustomPortal(id: string, direction: CustomPortalMoveDirection): CustomPortalSite[] {
  if (direction !== 'left' && direction !== 'right') {
    throw new Error('Invalid custom portal move direction.');
  }
  const portals = getCustomPortals();
  const index = portals.findIndex((portal) => portal.id === id);
  if (index === -1) {
    throw new Error(`Custom portal not found: ${id}`);
  }

  const portal = portals[index];
  const siblingIndexes = portals
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => item.tenantId === portal.tenantId)
    .map(({ itemIndex }) => itemIndex);
  const localIndex = siblingIndexes.indexOf(index);
  const swapLocalIndex = direction === 'left' ? localIndex - 1 : localIndex + 1;
  const swapIndex = siblingIndexes[swapLocalIndex];

  if (swapIndex === undefined) {
    return portals;
  }

  [portals[index], portals[swapIndex]] = [portals[swapIndex], portals[index]];
  store.set('customPortals', portals);
  return portals;
}

export function removeCustomPortal(id: string): void {
  const portals = getCustomPortals();
  const filtered = portals.filter((portal) => portal.id !== id);
  store.set('customPortals', filtered);

  const removedTabId = `custom:${id}`;
  const lastTabs = store.get('tenantLastTabs');
  let changed = false;
  for (const [tenantId, tabId] of Object.entries(lastTabs)) {
    if (tabId === removedTabId) {
      lastTabs[tenantId] = 'admin';
      changed = true;
    }
  }
  if (changed) {
    store.set('tenantLastTabs', lastTabs);
  }
}

// --- Tenant Last Tabs ---

export function getTenantLastTabs(): TenantLastTabs {
  migrateCustomPortals();
  return cleanTenantLastTabs();
}

export function setTenantLastTab(tenantId: string, tabId: TenantTabId): void {
  const tenant = getTenants().find((item) => item.id === tenantId);
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  if (!isValidTenantTab(tenantId, tabId)) {
    throw new Error(`Invalid tab for tenant: ${tabId}`);
  }

  const lastTabs = getTenantLastTabs();
  lastTabs[tenantId] = tabId;
  store.set('tenantLastTabs', lastTabs);
}

// --- Tools ---

export function getTools(): ToolSite[] {
  return store.get('tools');
}

export function addTool(input: ToolInput): ToolSite {
  const tool: ToolSite = {
    id: crypto.randomUUID(),
    label: normalizeLabel(input.label, 'Tool label'),
    url: normalizeHttpsUrl(input.url, 'Tool URL'),
  };
  const tools = getTools();
  tools.push(tool);
  store.set('tools', tools);
  return tool;
}

export function removeTool(id: string): void {
  const tools = getTools();
  const filtered = tools.filter((t) => t.id !== id);
  store.set('tools', filtered);
}

// --- Window State ---

export function getWindowState(): WindowState {
  return store.get('windowState');
}

export function saveWindowState(state: WindowState): void {
  store.set('windowState', validateWindowState(state));
}

// --- Application preferences ---

export function getPreferences(): AppPreferences {
  return validateAppPreferences(store.get('preferences'));
}

export function updatePreferences(value: unknown): AppPreferences {
  const preferences = validateAppPreferences(value);
  store.set('preferences', preferences);
  return preferences;
}

// --- Configuration backup/restore ---

export function getConfiguration(): PersistedConfiguration {
  return structuredClone({
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    tenants: getTenants(),
    customPortals: getCustomPortals(),
    tenantLastTabs: getTenantLastTabs(),
    tools: getTools(),
    windowState: getWindowState(),
    preferences: getPreferences(),
  });
}

export function replaceConfiguration(value: unknown): PersistedConfiguration {
  const configuration = validateConfiguration(value);
  store.store = structuredClone(configuration);
  return configuration;
}
