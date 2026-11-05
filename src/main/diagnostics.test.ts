import { describe, expect, it } from 'vitest';
import { createDiagnosticsReport } from './diagnostics';

describe('diagnostics report', () => {
  it('contains operational counts without client identifiers or URLs', () => {
    const report = createDiagnosticsReport({
      appVersion: '0.1.5',
      schemaVersion: 2,
      tenantCount: 3,
      customPortalCount: 4,
      toolCount: 2,
      preferences: {
        contentProtection: false,
        hideOnLock: true,
        inactiveViewMinutes: 15,
        maxLiveViews: 8,
      },
      windowCount: 1,
      liveViewCount: 2,
      recentAuditEntries: [
        {
          id: 'entry-1',
          timestamp: '2026-08-14T12:00:00.000Z',
          action: 'tenant.update',
          outcome: 'success',
          target: 'Secret Client',
          detail: 'secretclient.onmicrosoft.com',
        },
      ],
      generatedAt: new Date('2026-08-14T12:00:00.000Z'),
    });

    const serialized = JSON.stringify(report);
    expect(serialized).toContain('"tenantCount":3');
    expect(serialized).not.toContain('Secret Client');
    expect(serialized).not.toContain('secretclient.onmicrosoft.com');
  });
});
