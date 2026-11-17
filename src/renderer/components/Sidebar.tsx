import { useState, useRef, useEffect } from 'react';
import type { Tenant, ToolSite } from '../../types/index';
import AddTenantForm from './AddTenantForm';
import EditTenantForm from './EditTenantForm';
import { getTenantColor } from '../tenant-identity';

interface SidebarProps {
  tenants: Tenant[];
  tools: ToolSite[];
  activeTenantId: string | null;
  activeToolId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTenant: (tenantId: string) => void;
  onSelectTool: (toolId: string) => void;
  onAddTenant: (name: string, domain: string) => void | Promise<void>;
  onUpdateTenant: (id: string, name: string, domain: string) => void | Promise<void>;
  onRemoveTenant: (id: string) => void | Promise<void>;
  onClearSession: (id: string) => void | Promise<void>;
  onAddTool: (label: string, url: string) => void | Promise<void>;
  onRemoveTool: (id: string) => void | Promise<void>;
  onBackupData: () => void | Promise<void>;
  onRestoreData: () => void | Promise<void>;
  onOpenSettings: () => void;
}

// Icon lookups survive re-renders and collapsing; keyed by the site so an edit refetches.
const siteIconRequests = new Map<string, Promise<string | null>>();
const siteIcons = new Map<string, string | null>();

