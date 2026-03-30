import type { Tenant } from '../../types/index';

interface SidebarProps {
  tenants: Tenant[];
  activeTenantId: string | null;
  onSelectTenant: (tenantId: string) => void;
}

function getTenantColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

export default function Sidebar({ tenants, activeTenantId, onSelectTenant }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Tenants</h2>
      </div>
      <div className="sidebar-list">
        {tenants.map((tenant) => (
          <button
            key={tenant.id}
            className={`sidebar-item ${tenant.id === activeTenantId ? 'active' : ''}`}
            onClick={() => onSelectTenant(tenant.id)}
          >
            <span
              className="sidebar-item-dot"
              style={{ backgroundColor: getTenantColor(tenant.id) }}
            />
            <div className="sidebar-item-text">
              <span className="sidebar-item-name">{tenant.name}</span>
              <span className="sidebar-item-domain">{tenant.domain}</span>
            </div>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-add-btn" disabled title="Coming soon">
          + Add Tenant
        </button>
      </div>
    </div>
  );
}
