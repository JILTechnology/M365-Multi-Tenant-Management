import { useState, useRef, useEffect } from 'react';
import type { Tenant } from '../../types/index';
import AddTenantForm from './AddTenantForm';
import EditTenantForm from './EditTenantForm';

interface SidebarProps {
  tenants: Tenant[];
  activeTenantId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTenant: (tenantId: string) => void;
  onAddTenant: (name: string, domain: string) => void;
  onUpdateTenant: (id: string, name: string, domain: string) => void;
  onRemoveTenant: (id: string) => void;
}

function getTenantColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function getInitials(name: string): string {
  return name
    .split(/[\s\-_&]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function Sidebar({
  tenants,
  activeTenantId,
  collapsed,
  onToggleCollapse,
  onSelectTenant,
  onAddTenant,
  onUpdateTenant,
  onRemoveTenant,
}: SidebarProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpenId]);

  // Close forms when collapsing
  useEffect(() => {
    if (collapsed) {
      setShowAddForm(false);
      setEditingId(null);
      setMenuOpenId(null);
    }
  }, [collapsed]);

  const handleAddSave = (name: string, domain: string) => {
    onAddTenant(name, domain);
    setShowAddForm(false);
  };

  const handleEditSave = (id: string, name: string, domain: string) => {
    onUpdateTenant(id, name, domain);
    setEditingId(null);
  };

  const handleRemove = (id: string) => {
    setMenuOpenId(null);
    onRemoveTenant(id);
  };

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? '\u25B6' : '\u25C0'}
        </button>
        {!collapsed && <h2>Tenants</h2>}
      </div>
      <div className="sidebar-list">
        {tenants.map((tenant) =>
          !collapsed && editingId === tenant.id ? (
            <div key={tenant.id} className="sidebar-form-wrapper">
              <EditTenantForm
                tenant={tenant}
                onSave={(name, domain) => handleEditSave(tenant.id, name, domain)}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <div key={tenant.id} className="sidebar-item-wrapper">
              <button
                className={`sidebar-item ${tenant.id === activeTenantId ? 'active' : ''}`}
                onClick={() => onSelectTenant(tenant.id)}
                title={collapsed ? `${tenant.name}\n${tenant.domain}` : undefined}
              >
                {collapsed ? (
                  <span
                    className="sidebar-item-avatar"
                    style={{ backgroundColor: getTenantColor(tenant.id) }}
                  >
                    {getInitials(tenant.name)}
                  </span>
                ) : (
                  <>
                    <span
                      className="sidebar-item-dot"
                      style={{ backgroundColor: getTenantColor(tenant.id) }}
                    />
                    <div className="sidebar-item-text">
                      <span className="sidebar-item-name">{tenant.name}</span>
                      <span className="sidebar-item-domain">{tenant.domain}</span>
                    </div>
                  </>
                )}
              </button>
              {!collapsed && (
                <div className="sidebar-item-menu-container">
                  <button
                    className="sidebar-item-menu-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === tenant.id ? null : tenant.id);
                    }}
                  >
                    ...
                  </button>
                  {menuOpenId === tenant.id && (
                    <div className="sidebar-item-menu" ref={menuRef}>
                      <button
                        onClick={() => {
                          setMenuOpenId(null);
                          setEditingId(tenant.id);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="danger"
                        onClick={() => handleRemove(tenant.id)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        )}
        {tenants.length === 0 && !showAddForm && !collapsed && (
          <div className="sidebar-empty">
            No tenants yet. Add one to get started.
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        {!collapsed && showAddForm ? (
          <AddTenantForm
            onSave={handleAddSave}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            className="sidebar-add-btn"
            onClick={() => {
              if (collapsed) onToggleCollapse();
              setShowAddForm(true);
            }}
            title="Add Tenant"
          >
            {collapsed ? '+' : '+ Add Tenant'}
          </button>
        )}
      </div>
    </div>
  );
}
