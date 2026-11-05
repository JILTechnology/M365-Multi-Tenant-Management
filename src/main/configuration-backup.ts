import crypto from 'node:crypto';
import type {
  AppPreferences,
  CustomPortalSite,
  Tenant,
  TenantLastTabs,
  TenantTabId,
  ToolSite,
} from '../types/index';
import {
  PORTALS,
  getCustomPortalId,
  isCustomPortalTabId,
} from '../types/index';
import {
  customPortalPartition,
  normalizeHttpsUrl,
  normalizeTenantDomain,
} from './url-policy';

export const CONFIGURATION_SCHEMA_VERSION = 2;
export const CONFIGURATION_BACKUP_FORMAT = 'm365-multi-tenant-configuration';
export const CONFIGURATION_BACKUP_VERSION = 2;
export const ENCRYPTED_CONFIGURATION_BACKUP_FORMAT =
  'm365-multi-tenant-configuration-encrypted';
export const ENCRYPTED_CONFIGURATION_BACKUP_VERSION = 1;

export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = {
  contentProtection: false,
  hideOnLock: true,
  inactiveViewMinutes: 15,
  maxLiveViews: 8,
};

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const ENCRYPTION_KEY_BYTES = 32;

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface PersistedConfiguration {
  schemaVersion: typeof CONFIGURATION_SCHEMA_VERSION;
  tenants: Tenant[];
  customPortals: CustomPortalSite[];
  tenantLastTabs: TenantLastTabs;
  tools: ToolSite[];
  windowState: WindowState;
  preferences: AppPreferences;
}

export interface ConfigurationBackupFile {
  format: typeof CONFIGURATION_BACKUP_FORMAT;
  version: 1 | typeof CONFIGURATION_BACKUP_VERSION;
  createdAt: string;
  appVersion: string;
  configuration: PersistedConfiguration;
}

export interface EncryptedConfigurationBackupFile {
  format: typeof ENCRYPTED_CONFIGURATION_BACKUP_FORMAT;
  version: typeof ENCRYPTED_CONFIGURATION_BACKUP_VERSION;
  createdAt: string;
  appVersion: string;
  encryption: {
    algorithm: 'aes-256-gcm';
    kdf: 'scrypt';
    cost: typeof SCRYPT_COST;
    blockSize: typeof SCRYPT_BLOCK_SIZE;
    parallelization: typeof SCRYPT_PARALLELIZATION;
    salt: string;
    iv: string;
    authTag: string;
  };
  ciphertext: string;
}

export interface EntityChangeSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface ConfigurationRestorePreview {
  tenants: EntityChangeSummary;
  customPortals: EntityChangeSummary;
  tools: EntityChangeSummary;
  preferencesChanged: boolean;
  savedTabsChanged: boolean;
  windowStateChanged: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return trimmed;
}

function requireId(value: unknown, label: string): string {
  const id = requireString(value, label, 128);
  if (
    !/^[a-zA-Z0-9_-]+$/.test(id) ||
    ['__proto__', 'constructor', 'prototype'].includes(id.toLowerCase())
  ) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return id;
}

function requireUniqueIds(items: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate ${label} ID: ${item.id}`);
    }
    ids.add(item.id);
  }
}

function validateTenants(value: unknown): Tenant[] {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new Error('The tenant list is invalid.');
  }

  const tenants = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Tenant ${index + 1} is invalid.`);
    }
    return {
      id: requireId(item.id, `Tenant ${index + 1} ID`),
      name: requireString(item.name, `Tenant ${index + 1} name`, 200),
      domain: normalizeTenantDomain(
        requireString(item.domain, `Tenant ${index + 1} domain`, 253),
      ),
    };
  });
  requireUniqueIds(tenants, 'tenant');
  return tenants;
}

function migrateLegacyCustomPortals(
  value: unknown,
  tenants: Tenant[],
  sourceSchemaVersion: number,
): unknown {
  if (sourceSchemaVersion >= CONFIGURATION_SCHEMA_VERSION || !Array.isArray(value)) {
    return value;
  }

  const fallbackTenantId = tenants[0]?.id;
  return value.map((item) => {
    if (!fallbackTenantId || !isRecord(item) || item.tenantId !== undefined) {
      return item;
    }
    return { ...item, tenantId: fallbackTenantId };
  });
}

