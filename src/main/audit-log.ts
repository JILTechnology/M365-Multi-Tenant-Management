import crypto from 'node:crypto';
import Store from 'electron-store';
import type { AuditEntry, AuditOutcome } from '../types/index';

const MAX_AUDIT_ENTRIES = 500;

interface AuditStoreSchema {
  entries: AuditEntry[];
}

export interface AuditInput {
  action: string;
  outcome: AuditOutcome;
  target?: string;
  detail?: string;
}

const auditStore = new Store<AuditStoreSchema>({
  name: 'audit-log',
  defaults: { entries: [] },
});

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function isAuditOutcome(value: unknown): value is AuditOutcome {
  return ['success', 'canceled', 'blocked', 'failed'].includes(String(value));
}

function isAuditEntry(value: unknown): value is AuditEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.timestamp === 'string' &&
    Number.isFinite(Date.parse(entry.timestamp)) &&
    typeof entry.action === 'string' &&
    isAuditOutcome(entry.outcome) &&
    (entry.target === undefined || typeof entry.target === 'string') &&
    (entry.detail === undefined || typeof entry.detail === 'string')
  );
}

export function recordAudit(input: AuditInput): AuditEntry | null {
  try {
    const action = cleanText(input.action, 100);
    if (!action) return null;
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      outcome: input.outcome,
    };
    const target = input.target ? cleanText(input.target, 200) : '';
    const detail = input.detail ? cleanText(input.detail, 300) : '';
    if (target) entry.target = target;
    if (detail) entry.detail = detail;

    const entries = auditStore.get('entries').filter(isAuditEntry);
    entries.unshift(entry);
    auditStore.set('entries', entries.slice(0, MAX_AUDIT_ENTRIES));
    return entry;
  } catch {
    // Audit logging must never break the operation being recorded.
    return null;
  }
}

export function getRecentAuditEntries(limit = 100): AuditEntry[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_AUDIT_ENTRIES);
  return structuredClone(
    auditStore.get('entries').filter(isAuditEntry).slice(0, safeLimit),
  );
}

export function clearAuditEntries(): void {
  auditStore.set('entries', []);
}
