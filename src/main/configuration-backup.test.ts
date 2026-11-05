import { describe, expect, it } from 'vitest';
import {
  CONFIGURATION_SCHEMA_VERSION,
  CONFIGURATION_BACKUP_FORMAT,
  CONFIGURATION_BACKUP_VERSION,
  assertCompatibleSessionBindings,
  createConfigurationBackupFile,
  createConfigurationRestorePreview,
  createEncryptedConfigurationBackupFile,
  decryptConfigurationBackupFile,
  formatConfigurationRestorePreview,
  migrateConfiguration,
  parseConfigurationBackupFile,
  validateConfiguration,
} from './configuration-backup';
import type { PersistedConfiguration } from './configuration-backup';

const configuration: PersistedConfiguration = {
  schemaVersion: CONFIGURATION_SCHEMA_VERSION,
  tenants: [
    {
      id: '7ce299b1-fd5c-47ce-a5c2-c52294f428cc',
      name: 'Contoso',
      domain: 'contoso.onmicrosoft.com',
    },
  ],
  customPortals: [
    {
      id: 'e4cbb4cf-ab5a-40ea-a1cf-0ce213b51757',
      tenantId: '7ce299b1-fd5c-47ce-a5c2-c52294f428cc',
      label: 'Power Platform',
      url: 'https://admin.powerplatform.microsoft.com/',
    },
  ],
  tenantLastTabs: {
    '7ce299b1-fd5c-47ce-a5c2-c52294f428cc':
      'custom:e4cbb4cf-ab5a-40ea-a1cf-0ce213b51757',
  },
  tools: [
    {
      id: 'pax8',
      label: 'Pax8',
      url: 'https://app.pax8.com/',
    },
  ],
  windowState: {
    x: 40,
    y: 50,
    width: 1200,
    height: 800,
    isMaximized: false,
  },
  preferences: {
    contentProtection: false,
    hideOnLock: true,
    inactiveViewMinutes: 15,
    maxLiveViews: 8,
  },
};

