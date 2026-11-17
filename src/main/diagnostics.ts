import os from 'node:os';
import type { AppPreferences, AuditEntry } from '../types/index';

export const DIAGNOSTICS_FORMAT = 'm365-multi-tenant-diagnostics';
export const DIAGNOSTICS_VERSION = 1;

export interface DiagnosticsInput {
  appVersion: string;
  schemaVersion: number;
  tenantCount: number;
  customPortalCount: number;
  toolCount: number;
  preferences: AppPreferences;
  windowCount: number;
  liveViewCount: number;
  recentAuditEntries: AuditEntry[];
  generatedAt?: Date;
}

export function createDiagnosticsReport(input: DiagnosticsInput) {
  return {
    format: DIAGNOSTICS_FORMAT,
    version: DIAGNOSTICS_VERSION,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    application: {
      version: input.appVersion,
      configurationSchema: input.schemaVersion,
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node,
    },
    system: {
      platform: process.platform,
      architecture: process.arch,
      release: os.release(),
    },
    inventory: {
      tenantCount: input.tenantCount,
      customPortalCount: input.customPortalCount,
      toolCount: input.toolCount,
      windowCount: input.windowCount,
      liveViewCount: input.liveViewCount,
    },
    preferences: { ...input.preferences },
    recentActivity: input.recentAuditEntries.slice(0, 50).map((entry) => ({
      timestamp: entry.timestamp,
      action: entry.action,
      outcome: entry.outcome,
    })),
    redaction: {
      tenantNames: 'omitted',
      domainsAndUrls: 'omitted',
      browserSessions: 'omitted',
      localPaths: 'omitted',
    },
  };
}
