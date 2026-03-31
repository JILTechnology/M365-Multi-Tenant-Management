import Store from 'electron-store';
import crypto from 'node:crypto';
import type { Tenant, TenantInput } from '../types/index';

interface StoreSchema {
  tenants: Tenant[];
}

const store = new Store<StoreSchema>({
  name: 'tenants',
  defaults: {
    tenants: [],
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
