import { useEffect, useState } from 'react';

interface BackupPasswordDialogProps {
  mode: 'backup' | 'restore';
  open: boolean;
  externalError?: string;
  onCancel: () => void;
  onSubmit: (encrypted: boolean, passphrase?: string) => void | Promise<void>;
}

export default function BackupPasswordDialog({
  mode,
  open,
  externalError,
  onCancel,
  onSubmit,
}: BackupPasswordDialogProps) {
  const [encrypted, setEncrypted] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEncrypted(true);
    setPassphrase('');
    setConfirmation('');
    setError('');
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (externalError) setError(externalError);
  }, [externalError]);

  if (!open) return null;

  const passwordRequired = mode === 'restore' || encrypted;

  const handleSubmit = async () => {
    if (passwordRequired && passphrase.trim().length < 12) {
      setError('Use at least 12 characters.');
      return;
    }
    if (mode === 'backup' && encrypted && passphrase !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setError('');
    setBusy(true);
    try {
      await onSubmit(mode === 'restore' ? true : encrypted, passwordRequired ? passphrase : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <div className="password-dialog">
        <div className="modal-header">
          <h2>{mode === 'backup' ? 'Configuration Backup' : 'Unlock Backup'}</h2>
          <button type="button" onClick={onCancel} disabled={busy}>Close</button>
        </div>
        {mode === 'backup' && (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={encrypted}
              onChange={(event) => setEncrypted(event.target.checked)}
              disabled={busy}
            />
            <span>Password protection</span>
          </label>
        )}
        {passwordRequired && (
          <div className="password-fields">
            <label>
              Backup password
              <input
                autoFocus
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(event) => {
                  setPassphrase(event.target.value);
                  setError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && mode === 'restore') void handleSubmit();
                  if (event.key === 'Escape' && !busy) onCancel();
                }}
                disabled={busy}
              />
            </label>
            {mode === 'backup' && (
              <label>
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => {
                    setConfirmation(event.target.value);
                    setError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleSubmit();
                    if (event.key === 'Escape' && !busy) onCancel();
                  }}
                  disabled={busy}
                />
              </label>
            )}
          </div>
        )}
        {!encrypted && mode === 'backup' && (
          <div className="inline-warning">
            The backup will contain tenant names, domains, and portal URLs without encryption.
          </div>
        )}
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? 'Working...' : mode === 'backup' ? 'Save Backup' : 'Unlock and Preview'}
          </button>
        </div>
      </div>
    </div>
  );
}
