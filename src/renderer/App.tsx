import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import type { Tenant, PortalId } from '../types/index';
import './App.css';

function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [activePortalId, setActivePortalId] = useState<PortalId>('admin');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const refreshTenants = useCallback(async () => {
    const list = await window.electronAPI.getTenants();
    setTenants(list);
    return list;
  }, []);

  // Load tenants on mount
  useEffect(() => {
    refreshTenants();
  }, [refreshTenants]);

  // Report content area bounds to main process via ResizeObserver
  const sendBounds = useCallback(() => {
    if (!contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    window.electronAPI.updateLayout({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const observer = new ResizeObserver(sendBounds);
    observer.observe(el);
    sendBounds();

    return () => observer.disconnect();
  }, [sendBounds]);

  const handleSelectTenant = useCallback((tenantId: string) => {
    setActiveTenantId(tenantId);
    setActivePortalId('admin');
    requestAnimationFrame(() => {
      window.electronAPI.selectTenant(tenantId, 'admin');
    });
  }, []);

  const handleSelectPortal = useCallback((portalId: PortalId) => {
    if (!activeTenantId) return;
    setActivePortalId(portalId);
    window.electronAPI.selectTenant(activeTenantId, portalId);
  }, [activeTenantId]);

  const handleAddTenant = useCallback(async (name: string, domain: string) => {
    const tenant = await window.electronAPI.addTenant({ name, domain });
    await refreshTenants();
    // Auto-select the new tenant
    handleSelectTenant(tenant.id);
  }, [refreshTenants, handleSelectTenant]);

  const handleUpdateTenant = useCallback(async (id: string, name: string, domain: string) => {
    await window.electronAPI.updateTenant(id, { name, domain });
    await refreshTenants();
  }, [refreshTenants]);

  const handleRemoveTenant = useCallback(async (id: string) => {
    await window.electronAPI.removeTenant(id);
    const list = await refreshTenants();
    // If we removed the active tenant, clear selection
    if (activeTenantId === id) {
      if (list.length > 0) {
        handleSelectTenant(list[0].id);
      } else {
        setActiveTenantId(null);
      }
    }
  }, [activeTenantId, refreshTenants, handleSelectTenant]);

  return (
    <div className="app">
      <Sidebar
        tenants={tenants}
        activeTenantId={activeTenantId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onSelectTenant={handleSelectTenant}
        onAddTenant={handleAddTenant}
        onUpdateTenant={handleUpdateTenant}
        onRemoveTenant={handleRemoveTenant}
      />
      <div className="main-area">
        {activeTenantId ? (
          <TabBar
            activePortalId={activePortalId}
            onSelectPortal={handleSelectPortal}
          />
        ) : null}
        <div className="content-area" ref={contentRef}>
          {!activeTenantId && (
            <div className="content-placeholder">
              <p>
                {tenants.length === 0
                  ? 'Add a tenant to get started.'
                  : 'Select a tenant from the sidebar.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
