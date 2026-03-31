import { useState } from 'react';
import type { Tenant } from '../../types/index';

interface EditTenantFormProps {
  tenant: Tenant;
  onSave: (name: string, domain: string) => void;
  onCancel: () => void;
}

export default function EditTenantForm({ tenant, onSave, onCancel }: EditTenantFormProps) {
  const [name, setName] = useState(tenant.name);
  const [domain, setDomain] = useState(tenant.domain);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && domain.trim()) {
      onSave(name.trim(), domain.trim());
    }
  };

  return (
    <form className="tenant-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Tenant name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <input
        type="text"
        placeholder="domain.onmicrosoft.com"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
      />
      <div className="tenant-form-actions">
        <button type="submit" className="btn-save" disabled={!name.trim() || !domain.trim()}>
          Save
        </button>
        <button type="button" className="btn-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
