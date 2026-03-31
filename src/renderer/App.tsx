import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import NavBar from './components/NavBar';
import type { Tenant, PortalId, NavState } from '../types/index';
import './App.css';

const EMPTY_NAV: NavState = { canGoBack: false, canGoForward: false, isLoading: false, url: '' };

function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [activePortalId, setActivePortalId] = useState<PortalId>('admin');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navState, setNavState] = useState<NavState>(EMPTY_NAV);
  const contentRef = useRef<HTMLDivElement>(null);

  const refreshTenants = useCallback(async () => {
    const list = await window.electronAPI.getTenants();
    setTenants(list);
    return list;
  }, []);

  useEffect(() => {
    refreshTenants();
  }, [refreshTenants]);

  useEffect(() => {
    const cleanup = window.electronAPI.onNavState(setNavState);
    return cleanup;
  }, []);

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
    setActiveToolId(null);
    setActivePortalId('admin');
    requestAnimationFrame(() => {
      window.electronAPI.selectTenant(tenantId, 'admin');
    });
  }, []);

  const handleSelectTool = useCallback((toolId: string) => {
    setActiveToolId(toolId);
    setActiveTenantId(null);
    requestAnimationFrame(() => {
      window.electronAPI.selectTool(toolId);
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
    handleSelectTenant(tenant.id);
  }, [refreshTenants, handleSelectTenant]);

  const handleUpdateTenant = useCallback(async (id: string, name: string, domain: string) => {
    await window.electronAPI.updateTenant(id, { name, domain });
    await refreshTenants();
  }, [refreshTenants]);

  const handleRemoveTenant = useCallback(async (id: string) => {
    await window.electronAPI.removeTenant(id);
    const list = await refreshTenants();
    if (activeTenantId === id) {
      if (list.length > 0) {
        handleSelectTenant(list[0].id);
      } else {
        setActiveTenantId(null);
        setNavState(EMPTY_NAV);
      }
    }
  }, [activeTenantId, refreshTenants, handleSelectTenant]);

  const hasActiveView = activeTenantId || activeToolId;

  return (
    <div className="app">
      <Sidebar
        tenants={tenants}
        activeTenantId={activeTenantId}
        activeToolId={activeToolId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onSelectTenant={handleSelectTenant}
        onSelectTool={handleSelectTool}
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
        {hasActiveView ? <NavBar navState={navState} /> : null}
        <div className="content-area" ref={contentRef}>
          {!hasActiveView && (
            <div className="content-placeholder">
              <p>
                {tenants.length === 0
                  ? 'Add a tenant to get started.'
                  : 'Select a tenant or tool from the sidebar.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