function SiteIcon({ kind, id, site, color }: { kind: 'tenant' | 'tool'; id: string; site: string; color: string }) {
  const key = `${kind}:${id}:${site}`;
  const [icon, setIcon] = useState(() => siteIcons.get(key) ?? null);

  useEffect(() => {
    let current = true;
    setIcon(siteIcons.get(key) ?? null);
    let request = siteIconRequests.get(key);
    if (!request) {
      request = window.electronAPI.getSiteIcon(kind, id).catch(() => null);
      siteIconRequests.set(key, request);
    }
    void request.then((value) => {
      siteIcons.set(key, value);
      if (current) setIcon(value);
    });
    return () => {
      current = false;
    };
  }, [key, kind, id]);

  return (
    <span className="sidebar-item-mark">
      {icon ? (
        <img className="sidebar-item-icon" src={icon} alt="" onError={() => setIcon(null)} />
      ) : (
        <span className="sidebar-item-dot" style={{ backgroundColor: color }} />
      )}
    </span>
  );
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
  tools,
  activeTenantId,
  activeToolId,
  collapsed,
  onToggleCollapse,
  onSelectTenant,
  onSelectTool,
  onAddTenant,
  onUpdateTenant,
  onRemoveTenant,
  onClearSession,
  onAddTool,
  onRemoveTool,
  onBackupData,
  onRestoreData,
  onOpenSettings,
}: SidebarProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddToolForm, setShowAddToolForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [toolMenuOpenId, setToolMenuOpenId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toolLabel, setToolLabel] = useState('');
  const [toolUrl, setToolUrl] = useState('');
  const [toolError, setToolError] = useState('');
  const [isAddingTool, setIsAddingTool] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toolMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpenId && !toolMenuOpenId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuOpenId && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
      if (toolMenuOpenId && toolMenuRef.current && !toolMenuRef.current.contains(e.target as Node)) {
        setToolMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpenId, toolMenuOpenId]);

  // Close forms when collapsing
  useEffect(() => {
    if (collapsed) {
      setShowAddForm(false);
      setShowAddToolForm(false);
      setEditingId(null);
      setMenuOpenId(null);
      setToolMenuOpenId(null);
      setSearchQuery('');
    }
  }, [collapsed]);

  const handleAddSave = async (name: string, domain: string) => {
    await onAddTenant(name, domain);
    setShowAddForm(false);
  };

  const handleEditSave = async (id: string, name: string, domain: string) => {
    await onUpdateTenant(id, name, domain);
    setEditingId(null);
  };

  const handleRemove = async (id: string) => {
    setMenuOpenId(null);
    try {
      await onRemoveTenant(id);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to remove the tenant.');
    }
  };

  const handleAddToolSave = async () => {
    const trimmedLabel = toolLabel.trim();
    const trimmedUrl = toolUrl.trim();
    if (!trimmedLabel || !trimmedUrl || isAddingTool) return;
    setToolError('');
    setIsAddingTool(true);
    try {
      await onAddTool(trimmedLabel, trimmedUrl);
      setToolLabel('');
      setToolUrl('');
      setShowAddToolForm(false);
    } catch {
      setToolError('Enter a valid HTTPS URL.');
    } finally {
      setIsAddingTool(false);
    }
  };

  const handleRemoveTool = async (id: string) => {
    setToolMenuOpenId(null);
    try {
      await onRemoveTool(id);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to remove the tool.');
    }
  };

  // Filter tenants by search query
  const filteredTenants = searchQuery
    ? tenants.filter((t) => {
        const q = searchQuery.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.domain.toLowerCase().includes(q);
      })
    : tenants;

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? '\u25B6' : '\u25C0'}
        </button>
        {!collapsed && <h2>Tenants</h2>}
      </div>
      <div className="sidebar-tools">
        {!collapsed && (
          <div className="sidebar-tools-header">
            <span className="sidebar-section-label" style={{ padding: 0 }}>Tools</span>
            <button
              className="sidebar-tools-add-btn"
              onClick={() => setShowAddToolForm(!showAddToolForm)}
              title="Add Tool"
            >
              +
            </button>
          </div>
        )}
        {!collapsed && showAddToolForm && (
          <div className="sidebar-form-wrapper">
            <div className="tenant-form">
              <input
                autoFocus
                placeholder="Label"
                value={toolLabel}
                onChange={(e) => {
                  setToolLabel(e.target.value);
                  setToolError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowAddToolForm(false);
                    setToolLabel('');
                    setToolUrl('');
                  }
                }}
              />
              <input
                placeholder="URL (https://...)"
                value={toolUrl}
                onChange={(e) => {
                  setToolUrl(e.target.value);
                  setToolError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddToolSave();
                  if (e.key === 'Escape') {
                    setShowAddToolForm(false);
                    setToolLabel('');
                    setToolUrl('');
                  }
                }}
              />
              {toolError && <div className="tab-add-error">{toolError}</div>}
              <div className="tenant-form-actions">
                <button
                  className="btn-save"
                  disabled={!toolLabel.trim() || !toolUrl.trim() || isAddingTool}
                  onClick={() => void handleAddToolSave()}
                >
                  {isAddingTool ? 'Adding...' : 'Add'}
                </button>
                <button
                  className="btn-cancel"
                  onClick={() => {
                    setShowAddToolForm(false);
                    setToolLabel('');
                    setToolUrl('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {tools.map((tool) => (
          <div key={tool.id} className="sidebar-item-wrapper">
            <button
              className={`sidebar-item ${activeToolId === tool.id ? 'active' : ''}`}
              onClick={() => onSelectTool(tool.id)}
              title={collapsed ? tool.label : undefined}
            >
              {collapsed ? (
                <span className="sidebar-item-avatar" style={{ backgroundColor: '#f97316' }}>
                  {tool.label.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <>
                  <SiteIcon kind="tool" id={tool.id} site={tool.url} color="#f97316" />
                  <div className="sidebar-item-text">
                    <span className="sidebar-item-name">{tool.label}</span>
                    <span className="sidebar-item-domain">{tool.url.replace('https://', '')}</span>
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
                    setToolMenuOpenId(toolMenuOpenId === tool.id ? null : tool.id);
                  }}
                >
                  ...
                </button>
                {toolMenuOpenId === tool.id && (
                  <div className="sidebar-item-menu" ref={toolMenuRef}>
                    <button
                      className="danger"
                      onClick={() => void handleRemoveTool(tool.id)}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {tools.length === 0 && !showAddToolForm && !collapsed && (
          <div className="sidebar-empty" style={{ padding: '0.5rem 1rem' }}>
            No tools yet.
          </div>
        )}
      </div>
      {!collapsed && <div className="sidebar-section-label">Tenants</div>}
      {!collapsed && (
        <div className="sidebar-search">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search tenants..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('');
                searchInputRef.current?.blur();
              }
            }}
          />
        </div>
      )}
      <div className="sidebar-list">
        {filteredTenants.map((tenant) =>
          !collapsed && editingId === tenant.id ? (
            <div key={tenant.id} className="sidebar-form-wrapper">
              <EditTenantForm
                tenant={tenant}
                onSave={(name, domain) => handleEditSave(tenant.id, name, domain)}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <div key={tenant.id} className={`sidebar-item-wrapper${menuOpenId === tenant.id ? ' menu-open' : ''}`}>
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
                    <SiteIcon
                      kind="tenant"
                      id={tenant.id}
                      site={tenant.domain}
                      color={getTenantColor(tenant.id)}
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
                        onClick={() => {
                          setMenuOpenId(null);
                          void Promise.resolve(onClearSession(tenant.id)).catch((error) => {
                            alert(
                              error instanceof Error
                                ? error.message
                                : 'Unable to clear the tenant session.',
                            );
                          });
                        }}
                      >
                        Clear Session
                      </button>
                      <button
                        className="danger"
                        onClick={() => void handleRemove(tenant.id)}
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
        {filteredTenants.length === 0 && searchQuery && !collapsed && (
          <div className="sidebar-empty">
            No matching tenants.
          </div>
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
        {!collapsed && (
          <div className="sidebar-maintenance-actions">
            <button onClick={() => void onBackupData()}>Backup Configuration</button>
            <button onClick={() => void onRestoreData()}>Restore Configuration</button>
            <button className="sidebar-settings-button" onClick={onOpenSettings}>Settings</button>
          </div>
        )}
        {!collapsed && (
          <button
            className="sidebar-update-link"
            onClick={() => window.electronAPI.checkForUpdates()}
            style={{
              background: 'none',
              border: 'none',
              color: '#6c7086',
              fontSize: '0.7rem',
              cursor: 'pointer',
              padding: '4px 0',
              marginTop: '4px',
              textAlign: 'center',
              width: '100%',
            }}
          >
            Check for Updates
          </button>
        )}
      </div>
    </div>
  );
}
