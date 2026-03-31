import Store from 'electron-store';
import crypto from 'node:crypto';
import type { Tenant, TenantInput, ToolSite, ToolInput } from '../types/index';
import { TOOL_SITES } from '../types/index';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

interface StoreSchema {
  tenants: Tenant[];
  tools: ToolSite[];
  windowState: WindowState;
}

const store = new Store<StoreSchema>({
  name: 'tenants',
  defaults: {
    tenants: [],
    tools: TOOL_SITES,
    windowState: { width: 1200, height: 800, isMaximized: false },
  },
});

export function getTenants(): Tenant[] {
  return store.get('tenants');
}

export function addTenant(input: TenantInput): Tenant {
  const tenant: Tenant = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    domain: input.domain.trim(),
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
    name: input.name.trim(),
    domain: input.domain.trim(),
  };
  store.set('tenants', tenants);
  return tenants[index];
}

export function removeTenant(id: string): void {
  const tenants = getTenants();
  const filtered = tenants.filter((t) => t.id !== id);
  store.set('tenants', filtered);
}

// --- Tools ---

export function getTools(): ToolSite[] {
  return store.get('tools');
}

export function addTool(input: ToolInput): ToolSite {
  const tool: ToolSite = {
    id: crypto.randomUUID(),
    label: input.label.trim(),
    url: input.url.trim(),
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
  store.set('windowState', state);
}
