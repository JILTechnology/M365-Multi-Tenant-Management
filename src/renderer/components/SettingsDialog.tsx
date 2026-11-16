import { useEffect, useState } from 'react';
import { CLAUDE_CONTROL_PORT } from '../../types/index';
import type { AppPreferences, AuditEntry, DataActionResult } from '../../types/index';

interface SettingsDialogProps {
  open: boolean;
  appVersion: string;
  claudeControlActive: boolean;
  preferences: AppPreferences;
  onClose: () => void;
  onSave: (preferences: AppPreferences) => Promise<void>;
  onBackup: () => void;
  onRestore: () => void;
}

const RELEASE_NOTES = [
  'The sidebar now shows each tenant and tool logo from its own website instead of a colored dot.',
  'Updated Electron to 43.8.10 for its latest security fixes.',
  'Added an Exchange PowerShell tab for tenants set up with certificate sign-in; it opens inside the app already connected.',
  'Added an optional Claude Control setting so Claude can operate tenant portals in this app.',
];

export default function SettingsDialog({
  open,
  appVersion,
  claudeControlActive,
  preferences,
  onClose,
  onSave,
  onBackup,
  onRestore,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(preferences);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refreshEntries = async () => {
    setEntries(await window.electronAPI.getRecentAuditEntries(30));
  };

  useEffect(() => {
    if (!open) return;
    setDraft(preferences);
    setStatus('');
    void refreshEntries();
  }, [open, preferences]);

  useEffect(() => {
    if (!open) return;
    return window.electronAPI.onDataChanged((notice) => {
      if (notice.scope === 'audit' || notice.scope === 'all') {
        void refreshEntries();
      }
    });
  }, [open]);

  if (!open) return null;

  const runDataAction = async (operation: () => Promise<DataActionResult>) => {
    setBusy(true);
    setStatus('');
    try {
      const result = await operation();
      if (result.ok) {
        setStatus(result.path ? `${result.message} ${result.path}` : result.message);
      } else if (!/canceled/i.test(result.message)) {
        setStatus(result.message);
      }
      await refreshEntries();
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    setStatus('');
    try {
      await onSave(draft);
      setStatus(
        draft.claudeControl !== claudeControlActive
          ? 'Settings saved. Restart the app to apply the Claude control change.'
          : 'Settings saved.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="settings-dialog">
        <div className="modal-header">
          <div>
            <h2>Settings</h2>
            <span className="version-label">Version {appVersion || 'unknown'}</span>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>Close</button>
        </div>

        <div className="settings-scroll">
          <section className="settings-section">
            <h3>Privacy</h3>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.contentProtection}
                onChange={(event) => setDraft({ ...draft, contentProtection: event.target.checked })}
              />
              <span>Block screenshots and screen capture</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.hideOnLock}
                onChange={(event) => setDraft({ ...draft, hideOnLock: event.target.checked })}
              />
              <span>Hide app windows when Windows locks</span>
            </label>
          </section>

          <section className="settings-section">
            <h3>Claude Control</h3>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.claudeControl}
                onChange={(event) => setDraft({ ...draft, claudeControl: event.target.checked })}
              />
              <span>Let Claude operate this app (local port {CLAUDE_CONTROL_PORT})</span>
            </label>
            <p className="settings-note">
              While on, any program running on this PC can control every signed-in tenant
              session. Applies after restarting the app. Currently {claudeControlActive ? 'on' : 'off'}.
            </p>
          </section>

          <section className="settings-section">
            <h3>Performance</h3>
            <div className="number-settings">
              <label>
                Close hidden pages after
                <span className="number-input-row">
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={draft.inactiveViewMinutes}
                    onChange={(event) => setDraft({
                      ...draft,
                      inactiveViewMinutes: Number(event.target.value),
                    })}
                  />
                  minutes
                </span>
              </label>
              <label>
                Maximum open pages
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={draft.maxLiveViews}
                  onChange={(event) => setDraft({
                    ...draft,
                    maxLiveViews: Number(event.target.value),
                  })}
                />
              </label>
            </div>
            <button type="button" className="primary-button compact-button" onClick={() => void handleSave()} disabled={busy}>
              Save Settings
            </button>
          </section>

          <section className="settings-section">
            <h3>Data</h3>
            <div className="settings-action-row">
              <button type="button" onClick={onBackup} disabled={busy}>Backup</button>
              <button type="button" onClick={onRestore} disabled={busy}>Restore</button>
              <button type="button" onClick={() => void runDataAction(() => window.electronAPI.exportAuditLog())} disabled={busy}>
                Export History
              </button>
              <button type="button" onClick={() => void runDataAction(() => window.electronAPI.exportDiagnostics())} disabled={busy}>
                Export Diagnostics
              </button>
              <button type="button" className="danger-button" onClick={() => void runDataAction(() => window.electronAPI.clearAuditLog())} disabled={busy}>
                Clear History
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Recent Activity</h3>
            <div className="audit-list">
              {entries.length === 0 ? (
                <div className="audit-empty">No activity recorded.</div>
              ) : entries.map((entry) => (
                <div className="audit-row" key={entry.id}>
                  <time>{new Date(entry.timestamp).toLocaleString()}</time>
                  <span className={`audit-outcome ${entry.outcome}`}>{entry.outcome}</span>
                  <strong>{entry.action}</strong>
                  <span>{entry.target ?? entry.detail ?? ''}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section release-section">
            <h3>What Changed in {appVersion || 'this version'}</h3>
            <ul>
              {RELEASE_NOTES.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        </div>
        {status && <div className="settings-status">{status}</div>}
      </div>
    </div>
  );
}
