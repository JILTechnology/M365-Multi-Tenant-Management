import { useState } from 'react';
import type { Tenant } from '../../types/index';

interface EditTenantFormProps {
  tenant: Tenant;
  onSave: (name: string, domain: string) => void | Promise<void>;
  onCancel: () => void;
}

export default function EditTenantForm({ tenant, onSave, onCancel }: EditTenantFormProps) {
  const [name, setName] = useState(tenant.name);
  const [domain, setDomain] = useState(tenant.domain);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !domain.trim() || isSaving) return;
    setError('');
    setIsSaving(true);
    try {
      await onSave(name.trim(), domain.trim());
    } catch {
      setError('Enter a valid tenant name and DNS domain.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="tenant-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Tenant name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError('');
        }}
        autoFocus
      />
      <input
        type="text"
        placeholder="domain.onmicrosoft.com"
        value={domain}
        onChange={(e) => {
          setDomain(e.target.value);
          setError('');
        }}
      />
      {error && <div className="tab-add-error">{error}</div>}
      <div className="tenant-form-actions">
        <button
          type="submit"
          className="btn-save"
          disabled={!name.trim() || !domain.trim() || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="btn-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