function validateCustomPortals(
  value: unknown,
  tenantIds: Set<string>,
): CustomPortalSite[] {
  if (!Array.isArray(value) || value.length > 5000) {
    throw new Error('The custom portal list is invalid.');
  }

  const portals = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Custom portal ${index + 1} is invalid.`);
    }
    const tenantId = requireId(item.tenantId, `Custom portal ${index + 1} tenant ID`);
    if (!tenantIds.has(tenantId)) {
      throw new Error(`Custom portal ${index + 1} references an unknown tenant.`);
    }
    return {
      id: requireId(item.id, `Custom portal ${index + 1} ID`),
      tenantId,
      label: requireString(item.label, `Custom portal ${index + 1} label`, 200),
      url: normalizeHttpsUrl(
        requireString(item.url, `Custom portal ${index + 1} URL`, 2048),
        `Custom portal ${index + 1} URL`,
      ),
    };
  });
  requireUniqueIds(portals, 'custom portal');
  return portals;
}

function validateTools(value: unknown): ToolSite[] {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new Error('The tool list is invalid.');
  }

  const tools = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Tool ${index + 1} is invalid.`);
    }
    return {
      id: requireId(item.id, `Tool ${index + 1} ID`),
      label: requireString(item.label, `Tool ${index + 1} label`, 200),
      url: normalizeHttpsUrl(
        requireString(item.url, `Tool ${index + 1} URL`, 2048),
        `Tool ${index + 1} URL`,
      ),
    };
  });
  requireUniqueIds(tools, 'tool');
  return tools;
}

function validateLastTabs(
  value: unknown,
  tenantIds: Set<string>,
  portals: CustomPortalSite[],
): TenantLastTabs {
  if (!isRecord(value) || Object.keys(value).length > 1000) {
    throw new Error('The saved tenant tabs are invalid.');
  }

  const portalOwners = new Map(portals.map((portal) => [portal.id, portal.tenantId]));
  const lastTabs: TenantLastTabs = {};
  for (const [tenantId, rawTabId] of Object.entries(value)) {
    if (!tenantIds.has(tenantId)) {
      throw new Error('A saved tenant tab references an unknown tenant.');
    }
    if (typeof rawTabId !== 'string' || rawTabId.length > 256) {
      throw new Error('A saved tenant tab is invalid.');
    }

    const tabId = rawTabId as TenantTabId;
    if (isCustomPortalTabId(tabId)) {
      const portalId = getCustomPortalId(tabId);
      if (portalOwners.get(portalId) !== tenantId) {
        throw new Error('A saved custom tab references an unknown portal.');
      }
    } else if (!Object.prototype.hasOwnProperty.call(PORTALS, tabId)) {
      throw new Error(`Unknown tenant tab: ${rawTabId}`);
    }
    lastTabs[tenantId] = tabId;
  }

  return lastTabs;
}

function validateFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function validateIntegerInRange(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const number = validateFiniteNumber(value, label);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  }
  return number;
}

export function validateWindowState(value: unknown): WindowState {
  if (!isRecord(value)) {
    throw new Error('The saved window state is invalid.');
  }

  const width = validateFiniteNumber(value.width, 'Window width');
  const height = validateFiniteNumber(value.height, 'Window height');
  if (width < 320 || width > 10000 || height < 240 || height > 10000) {
    throw new Error('The saved window dimensions are outside the allowed range.');
  }
  if (typeof value.isMaximized !== 'boolean') {
    throw new Error('The saved maximized state is invalid.');
  }

  const state: WindowState = {
    width,
    height,
    isMaximized: value.isMaximized,
  };
  if (value.x !== undefined) state.x = validateFiniteNumber(value.x, 'Window x position');
  if (value.y !== undefined) state.y = validateFiniteNumber(value.y, 'Window y position');
  return state;
}