describe('configuration backups', () => {
  it('round-trips validated configuration without changing partition IDs', () => {
    const backup = createConfigurationBackupFile(
      configuration,
      '0.1.3',
      new Date('2026-08-14T12:00:00.000Z'),
    );
    const parsed = parseConfigurationBackupFile(
      JSON.parse(JSON.stringify(backup)),
    );

    expect(parsed.format).toBe(CONFIGURATION_BACKUP_FORMAT);
    expect(parsed.version).toBe(CONFIGURATION_BACKUP_VERSION);
    expect(parsed.configuration).toEqual(configuration);
    expect(parsed.configuration.tenants[0].id).toBe(configuration.tenants[0].id);
  });

  it('does not serialize browser profile or session fields', () => {
    const serialized = JSON.stringify(
      createConfigurationBackupFile(configuration, '0.1.3'),
    );
    expect(serialized).not.toContain('"cookies"');
    expect(serialized).not.toContain('Local Storage');
    expect(serialized).not.toContain('Network Persistent State');
  });

  it('migrates legacy configuration without changing tenant or portal IDs', () => {
    const legacy = structuredClone(configuration) as unknown as Record<string, unknown>;
    delete legacy.schemaVersion;
    delete legacy.preferences;

    const migrated = migrateConfiguration(legacy);
    expect(migrated.schemaVersion).toBe(CONFIGURATION_SCHEMA_VERSION);
    expect(migrated.tenants[0].id).toBe(configuration.tenants[0].id);
    expect(migrated.customPortals[0].id).toBe(configuration.customPortals[0].id);
    expect(migrated.preferences.hideOnLock).toBe(true);
  });

  it('rejects configuration from a newer unsupported schema', () => {
    const future = { ...structuredClone(configuration), schemaVersion: 999 };
    expect(() => validateConfiguration(future)).toThrow(/newer app version/i);
  });

  it('encrypts and decrypts a portable backup without exposing configuration', async () => {
    const encrypted = await createEncryptedConfigurationBackupFile(
      configuration,
      '0.1.5',
      'correct horse battery staple',
      new Date('2026-08-14T12:00:00.000Z'),
    );
    const serialized = JSON.stringify(encrypted);
    expect(serialized).not.toContain('contoso.onmicrosoft.com');
    expect(serialized).not.toContain('Power Platform');

    const decrypted = await decryptConfigurationBackupFile(
      JSON.parse(serialized),
      'correct horse battery staple',
    );
    expect(decrypted.configuration).toEqual(configuration);
  });

  it('rejects an incorrect backup password and tampered ciphertext', async () => {
    const encrypted = await createEncryptedConfigurationBackupFile(
      configuration,
      '0.1.5',
      'correct horse battery staple',
    );
    await expect(
      decryptConfigurationBackupFile(encrypted, 'incorrect password value'),
    ).rejects.toThrow();

    const tampered = structuredClone(encrypted);
    tampered.ciphertext = `${tampered.ciphertext.slice(0, -4)}AAAA`;
    await expect(
      decryptConfigurationBackupFile(tampered, 'correct horse battery staple'),
    ).rejects.toThrow();
  });

  it('builds a readable restore preview before applying changes', () => {
    const incoming = structuredClone(configuration);
    incoming.tenants[0].name = 'Contoso Updated';
    incoming.tools.push({
      id: 'new-tool',
      label: 'New Tool',
      url: 'https://example.com/',
    });
    incoming.preferences.contentProtection = true;

    const preview = createConfigurationRestorePreview(configuration, incoming);
    expect(preview.tenants.changed).toEqual(['Contoso Updated']);
    expect(preview.tools.added).toEqual(['New Tool']);
    expect(preview.preferencesChanged).toBe(true);
    expect(formatConfigurationRestorePreview(preview)).toMatch(/1 added/i);
  });

  it('rejects unknown tenant references', () => {
    const invalid = structuredClone(configuration);
    invalid.customPortals[0].tenantId = 'unknown-tenant';
    expect(() => validateConfiguration(invalid)).toThrow(/unknown tenant/i);
  });

  it('rejects HTTP URLs and embedded credentials', () => {
    const insecure = structuredClone(configuration);
    insecure.tools[0].url = 'http://app.pax8.com/';
    expect(() => validateConfiguration(insecure)).toThrow(/HTTPS/i);

    const credentialed = structuredClone(configuration);
    credentialed.customPortals[0].url =
      'https://username:password@example.com/';
    expect(() => validateConfiguration(credentialed)).toThrow(
      /embedded credentials/i,
    );
  });

  it('rejects malformed backup envelopes', () => {
    expect(() =>
      parseConfigurationBackupFile({
        format: CONFIGURATION_BACKUP_FORMAT,
        version: 999,
        createdAt: new Date().toISOString(),
        appVersion: '0.1.3',
        configuration,
      }),
    ).toThrow(/Unsupported configuration backup version/i);
  });

  it('rejects prototype-sensitive IDs', () => {
    const invalid = structuredClone(configuration);
    invalid.tenants[0].id = '__proto__';
    invalid.customPortals[0].tenantId = '__proto__';
    expect(() => validateConfiguration(invalid)).toThrow(
      /unsupported characters/i,
    );
  });

  it('rejects tenant IDs rebound to a different domain', () => {
    const incoming = structuredClone(configuration);
    incoming.tenants[0].domain = 'fabrikam.onmicrosoft.com';
    expect(() =>
      assertCompatibleSessionBindings(configuration, incoming),
    ).toThrow(/cannot be reassigned/i);
  });

  it('rejects tool or portal IDs rebound to a different origin', () => {
    const changedTool = structuredClone(configuration);
    changedTool.tools[0].url = 'https://portal.example.com/';
    expect(() =>
      assertCompatibleSessionBindings(configuration, changedTool),
    ).toThrow(/Tool ID.*cannot be reassigned/i);

    const changedPortal = structuredClone(configuration);
    changedPortal.customPortals[0].url = 'https://example.com/';
    expect(() =>
      assertCompatibleSessionBindings(configuration, changedPortal),
    ).toThrow(/Custom portal ID.*different session/i);
  });

  it('allows one Microsoft custom portal origin to replace another', () => {
    const changedPortal = structuredClone(configuration);
    changedPortal.customPortals[0].url = 'https://admin.microsoft.com/';
    expect(() =>
      assertCompatibleSessionBindings(configuration, changedPortal),
    ).not.toThrow();
  });
});