export function validateAppPreferences(value: unknown): AppPreferences {
  const preferences = value === undefined ? {} : value;
  if (!isRecord(preferences)) {
    throw new Error('The saved application preferences are invalid.');
  }

  const contentProtection =
    preferences.contentProtection ?? DEFAULT_APP_PREFERENCES.contentProtection;
  const hideOnLock = preferences.hideOnLock ?? DEFAULT_APP_PREFERENCES.hideOnLock;
  if (typeof contentProtection !== 'boolean' || typeof hideOnLock !== 'boolean') {
    throw new Error('The saved privacy preferences are invalid.');
  }

  return {
    contentProtection,
    hideOnLock,
    inactiveViewMinutes: validateIntegerInRange(
      preferences.inactiveViewMinutes ?? DEFAULT_APP_PREFERENCES.inactiveViewMinutes,
      'Inactive view timeout',
      1,
      240,
    ),
    maxLiveViews: validateIntegerInRange(
      preferences.maxLiveViews ?? DEFAULT_APP_PREFERENCES.maxLiveViews,
      'Maximum live views',
      2,
      30,
    ),
  };
}

export function validateConfiguration(value: unknown): PersistedConfiguration {
  if (!isRecord(value)) {
    throw new Error('The backup configuration is invalid.');
  }

  const sourceSchemaVersion = value.schemaVersion === undefined
    ? 1
    : validateIntegerInRange(value.schemaVersion, 'Configuration schema version', 1, 1000);
  if (sourceSchemaVersion > CONFIGURATION_SCHEMA_VERSION) {
    throw new Error(
      `This configuration requires a newer app version (schema ${sourceSchemaVersion}).`,
    );
  }

  const tenants = validateTenants(value.tenants);
  const tenantIds = new Set(tenants.map((tenant) => tenant.id));
  const migratedPortals = migrateLegacyCustomPortals(
    value.customPortals,
    tenants,
    sourceSchemaVersion,
  );
  const customPortals = validateCustomPortals(migratedPortals, tenantIds);

  return {
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    tenants,
    customPortals,
    tenantLastTabs: validateLastTabs(value.tenantLastTabs, tenantIds, customPortals),
    tools: validateTools(value.tools),
    windowState: validateWindowState(value.windowState),
    preferences: validateAppPreferences(value.preferences),
  };
}

export const migrateConfiguration = validateConfiguration;

export function assertCompatibleSessionBindings(
  current: PersistedConfiguration,
  incoming: PersistedConfiguration,
): void {
  const currentTenants = new Map(
    current.tenants.map((tenant) => [tenant.id, tenant]),
  );
  for (const tenant of incoming.tenants) {
    const existing = currentTenants.get(tenant.id);
    if (
      existing &&
      normalizeTenantDomain(existing.domain) !== normalizeTenantDomain(tenant.domain)
    ) {
      throw new Error(
        `Tenant ID ${tenant.id} cannot be reassigned from ${existing.domain} to ${tenant.domain}.`,
      );
    }
  }

  const currentPortals = new Map(
    current.customPortals.map((portal) => [portal.id, portal]),
  );
  for (const portal of incoming.customPortals) {
    const existing = currentPortals.get(portal.id);
    if (!existing) continue;

    const existingPartition = customPortalPartition(
      existing.tenantId,
      existing.id,
      existing.url,
    );
    const incomingPartition = customPortalPartition(
      portal.tenantId,
      portal.id,
      portal.url,
    );
    const isolatedOriginChanged =
      existingPartition.startsWith('persist:custom-') &&
      new URL(existing.url).origin !== new URL(portal.url).origin;
    if (
      existing.tenantId !== portal.tenantId ||
      existingPartition !== incomingPartition ||
      isolatedOriginChanged
    ) {
      throw new Error(
        `Custom portal ID ${portal.id} cannot be reassigned to a different session.`,
      );
    }
  }

  const currentToolOrigins = new Map(
    current.tools.map((tool) => [tool.id, new URL(tool.url).origin]),
  );
  for (const tool of incoming.tools) {
    const currentOrigin = currentToolOrigins.get(tool.id);
    const incomingOrigin = new URL(tool.url).origin;
    if (currentOrigin && currentOrigin !== incomingOrigin) {
      throw new Error(
        `Tool ID ${tool.id} cannot be reassigned from ${currentOrigin} to ${incomingOrigin}.`,
      );
    }
  }
}

export function createConfigurationBackupFile(
  configuration: PersistedConfiguration,
  appVersion: string,
  createdAt = new Date(),
): ConfigurationBackupFile {
  return {
    format: CONFIGURATION_BACKUP_FORMAT,
    version: CONFIGURATION_BACKUP_VERSION,
    createdAt: createdAt.toISOString(),
    appVersion,
    configuration: validateConfiguration(configuration),
  };
}

export function parseConfigurationBackupFile(value: unknown): ConfigurationBackupFile {
  if (!isRecord(value)) {
    throw new Error('The selected file is not a configuration backup.');
  }
  if (value.format !== CONFIGURATION_BACKUP_FORMAT) {
    throw new Error('The selected file is not an M365 Multi Tenant Management backup.');
  }
  if (value.version !== 1 && value.version !== CONFIGURATION_BACKUP_VERSION) {
    throw new Error(`Unsupported configuration backup version: ${String(value.version)}`);
  }

  const createdAt = requireString(value.createdAt, 'Backup creation date', 64);
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error('The backup creation date is invalid.');
  }

  return {
    format: CONFIGURATION_BACKUP_FORMAT,
    version: value.version,
    createdAt,
    appVersion: requireString(value.appVersion, 'Backup app version', 64),
    configuration: validateConfiguration(value.configuration),
  };
}

function requirePassphrase(value: string): string {
  if (typeof value !== 'string' || value.trim().length < 12 || value.length > 1024) {
    throw new Error('Backup passwords must be between 12 and 1024 characters.');
  }
  return value;
}

function encryptionAad(
  createdAt: string,
  appVersion: string,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      format: ENCRYPTED_CONFIGURATION_BACKUP_FORMAT,
      version: ENCRYPTED_CONFIGURATION_BACKUP_VERSION,
      createdAt,
      appVersion,
    }),
    'utf8',
  );
}

async function deriveEncryptionKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      requirePassphrase(passphrase),
      salt,
      ENCRYPTION_KEY_BYTES,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

function decodeBase64(value: unknown, label: string, expectedBytes?: number): Buffer {
  const encoded = requireString(value, label, 10 * 1024 * 1024);
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`${label} is invalid.`);
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    throw new Error(`${label} is invalid.`);
  }
  return decoded;
}

function parseEncryptedEnvelope(value: unknown): EncryptedConfigurationBackupFile {
  if (!isRecord(value) || value.format !== ENCRYPTED_CONFIGURATION_BACKUP_FORMAT) {
    throw new Error('The selected file is not a password-protected configuration backup.');
  }
  if (value.version !== ENCRYPTED_CONFIGURATION_BACKUP_VERSION) {
    throw new Error(`Unsupported encrypted backup version: ${String(value.version)}`);
  }
  if (!isRecord(value.encryption)) {
    throw new Error('The encrypted backup settings are invalid.');
  }
  const encryption = value.encryption;
  if (
    encryption.algorithm !== 'aes-256-gcm' ||
    encryption.kdf !== 'scrypt' ||
    encryption.cost !== SCRYPT_COST ||
    encryption.blockSize !== SCRYPT_BLOCK_SIZE ||
    encryption.parallelization !== SCRYPT_PARALLELIZATION
  ) {
    throw new Error('The encrypted backup uses unsupported security settings.');
  }

  const createdAt = requireString(value.createdAt, 'Backup creation date', 64);
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error('The backup creation date is invalid.');
  }
  const appVersion = requireString(value.appVersion, 'Backup app version', 64);
  const salt = decodeBase64(encryption.salt, 'Encryption salt', 16);
  const iv = decodeBase64(encryption.iv, 'Encryption IV', 12);
  const authTag = decodeBase64(encryption.authTag, 'Encryption authentication tag', 16);
  const ciphertext = decodeBase64(value.ciphertext, 'Encrypted backup payload');
  if (ciphertext.length === 0 || ciphertext.length > 5 * 1024 * 1024) {
    throw new Error('The encrypted backup payload is invalid.');
  }

  return {
    format: ENCRYPTED_CONFIGURATION_BACKUP_FORMAT,
    version: ENCRYPTED_CONFIGURATION_BACKUP_VERSION,
    createdAt,
    appVersion,
    encryption: {
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      cost: SCRYPT_COST,
      blockSize: SCRYPT_BLOCK_SIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
  };
}

export function isEncryptedConfigurationBackupFile(value: unknown): boolean {
  return isRecord(value) && value.format === ENCRYPTED_CONFIGURATION_BACKUP_FORMAT;
}

export async function createEncryptedConfigurationBackupFile(
  configuration: PersistedConfiguration,
  appVersion: string,
  passphrase: string,
  createdAt = new Date(),
): Promise<EncryptedConfigurationBackupFile> {
  const backup = createConfigurationBackupFile(configuration, appVersion, createdAt);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveEncryptionKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(encryptionAad(backup.createdAt, backup.appVersion));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(backup), 'utf8'),
    cipher.final(),
  ]);

  return {
    format: ENCRYPTED_CONFIGURATION_BACKUP_FORMAT,
    version: ENCRYPTED_CONFIGURATION_BACKUP_VERSION,
    createdAt: backup.createdAt,
    appVersion: backup.appVersion,
    encryption: {
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      cost: SCRYPT_COST,
      blockSize: SCRYPT_BLOCK_SIZE,
      parallelization: SCRYPT_PARALLELIZATION,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
  };
}

export async function decryptConfigurationBackupFile(
  value: unknown,
  passphrase: string,
): Promise<ConfigurationBackupFile> {
  const envelope = parseEncryptedEnvelope(value);
  const salt = Buffer.from(envelope.encryption.salt, 'base64');
  const iv = Buffer.from(envelope.encryption.iv, 'base64');
  const authTag = Buffer.from(envelope.encryption.authTag, 'base64');
  const key = await deriveEncryptionKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(encryptionAad(envelope.createdAt, envelope.appVersion));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return parseConfigurationBackupFile(JSON.parse(plaintext) as unknown);
}

function summarizeEntities<T extends { id: string }>(
  current: T[],
  incoming: T[],
  labelFor: (item: T) => string,
): EntityChangeSummary {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const added = incoming
    .filter((item) => !currentById.has(item.id))
    .map(labelFor)
    .sort();
  const removed = current
    .filter((item) => !incomingById.has(item.id))
    .map(labelFor)
    .sort();
  const changed = incoming
    .filter((item) => {
      const existing = currentById.get(item.id);
      return existing !== undefined && JSON.stringify(existing) !== JSON.stringify(item);
    })
    .map(labelFor)
    .sort();
  return { added, removed, changed };
}

export function createConfigurationRestorePreview(
  current: PersistedConfiguration,
  incoming: PersistedConfiguration,
): ConfigurationRestorePreview {
  return {
    tenants: summarizeEntities(current.tenants, incoming.tenants, (item) => item.name),
    customPortals: summarizeEntities(
      current.customPortals,
      incoming.customPortals,
      (item) => item.label,
    ),
    tools: summarizeEntities(current.tools, incoming.tools, (item) => item.label),
    preferencesChanged:
      JSON.stringify(current.preferences) !== JSON.stringify(incoming.preferences),
    savedTabsChanged:
      JSON.stringify(current.tenantLastTabs) !== JSON.stringify(incoming.tenantLastTabs),
    windowStateChanged:
      JSON.stringify(current.windowState) !== JSON.stringify(incoming.windowState),
  };
}

function formatEntitySummary(label: string, summary: EntityChangeSummary): string {
  const counts = `${summary.added.length} added, ${summary.removed.length} removed, ${summary.changed.length} changed`;
  const names = [
    ...summary.added.map((name) => `+ ${name}`),
    ...summary.removed.map((name) => `- ${name}`),
    ...summary.changed.map((name) => `~ ${name}`),
  ].slice(0, 8);
  return names.length > 0
    ? `${label}: ${counts}\n  ${names.join('\n  ')}`
    : `${label}: no changes`;
}

export function formatConfigurationRestorePreview(
  preview: ConfigurationRestorePreview,
): string {
  return [
    formatEntitySummary('Tenants', preview.tenants),
    formatEntitySummary('Custom portals', preview.customPortals),
    formatEntitySummary('Tools', preview.tools),
    `Saved tab selections: ${preview.savedTabsChanged ? 'will change' : 'no changes'}`,
    `Window settings: ${preview.windowStateChanged ? 'will change' : 'no changes'}`,
    `Security and performance settings: ${preview.preferencesChanged ? 'will change' : 'no changes'}`,
  ].join('\n\n');
}
